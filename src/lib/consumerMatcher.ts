import db, { type Consumer } from './db';
import { supabase } from './supabase';
import { v4 as uuidv4 } from 'uuid';

export const DISTRIBUTOR_BLACKLIST = new Set([
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

export interface MatchResult {
  consumer_id?: string;
  consumer_number: string;
  consumer_name: string;
  address: string;
  mobile: string;
  found: boolean;
  corrected?: boolean;
  original_number?: string;
  is_new?: boolean;
  name_verified?: boolean;
}

/**
 * Checks if two names have matching significant words
 */
export function areNamesSimilar(name1: string, name2: string): boolean {
  if (!name1 || !name2) return false;
  const words1 = cleanNameWords(name1);
  const words2 = cleanNameWords(name2);
  if (words1.length === 0 || words2.length === 0) return false;
  return words1.some((w1) =>
    words2.some(
      (w2) => w1 === w2 || (w1.length >= 3 && w2.includes(w1)) || (w2.length >= 3 && w1.includes(w2))
    )
  );
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
        .replace(/\b(MR|MRS|MS|MISS|SMT|SHRI|DR|M\/S)\.?\b/g, '')
        .replace(/[^A-Z0-9\s]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter((w) => w.length >= 2 && !/^(AND|THE|FOR|NOT|GAS|LPG|BHARAT|CONSUMER|SIDDHARTHA|RECEIPT|BILL|NAME)$/.test(w))
    )
  );
}

/**
 * Computes digit suffix match score. If the last 3+ digits match (e.g. 69994449 vs 89994449),
 * this strongly confirms a 1-digit dot-matrix OCR distortion.
 */
export function scoreDigitsSuffix(targetNum: string, queryNum: string): number {
  if (!targetNum || !queryNum) return 0;
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
 * Disambiguates candidate consumers to eliminate collisions:
 * 1. Requires ALL search words to match the candidate name.
 * 2. If exactly one candidate matches all words:
 *    - Confident if suffix score >= 3 (dot-matrix OCR fix) OR multi-word distinctive name (>= 2 strong tokens).
 * 3. If multiple candidates share the name (COLLISION RISK):
 *    - ONLY accepts if exactly ONE candidate has a high suffix score (>= 3) and strictly beats all other candidates.
 *    - Otherwise, rejects the match as ambiguous to prevent misattributing deliveries.
 */
function disambiguateCandidates(
  candidates: Consumer[],
  cleanNum: string,
  words: string[]
): { best: Consumer | null; isConfident: boolean } {
  if (candidates.length === 0) {
    return { best: null, isConfident: false };
  }

  // 1. Strict Filter: Candidate name must contain ALL search words
  const matchingCandidates = candidates.filter((c) => {
    const cName = (c.consumer_name || '').toUpperCase();
    return words.every((w) => cName.includes(w));
  });

  if (matchingCandidates.length === 0) {
    return { best: null, isConfident: false };
  }

  // 2. Exactly one unique match in the database
  if (matchingCandidates.length === 1) {
    const cand = matchingCandidates[0];
    const strongTokens = words.filter((w) => w.length >= 3);

    if (cleanNum) {
      const suffixScore = scoreDigitsSuffix(cand.consumer_number, cleanNum);
      // High-confidence 1-digit OCR distortion (e.g. 89994449 vs 69994449)
      if (suffixScore >= 3) {
        return { best: cand, isConfident: true };
      }
      // If suffix score is low, only accept if there are >= 2 strong distinctive name tokens
      if (strongTokens.length >= 2) {
        return { best: cand, isConfident: true };
      }
      // Single short token with non-matching number: too risky/ambiguous
      return { best: null, isConfident: false };
    } else {
      // Pure name query: accept if >= 2 strong tokens or >= 2 words
      if (strongTokens.length >= 2 || words.length >= 2) {
        return { best: cand, isConfident: true };
      }
      return { best: null, isConfident: false };
    }
  }

  // 3. MULTIPLE candidates match all name tokens (AMBIGUOUS COLLISION RISK)
  if (cleanNum) {
    const scored = matchingCandidates.map((c) => ({
      consumer: c,
      score: scoreDigitsSuffix(c.consumer_number, cleanNum),
    }));

    scored.sort((a, b) => b.score - a.score);

    const highestScore = scored[0].score;
    const secondHighestScore = scored.length > 1 ? scored[1].score : 0;

    if (highestScore >= 3 && highestScore > secondHighestScore) {
      return { best: scored[0].consumer, isConfident: true };
    }
  }

  // Cannot safely disambiguate without collision: Reject match
  console.warn(
    `[ConsumerMatcher] Ambiguous name collision detected for words "${words.join(' ')}" (${matchingCandidates.length} matches). Rejected auto-correction.`
  );
  return { best: null, isConfident: false };
}

/**
 * Directly registers a new customer into the master database:
 * 1. Inserts into local Dexie IndexedDB cache immediately.
 * 2. If online, immediately pushes to Supabase via sync_consumer RPC & consumers table.
 * 3. Notifies application components so new consumer is instantly searchable.
 */
export async function registerNewConsumer(
  cleanNum: string,
  rawName?: string,
  address?: string,
  mobile?: string
): Promise<Consumer> {
  const newId = uuidv4();
  const cleanName =
    rawName &&
    rawName.trim().length > 0 &&
    !rawName.toUpperCase().includes('UNVERIFIED') &&
    !rawName.toUpperCase().includes('RECORD NOT FOUND')
      ? rawName.trim().toUpperCase()
      : `Consumer #${cleanNum}`;
  const nowIso = new Date().toISOString();

  const newConsumer: Consumer = {
    id: newId,
    consumer_number: cleanNum,
    consumer_name: cleanName,
    mobile: mobile || '',
    address: address || 'New Customer / Registered via Day End',
    cylinder_type: '14.2KG_STD',
    verification_status: 'Verified',
    created_at: nowIso,
    updated_at: nowIso,
    synced: false,
    searchWords: [
      ...cleanName.toLowerCase().split(/\s+/),
      cleanNum.toLowerCase(),
      ...(mobile ? [mobile.toLowerCase()] : []),
    ],
  };

  // 1. Immediately store in local Dexie IndexedDB
  try {
    await db.consumers.put(newConsumer);
  } catch (dexErr) {
    console.warn('Failed to put new consumer in local Dexie:', dexErr);
  }

  // 2. If online, sync to Supabase via sync_consumer RPC (which bypasses RLS safely)
  if (navigator.onLine) {
    try {
      const { data, error } = await supabase.rpc('sync_consumer', {
        p_id: newId,
        p_consumer_number: cleanNum,
        p_consumer_name: cleanName,
        p_mobile: mobile || '',
        p_address: newConsumer.address,
        p_verification_status: 'Verified',
        p_assigned_agent_id: null,
        p_area_code: null,
        p_created_at: nowIso,
        p_updated_at: nowIso,
      });

      if (!error && data) {
        newConsumer.synced = true;
        await db.consumers.update(newId, { synced: true }).catch(() => {});
        console.log(`[New Consumer] Registered #${cleanNum} (${cleanName}) into Supabase cloud.`);
      } else {
        console.warn('[New Consumer] sync_consumer notice (will retry on next sync):', error);
      }
    } catch (supErr) {
      console.warn('[New Consumer] Cloud push error:', supErr);
    }
  }

  // 3. Dispatch global event to update consumer counts across the app
  window.dispatchEvent(new CustomEvent('bgcls-consumers-synced', { detail: { newConsumer } }));

  return newConsumer;
}

/**
 * Generates variants where dot-matrix ambiguous digits (8 <-> 6, 8 <-> 0) are swapped.
 * Because dot-matrix printer pin wear causes '8' to appear as '6' (missing top-right dot)
 * or as '0' (missing center cross-bar).
 */
export function generateDotMatrix8Variants(num: string): string[] {
  if (!num || num.length < 2) return [];
  const variants = new Set<string>();
  const chars = num.split('');

  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    // If OCR saw '6' or '0', it could actually be an '8'
    if (c === '6' || c === '0') {
      const copy = [...chars];
      copy[i] = '8';
      variants.add(copy.join(''));
    }
    // If OCR saw '8', check if it could be '6' or '0'
    if (c === '8') {
      const copy6 = [...chars];
      copy6[i] = '6';
      variants.add(copy6.join(''));
      const copy0 = [...chars];
      copy0[i] = '0';
      variants.add(copy0.join(''));
    }
  }

  return Array.from(variants);
}

/**
 * Intelligent Consumer Matcher with Strict Database Verification:
 * 1. Checks direct Consumer Number in local Dexie database and remote Supabase.
 * 2. If number is found, CROSS-VERIFIES customer name:
 *    - If name matches: 100% verified!
 *    - If name mismatches (e.g. scanned 1677 which is ANNAPURNA, but bill says B LINGAM):
 *      Checks dot-matrix 8/6/0 variants (e.g. 1877) to recover the true customer!
 * 3. If number is not found:
 *    - Checks dot-matrix 8/6/0 variants against the database and matches receipt name.
 * 4. NEVER silently registers or adds unverified consumers to the delivery book without database confirmation.
 */
export async function matchConsumerWithDatabase(
  rawNum: string,
  rawName?: string
): Promise<MatchResult> {
  const cleanNum = (rawNum || '').replace(/[^0-9]/g, '');
  const cleanName = (rawName || '').trim();

  // Helper to query consumer by number (Dexie first, then remote Supabase)
  async function findByNumber(num: string): Promise<Consumer | null> {
    if (!num) return null;
    const local = await db.consumers.where('consumer_number').equalsIgnoreCase(num).first();
    if (local) return local;

    if (navigator.onLine) {
      try {
        const { data } = await supabase
          .from('manager_consumer_summary')
          .select('id, consumer_number, consumer_name, address, mobile')
          .eq('consumer_number', num)
          .maybeSingle();

        if (data) {
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
        }
      } catch (err) {
        console.warn('Remote number lookup error:', err);
      }
    }
    return null;
  }

  // Helper to query consumer by name words
  async function findByName(name: string): Promise<Consumer[]> {
    if (!name) return [];
    const words = cleanNameWords(name);
    if (words.length === 0) return [];

    try {
      // 1. Search local Dexie
      const localCandidates = await db.consumers
        .where('searchWords')
        .anyOfIgnoreCase(words.map((w) => w.toLowerCase()))
        .toArray();

      if (localCandidates.length > 0) {
        return localCandidates;
      }

      // 2. Search remote Supabase if online
      if (navigator.onLine) {
        const targetWord = words.find((w) => w.length >= 3) || words[0];
        const { data } = await supabase
          .from('manager_consumer_summary')
          .select('id, consumer_number, consumer_name, address, mobile')
          .ilike('consumer_name', `%${targetWord}%`)
          .limit(20);

        if (data && data.length > 0) {
          return data.map((d) => ({
            id: d.id,
            consumer_number: d.consumer_number,
            consumer_name: d.consumer_name,
            address: d.address || '',
            mobile: d.mobile || '',
            verification_status: 'Verified',
            created_at: new Date().toISOString(),
            searchWords: [
              ...d.consumer_name.toLowerCase().split(/\s+/),
              d.consumer_number.toLowerCase(),
            ],
          }));
        }
      }
    } catch (_) {}
    return [];
  }

  // 1. Direct number check
  if (cleanNum && !DISTRIBUTOR_BLACKLIST.has(cleanNum)) {
    const directConsumer = await findByNumber(cleanNum);

    if (directConsumer) {
      // Check if scanned name matches database record
      const isNameVerified = cleanName ? areNamesSimilar(cleanName, directConsumer.consumer_name) : true;

      if (isNameVerified) {
        // High confidence: BOTH number and name verify against database!
        return {
          consumer_id: directConsumer.id,
          consumer_number: directConsumer.consumer_number,
          consumer_name: directConsumer.consumer_name,
          address: directConsumer.address || '',
          mobile: directConsumer.mobile || '',
          found: true,
          name_verified: true,
        };
      } else {
        // NAME MISMATCH DETECTED!
        // E.g. OCR read 1677 (which is ANNAPURNA in DB), but receipt says "B LINGAM"!
        // Check dot-matrix 8/6/0 variants (e.g. 1877)!
        console.warn(`[OCR Cross-Check] Name mismatch on #${cleanNum}: Receipt says "${cleanName}", but DB #${cleanNum} is "${directConsumer.consumer_name}". Checking 8/6/0 variants...`);
        
        const variants = generateDotMatrix8Variants(cleanNum);
        for (const variant of variants) {
          const varConsumer = await findByNumber(variant);
          if (varConsumer && areNamesSimilar(cleanName, varConsumer.consumer_name)) {
            console.log(`[OCR Auto-Recovery] Corrected #${cleanNum} -> #${varConsumer.consumer_number} (${varConsumer.consumer_name}) matching receipt name!`);
            return {
              consumer_id: varConsumer.id,
              consumer_number: varConsumer.consumer_number,
              consumer_name: varConsumer.consumer_name,
              address: varConsumer.address || '',
              mobile: varConsumer.mobile || '',
              found: true,
              corrected: true,
              original_number: cleanNum,
              name_verified: true,
            };
          }
        }

        // Also search by name directly in database
        if (cleanName) {
          const nameMatches = await findByName(cleanName);
          const closeCandidate = nameMatches.find((cand) => {
            if (!cand.consumer_number || cand.consumer_number.length !== cleanNum.length) return false;
            let diff = 0;
            for (let i = 0; i < cleanNum.length; i++) {
              if (cleanNum[i] !== cand.consumer_number[i]) diff++;
            }
            return diff === 1;
          });

          if (closeCandidate) {
            console.log(`[OCR Auto-Recovery] Recovered #${closeCandidate.consumer_number} (${closeCandidate.consumer_name}) from name match!`);
            return {
              consumer_id: closeCandidate.id,
              consumer_number: closeCandidate.consumer_number,
              consumer_name: closeCandidate.consumer_name,
              address: closeCandidate.address || '',
              mobile: closeCandidate.mobile || '',
              found: true,
              corrected: true,
              original_number: cleanNum,
              name_verified: true,
            };
          }
        }

        // If names completely conflict, return with mismatch warning (found: false for safety)
        return {
          consumer_id: directConsumer.id,
          consumer_number: directConsumer.consumer_number,
          consumer_name: directConsumer.consumer_name,
          address: directConsumer.address || '',
          mobile: directConsumer.mobile || '',
          found: false, // Prevent adding mismatched customer
          name_verified: false,
        };
      }
    } else {
      // Direct number was NOT found in database!
      // Check dot-matrix 8/6/0 variants:
      const variants = generateDotMatrix8Variants(cleanNum);
      for (const variant of variants) {
        const varConsumer = await findByNumber(variant);
        if (varConsumer) {
          const nameMatches = cleanName ? areNamesSimilar(cleanName, varConsumer.consumer_name) : true;
          if (nameMatches) {
            console.log(`[OCR Auto-Recovery] Unmatched #${cleanNum} recovered to #${varConsumer.consumer_number} (${varConsumer.consumer_name})!`);
            return {
              consumer_id: varConsumer.id,
              consumer_number: varConsumer.consumer_number,
              consumer_name: varConsumer.consumer_name,
              address: varConsumer.address || '',
              mobile: varConsumer.mobile || '',
              found: true,
              corrected: true,
              original_number: cleanNum,
              name_verified: true,
            };
          }
        }
      }

      // Check name in database to recover 1-digit dot-matrix errors
      if (cleanName) {
        const nameMatches = await findByName(cleanName);
        const closeCandidate = nameMatches.find((cand) => {
          if (!cand.consumer_number || cand.consumer_number.length !== cleanNum.length) return false;
          let diff = 0;
          for (let i = 0; i < cleanNum.length; i++) {
            if (cleanNum[i] !== cand.consumer_number[i]) diff++;
          }
          return diff === 1;
        });

        if (closeCandidate) {
          return {
            consumer_id: closeCandidate.id,
            consumer_number: closeCandidate.consumer_number,
            consumer_name: closeCandidate.consumer_name,
            address: closeCandidate.address || '',
            mobile: closeCandidate.mobile || '',
            found: true,
            corrected: true,
            original_number: cleanNum,
            name_verified: true,
          };
        }
      }

      // TRULY NOT IN DATABASE:
      // Return found: false - DO NOT auto-register or add blindly!
      return {
        consumer_number: cleanNum,
        consumer_name: cleanName || 'Customer Not Found in Database',
        address: 'Not in master database',
        mobile: '',
        found: false,
      };
    }
  }

  // Fallback for pure name manual search
  if (!cleanNum && cleanName) {
    const nameMatches = await findByName(cleanName);
    const words = cleanNameWords(cleanName);
    const { best, isConfident } = disambiguateCandidates(nameMatches, '', words);
    if (best && isConfident) {
      return {
        consumer_id: best.id,
        consumer_number: best.consumer_number,
        consumer_name: best.consumer_name,
        address: best.address || '',
        mobile: best.mobile || '',
        found: true,
        name_verified: true,
      };
    }
  }

  return {
    consumer_number: cleanNum || 'UNKNOWN',
    consumer_name: cleanName || 'Unverified Consumer',
    address: 'Not in master database',
    mobile: '',
    found: false,
  };
}
