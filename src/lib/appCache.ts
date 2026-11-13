/**
 * App cache maintenance.
 *
 * Browsers intentionally do NOT expose a "clear the whole Chrome cache" API to
 * web pages. What a page *can* do is:
 *   - delete its own Cache Storage (the PWA/Workbox downloaded JS/CSS/images),
 *   - unregister the old service worker,
 *   - reload through a cache-busting URL so Chrome fetches a fresh app shell.
 *
 * This function deliberately does NOT touch localStorage, sessionStorage or
 * IndexedDB. That means it can never delete:
 *   - login / Supabase auth session,
 *   - saved day-end bills,
 *   - unsaved day-end and BPCL paste drafts,
 *   - offline data (locations, photos, notes, unsynced settlements),
 *   - archived/no-supply flags,
 *   - the local scanned-receipt audit log,
 *   - any app setting.
 *
 * It only removes downloaded application files, which are re-downloaded.
 */

const CACHE_BUST_PARAM = 'appv';

/**
 * Clears the app's downloaded files and reloads a fresh copy.
 * Throws a friendly error when offline (the fresh copy could not load).
 */
export async function clearAppCacheAndReload(): Promise<void> {
  if (!navigator.onLine) {
    throw new Error('Connect to the internet before refreshing the app.');
  }

  if ('caches' in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    } catch (err) {
      console.warn('Cache Storage clear failed:', err);
    }
  }

  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    } catch (err) {
      console.warn('Service worker unregister failed:', err);
    }
  }

  // NOTE: intentionally no localStorage / sessionStorage / IndexedDB cleanup.
  // Saved bills, drafts, login session and offline data must survive this.

  // A new query key bypasses Chrome's cached HTML for this navigation. The
  // parameter is removed from the address bar by stripCacheBustParam().
  const url = new URL(window.location.href);
  url.searchParams.set(CACHE_BUST_PARAM, Date.now().toString());
  window.location.replace(url.toString());
}

/** Removes the temporary ?appv= cache-buster from the address bar. */
export function stripCacheBustParam(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(CACHE_BUST_PARAM)) return;
    url.searchParams.delete(CACHE_BUST_PARAM);
    window.history.replaceState(
      {},
      '',
      `${url.pathname}${url.search}${url.hash}`
    );
  } catch (_) {}
}
