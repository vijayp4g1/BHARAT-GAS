import { createWorker } from 'tesseract.js';
import db from './db';
import { supabase } from './supabase';

export interface BillScanResult {
  consumerNumber: string;
  consumerName?: string;
  address?: string;
  mobile?: string;
  found: boolean;
  rawText: string;
}

/**
 * Pre-processes image on HTML Canvas (grayscale + contrast boost)
 * for optimal thermal paper receipt OCR detection.
 */
export async function preprocessImage(imageSource: File | Blob | string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        resolve(typeof imageSource === 'string' ? imageSource : URL.createObjectURL(imageSource));
        return;
      }

      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;

      // Grayscale + Contrast adjustment
      const contrast = 40; // contrast factor
      const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

      for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const color = factor * (avg - 128) + 128;
        const finalColor = color < 128 ? 0 : 255; // Binarize for print receipts

        data[i] = finalColor;
        data[i + 1] = finalColor;
        data[i + 2] = finalColor;
      }

      ctx.putImageData(imgData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };

    img.onerror = () => {
      resolve(typeof imageSource === 'string' ? imageSource : URL.createObjectURL(imageSource));
    };

    if (typeof imageSource === 'string') {
      img.src = imageSource;
    } else {
      img.src = URL.createObjectURL(imageSource);
    }
  });
}

/**
 * Extracts Consumer Number from Siddhartha Bharatgas Bill Receipt photo
 */
export async function scanBillReceipt(imageFile: File | Blob | string): Promise<BillScanResult> {
  const processedImg = await preprocessImage(imageFile);
  
  // Run Tesseract OCR on processed image
  const worker = await createWorker('eng');
  const { data: { text } } = await worker.recognize(processedImg);
  await worker.terminate();

  console.log('--- OCR Extracted Text ---');
  console.log(text);

  // 1. Specific Siddhartha Bharatgas Regex Patterns for "Cons No:28721381"
  const patterns = [
    /(?:Cons\s*No|Consumer\s*No|ConsNo|Cons\s*No\s*:)[:.\s]*([0-9]{5,12})/i,
    /(?:Cons|Consumer|Refill)[:.\s]*#?([0-9]{5,12})/i,
    /No[:.\s]*([0-9]{6,10})/i
  ];

  let extractedNum = '';

  for (const pat of patterns) {
    const match = text.match(pat);
    if (match && match[1]) {
      extractedNum = match[1].trim();
      break;
    }
  }

  // 2. Fallback: Search for any 7-9 digit standalone number in OCR text
  if (!extractedNum) {
    const standaloneDigits = text.match(/\b([0-9]{7,9})\b/g);
    if (standaloneDigits && standaloneDigits.length > 0) {
      // Pick first matching digit sequence
      extractedNum = standaloneDigits[0];
    }
  }

  if (!extractedNum) {
    return {
      consumerNumber: '',
      found: false,
      rawText: text
    };
  }

  // 3. Resolve extracted consumer number against 31k database
  const localMatch = await db.consumers
    .where('consumer_number')
    .equalsIgnoreCase(extractedNum)
    .first();

  if (localMatch) {
    return {
      consumerNumber: localMatch.consumer_number,
      consumerName: localMatch.consumer_name,
      address: localMatch.address,
      mobile: localMatch.mobile,
      found: true,
      rawText: text
    };
  }

  // Remote Supabase lookup fallback
  if (navigator.onLine) {
    const { data: remoteData } = await supabase
      .from('consumers')
      .select('consumer_number, consumer_name, address, mobile')
      .eq('consumer_number', extractedNum)
      .maybeSingle();

    if (remoteData) {
      return {
        consumerNumber: remoteData.consumer_number,
        consumerName: remoteData.consumer_name,
        address: remoteData.address,
        mobile: remoteData.mobile,
        found: true,
        rawText: text
      };
    }
  }

  return {
    consumerNumber: extractedNum,
    found: false,
    rawText: text
  };
}
