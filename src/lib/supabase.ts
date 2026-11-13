import { createClient } from '@supabase/supabase-js';
import {
  evictOldestDraft,
  freeLocalStorageSpace,
  isStorageQuotaError,
} from './storageCleanup';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://skkebmqxhrtarpfwffgx.supabase.co';
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
      return window.localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  },

  setItem(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
      return;
    } catch (err) {
      if (!isStorageQuotaError(err)) throw err;
    }

    // 1st retry: remove caches, trim the audit log, prune old drafts.
    freeLocalStorageSpace({ aggressive: true });
    try {
      window.localStorage.setItem(key, value);
      return;
    } catch (err) {
      if (!isStorageQuotaError(err)) throw err;
    }

    // Last resort: evict the oldest drafts (newest two are kept) until the
    // auth/session token fits. Saved bills live in Supabase/IndexedDB.
    for (let attempt = 0; attempt < 10; attempt++) {
      if (!evictOldestDraft()) break;
      try {
        window.localStorage.setItem(key, value);
        return;
      } catch (err) {
        if (!isStorageQuotaError(err)) throw err;
      }
    }

    console.error(
      '[Auth] Could not persist the session because localStorage is full. ' +
        'Free device storage and reload the app.'
    );
    throw new Error('localStorage quota exceeded while saving the session');
  },

  removeItem(key: string): void {
    try {
      window.localStorage.removeItem(key);
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
export function readPersistedAuthSession(): { userId: string; email: string } | null {
  try {
    const key = Object.keys(localStorage).find(
      (k) => k.startsWith('sb-') && k.endsWith('-auth-token')
    );
    if (!key) return null;

    const raw = localStorage.getItem(key);
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
