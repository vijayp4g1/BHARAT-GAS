import db, { type Consumer } from './db';
import { supabase } from './supabase';
import {
  DISTRIBUTOR_BLACKLIST,
  generateAmbiguousDigitVariants,
  mapOcrDigits,
  normalizeDigits,
  numberKey,
} from './scanUtils';

export { DISTRIBUTOR_BLACKLIST };

export interface MatchResult {
  consumer_id?: string;
  consumer_number: string;
  consumer_name: string;
  address: string;
  mobile: string;
  found: boolean;
}

/**
 * Computes Levenshtein distance between two strings
 */
function getLevenshteinDistance(a: string, b: string): number {
  const an = a ? a.length : 0;
  const bn = b ? b.length : 0;
  if (an === 0) return bn;
  if (bn === 0) return an;
  const matrix: number[][] = Array.from({ length: bn + 1 }, () => Array(an + 1).fill(0));
  for (let i = 0; i <= an; i++) matrix[0][i] = i;
  for (let j = 0; j <= bn; j++) matrix[j][0] = j;

  for (let j = 1; j <= bn; j++) {
    for (let i = 1; i <= an; i++) {
      if (a[i - 1] === b[j - 1]) {
        matrix[j][i] = matrix[j - 1][i - 1];
      } else {
        matrix[j][i] = Math.min(
          matrix[j - 1][i] + 1,
          matrix[j][i - 1] + 1,
          matrix[j - 1][i - 1] + 1
        );
      }
    }
  }
  return matrix[bn][an];
}

/**
 * Checks if two individual name tokens are fuzzy matches (substring, common prefix, or Levenshtein distance <= 2).
 */
export function areWordsSimilar(w1: string, w2: string): boolean {
  if (!w1 || !w2) return false;
  if (w1 === w2) return true;
  if (w1.length >= 3 && w2.includes(w1)) return true;
  if (w2.length >= 3 && w1.includes(w2)) return true;
  // Prefix matching for Indian name roots (e.g. VENKAT, LAKSHM, CHAND)
  if (w1.length >= 4 && w2.length >= 4 && (w1.startsWith(w2.slice(0, 4)) || w2.startsWith(w1.slice(0, 4)))) return true;
  const minLen = Math.min(w1.length, w2.length);
  const maxLen = Math.max(w1.length, w2.length);
  if (minLen >= 4) {
    const dist = getLevenshteinDistance(w1, w2);
    if (dist <= (maxLen >= 6 ? 2 : 1)) return true;
  }
  return false;
}

/**
 * Checks if two names have matching significant words (with fuzzy tolerance for dot-matrix OCR errors).
 */
export function areNamesSimilar(name1: string, name2: string): boolean {
  if (!name1 || !name2) return false;
  const words1 = cleanNameWords(name1);
  const words2 = cleanNameWords(name2);
  if (words1.length === 0 || words2.length === 0) return false;
  return words1.some((w1) => words2.some((w2) => areWordsSimilar(w1, w2)));
}

/**
 * Strips common honorifics, agency noise words, and non-alphanumeric noise to isolate distinctive name tokens.
 * Keeps tokens with length >= 2 and filters out stopwords and duplicate tokens.
 */
export function cleanNameWords(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .toUpperCase()
        .replace(/\b(MR|MRS|MS|MISS|SMT|SHRI|DR|M\/S|WO|W\/O|SO|S\/O|DO|D\/O)\.?\b/g, '')
        .replace(/[^A-Z0-9\s]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter((w) => w.length >= 2 && !/^(AND|THE|FOR|NOT|GAS|LPG|BHARAT|CONSUMER|SIDDHARTHA|RECEIPT|BILL|NAME|DETAILS|RECEIVER|FRESH|DOMESTIC|CYLINDER|DELIVERY)$/.test(w))
    )
  );
}

/**
 * Consumer lookup by printed consumer number ONLY.
 *
 * The consumer number is the single key. The name on a bill (OCR or typed) is
 * never used to choose or reject a consumer, and a number that is not in the
 * database is never swapped for a similar number automatically. A dot-matrix
 * 8/6/0 variant may only be *offered* for operator confirmation
 * (findConsumersByAmbiguousVariants); it is never added silently.
 */
