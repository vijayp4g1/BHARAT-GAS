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

function cleanAndNormalizeDigits(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/I|L|\|/g, '1')
    .replace(/O|Q/g, '0')
    .replace(/B/g, '8')
    .replace(/Z/g, '2')
    .replace(/S/g, '5')
    .replace(/G/g, '6')
    .replace(/T/g, '7')
    .replace(/[^0-9]/g, '');
}

function getLevenshteinDistance(a: string, b: string): number {
  const tmp: number[][] = [];
  let i, j;
  for (i = 0; i <= a.length; i++) {
    tmp[i] = [i];
  }
  for (j = 0; j <= b.length; j++) {
    tmp[0][j] = j;
  }
  for (i = 1; i <= a.length; i++) {
    for (j = 1; j <= b.length; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1,
        tmp[i][j - 1] + 1,
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return tmp[a.length][b.length];
}

function areNamesSimilar(scanned: string, dbName: string): boolean {
  const s = scanned.toLowerCase().replace(/[^a-z]/g, '');
  const d = dbName.toLowerCase().replace(/[^a-z]/g, '');
  
  if (s.length === 0 || d.length === 0) return false;
  
  if (s.length <= 3 || d.length <= 3) {
    return d.includes(s) || s.includes(d);
  }
  
  if (d.includes(s) || s.includes(d)) return true;
  
  const dist = getLevenshteinDistance(s, d.substring(0, s.length));
  const maxLen = Math.max(s.length, Math.min(d.length, s.length));
  const similarity = 1 - dist / maxLen;
  return similarity >= 0.5;
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

  // Normalize line breaks and colons to facilitate line matching
  const normalizedText = text
    .replace(/;/g, ':')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const lines = normalizedText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  // Regex patterns allowing digit-lookalike letters (e.g. B->8, l->1, O->0)
  const numberPatterns = [
    /(?:Cons\s*No|Consumer\s*No|ConsNo|Cons\s*No\s*:)[:.\s]*([0-9I|liOoQBZzSsGgTt]{5,12})/i,
    /Cons\s*No\s*[:.\s]*([0-9I|liOoQBZzSsGgTt]{5,12})/i,
    /(?:Cons|Consumer|Refill)[:.\s]*#?([0-9I|liOoQBZzSsGgTt]{5,12})/i,
  ];
  const standalonePattern = /\b([0-9I|liOoQBZzSsGgTt]{6,10})\b/;

  let firstDetectedNum = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let candidateNum = '';

    // 1. Try matching explicit consumer number patterns
    for (const pat of numberPatterns) {
      const match = line.match(pat);
      if (match && match[1]) {
        candidateNum = match[1].trim();
        break;
      }
    }

    // 2. If no pattern matches, try matching standalone numeric words
    if (!candidateNum) {
      const match = line.match(standalonePattern);
      if (match && match[1]) {
        candidateNum = match[1].trim();
      }
    }

    if (!candidateNum) continue;

    const cleanNum = cleanAndNormalizeDigits(candidateNum);
    if (cleanNum.length < 5 || cleanNum.length > 12 || DISTRIBUTOR_BLACKLIST.has(cleanNum)) {
      continue;
    }

    if (!firstDetectedNum) {
      firstDetectedNum = cleanNum;
    }

    // 3. Locate the candidate name line (the first non-empty text line directly below)
    let candidateName = '';
    for (let offset = 1; offset <= 2; offset++) {
      const nextLine = lines[i + offset];
      if (nextLine) {
        // Clean up the line to ignore purely numeric or symbol lines
        const cleanedLine = nextLine.replace(/[^a-zA-Z\s]/g, '').trim();
        if (cleanedLine.length >= 3) {
          const uppercaseWords = cleanedLine.match(/\b[A-Z]{3,15}\b/g) || [];
          const filteredWords = uppercaseWords.filter(
            (w) => !['DETAILS', 'RECEIVER', 'INVOICE', 'BHARATGAS', 'BASE', 'RATE', 'CGST', 'SGST', 'SUB', 'CYL', 'AUTH', 'SIGN', 'DUE'].includes(w)
          );
          if (filteredWords.length > 0) {
            candidateName = cleanedLine;
            break;
          }
        }
      }
    }

    // 4. Verify against local Database
    const localMatch = await db.consumers
      .where('consumer_number')
      .equalsIgnoreCase(cleanNum)
      .first();

    if (localMatch) {
      // Verify the name below the number matches the database record
      if (candidateName) {
        const isNameVerified = areNamesSimilar(candidateName, localMatch.consumer_name);

        if (isNameVerified) {
          console.log(`Found database match by Number #${cleanNum}:`, localMatch);
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
    }

    // 5. Remote Supabase Validation Fallback (verified with name check)
    if (navigator.onLine) {
      const { data: remoteData } = await supabase
        .from('consumers')
        .select('consumer_number, consumer_name, address, mobile')
        .eq('consumer_number', cleanNum)
        .maybeSingle();

      if (remoteData) {
        if (candidateName) {
          const isNameVerified = areNamesSimilar(candidateName, remoteData.consumer_name as string);

          if (isNameVerified) {
            console.log(`Found remote database match by Number #${cleanNum}:`, remoteData);
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
    }
  }

  return {
    consumerNumber: firstDetectedNum,
    found: false,
    rawText: text,
  };
}
