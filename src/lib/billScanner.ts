import db from './db';
import { supabase } from './supabase';
import { scanBillWithGemini } from './gemini';

export interface BillScanResult {
  consumerNumber: string;
  consumerName?: string;
  address?: string;
  mobile?: string;
  found: boolean;
  rawText: string;
  error?: string;
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
 * Extracts Consumer Number & Consumer Name from Siddhartha Bharatgas Bill Receipt photo using Gemini AI
 */
export async function scanBillReceipt(imageFile: File | Blob | string): Promise<BillScanResult> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || localStorage.getItem('VITE_GEMINI_API_KEY');
  
  if (!apiKey) {
    return {
      consumerNumber: '',
      found: false,
      rawText: 'ERROR: Gemini API Key is missing. Please add it to configuration.',
    };
  }

  console.log('Using Gemini Multimodal AI for receipt OCR...');
  const geminiRes = await scanBillWithGemini(imageFile);
  
  if (geminiRes.error) {
    return {
      consumerNumber: '',
      found: false,
      rawText: `Gemini OCR failed: ${geminiRes.error}`,
      error: geminiRes.error,
    };
  }

  const rawTextLog = `[Gemini AI OCR]\nConsumer Number: ${geminiRes.consumerNumber || 'Not Found'}\nConsumer Name: ${geminiRes.consumerName || 'Not Found'}${geminiRes.error ? `\nError: ${geminiRes.error}` : ''}`;

  if (geminiRes.found && geminiRes.consumerNumber) {
    const cleanNum = cleanAndNormalizeDigits(geminiRes.consumerNumber);
    
    // 1. Look up in local master database (Dexie IndexedDB)
    const localMatch = await db.consumers
      .where('consumer_number')
      .equalsIgnoreCase(cleanNum)
      .first();

    if (localMatch) {
      // Analyze and verify both number and name
      const isNameVerified = geminiRes.consumerName
        ? areNamesSimilar(geminiRes.consumerName, localMatch.consumer_name)
        : true;

      if (isNameVerified) {
        console.log(`Found database match by Gemini OCR Number #${cleanNum}:`, localMatch);
        return {
          consumerNumber: localMatch.consumer_number,
          consumerName: localMatch.consumer_name,
          address: localMatch.address,
          mobile: localMatch.mobile,
          found: true,
          rawText: rawTextLog,
        };
      } else {
        console.warn(`Consumer number #${cleanNum} found, but name "${geminiRes.consumerName}" did not match database name "${localMatch.consumer_name}"`);
      }
    }

    // 2. Check remote Supabase fallback
    if (navigator.onLine) {
      const { data: remoteData } = await supabase
        .from('consumers')
        .select('consumer_number, consumer_name, address, mobile')
        .eq('consumer_number', cleanNum)
        .maybeSingle();

      if (remoteData) {
        const isNameVerified = geminiRes.consumerName
          ? areNamesSimilar(geminiRes.consumerName, remoteData.consumer_name as string)
          : true;

        if (isNameVerified) {
          console.log(`Found remote database match by Gemini OCR Number #${cleanNum}:`, remoteData);
          return {
            consumerNumber: remoteData.consumer_number,
            consumerName: remoteData.consumer_name,
            address: remoteData.address,
            mobile: remoteData.mobile,
            found: true,
            rawText: rawTextLog,
          };
        } else {
          console.warn(`Consumer number #${cleanNum} found on remote DB, but name check failed.`);
        }
      }
    }

    // If number detected but verification failed or not found in DB
    return {
      consumerNumber: cleanNum,
      consumerName: geminiRes.consumerName || 'Not Verified',
      found: false,
      rawText: rawTextLog,
    };
  }

  return {
    consumerNumber: '',
    found: false,
    rawText: rawTextLog,
  };
}
