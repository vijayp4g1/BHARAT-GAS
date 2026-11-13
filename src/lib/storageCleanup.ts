/**
 * Safe localStorage quota management.
 *
 * The app keeps several large, re-fetchable caches in localStorage:
 *   - BPCL report snapshots (per boy/date)
 *   - past-7-days bill maps (per date)
 *   - archive/no-supply flags (per date)
 *   - day-end working drafts (per boy/date)
 *   - BPCL paste drafts
 *   - a local scanned-bill audit log
 *
 * Over time these fill Chrome's ~5 MB localStorage quota and break login
 * (Supabase auth and "remember me" both need to write to localStorage).
 *
 * This cleanup removes ONLY data that is either re-fetched from Supabase or
 * old enough to be an abandoned draft. It never touches:
 *   - login / Supabase auth keys
 *   - saved bills (Supabase + IndexedDB)
 *   - the current/recent day-end or BPCL paste drafts
 *   - app settings / assignments / supervisor phone
 */

const CACHE_PREFIXES = [
  'bgcls_bpcl_report_',
  'bgcls_day_end_cloud_cache_',
  'bgcls_past_7days_bills_',
  'bgcls_archived_boys_',
  'bgcls_no_supply_boys_',
  'bgcls_recent_interactions_',
  'bgcls_last_pull_timestamp',
];

const DAY_END_DRAFT_PREFIX = 'bgcls_day_end_working_draft_';
const PASTE_DRAFT_PREFIX = 'bgcls_bpcl_paste_draft_';
const AUDIT_LOG_KEY = 'bgcls_scanned_receipts_audit_log';
const CLEANUP_STAMP_KEY = 'bgcls_last_storage_cleanup';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface StorageCleanupOptions {
  /** Remove re-fetchable display caches (default true). */
  removeCaches?: boolean;
  /** Keep only this many newest audit-log entries (default 100). */
  auditMaxEntries?: number;
  /** Remove day-end drafts older than N days (default 30). */
  dayEndDraftMaxAgeDays?: number;
  /** Remove abandoned BPCL paste drafts older than N days (default 2). */
  pasteDraftMaxAgeDays?: number;
  /** Second pass used only when the quota is already exhausted. */
  aggressive?: boolean;
}

export interface StorageCleanupReport {
  removedKeys: number;
  freedBytes: number;
  trimmedAudit: boolean;
}

function approxBytes(value: string | null): number {
  return value ? value.length * 2 : 0; // UTF-16 code units
}

/** Local (not UTC) YYYY-MM-DD, matching the app's report date strings. */
function localDateString(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * Date-stamped caches for today and yesterday are always kept: they may still
 * contain work done offline that has not reached the server yet.
 */
function isRecentDatedCache(key: string, todayIso: string, yesterdayIso: string): boolean {
  return key.includes(todayIso) || key.includes(yesterdayIso);
}

/**
 * Frees localStorage space. Safe to call at login or from a "free space" UI.
 */
export function freeLocalStorageSpace(
  options: StorageCleanupOptions = {}
): StorageCleanupReport {
  const {
    removeCaches = true,
    auditMaxEntries = 100,
    dayEndDraftMaxAgeDays = 30,
    pasteDraftMaxAgeDays = 2,
    aggressive = false,
  } = options;

  const dayEndMaxAge = aggressive ? 3 : dayEndDraftMaxAgeDays;
  const pasteMaxAge = aggressive ? 1 : pasteDraftMaxAgeDays;
  const auditKeep = aggressive ? 50 : auditMaxEntries;

  const report: StorageCleanupReport = {
    removedKeys: 0,
    freedBytes: 0,
    trimmedAudit: false,
  };

  const todayIso = localDateString(0);
  const yesterdayIso = localDateString(1);

  let keys: string[] = [];
  try {
    keys = Object.keys(localStorage);
  } catch (_) {
    return report;
  }

  for (const key of keys) {
    let value: string | null = null;
    try {
      value = localStorage.getItem(key);
    } catch (_) {
      continue;
    }
    if (value === null) continue;

    // 1. Re-fetchable display caches (today/yesterday are kept).
    if (removeCaches && CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      if (isRecentDatedCache(key, todayIso, yesterdayIso)) continue;

      try {
        localStorage.removeItem(key);
        report.removedKeys++;
        report.freedBytes += approxBytes(value);
      } catch (_) {}
      continue;
    }

    // 2. Trim the local audit log (newest entries are stored first).
    if (key === AUDIT_LOG_KEY) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed) && parsed.length > auditKeep) {
          const next = JSON.stringify(parsed.slice(0, auditKeep));
          localStorage.setItem(key, next);
          report.trimmedAudit = true;
          report.freedBytes += Math.max(0, approxBytes(value) - approxBytes(next));
        }
      } catch (_) {}
      continue;
    }

    // 3. Remove abandoned drafts only (recent drafts are preserved).
    if (key.startsWith(DAY_END_DRAFT_PREFIX) || key.startsWith(PASTE_DRAFT_PREFIX)) {
      try {
        const parsed = JSON.parse(value);
        const timestamp = Number(parsed?.timestamp || parsed?.at || 0);
        const maxAgeDays = key.startsWith(PASTE_DRAFT_PREFIX)
          ? pasteMaxAge
          : dayEndMaxAge;
        if (timestamp > 0 && timestamp < Date.now() - maxAgeDays * DAY_MS) {
          localStorage.removeItem(key);
          report.removedKeys++;
          report.freedBytes += approxBytes(value);
        }
      } catch (_) {}
    }
  }

  return report;
}

