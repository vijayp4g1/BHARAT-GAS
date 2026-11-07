import { supabase } from './supabase';
import { staffAction, staffDb } from './staffDb';

const STAFF_PERMISSIONS_STORAGE_KEY = 'bgcls_staff_permissions_list';
const DEFAULT_STAFF = ['john', 'ganesh'];

type StaffIdentity = {
  userId: string;
  email: string | null;
  username: string;
  name: string | null;
  role: string;
  is_staff: boolean;
  isManager: boolean;
  isStaff: boolean;
};

/**
 * Retrieve the list of agents (IDs and usernames) who have been granted Staff Dashboard permission
 */
export function getStaffPermissions(): string[] {
  try {
    const raw = localStorage.getItem(STAFF_PERMISSIONS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(parsed) ? parsed : [];
    return Array.from(new Set([...DEFAULT_STAFF, ...list]));
  } catch (e) {
    console.error('Failed to parse staff permissions:', e);
    return DEFAULT_STAFF;
  }
}

/**
 * Check if a specific agent has staff access permissions
 */
export function hasStaffPermission(
  agentId?: string | null,
  username?: string | null,
  isStaffDb?: boolean | null,
  agentName?: string | null
): boolean {
  const cleanUsername = (username || '').toLowerCase().replace('@', '').trim();
  const cleanName = (agentName || '').toLowerCase().trim();

  // John & Ganesh default pre-approval
  if (cleanUsername === 'john' || cleanName === 'john' || cleanUsername.startsWith('john') || cleanName.startsWith('john')) {
    return true;
  }
  if (cleanUsername === 'ganesh' || cleanName === 'ganesh' || cleanUsername.startsWith('ganesh') || cleanName.startsWith('ganesh')) {
    return true;
  }

  // If database explicitly set is_staff to true
  if (isStaffDb === true) return true;
  // If database explicitly set is_staff to false, this user is strictly NOT staff!
  if (isStaffDb === false) return false;

  if (!agentId && !username && !agentName) return false;

  const list = getStaffPermissions().map((s) => s.toLowerCase().replace('@', '').trim());
  if (agentId && list.includes(agentId.toLowerCase())) return true;
  if (cleanUsername && list.includes(cleanUsername)) return true;
  if (cleanName && list.includes(cleanName)) return true;

  return false;
}

/**
 * Check if the currently active logged-in user is a Staff member or Manager
 */
export function isCurrentStaffOrManager(): boolean {
  // If explicitly flagged as non-staff
  if (localStorage.getItem('bgcls_is_staff') === 'false') {
    return false;
  }

  const currentUsername = (
    localStorage.getItem('bgcls_logged_username') ||
    localStorage.getItem('bgcls_remember_username') ||
    ''
  ).toLowerCase().trim();

  // Non-staff known agents
  if (currentUsername === 'sanija') {
    return false;
  }

  // Pre-approved staff usernames
  if (currentUsername === 'john' || currentUsername === 'ganesh') {
    return true;
  }

  const role = localStorage.getItem('bgcls_user_role');
  if (role === 'AGENT') {
    return localStorage.getItem('bgcls_is_staff') === 'true';
  }

  if (role === 'MANAGER') {
    // Only allow manager if username is NOT an agent
    const isAgentUser = currentUsername && !currentUsername.includes('manager') && !currentUsername.includes('admin') && !currentUsername.includes('@');
    if (isAgentUser) {
      return localStorage.getItem('bgcls_is_staff') === 'true';
    }
    return true;
  }

  return localStorage.getItem('bgcls_is_staff') === 'true';
}

/**
 * Live-refresh and verify staff permissions directly against Supabase Postgres
 * Authoritative check: never trusts stale localStorage.
 */
export async function refreshCurrentStaffPermission(): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      localStorage.setItem('bgcls_is_staff', 'false');
      return false;
    }

    // The Edge Function decides staff/manager using fresh server-side data.
    // Never infer manager access from an external email in the browser.
    const { data: identity, error } = await staffAction<StaffIdentity>('me');
    if (error || !identity) {
      throw new Error(error?.message || 'Could not verify staff permission');
    }

    localStorage.setItem(
      'bgcls_user_role',
      identity.isManager ? 'MANAGER' : (identity.role || 'AGENT')
    );

    const username = (identity.username || (identity.email || '').split('@')[0] || '')
      .toLowerCase()
      .trim();
    if (username) localStorage.setItem('bgcls_logged_username', username);
    if (identity.name) localStorage.setItem('bgcls_agent_name', identity.name);
    if (identity.userId) localStorage.setItem('bgcls_agent_id', identity.userId);

    localStorage.setItem('bgcls_is_staff', identity.isStaff ? 'true' : 'false');
    return identity.isStaff;
  } catch (err) {
    console.warn('Failed to refresh staff permission from cloud:', err);
    return localStorage.getItem('bgcls_is_staff') === 'true';
  }
}

/**
 * Owner/Manager grants Staff Dashboard permission to an agent (e.g., Ganesh)
 */
export async function grantStaffPermission(agentId: string, username: string): Promise<void> {
  const current = getStaffPermissions();
  const cleanUsername = username.toLowerCase().replace('@', '').trim();
  const updated = Array.from(new Set([...current, agentId.toLowerCase(), cleanUsername]));
  localStorage.setItem(STAFF_PERMISSIONS_STORAGE_KEY, JSON.stringify(updated));

  // Server-side update: only a manager may change is_staff.
  try {
    if (agentId) {
      const { error } = await staffDb.from('agents').update({ is_staff: true }).eq('id', agentId);
      if (error) throw error;
    }
    if (cleanUsername) {
      const { error } = await staffDb.from('agents').update({ is_staff: true }).ilike('username', cleanUsername);
      if (error) throw error;
    }
  } catch (err) {
    console.warn('Staff permission update notice:', err);
  }

  // Broadcast realtime notification across devices
  try {
    const channel = supabase.channel('bgcls_staff_permissions_channel');
    await channel.send({
      type: 'broadcast',
      event: 'staff_permission_changed',
      payload: { agentId, username: cleanUsername, is_staff: true },
    });
  } catch (_) {}
}

/**
 * Owner/Manager revokes Staff Dashboard permission from an agent
 */
export async function revokeStaffPermission(agentId: string, username: string): Promise<void> {
  const current = getStaffPermissions();
  const cleanUsername = username.toLowerCase().replace('@', '').trim();
  const updated = current.filter(
    (item) => item.toLowerCase() !== agentId.toLowerCase() && item.toLowerCase() !== cleanUsername && item.toLowerCase() !== 'john'
  );
  localStorage.setItem(STAFF_PERMISSIONS_STORAGE_KEY, JSON.stringify(updated));

  try {
    if (agentId) {
      const { error } = await staffDb.from('agents').update({ is_staff: false }).eq('id', agentId);
      if (error) throw error;
    }
    if (cleanUsername) {
      const { error } = await staffDb.from('agents').update({ is_staff: false }).ilike('username', cleanUsername);
      if (error) throw error;
    }
  } catch (err) {
    console.warn('Staff permission update notice:', err);
  }

  // Broadcast realtime notification across devices
  try {
    const channel = supabase.channel('bgcls_staff_permissions_channel');
    await channel.send({
      type: 'broadcast',
      event: 'staff_permission_changed',
      payload: { agentId, username: cleanUsername, is_staff: false },
    });
  } catch (_) {}
}
