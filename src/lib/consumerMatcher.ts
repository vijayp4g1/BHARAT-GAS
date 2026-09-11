import db, { type Consumer } from './db';
import { supabase } from './supabase';

export interface MatchResult {
  consumer_number: string;
  consumer_name: string;
  address: string;
  mobile: string;
  found: boolean;
  corrected?: boolean;
  original_number?: string;
}

/**
 * Strips common honorifics and non-alphanumeric noise to isolate distinctive name tokens.
 * Keeps tokens with length >= 2 and filters out stopwords.
 */
export function cleanNameWords(raw: string): string[] {
  return raw
    .toUpperCase()
    .replace(/\b(MR|MRS|MS|MISS|SMT|SHRI|DR|M\/S)\.?\b/g, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !/^(AND|THE|FOR|NOT|GAS)$/.test(w));
}

/**
 * Computes digit suffix match score. If the last 7 digits match (e.g. 69994449 vs 89994449),
 * this strongly confirms a 1-digit OCR distortion.
 */
export function scoreDigitsSuffix(targetNum: string, queryNum: string): number {
  let score = 0;
  for (let i = 1; i <= Math.min(targetNum.length, queryNum.length); i++) {
    if (targetNum[targetNum.length - i] === queryNum[queryNum.length - i]) {
      score++;
    } else {
      break;
    }
  }
  return score;
}

/**
 * Intelligent Consumer Matcher:
 * 1. Tries direct Consumer Number in local Dexie database.
 * 2. Tries direct Consumer Number in remote Supabase (manager_consumer_summary & consumers).
 * 3. If number is blurred/unclear or 1-digit misread, searches by Customer Name in local Dexie.
 * 4. If not found in Dexie, searches by Customer Name in remote Supabase (manager_consumer_summary).
 * 5. If matched by Name, automatically CORRECTS the Consumer Number to the verified database number!
 */
