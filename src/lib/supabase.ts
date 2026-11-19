import { createClient } from '@supabase/supabase-js';
import {
  evictOldestDraft,
  freeLocalStorageSpace,
  isStorageQuotaError,
} from './storageCleanup';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://zdipbxhgjhxfslpoizkj.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'PLACEHOLDER_KEY';

/**
 * Auth storage with quota protection.
 *
 * Supabase stores the access/refresh token in localStorage. When the browser's
 * ~5 MB quota is full (large caches/drafts), the token refresh write fails and
 * auth-js signs the user out — the "random automatic logout" symptom.
 *
 * The session token is tiny and critical, so on a quota error we free only
 * re-fetchable caches / abandoned drafts and retry. If even that is not enough,
 * the oldest drafts are removed one by one, keeping the two newest.
 */
const quotaSafeAuthStorage = {
  getItem(key: string): string | null {
    try {
      const value = window.localStorage.getItem(key);
      if (value !== null) return value;
    } catch (_) {}
    // A full localStorage may have forced the session into sessionStorage.
    try {
      return window.sessionStorage.getItem(key);
    } catch (_) {
      return null;
    }
  },

  setItem(key: string, value: string): void {
    // A successful localStorage write makes any sessionStorage fallback stale.
    const saveLocal = () => {
      window.localStorage.setItem(key, value);
      try {
        window.sessionStorage.removeItem(key);
      } catch (_) {}
    };

    try {
      saveLocal();
      return;
    } catch (err) {
      if (!isStorageQuotaError(err)) throw err;
    }

    // 1st retry: remove caches, trim the audit log, prune old drafts.
    freeLocalStorageSpace({ aggressive: true });
    try {
      saveLocal();
      return;
    } catch (err) {
      if (!isStorageQuotaError(err)) throw err;
    }

    // 2nd retry: the quota is already critical, so also drop today's /
    // yesterday's re-fetchable caches. Login must be able to persist a token;
    // these caches are rebuilt from Supabase (or settlement notes) afterwards.
    freeLocalStorageSpace({ aggressive: true, critical: true });
    try {
      saveLocal();
      return;
    } catch (err) {
      if (!isStorageQuotaError(err)) throw err;
    }

    // 3rd retry: a bloated old session can block its own replacement because
    // the browser needs room for the new value before releasing the old one.
    // Drop the previous auth value for this key, then write the new one.
    try {
      window.localStorage.removeItem(key);
    } catch (_) {}
    try {
      saveLocal();
      return;
    } catch (err) {
      if (!isStorageQuotaError(err)) throw err;
    }

    // Last resort: evict the oldest drafts (newest two are kept) until the
    // auth/session token fits. Saved bills live in Supabase/IndexedDB.
    for (let attempt = 0; attempt < 10; attempt++) {
      if (!evictOldestDraft()) break;
      try {
        saveLocal();
        return;
      } catch (err) {
        if (!isStorageQuotaError(err)) throw err;
      }
    }

    // Absolute fallback: keep the session for this tab in sessionStorage
    // instead of leaving the user stuck on the login screen forever. The app
    // keeps working until the tab/app is closed; logging in again is enough
    // after a cold start.
    try {
      window.sessionStorage.setItem(key, value);
      console.warn(
        '[Auth] localStorage is full; keeping this session in sessionStorage. ' +
          'Free device storage to keep the login after closing the app.'
      );
      return;
    } catch (_) {}

    console.error(
      '[Auth] Could not persist the session because browser storage is full. ' +
        'Free device storage and reload the app.'
    );
    throw new Error('localStorage quota exceeded while saving the session');
  },

  removeItem(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch (_) {}
    try {
      window.sessionStorage.removeItem(key);
    } catch (_) {}
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: quotaSafeAuthStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/**
 * Reads the Supabase session straight from localStorage.
 *
 * auth-js deletes this key only on a real sign-out (`_removeSession`). A
 * transient network/server failure during a token refresh keeps the key in
 * place and returns `{ session: null, error }` from `getSession()`.
 *
 * Callers use this to tell "temporarily cannot refresh" apart from "signed
 * out", so a dropped mobile connection at token-expiry time does not bounce the
 * user to the login screen.
 */
/**
 * Cached session user id. `getUser()` performs a network call; most writes only
 * need the already-validated session id. Use this instead of getUser() in
 * uploads/audit logs to avoid extra Auth API calls.
 */
export async function getSessionUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  } catch (_) {
    return null;
  }
}

export function readPersistedAuthSession(): { userId: string; email: string } | null {
  try {
    const findKey = (storage: Storage): string | null =>
      Object.keys(storage).find(
        (k) => k.startsWith('sb-') && k.endsWith('-auth-token')
      ) || null;

    let key = findKey(localStorage);
    let raw = key ? localStorage.getItem(key) : null;

    // A full localStorage can push the session into sessionStorage.
    if (!raw) {
      key = findKey(sessionStorage);
      raw = key ? sessionStorage.getItem(key) : null;
    }
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const user = parsed?.user;
    if (!user?.id) return null;

    return { userId: user.id, email: user.email || '' };
  } catch (_) {
    return null;
  }
}

// Diagnostic: distinguish an explicit logout from an expired/refused session.
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') {
    let explicit = false;
    try {
      explicit = sessionStorage.getItem('bgcls_just_logged_out') === 'true';
    } catch (_) {}

    try {
      localStorage.setItem(
        'bgcls_last_auth_signout',
        JSON.stringify({ at: Date.now(), explicit })
      );
    } catch (_) {}

    console.warn(
      `[Auth] SIGNED_OUT (${explicit ? 'explicit logout' : 'automatic / session refresh failed'})`
    );
  }
});
