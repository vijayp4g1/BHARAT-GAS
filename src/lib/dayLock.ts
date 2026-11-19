import { supabase } from './supabase';
import { isPastGodownDate } from './dateUtils';

/**
 * Automatic day lock:
 *  - today (IST) and future dates are open,
 *  - any earlier date is locked by default,
 *  - staff/managers can unlock a date by inserting a row in `day_unlocks`.
 *
 * If the migration has not been applied, reads fail open (not locked) so the
 * app keeps working until the tables exist.
 */

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { locked: boolean; at: number }>();
let tableMissing = false;

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = String(error.code || '');
  const message = String(error.message || '').toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    message.includes('does not exist') ||
    message.includes('schema cache') ||
    message.includes('could not find the table')
  );
}

export function isDateInFutureOrToday(dateStr: string): boolean {
  return !isPastGodownDate(dateStr);
}

export async function isDayLocked(
  dateStr: string,
  options: { force?: boolean } = {}
): Promise<boolean> {
  if (!dateStr) return false;
  if (!isPastGodownDate(dateStr)) return false;
  // The lock tables have not been migrated yet: keep the app fully usable.
  if (tableMissing) return false;

  const cached = cache.get(dateStr);
  if (!options.force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.locked;
  }

  try {
    const { data, error } = await supabase
      .from('day_unlocks')
      .select('unlock_date')
      .eq('unlock_date', dateStr)
      .maybeSingle();

    if (error) {
      if (isMissingTableError(error)) tableMissing = true;
      // Table not migrated yet: do not block the business.
      return false;
    }

    const locked = !data;
    cache.set(dateStr, { locked, at: Date.now() });
    return locked;
  } catch (_) {
    return false;
  }
}

export async function unlockDay(
  dateStr: string,
  reason: string
): Promise<{ ok: boolean; error?: string }> {
  if (!dateStr) return { ok: false, error: 'Missing date' };

  try {
    const { data: userData } = await supabase.auth.getUser();
    const now = new Date().toISOString();

    const { error } = await supabase.from('day_unlocks').upsert(
      {
        unlock_date: dateStr,
        unlocked_by: userData?.user?.id ?? null,
        reason: reason || 'Manual unlock',
        unlocked_at: now,
      },
      { onConflict: 'unlock_date' }
    );

    if (error) return { ok: false, error: error.message };

    cache.set(dateStr, { locked: false, at: Date.now() });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Network error' };
  }
}

export function forgetDayLockCache(dateStr?: string): void {
  if (dateStr) cache.delete(dateStr);
  else cache.clear();
}
