import { supabase } from './supabase';
import { staffAction, staffDb } from './staffDb';
import { broadcastPermissionsEvent } from './realtimeBus';

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

type AgentPermissionRow = {
  name?: string | null;
  username?: string | null;
  role?: string | null;
  is_staff?: boolean | null;
  status?: string | null;
};

/**
 * Reads the agents row used to decide staff access. Tries the admin-api first
 * (works even when the auth id differs but the username matches), then the
 * direct RLS read as a fallback.
 */
async function readAgentPermissionRow(
  userId: string,
  candidate: string
): Promise<AgentPermissionRow | null> {
  const columns = 'name, username, role, is_staff, status';

  try {
    const byId = await staffDb
      .from('agents')
      .select(columns)
      .eq('id', userId)
      .maybeSingle();
    if (byId.data) return byId.data as AgentPermissionRow;

    if (candidate) {
      const byName = await staffDb
        .from('agents')
        .select(columns)
        .ilike('username', candidate)
        .maybeSingle();
      if (byName.data) return byName.data as AgentPermissionRow;
    }
  } catch (_) {
    // Fall through to the direct RLS read.
  }

  try {
    const byId = await supabase
      .from('agents')
      .select(columns)
      .eq('id', userId)
      .maybeSingle();
    if (byId.data) return byId.data as AgentPermissionRow;

    if (candidate) {
      const byName = await supabase
        .from('agents')
        .select(columns)
        .ilike('username', candidate)
        .maybeSingle();
      if (byName.data) return byName.data as AgentPermissionRow;
    }
  } catch (_) {}

  return null;
}

/**
 * Live-refresh and verify staff permissions.
 *
 * The admin-api is authoritative, but legacy accounts can have an
 * agents.id that differs from their auth user id. In that case `me` returns
 * isStaff=false even though the manager set agents.is_staff. To avoid locking
 * such a user out, fall back to reading the agents row directly by auth id and
 * then by the login username.
 */
export async function refreshCurrentStaffPermission(): Promise<boolean> {
  const persist = (
    userId: string,
    username: string,
    name: string | null,
    role: string,
    isManager: boolean,
    isStaff: boolean
  ) => {
    localStorage.setItem('bgcls_user_role', isManager ? 'MANAGER' : role || 'AGENT');
    if (username) localStorage.setItem('bgcls_logged_username', username);
    if (name) localStorage.setItem('bgcls_agent_name', name);
    if (userId) localStorage.setItem('bgcls_agent_id', userId);
    localStorage.setItem('bgcls_is_staff', isStaff ? 'true' : 'false');
  };

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      localStorage.setItem('bgcls_is_staff', 'false');
      return false;
    }

    const userId = session.user.id;
    const emailLocal = (session.user.email || '').split('@')[0].toLowerCase().trim();
    const cachedUsername =
      (localStorage.getItem('bgcls_logged_username') || '').toLowerCase().trim();

    let isStaff = false;
    let isManager = false;
    let role = 'AGENT';
    let username = cachedUsername || emailLocal;
    let name: string | null = null;

    // 1. Server identity
    const { data: identity, error } = await staffAction<StaffIdentity>('me');
    if (!error && identity) {
      isStaff = identity.isStaff;
      isManager = identity.isManager;
      role = identity.role || 'AGENT';
      username = (identity.username || username).toLowerCase().trim();
      name = identity.name ?? null;
    }

    // 2. Direct agents-row verification when the server identity did not
    //    resolve to a staff member. This covers legacy auth/agents id drift.
    if (!isStaff) {
      const agentRow = await readAgentPermissionRow(userId, username || emailLocal);

      if (agentRow && agentRow.status !== 'DELETED') {
        isManager = isManager || agentRow.role === 'MANAGER';
        isStaff = isManager || agentRow.is_staff === true;
        if (agentRow.username) username = agentRow.username.toLowerCase().trim();
        if (agentRow.name) name = agentRow.name;
        if (isManager) role = 'MANAGER';
        else if (agentRow.role) role = agentRow.role;
      }
    }

    persist(userId, username, name, role, isManager, isStaff);
    return isStaff;
  } catch (err) {
    console.warn('Failed to refresh staff permission from cloud:', err);
    return localStorage.getItem('bgcls_is_staff') === 'true';
  }
}

