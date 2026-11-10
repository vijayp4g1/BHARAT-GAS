/**
 * Shared bill/consumer-number helpers.
 *
 * Every scanner, matcher and double-bill map must normalize numbers the same
 * way. Keeping these in one module prevents the two copies of the blacklist and
 * the two digit cleaners from drifting apart (a drift that silently disabled
 * duplicate detection for numbers stored with leading zeros).
 */

/** Distributor codes, helpline numbers and other non-consumer numbers that appear on receipts. */
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

/**
 * Maps the dot-matrix letter/digit look-alikes (I/L/| → 1, O/Q → 0, B → 8 ...)
 * and strips every non-digit, but KEEPS leading zeros.
 *
 * The leading zeros matter: some agency records store numbers with a leading
 * zero, so the exact lookup must try both "0117231569" and "117231569".
 */
export function mapOcrDigits(raw: string | null | undefined): string {
  return (raw || '')
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

/**
 * Normalizes a printed/typed number into bare digits:
 * - maps dot-matrix letter/digit look-alikes (I/L/| → 1, O/Q → 0, B → 8 ...)
 * - strips every non-digit
 * - drops leading zeros so "0117231569" and "117231569" are the same bill
 */
export function normalizeDigits(raw: string | null | undefined): string {
  const digits = mapOcrDigits(raw);
  const unpadded = digits.replace(/^0+/, '');
  return unpadded || digits;
}

/**
 * Stable key for comparing a bill across the delivery list, audit log and the
 * cross-agent claimed map. Always use this (never `.trim().toLowerCase()`).
 */
export function numberKey(raw: string | null | undefined): string {
  return normalizeDigits(raw);
}

/** True when the number is a plausible Bharatgas consumer number we may add. */
export function isAddableConsumerNumber(raw: string | null | undefined): boolean {
  const num = numberKey(raw);
  return num.length >= 1 && num.length <= 12 && !DISTRIBUTOR_BLACKLIST.has(num);
}

const AMBIGUOUS_DOT_MATRIX_DIGITS = ['0', '6', '8'] as const;

function otherAmbiguousDigits(digit: string): string[] {
  return AMBIGUOUS_DOT_MATRIX_DIGITS.filter((d) => d !== digit);
}

/**
 * Generates consumer numbers that differ from `num` ONLY at dot-matrix
 * ambiguous positions (8 ↔ 6 ↔ 0).
 *
 * This is deliberately narrow: a variant can never change a 4 into a 9, so a
 * guessed number can only ever differ by the digits a worn printer pin is known
 * to corrupt. Callers must still verify the variant exists in the database AND
 * ask the operator before using it.
 *
 * Limits to at most 2 changed digits to keep the candidate list small (a
 * 10-digit number yields at most ~200 variants instead of 3^10).
 */
export function generateAmbiguousDigitVariants(num: string, maxSubstitutions = 2): string[] {
  if (!num) return [];
  const chars = num.split('');
  const positions = chars
    .map((digit, index) => (AMBIGUOUS_DOT_MATRIX_DIGITS.includes(digit as any) ? index : -1))
    .filter((index) => index >= 0);

  const variants = new Set<string>();

  positions.forEach((i) => {
    otherAmbiguousDigits(chars[i]).forEach((digit) => {
      const copy = [...chars];
      copy[i] = digit;
      variants.add(copy.join(''));
    });
  });

  if (maxSubstitutions >= 2) {
    for (let a = 0; a < positions.length; a++) {
      for (let b = a + 1; b < positions.length; b++) {
        const i = positions[a];
        const j = positions[b];
        otherAmbiguousDigits(chars[i]).forEach((di) => {
          otherAmbiguousDigits(chars[j]).forEach((dj) => {
            const copy = [...chars];
            copy[i] = di;
            copy[j] = dj;
            variants.add(copy.join(''));
          });
        });
      }
    }
  }

  return Array.from(variants);
}