export async function matchConsumerWithDatabase(
  rawNum: string,
  rawName?: string
): Promise<MatchResult> {
  const cleanNum = (rawNum || '').replace(/[^0-9]/g, '');
  const words = cleanNameWords(rawName || '');

  // 1. Direct number match in local Dexie
  if (cleanNum) {
    const localByNum = await db.consumers
      .where('consumer_number')
      .equalsIgnoreCase(cleanNum)
      .first();

    if (localByNum) {
      return {
        consumer_number: localByNum.consumer_number,
        consumer_name: localByNum.consumer_name,
        address: localByNum.address || '',
        mobile: localByNum.mobile || '',
        found: true,
      };
    }
  }

  // 2. Direct number match in remote Supabase
  if (cleanNum && navigator.onLine) {
    try {
      const { data: remoteByNum } = await supabase
        .from('manager_consumer_summary')
        .select('id, consumer_number, consumer_name, address, mobile')
        .eq('consumer_number', cleanNum)
        .maybeSingle();

      if (remoteByNum) {
        const cached: Consumer = {
          id: remoteByNum.id,
          consumer_number: remoteByNum.consumer_number,
          consumer_name: remoteByNum.consumer_name,
          address: remoteByNum.address || '',
          mobile: remoteByNum.mobile || '',
          verification_status: 'Verified',
          created_at: new Date().toISOString(),
          searchWords: [
            ...remoteByNum.consumer_name.toLowerCase().split(/\s+/),
            remoteByNum.consumer_number.toLowerCase(),
          ],
        };
        await db.consumers.put(cached).catch(() => {});

        return {
          consumer_number: remoteByNum.consumer_number,
          consumer_name: remoteByNum.consumer_name,
          address: remoteByNum.address || '',
          mobile: remoteByNum.mobile || '',
          found: true,
        };
      }
    } catch (err) {
      console.warn('Remote number match check error:', err);
    }
  }

  // 3. Number was blurred / misread: Search by Name in Local Dexie
  if (words.length > 0) {
    try {
      const localCandidates = await db.consumers
        .where('searchWords')
        .anyOfIgnoreCase(words.map((w) => w.toLowerCase()))
        .toArray();

      const exactLocal = localCandidates.filter((cand) => {
        const cName = cand.consumer_name.toUpperCase();
        return words.every((w) => cName.includes(w));
      });

      const pool = exactLocal.length > 0 ? exactLocal : localCandidates;

      if (pool.length > 0) {
        let bestLocal = pool[0];
        if (pool.length > 1 && cleanNum) {
          pool.sort(
            (a, b) =>
              scoreDigitsSuffix(b.consumer_number, cleanNum) -
              scoreDigitsSuffix(a.consumer_number, cleanNum)
          );
          bestLocal = pool[0];
        }

        const isMatchConfident =
          exactLocal.length > 0 ||
          (cleanNum && scoreDigitsSuffix(bestLocal.consumer_number, cleanNum) >= 3);

        if (isMatchConfident) {
          return {
            consumer_number: bestLocal.consumer_number,
            consumer_name: bestLocal.consumer_name,
            address: bestLocal.address || '',
            mobile: bestLocal.mobile || '',
            found: true,
            corrected: bestLocal.consumer_number !== cleanNum,
            original_number: cleanNum,
          };
        }
      }
    } catch (dexErr) {
      console.warn('Local name search error:', dexErr);
    }
  }

  // 4. Search by Name in Remote Supabase (manager_consumer_summary)
  if (words.length > 0 && navigator.onLine) {
    try {
      let query = supabase
        .from('manager_consumer_summary')
        .select('id, consumer_number, consumer_name, address, mobile');

      for (const w of words) {
        query = query.ilike('consumer_name', `%${w}%`);
      }

      let { data: remoteCandidates } = await query.limit(10);

      // Fallback: if searching all tokens returned nothing, try distinctive individual words (length >= 4)
      if (!remoteCandidates || remoteCandidates.length === 0) {
        for (const w of words.filter((word) => word.length >= 4)) {
          const { data: partialData } = await supabase
            .from('manager_consumer_summary')
            .select('id, consumer_number, consumer_name, address, mobile')
            .ilike('consumer_name', `%${w}%`)
            .limit(10);

          if (partialData && partialData.length > 0) {
            remoteCandidates = partialData;
            break;
          }
        }
      }

      if (remoteCandidates && remoteCandidates.length > 0) {
        let best = remoteCandidates[0];
        if (remoteCandidates.length > 1 && cleanNum) {
          remoteCandidates.sort(
            (a, b) =>
              scoreDigitsSuffix(b.consumer_number, cleanNum) -
              scoreDigitsSuffix(a.consumer_number, cleanNum)
          );
          best = remoteCandidates[0];
        }

        // Cache into local Dexie for future offline lookups
        const cached: Consumer = {
          id: best.id,
          consumer_number: best.consumer_number,
          consumer_name: best.consumer_name,
          address: best.address || '',
          mobile: best.mobile || '',
          verification_status: 'Verified',
          created_at: new Date().toISOString(),
          searchWords: [
            ...best.consumer_name.toLowerCase().split(/\s+/),
            best.consumer_number.toLowerCase(),
          ],
        };
        await db.consumers.put(cached).catch(() => {});

        return {
          consumer_number: best.consumer_number,
          consumer_name: best.consumer_name,
          address: best.address || '',
          mobile: best.mobile || '',
          found: true,
          corrected: best.consumer_number !== cleanNum,
          original_number: cleanNum,
        };
      }
    } catch (supErr) {
      console.warn('Remote name search error:', supErr);
    }
  }

  // 5. Unverified fallback if no number or name matched
  return {
    consumer_number: cleanNum || 'UNKNOWN',
    consumer_name: rawName?.trim().toUpperCase() || 'Unverified Consumer',
    address: 'Not in master database',
    mobile: '',
    found: false,
  };
}
