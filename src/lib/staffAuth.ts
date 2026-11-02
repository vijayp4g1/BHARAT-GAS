import { createClient } from '@supabase/supabase-js';
import { supabase } from './supabase';

const STAFF_PERMISSIONS_STORAGE_KEY = 'bgcls_staff_permissions_list';
const DEFAULT_STAFF = ['john', 'ganesh'];

// Create an administrative privileged client for staff permission management
// This bypasses RLS so Manager can grant/revoke staff permissions reliably in Postgres!
const serviceRoleKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://skkebmqxhrtarpfwffgx.supabase.co';
const adminClient = serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : supabase;

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

  // John & Ganesh default pre-approval
  if (cleanUsername === 'john' || cleanName === 'john' || cleanUsername.startsWith('john') || cleanName.startsWith('john')) {
    return true;
  }
  if (cleanUsername === 'ganesh' || cleanName === 'ganesh' || cleanUsername.startsWith('ganesh') || cleanName.startsWith('ganesh')) {
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
 * Live-refresh and verify staff permissions against Supabase
 * Ensures that if Manager granted permission while user was logged in,
 * the user receives instant access without having to re-login.
 */
export async function refreshCurrentStaffPermission(): Promise<boolean> {
  const role = localStorage.getItem('bgcls_user_role');
  if (role === 'MANAGER') return true;

  const currentAgentId = localStorage.getItem('bgcls_agent_id');
  const currentUsername = (localStorage.getItem('bgcls_remember_username') || '').toLowerCase().trim();

  // Pre-approved staff usernames
  if (currentUsername === 'john' || currentUsername === 'ganesh') {
    localStorage.setItem('bgcls_is_staff', 'true');
    return true;
  }

  if (!currentAgentId && !currentUsername) return false;

  try {
    let query = supabase.from('agents').select('id, name, username, is_staff, role');
    if (currentAgentId && currentAgentId !== 'agent_default') {
      query = query.or(`id.eq.${currentAgentId},username.ilike.${currentUsername || ''}`);
    } else if (currentUsername) {
      query = query.ilike('username', currentUsername);
    }

    const { data } = await query.maybeSingle();
    if (data) {
      const isStaff = Boolean(
        data.is_staff === true ||
        data.role === 'MANAGER' ||
        (data.username && (data.username.toLowerCase() === 'john' || data.username.toLowerCase() === 'ganesh'))
      );

      if (isStaff) {
        localStorage.setItem('bgcls_is_staff', 'true');
        return true;
      } else {
        localStorage.removeItem('bgcls_is_staff');
        return false;
      }
    }
  } catch (err) {
    console.warn('Failed to refresh staff permission from cloud:', err);
  }

  return localStorage.getItem('bgcls_is_staff') === 'true';
}

/**
 * Owner/Manager grants Staff Dashboard permission to an agent (e.g., Ganesh)
 */
export async function grantStaffPermission(agentId: string, username: string): Promise<void> {
  const current = getStaffPermissions();
  const cleanUsername = username.toLowerCase().replace('@', '').trim();
  const updated = Array.from(new Set([...current, agentId.toLowerCase(), cleanUsername]));
  localStorage.setItem(STAFF_PERMISSIONS_STORAGE_KEY, JSON.stringify(updated));

  // Directly update Supabase Postgres agents table (using admin client to bypass RLS)
  try {
    if (agentId) {
      await adminClient.from('agents').update({ is_staff: true } as any).eq('id', agentId);
    }
    if (cleanUsername) {
      await adminClient.from('agents').update({ is_staff: true } as any).ilike('username', cleanUsername);
    }
  } catch (err) {
    console.warn('Direct agents table update notice:', err);
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
      await adminClient.from('agents').update({ is_staff: false } as any).eq('id', agentId);
    }
    if (cleanUsername) {
      await adminClient.from('agents').update({ is_staff: false } as any).ilike('username', cleanUsername);
    }
  } catch (err) {
    console.warn('Direct agents table update notice:', err);
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
