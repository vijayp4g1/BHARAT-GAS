import { supabase, readPersistedAuthSession } from './supabase';

export interface AuthSessionInfo {
  userId: string;
  email?: string;
  role: 'AGENT' | 'MANAGER';
}

/**
 * Robustly log out the user, clearing local session storage and Supabase auth keys.
 *
 * A confirmation is shown by default so a stray tap on the header logout icon
 * (or on a phone) cannot silently end the session. Pass `{ confirm: false }`
 * when the caller has already confirmed.
 *
 * Returns false when the user cancels.
 */
export async function performLogout(
  options: { confirm?: boolean } = {}
): Promise<boolean> {
  if (options.confirm !== false) {
    const confirmed = window.confirm(
      'Log out of Siddhartha Bharat Gas?\n\nSaved bills, drafts and offline data stay on this device.'
    );
    if (!confirmed) return false;
  }

  // Mark that user explicitly initiated logout so Login page doesn't auto-redirect
  try {
    sessionStorage.setItem('bgcls_just_logged_out', 'true');
  } catch (_) {}

  try {
    // Local scope ensures immediate local session destruction even if offline
    await supabase.auth.signOut({ scope: 'local' });
  } catch (err) {
    console.warn('Supabase local signOut warning:', err);
    try {
      await supabase.auth.signOut();
    } catch (_) {}
  }

  // Clear specific application auth cache
  localStorage.removeItem('bgcls_agent_id');
  localStorage.removeItem('bgcls_user_role');
  localStorage.removeItem('bgcls_is_staff');
  localStorage.removeItem('bgcls_assigned_delivery_boy');
  localStorage.removeItem('bgcls_agent_name');
  localStorage.removeItem('bgcls_logged_username');
  localStorage.removeItem('bgcls_day_end_selected_boy_name');
  localStorage.removeItem('bgcls_staff_permissions_list');
  localStorage.removeItem('bgcls_agent_delivery_boy_assignments');

  // Clear any persistent Supabase auth tokens from localStorage
  try {
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
        localStorage.removeItem(key);
      }
    });
  } catch (_) {}

  return true;
}

/**
 * Fast session check that retrieves role locally or with minimal network overhead
 */
export async function getFastAuthSession(): Promise<AuthSessionInfo | null> {
  // If user just explicitly logged out, skip session restoration
  if (sessionStorage.getItem('bgcls_just_logged_out') === 'true') {
    sessionStorage.removeItem('bgcls_just_logged_out');
    return null;
  }

  const resolveSession = async (): Promise<{ userId: string; email: string } | null> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        return { userId: session.user.id, email: session.user.email || '' };
      }
    } catch (err) {
      console.warn('getSession failed (will retry):', err);
    }
    return null;
  };

  let resolved = await resolveSession();

  // Auth-js may still be restoring/refreshing the session right after a reload,
  // a PWA update, or when the device comes back online.
  if (!resolved) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    resolved = await resolveSession();
  }

  if (!resolved) {
    // A transient refresh failure keeps the token in localStorage; auth-js only
    // deletes it on a real sign-out. Staying signed in is safer (and matches
    // this app's offline mode) than bouncing to the login screen on a blip.
    resolved = readPersistedAuthSession();
    if (!resolved) return null;
  }

  // 1. Check locally cached role (instant 0ms)
  const cachedRole = localStorage.getItem('bgcls_user_role') as 'AGENT' | 'MANAGER' | null;
  if (cachedRole === 'AGENT' || cachedRole === 'MANAGER') {
    return { userId: resolved.userId, email: resolved.email, role: cachedRole };
  }

  // 2. Infer from email convention
  const inferredRole: 'AGENT' | 'MANAGER' = resolved.email.includes('@bgcls.local') ? 'AGENT' : 'MANAGER';

  // 3. Cache and return immediately without blocking UI
  try {
    localStorage.setItem('bgcls_user_role', inferredRole);
  } catch (_) {}
  return { userId: resolved.userId, email: resolved.email, role: inferredRole };
}
