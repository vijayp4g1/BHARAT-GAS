import { supabase } from './supabase';

export interface AuthSessionInfo {
  userId: string;
  email?: string;
  role: 'AGENT' | 'MANAGER';
}

/**
 * Robustly log out the user, clearing local session storage and Supabase auth keys
 */
export async function performLogout(): Promise<void> {
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

  // Clear any persistent Supabase auth tokens from localStorage
  try {
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
        localStorage.removeItem(key);
      }
    });
  } catch (_) {}
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

  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session || !session.user) {
      return null;
    }

    const userId = session.user.id;
    const email = session.user.email || '';

    // 1. Check locally cached role (instant 0ms)
    const cachedRole = localStorage.getItem('bgcls_user_role') as 'AGENT' | 'MANAGER' | null;
    if (cachedRole === 'AGENT' || cachedRole === 'MANAGER') {
      return { userId, email, role: cachedRole };
    }

    // 2. Infer from email convention
    const inferredRole: 'AGENT' | 'MANAGER' = email.includes('@bgcls.local') ? 'AGENT' : 'MANAGER';

    // 3. Cache and return immediately without blocking UI
    localStorage.setItem('bgcls_user_role', inferredRole);
    return { userId, email, role: inferredRole };
  } catch (err) {
    console.error('Error in getFastAuthSession:', err);
    return null;
  }
}