/**
 * Last-resort: remove the oldest abandoned draft when the auth session cannot
 * be persisted. Keeps the two newest drafts (the ones most likely still in use).
 * Returns false when there is nothing safe left to remove.
 */
export function evictOldestDraft(): boolean {
  try {
    const drafts: Array<{ key: string; timestamp: number }> = [];

    for (const key of Object.keys(localStorage)) {
      if (
        !key.startsWith(DAY_END_DRAFT_PREFIX) &&
        !key.startsWith(PASTE_DRAFT_PREFIX)
      ) {
        continue;
      }
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || '{}');
        drafts.push({
          key,
          timestamp: Number(parsed?.timestamp || parsed?.at || 0),
        });
      } catch (_) {
        drafts.push({ key, timestamp: 0 });
      }
    }

    // Keep the two newest drafts untouched.
    if (drafts.length <= 2) return false;

    drafts.sort((a, b) => a.timestamp - b.timestamp);
    const victim = drafts[0];
    if (!victim) return false;

    localStorage.removeItem(victim.key);
    console.warn('[Storage] Removed oldest draft to preserve the login session:', victim.key);
    return true;
  } catch (_) {
    return false;
  }
}

/** True when an error is the browser's localStorage quota error. */
export function isStorageQuotaError(error: unknown): boolean {
  const err = error as { name?: string; message?: string } | null;
  return (
    err?.name === 'QuotaExceededError' ||
    err?.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    /quota/i.test(String(err?.message || '')) ||
    /exceeded the quota/i.test(String(err?.message || ''))
  );
}

/**
 * localStorage.setItem that never blocks the app because of a full quota.
 * On failure it frees safe caches / old drafts and retries twice.
 */
export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    if (!isStorageQuotaError(err)) return false;
  }

  freeLocalStorageSpace({ aggressive: false });
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    if (!isStorageQuotaError(err)) return false;
  }

  freeLocalStorageSpace({ aggressive: true });
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (_) {
    return false;
  }
}

/** Once-per-day maintenance so the quota cannot silently fill up again. */
export function runDailyStorageMaintenance(): StorageCleanupReport | null {
  try {
    const last = Number(localStorage.getItem(CLEANUP_STAMP_KEY) || 0);
    if (last > 0 && Date.now() - last < DAY_MS) return null;
  } catch (_) {
    return null;
  }

  const report = freeLocalStorageSpace({ aggressive: false });

  // This stamp is tiny; if even this fails, the quota is already critical and
  // the next login will run the aggressive pass.
  try {
    localStorage.setItem(CLEANUP_STAMP_KEY, String(Date.now()));
  } catch (_) {}

  return report;
}
