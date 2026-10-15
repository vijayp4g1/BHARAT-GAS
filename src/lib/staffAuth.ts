import { supabase } from './supabase';

const STAFF_PERMISSIONS_STORAGE_KEY = 'bgcls_staff_permissions_list';
const DEFAULT_STAFF = ['john'];

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
  if (isStaffDb === true) return true;

  const cleanUsername = (username || '').toLowerCase().replace('@', '').trim();
  const cleanName = (agentName || '').toLowerCase().trim();

  // John is pre-approved by default
  if (cleanUsername === 'john' || cleanName === 'john' || cleanUsername.startsWith('john') || cleanName.startsWith('john')) {
    return true;
  }

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
  const role = localStorage.getItem('bgcls_user_role');
  if (role === 'MANAGER') return true;

  const currentAgentId = localStorage.getItem('bgcls_agent_id');
  const currentUsername = localStorage.getItem('bgcls_remember_username');
  const isExplicitStaff = localStorage.getItem('bgcls_is_staff') === 'true';

  if (isExplicitStaff) return true;
  return hasStaffPermission(currentAgentId, currentUsername);
}

/**
 * Owner/Manager grants Staff Dashboard permission to an agent (e.g., John)
 */
export async function grantStaffPermission(agentId: string, username: string): Promise<void> {
  const current = getStaffPermissions();
  const cleanUsername = username.toLowerCase().replace('@', '').trim();
  const updated = Array.from(new Set([...current, agentId.toLowerCase(), cleanUsername]));
  localStorage.setItem(STAFF_PERMISSIONS_STORAGE_KEY, JSON.stringify(updated));

  // Sync to Supabase agents table if is_staff column is available
  try {
    await supabase.from('agents').update({ is_staff: true } as any).eq('id', agentId);
  } catch (_) {
    // Graceful fallback
  }
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
    await supabase.from('agents').update({ is_staff: false } as any).eq('id', agentId);
  } catch (_) {
    // Graceful fallback
  }
}