export interface StaffPermissionResult {
  ok: boolean;
  error?: string;
}

/**
 * Owner/Manager grants Staff Dashboard permission to an agent (e.g., Ganesh)
 */
export async function grantStaffPermission(
  agentId: string,
  username: string
): Promise<StaffPermissionResult> {
  const current = getStaffPermissions();
  const previousList = [...current];
  const cleanUsername = username.toLowerCase().replace('@', '').trim();
  const updated = Array.from(new Set([...current, agentId.toLowerCase(), cleanUsername]));
  localStorage.setItem(STAFF_PERMISSIONS_STORAGE_KEY, JSON.stringify(updated));

  // Server-side update: only a manager may change is_staff.
  try {
    let updatedRows = 0;

    if (agentId) {
      const { data, error } = await staffDb
        .from('agents')
        .update({ is_staff: true })
        .eq('id', agentId);
      if (error) throw new Error(error.message);
      updatedRows += Array.isArray(data) ? data.length : 0;
    }

    if (cleanUsername) {
      const { data, error } = await staffDb
        .from('agents')
        .update({ is_staff: true })
        .ilike('username', cleanUsername);
      if (error) throw new Error(error.message);
      updatedRows += Array.isArray(data) ? data.length : 0;
    }

    // A filter that matched no row is NOT an error in SQL. Without this check
    // the UI used to claim "Granted" while nothing was saved.
    if (updatedRows === 0) {
      throw new Error(
        'No matching agent account was updated. Refresh the team list and try again.'
      );
    }
  } catch (err: any) {
    console.warn('Staff permission update notice:', err);
    // Do not keep a local-only grant: the database is authoritative and a
    // reload would silently revert it.
    localStorage.setItem(STAFF_PERMISSIONS_STORAGE_KEY, JSON.stringify(previousList));
    return { ok: false, error: err?.message || 'Could not update staff access.' };
  }

  // Broadcast realtime notification across devices
  await broadcastPermissionsEvent('staff_permission_changed', {
    agentId,
    username: cleanUsername,
    is_staff: true,
  });
  return { ok: true };
}

/**
 * Owner/Manager revokes Staff Dashboard permission from an agent
 */
export async function revokeStaffPermission(
  agentId: string,
  username: string
): Promise<StaffPermissionResult> {
  const current = getStaffPermissions();
  const previousList = [...current];
  const cleanUsername = username.toLowerCase().replace('@', '').trim();
  const updated = current.filter(
    (item) => item.toLowerCase() !== agentId.toLowerCase() && item.toLowerCase() !== cleanUsername && item.toLowerCase() !== 'john'
  );
  localStorage.setItem(STAFF_PERMISSIONS_STORAGE_KEY, JSON.stringify(updated));

  try {
    let updatedRows = 0;

    if (agentId) {
      const { data, error } = await staffDb
        .from('agents')
        .update({ is_staff: false })
        .eq('id', agentId);
      if (error) throw new Error(error.message);
      updatedRows += Array.isArray(data) ? data.length : 0;
    }

    if (cleanUsername) {
      const { data, error } = await staffDb
        .from('agents')
        .update({ is_staff: false })
        .ilike('username', cleanUsername);
      if (error) throw new Error(error.message);
      updatedRows += Array.isArray(data) ? data.length : 0;
    }

    if (updatedRows === 0) {
      throw new Error(
        'No matching agent account was updated. Refresh the team list and try again.'
      );
    }
  } catch (err: any) {
    console.warn('Staff permission update notice:', err);
    localStorage.setItem(STAFF_PERMISSIONS_STORAGE_KEY, JSON.stringify(previousList));
    return { ok: false, error: err?.message || 'Could not update staff access.' };
  }

  // Broadcast realtime notification across devices
  await broadcastPermissionsEvent('staff_permission_changed', {
    agentId,
    username: cleanUsername,
    is_staff: false,
  });
  return { ok: true };
}
