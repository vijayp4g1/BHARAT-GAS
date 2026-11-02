import { supabase } from './supabase';
import { createClient } from '@supabase/supabase-js';
import { isCurrentStaffOrManager, refreshCurrentStaffPermission } from './staffAuth';
import cylinderBookPreset from '../data/cylinderBookDeliveryBoys.json';

const ASSIGNMENTS_STORAGE_KEY = 'bgcls_agent_delivery_boy_assignments';
const serviceRoleKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://skkebmqxhrtarpfwffgx.supabase.co';
const adminClient = serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : supabase;

export interface AgentAssignmentMap {
  [agentIdOrUsername: string]: string; // maps agent ID or username -> delivery boy name (e.g. 'NAGARAJU')
}

/**
 * Get locally cached delivery boy assignments map
 */
export function getLocalAssignments(): AgentAssignmentMap {
  try {
    const raw = localStorage.getItem(ASSIGNMENTS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Save assignments to localStorage cache
 */
export function setLocalAssignments(map: AgentAssignmentMap): void {
  try {
    localStorage.setItem(ASSIGNMENTS_STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    console.warn('Failed to save assignments to localStorage:', err);
  }
}

/**
 * Fetch all agent delivery boy assignments from Supabase audit_logs & auth
 */
export async function fetchAgentDeliveryBoyAssignments(): Promise<AgentAssignmentMap> {
  const map: AgentAssignmentMap = { ...getLocalAssignments() };

  try {
    const [{ data: auditData }, { data: agentsData }] = await Promise.all([
      adminClient
        .from('audit_logs')
        .select('entity_id, action_type, timestamp')
        .like('action_type', 'ASSIGN_DELIVERY_BOY:%')
        .order('timestamp', { ascending: true }),
      adminClient
        .from('agents')
        .select('id, username')
    ]);

    const idToUsername: Record<string, string> = {};
    if (Array.isArray(agentsData)) {
      agentsData.forEach((a) => {
        if (a.id && a.username) {
          idToUsername[a.id] = a.username.toLowerCase().trim();
        }
      });
    }

    if (Array.isArray(auditData)) {
      auditData.forEach((row) => {
        if (!row.entity_id || !row.action_type) return;
        const boyName = row.action_type.replace('ASSIGN_DELIVERY_BOY:', '').trim().toUpperCase();
        const username = idToUsername[row.entity_id];
        if (boyName === 'UNASSIGNED' || boyName === 'NONE' || !boyName) {
          delete map[row.entity_id];
          if (username) delete map[username];
        } else {
          map[row.entity_id] = boyName;
          if (username) map[username] = boyName;
        }
      });
      setLocalAssignments(map);
    }
  } catch (err) {
    console.warn('Error fetching agent assignments from cloud:', err);
  }

  return map;
}

/**
 * Manager assigns a specific delivery boy to an agent ID / username
 * Example: Manager assigns Sanija to NAGARAJU
 */
export async function assignDeliveryBoyToAgent(
  agentId: string,
  username: string,
  deliveryBoyName: string | null
): Promise<boolean> {
  const normBoy = deliveryBoyName ? deliveryBoyName.trim().toUpperCase() : '';
  const cleanUsername = username.toLowerCase().replace('@', '').trim();

  // 1. Update local cache immediately
  const local = getLocalAssignments();
  if (normBoy) {
    local[agentId] = normBoy;
    if (cleanUsername) local[cleanUsername] = normBoy;
  } else {
    delete local[agentId];
    if (cleanUsername) delete local[cleanUsername];
  }
  setLocalAssignments(local);

  // 2. Persist to Supabase Auth User Metadata (Permanent)
  try {
    if (adminClient && agentId) {
      await adminClient.auth.admin.updateUserById(agentId, {
        user_metadata: { assigned_delivery_boy: normBoy },
      });
    }
  } catch (err) {
    console.warn('Failed to update auth metadata for agent assignment:', err);
  }

  // 3. Persist to Postgres audit_logs table (Accessible by all clients)
  try {
    await adminClient.from('audit_logs').insert({
      action_type: `ASSIGN_DELIVERY_BOY:${normBoy || 'UNASSIGNED'}`,
      entity_id: agentId,
      performed_by: agentId,
    });
  } catch (err) {
    console.warn('Failed to log assignment to audit_logs:', err);
  }

  // 4. Broadcast realtime notification to active devices
  try {
    const channel = supabase.channel('bgcls_staff_permissions_channel');
    await channel.send({
      type: 'broadcast',
      event: 'delivery_boy_assignment_changed',
      payload: {
        agentId,
        username: cleanUsername,
        assigned_delivery_boy: normBoy,
      },
    });
  } catch (_) {}

  return true;
}

/**
 * Resolve which delivery boy an agent is allowed to access synchronously.
 * Returns:
 * - 'ALL' if user is a Staff member or Manager
 * - Specific boy name (e.g. 'NAGARAJU') if assigned by Manager or matching profile
 * - null if unassigned non-staff user
 */
export function getAgentAssignedDeliveryBoy(
  agentId?: string | null,
  username?: string | null,
  agentName?: string | null
): string | null {
  // Staff and Managers can access ALL delivery boys
  if (isCurrentStaffOrManager()) {
    return 'ALL';
  }

  const cleanUser = (
    username ||
    localStorage.getItem('bgcls_logged_username') ||
    localStorage.getItem('bgcls_remember_username') ||
    ''
  )
    .toLowerCase()
    .replace('@', '')
    .trim();

  const cleanId = agentId || localStorage.getItem('bgcls_agent_id') || '';
  const cleanName = (agentName || localStorage.getItem('bgcls_agent_name') || '').trim().toUpperCase();

  // 1. Check local assignments map
  const map = getLocalAssignments();
  if (cleanId && map[cleanId]) return map[cleanId].toUpperCase();
  if (cleanUser && map[cleanUser]) return map[cleanUser].toUpperCase();

  // 2. Check localStorage stored session assignment
  const sessionBoy = localStorage.getItem('bgcls_assigned_delivery_boy');
  if (sessionBoy) {
    return sessionBoy.trim().toUpperCase();
  }

  // 3. Check if user's own profile matches an official delivery boy name
  const officialBoys = (cylinderBookPreset as Array<{ name: string }>).map((b) => b.name.toUpperCase());
  if (cleanName && officialBoys.includes(cleanName)) {
    return cleanName;
  }
  const matchingBoy = officialBoys.find(
    (b) => b.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanUser.replace(/[^a-z0-9]/g, '')
  );
  if (matchingBoy) {
    return matchingBoy;
  }

  return null;
}

/**
 * Asynchronously and authoritatively resolve the current user's route access.
 * Refreshes staff status and cloud assignments first.
 */
export async function resolveCurrentAgentDeliveryBoy(): Promise<{
  isStaffOrManager: boolean;
  assignedBoy: string | null;
}> {
  // 1. Authoritative check for Staff / Manager
  const isStaff = await refreshCurrentStaffPermission();
  if (isStaff) {
    return { isStaffOrManager: true, assignedBoy: 'ALL' };
  }

  // 2. Non-staff agent: Check Supabase auth session metadata directly
  let sessionUserId: string | null = null;
  let sessionUsername: string | null = null;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      sessionUserId = user.id;
      sessionUsername = user.email ? user.email.replace('@bgcls.local', '').trim().toLowerCase() : null;
      const metaBoy = user.user_metadata?.assigned_delivery_boy;
      if (metaBoy && typeof metaBoy === 'string') {
        const norm = metaBoy.trim().toUpperCase();
        localStorage.setItem('bgcls_assigned_delivery_boy', norm);
      }
    }
  } catch (e) {
    console.warn('Failed to get user metadata for delivery boy route:', e);
  }

  // 3. Fetch latest assignments from Supabase audit_logs
  await fetchAgentDeliveryBoyAssignments();

  // 4. Resolve assigned delivery boy using all identifiers
  const assignedBoy = getAgentAssignedDeliveryBoy(sessionUserId, sessionUsername);
  if (assignedBoy && assignedBoy !== 'ALL') {
    localStorage.setItem('bgcls_assigned_delivery_boy', assignedBoy);
  }

  return {
    isStaffOrManager: false,
    assignedBoy,
  };
}
