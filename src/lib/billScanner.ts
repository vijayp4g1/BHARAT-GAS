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

// Known non-consumer numbers (distributor codes, telephone numbers, pin codes, GST numbers, SMS numbers)
const DISTRIBUTOR_BLACKLIST = new Set([
  '169624',
  '23092200',
  '23192200',
  '23192211',
  '1800224344',
  '7718012345',
  '7715012345',
  '1718012345',
  '17718012345',
  '17715012345',
  '36406262986',
  '500054',
  '271119',
  '99400',
  '94666',
  '2367',
  '19441220350',
]);

/**
 * Pre-processes image on HTML Canvas (grayscale + contrast boost)
 * for optimal thermal paper receipt OCR detection.
 */
export async function preprocessImage(imageSource: File | Blob | string): Promise<string> {
  return new Promise((resolve) => {
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

      // Contrast boost for thermal print receipts
      const contrast = 50;
      const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

      for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const color = factor * (avg - 128) + 128;
        const finalColor = color < 120 ? 0 : 255;

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
  const {
    data: { text },
  } = await worker.recognize(processedImg);
  await worker.terminate();

  console.log('--- OCR Extracted Text ---');
  console.log(text);

  // Clean OCR text for thermal print noise (e.g. c0ns -> cons, n0 -> no)
  const normalizedText = text
    .replace(/c0ns/gi, 'cons')
    .replace(/n0/gi, 'no')
    .replace(/;/g, ':');

  // 1. High-priority targeted regex patterns for "Cons No:28721381"
  const patterns = [
    /(?:Cons\s*No|Consumer\s*No|ConsNo|Cons\s*No\s*:)[:.\s]*([0-9]{5,12})/i,
    /Cons\s*No\s*[:.\s]*([0-9]{5,12})/i,
    /(?:Cons|Consumer|Refill)[:.\s]*#?([0-9]{5,12})/i,
  ];

  let candidateNumbers: string[] = [];

  for (const pat of patterns) {
    const match = normalizedText.match(pat);
    if (match && match[1]) {
      const num = match[1].trim();
      if (!DISTRIBUTOR_BLACKLIST.has(num)) {
        candidateNumbers.push(num);
      }
    }
  }

  // 2. Extract all 6-10 digit numbers from OCR text as secondary candidates
  const allDigitMatches = normalizedText.match(/\b([0-9]{6,10})\b/g) || [];
  allDigitMatches.forEach((num) => {
    if (!DISTRIBUTOR_BLACKLIST.has(num) && !candidateNumbers.includes(num)) {
      candidateNumbers.push(num);
    }
  });

  console.log('Candidate numbers extracted:', candidateNumbers);

  // 3. Database Validation: Check candidates against 31k master IndexedDB
  for (const candidate of candidateNumbers) {
    const localMatch = await db.consumers
      .where('consumer_number')
      .equalsIgnoreCase(candidate)
      .first();

    if (localMatch) {
      console.log(`Found database match for candidate #${candidate}:`, localMatch);
      return {
        consumerNumber: localMatch.consumer_number,
        consumerName: localMatch.consumer_name,
        address: localMatch.address,
        mobile: localMatch.mobile,
        found: true,
        rawText: text,
      };
    }
  }

  // 4. Remote Supabase Validation Fallback
  if (navigator.onLine) {
    for (const candidate of candidateNumbers) {
      const { data: remoteData } = await supabase
        .from('consumers')
        .select('consumer_number, consumer_name, address, mobile')
        .eq('consumer_number', candidate)
        .maybeSingle();

      if (remoteData) {
        return {
          consumerNumber: remoteData.consumer_number,
          consumerName: remoteData.consumer_name,
          address: remoteData.address,
          mobile: remoteData.mobile,
          found: true,
          rawText: text,
        };
      }
    }
  }

  // If no candidate matched the 31k database, return found: false (never add random numbers)
  return {
    consumerNumber: candidateNumbers.length > 0 ? candidateNumbers[0] : '',
    found: false,
    rawText: text,
  };
}
