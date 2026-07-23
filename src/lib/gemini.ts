export interface GeminiOcrResult {
  consumerNumber: string;
  consumerName: string;
  found: boolean;
  error?: string;
}

/**
 * Resizes and compresses an image (File, Blob, or Data URL) on an HTML canvas
 * to a maximum dimension of 1000px and converts it to a compressed JPEG (70% quality).
 * This reduces network payload size by 90%+ and speeds up Gemini API response time.
 */
async function resizeAndCompressImage(
  imageSource: File | Blob | string,
  maxDimension: number = 1000
): Promise<{ data: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      // Maintain aspect ratio while resizing
      if (width > height) {
        if (width > maxDimension) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        }
      } else {
        if (height > maxDimension) {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get canvas 2D context'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      // Convert to compressed JPEG
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      const base64Data = dataUrl.split(',')[1];
      resolve({
        data: base64Data,
        mimeType: 'image/jpeg',
      });
    };

    img.onerror = (err) => {
      reject(err);
    };

    if (typeof imageSource === 'string') {
      img.src = imageSource;
    } else {
      const reader = new FileReader();
      reader.onloadend = () => {
        img.src = reader.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(imageSource);
    }
  });
}

/**
 * Sends a receipt image to Google Gemini API to parse the consumer number and name
 */
export async function scanBillWithGemini(
  imageSource: File | Blob | string
): Promise<GeminiOcrResult> {
  const apiKey =
    import.meta.env.VITE_GEMINI_API_KEY ||
    localStorage.getItem('VITE_GEMINI_API_KEY');

  if (!apiKey) {
    return {
      consumerNumber: '',
      consumerName: '',
      found: false,
      error: 'API_KEY_MISSING',
    };
  }

  try {
    const compressed = await resizeAndCompressImage(imageSource);
    const imgPart = {
      inlineData: {
        data: compressed.data,
        mimeType: compressed.mimeType,
      },
    };

    // Call gemini-3.6-flash endpoint
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;

    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: "You are an expert OCR parser for LPG utility bills. Extract the Customer's unique Consumer Number (labeled as Cons No, Consumer No, Refill No, etc., usually 8 digits like 28721381) and the Customer's Name (e.g. PRAKASH). Respond ONLY with a clean JSON object matching this schema, without markdown formatting or backticks: {\"consumerNumber\": \"...\", \"consumerName\": \"...\"}. If not visible, leave empty.",
            },
            imgPart,
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errText}`);
    }

    const resData = await response.json();
    const responseText =
      resData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    const parsed = JSON.parse(responseText.trim());
    const consumerNumber = parsed.consumerNumber
      ? String(parsed.consumerNumber).trim()
      : '';
    const consumerName = parsed.consumerName
      ? String(parsed.consumerName).trim()
      : '';

    if (consumerNumber) {
      return {
        consumerNumber,
        consumerName,
        found: true,
      };
    }

    return {
      consumerNumber: '',
      consumerName: '',
      found: false,
    };
  } catch (err: any) {
    console.error('Gemini OCR scan failed:', err);
    return {
      consumerNumber: '',
      consumerName: '',
      found: false,
      error: err.message || 'Unknown error',
    };
  }
}
