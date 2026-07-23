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
      const contrast = 55;
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
 * Extracts Consumer Number & Consumer Name from Siddhartha Bharatgas Bill Receipt photo
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

  // 1. Target Regex Patterns for Consumer Number (e.g. Cons No:28721381)
  const numberPatterns = [
    /(?:Cons\s*No|Consumer\s*No|ConsNo|Cons\s*No\s*:)[:.\s]*([0-9]{5,12})/i,
    /Cons\s*No\s*[:.\s]*([0-9]{5,12})/i,
    /(?:Cons|Consumer|Refill)[:.\s]*#?([0-9]{5,12})/i,
  ];

  let candidateNumbers: string[] = [];

  for (const pat of numberPatterns) {
    const match = normalizedText.match(pat);
    if (match && match[1]) {
      const num = match[1].trim();
      if (!DISTRIBUTOR_BLACKLIST.has(num)) {
        candidateNumbers.push(num);
      }
    }
  }

  // Secondary candidate digit sequences
  const allDigitMatches = normalizedText.match(/\b([0-9]{6,10})\b/g) || [];
  allDigitMatches.forEach((num) => {
    if (!DISTRIBUTOR_BLACKLIST.has(num) && !candidateNumbers.includes(num)) {
      candidateNumbers.push(num);
    }
  });

  // 2. Target Regex Patterns for Consumer Name (e.g. PRAKASH, PRAKASH BANDIKA)
  const namePatterns = [
    /(?:Cons\s*No|Consumer\s*No)[^\n]*\n\s*([A-Z\s]{3,30})/i,
    /(?:Details\s*of\s*Receiver)[^\n]*\n[^\n]*\n\s*([A-Z\s]{3,30})/i,
    /\b(PRAKASH|BANDIKA|[A-Z]{4,15})\b/g,
  ];

  let candidateNames: string[] = [];

  const nameMatch1 = normalizedText.match(/(?:Cons\s*No|ConsNo|Consumer\s*No)[^\n]*\n\s*([A-Z\s]{3,25})/i);
  if (nameMatch1 && nameMatch1[1]) {
    const nameStr = nameMatch1[1].trim();
    if (nameStr.length >= 3 && !['DETAILS', 'RECEIVER', 'INVOICE', 'BHARATGAS'].includes(nameStr)) {
      candidateNames.push(nameStr);
    }
  }

  console.log('Candidate numbers:', candidateNumbers);
  console.log('Candidate names:', candidateNames);

  // 3. Primary AI Search: Match Consumer Number in 31k IndexedDB
  for (const candidate of candidateNumbers) {
    const localMatch = await db.consumers
      .where('consumer_number')
      .equalsIgnoreCase(candidate)
      .first();

    if (localMatch) {
      console.log(`Found database match by Number #${candidate}:`, localMatch);
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

  // 4. Secondary AI Search: Match Consumer Name in 31k IndexedDB
  for (const nameCandidate of candidateNames) {
    const cleanName = nameCandidate.split('\n')[0].trim();
    if (cleanName.length < 3) continue;

    // Search IndexedDB for consumer_name
    const nameMatches = await db.consumers
      .filter((c) => !!(c.consumer_name && c.consumer_name.toLowerCase().includes(cleanName.toLowerCase())))
      .limit(5)
      .toArray();

    if (nameMatches.length > 0) {
      const topMatch = nameMatches[0];
      console.log(`Found database match by Name "${cleanName}":`, topMatch);
      return {
        consumerNumber: topMatch.consumer_number,
        consumerName: topMatch.consumer_name,
        address: topMatch.address,
        mobile: topMatch.mobile,
        found: true,
        rawText: text,
      };
    }
  }

  // 5. Remote Supabase Validation Fallback
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

  return {
    consumerNumber: candidateNumbers.length > 0 ? candidateNumbers[0] : '',
    found: false,
    rawText: text,
  };
}
