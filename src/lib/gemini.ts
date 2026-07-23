export interface GeminiOcrResult {
  consumerNumber: string;
  consumerName: string;
  found: boolean;
  error?: string;
}

/**
 * Converts a File, Blob, or canvas image URL to a base64 string + mime type
 */
async function fileToGenerativePart(
  imageSource: File | Blob | string
): Promise<{ inlineData: { data: string; mimeType: string } }> {
  let blob: Blob;

  if (typeof imageSource === 'string') {
    if (imageSource.startsWith('data:')) {
      const parts = imageSource.split(',');
      const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
      const data = parts[1];
      return {
        inlineData: { data, mimeType: mime },
      };
    }
    const res = await fetch(imageSource);
    blob = await res.blob();
  } else {
    blob = imageSource;
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64Data = (reader.result as string).split(',')[1];
      resolve({
        inlineData: {
          data: base64Data,
          mimeType: blob.type || 'image/png',
        },
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
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
    const imgPart = await fileToGenerativePart(imageSource);

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
