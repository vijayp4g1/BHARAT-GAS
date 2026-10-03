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
 * Intelligent Consumer Matcher:
 * 1. Tries direct Consumer Number in local Dexie database.
 * 2. Tries direct Consumer Number in remote Supabase (manager_consumer_summary & consumers).
 * 3. If number is blurred/unclear or 1-digit misread, searches by Customer Name in local Dexie without ambiguity.
 * 4. If not found in Dexie, searches by Customer Name in remote Supabase with strict multi-word matching.
 * 5. If customer is NEW (not found in DB), DIRECTLY ADDS THEM to both local & cloud databases!
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
        consumer_id: localByNum.id,
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
          consumer_id: remoteByNum.id,
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

      // Deduplicate candidates by consumer_number
      const candidateMap = new Map<string, Consumer>();
      for (const cand of localCandidates) {
        if (!candidateMap.has(cand.consumer_number)) {
          candidateMap.set(cand.consumer_number, cand);
        }
      }

      const deduplicated = Array.from(candidateMap.values());
      const { best, isConfident } = disambiguateCandidates(deduplicated, cleanNum, words);

      if (best && isConfident) {
        return {
          consumer_id: best.id,
          consumer_number: best.consumer_number,
          consumer_name: best.consumer_name,
          address: best.address || '',
          mobile: best.mobile || '',
          found: true,
          corrected: best.consumer_number !== cleanNum,
          original_number: cleanNum,
        };
      }
    } catch (dexErr) {
      console.warn('Local name search error:', dexErr);
    }
  }

  // 4. Search by Name in Remote Supabase (manager_consumer_summary) with ALL tokens
  if (words.length > 0 && navigator.onLine) {
    try {
      let query = supabase
        .from('manager_consumer_summary')
        .select('id, consumer_number, consumer_name, address, mobile');

      // Strictly require ALL words in remote search to prevent loose partial collisions
      for (const w of words) {
        query = query.ilike('consumer_name', `%${w}%`);
      }

      const { data: remoteData } = await query.limit(25);

      if (remoteData && remoteData.length > 0) {
        const remoteConsumers: Consumer[] = remoteData.map((r: any) => ({
          id: r.id,
          consumer_number: r.consumer_number,
          consumer_name: r.consumer_name,
          address: r.address || '',
          mobile: r.mobile || '',
          verification_status: 'Verified',
          created_at: new Date().toISOString(),
          searchWords: [
            ...r.consumer_name.toLowerCase().split(/\s+/),
            r.consumer_number.toLowerCase(),
          ],
        }));

        const { best, isConfident } = disambiguateCandidates(remoteConsumers, cleanNum, words);

        if (best && isConfident) {
          // Cache into local Dexie for future offline lookups
          await db.consumers.put(best).catch(() => {});

          return {
            consumer_id: best.id,
            consumer_number: best.consumer_number,
            consumer_name: best.consumer_name,
            address: best.address || '',
            mobile: best.mobile || '',
            found: true,
            corrected: best.consumer_number !== cleanNum,
            original_number: cleanNum,
          };
        }
      }
    } catch (supErr) {
      console.warn('Remote name search error:', supErr);
    }
  }

  // 5. NEW CUSTOMER: If valid consumer number and not in database, directly add to main database!
  if (cleanNum && cleanNum.length >= 3 && !DISTRIBUTOR_BLACKLIST.has(cleanNum)) {
    try {
      const newConsumer = await registerNewConsumer(cleanNum, rawName);
      return {
        consumer_id: newConsumer.id,
        consumer_number: newConsumer.consumer_number,
        consumer_name: newConsumer.consumer_name,
        address: newConsumer.address,
        mobile: newConsumer.mobile,
        found: true,
        is_new: true,
      };
    } catch (err) {
      console.error('Failed to auto-register new customer:', err);
    }
  }

  // 6. Fallback if number is invalid (< 3 digits or blacklisted)
  return {
    consumer_number: cleanNum || 'UNKNOWN',
    consumer_name: rawName?.trim().toUpperCase() || 'Unverified Consumer',
    address: 'Not in master database',
    mobile: '',
    found: false,
  };
}