export async function matchConsumerWithDatabase(
  rawNum: string,
  _rawName?: string
): Promise<MatchResult> {
  // Keep the padded form as a lookup candidate: some agency records store
  // "0117231569" while the bill prints "117231569" (and vice versa).
  const digitsWithLeadingZeros = mapOcrDigits(rawNum);
  const cleanNum = normalizeDigits(rawNum);

  if (!cleanNum || DISTRIBUTOR_BLACKLIST.has(cleanNum)) {
    return {
      consumer_number: cleanNum || 'UNKNOWN',
      consumer_name: 'Unverified Consumer',
      address: 'Not in master database',
      mobile: '',
      found: false,
    };
  }

  const consumer = await findConsumerByExactNumber(digitsWithLeadingZeros, cleanNum);
  if (!consumer) {
    return {
      consumer_number: cleanNum,
      consumer_name: 'Customer Not Found in Database',
      address: 'Not in master database',
      mobile: '',
      found: false,
    };
  }

  return {
    consumer_id: consumer.id,
    consumer_number: consumer.consumer_number,
    consumer_name: consumer.consumer_name,
    address: consumer.address || '',
    mobile: consumer.mobile || '',
    found: true,
  };
}

async function findConsumerByExactNumber(rawDigits: string, cleanNum: string): Promise<Consumer | null> {
  const candidates = Array.from(new Set([rawDigits, cleanNum].filter(Boolean)));

  try {
    for (const num of candidates) {
      const local = await db.consumers.where('consumer_number').equalsIgnoreCase(num).first();
      if (local) return local;
    }
  } catch (_) {}

  if (!navigator.onLine) return null;

  try {
    const { data } = await supabase
      .from('manager_consumer_summary')
      .select('id, consumer_number, consumer_name, address, mobile')
      .in('consumer_number', candidates)
      .limit(1)
      .maybeSingle();

    if (!data) return null;

    const cached: Consumer = {
      id: data.id,
      consumer_number: data.consumer_number,
      consumer_name: data.consumer_name,
      address: data.address || '',
      mobile: data.mobile || '',
      verification_status: 'Verified',
      created_at: new Date().toISOString(),
      searchWords: [
        ...data.consumer_name.toLowerCase().split(/\s+/),
        data.consumer_number.toLowerCase(),
      ],
    };
    await db.consumers.put(cached).catch(() => {});
    return cached;
  } catch (err) {
    console.warn('Remote consumer number lookup error:', err);
    return null;
  }
}

export interface AmbiguousConsumerMatch {
  consumer_id?: string;
  consumer_number: string;
  consumer_name: string;
  address?: string;
  mobile?: string;
}

/**
 * Finds database consumers whose number differs from the printed number ONLY at
 * dot-matrix ambiguous positions (8 ↔ 6 ↔ 0).
 *
 * IMPORTANT: this never selects or adds a consumer. It is used only to offer a
 * "possible match" that the operator must confirm, so a worn printer pin can be
 * corrected without ever silently swapping in a different consumer.
 */
export async function findConsumersByAmbiguousVariants(
  rawNum: string
): Promise<AmbiguousConsumerMatch[]> {
  const padded = mapOcrDigits(rawNum);
  const clean = normalizeDigits(rawNum);
  const bases = Array.from(new Set([padded, clean].filter(Boolean)));
  // If the model dropped a printed leading zero, offer the zero-padded spelling
  // as well (e.g. DB "041179880"). Confirm-first, so this is safe.
  if (clean && !clean.startsWith('0') && clean.length < 12) {
    bases.push(`0${clean}`);
  }
  if (bases.length === 0) return [];

  const keys = new Set<string>();
  bases.forEach((base) => {
    generateAmbiguousDigitVariants(base).forEach((variant) => keys.add(variant));
  });
  if (keys.size === 0) return [];

  const allKeys = Array.from(keys);
  type Row = {
    id?: string;
    consumer_number: string;
    consumer_name: string;
    address?: string | null;
    mobile?: string | null;
  };

  const rows: Row[] = [];

  try {
    const local = await db.consumers.where('consumer_number').anyOf(allKeys).toArray();
    local.forEach((consumer) => {
      rows.push({
        id: consumer.id,
        consumer_number: consumer.consumer_number,
        consumer_name: consumer.consumer_name,
        address: consumer.address,
        mobile: consumer.mobile,
      });
    });
  } catch (_) {}

  if (navigator.onLine) {
    try {
      const { data } = await supabase
        .from('manager_consumer_summary')
        .select('id, consumer_number, consumer_name, address, mobile')
        .in('consumer_number', allKeys);
      if (Array.isArray(data)) {
        data.forEach((row) => {
          rows.push({
            id: row.id,
            consumer_number: row.consumer_number,
            consumer_name: row.consumer_name,
            address: row.address,
            mobile: row.mobile,
          });
        });
      }
    } catch (err) {
      console.warn('Ambiguous variant lookup error:', err);
    }
  }

  // Deduplicate by the number used for equality elsewhere (leading zeros).
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      const key = numberKey(row.consumer_number);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((row) => ({
      consumer_id: row.id,
      consumer_number: row.consumer_number,
      consumer_name: row.consumer_name,
      address: row.address || '',
      mobile: row.mobile || '',
    }));
}
