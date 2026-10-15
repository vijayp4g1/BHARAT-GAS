import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import cylinderBookPreset from '../data/cylinderBookDeliveryBoys.json';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://skkebmqxhrtarpfwffgx.supabase.co';
const serviceRoleKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

// Admin client for backend-privileged operations (staff adding delivery boys)
let cachedAdminClient: SupabaseClient | null = null;

function getAdminClient(): SupabaseClient {
  if (cachedAdminClient) return cachedAdminClient;
  if (serviceRoleKey) {
    cachedAdminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    return cachedAdminClient;
  }
  return supabase;
}

export interface DeliveryBoy {
  id: string;
  name: string;
  username: string;
  phone?: string | null;
  role: 'AGENT' | 'MANAGER';
  status: 'ACTIVE' | 'INACTIVE' | 'DELETED';
  is_staff?: boolean;
  created_at?: string;
}

export interface CreateDeliveryBoyPayload {
  name: string;
  phone?: string;
  username?: string;
  password?: string;
}

// Official 17 delivery boys for Cylinder Book page (with Shiva Kishore, Sripal, and Wajeed merged)
export const OFFICIAL_CYLINDER_BOOK_NAMES = [
  'ANAND',
  'ESHWAR',
  'HANUMANTH-V',
  'KADALI NAGARAJU',
  'MANIKANTA',
  'NAGARAJU',
  'NAVEEN',
  'NIRANJAN',
  'RAJU',
  'RAMESH',
  'S.SRINU',
  'SHIVA KISHORE',
  'SRIPAL',
  'SURENDER J GUTTA',
  'TIRUPATHI',
  'VIJAY ADDURI',
  'WAJEED',
];

/**
 * Fetch delivery boys specifically for the Cylinder Book page (cylinderbook only).
 * Guaranteed to return the official 17 merged delivery boys, plus any newly added custom boys.
 */
export async function fetchCylinderBookDeliveryBoys(): Promise<DeliveryBoy[]> {
  try {
    const client = serviceRoleKey ? getAdminClient() : supabase;
    const { data, error } = await client
      .from('agents')
      .select('id, name, username, phone, status, role, is_staff, created_at')
      .eq('status', 'ACTIVE')
      .order('name');

    if (error || !data || data.length === 0) {
      return cylinderBookPreset as DeliveryBoy[];
    }

    // Match each official name to database record or fallback to preset
    const matchingOfficial = OFFICIAL_CYLINDER_BOOK_NAMES.map((targetName) => {
      const found = data.find(
        (a) =>
          a.name.trim().toUpperCase() === targetName ||
          (targetName === 'SHIVA KISHORE' && a.name.toUpperCase().includes('SHIVA KISHORE')) ||
          (targetName === 'SRIPAL' && a.name.toUpperCase().includes('SRIPAL')) ||
          (targetName === 'WAJEED' && a.name.toUpperCase().includes('WAJEED')) ||
          (targetName === 'KADALI NAGARAJU' && a.username === 'nagaraju01') ||
          (targetName === 'MANIKANTA' && a.username === 'mani') ||
          (targetName === 'S.SRINU' && a.username === 'srinu') ||
          (targetName === 'SURENDER J GUTTA' && a.username.includes('surender'))
      );
      if (found) {
        return {
          ...found,
          name: targetName, // normalize to official display name
        };
      }
      return (cylinderBookPreset as DeliveryBoy[]).find((p) => p.name === targetName);
    }).filter(Boolean) as DeliveryBoy[];

    // Include any new active agents created by staff not in demo list
    const knownIds = new Set(matchingOfficial.map((a) => a.id));
    const extraCustom = data.filter(
      (a) =>
        a.role === 'AGENT' &&
        !knownIds.has(a.id) &&
        !['Abhilash', 'Bharat', 'Ganesh', 'john', 'Sanija', 'Shashikala', 'RAJ SHEKAR'].includes(a.name.trim())
    );

    return [...matchingOfficial, ...extraCustom];
  } catch (err) {
    console.warn('Error fetching cloud cylinder book delivery boys, using preset:', err);
    return cylinderBookPreset as DeliveryBoy[];
  }
}

/**
 * Fetch all delivery boys (role = AGENT)
 */
export async function fetchDeliveryBoys(includeInactive = false): Promise<DeliveryBoy[]> {
  try {
    const client = serviceRoleKey ? getAdminClient() : supabase;
    let query = client
      .from('agents')
      .select('id, name, username, phone, status, role, is_staff, created_at')
      .neq('status', 'DELETED')
      .order('name');

    if (!includeInactive) {
      query = query.eq('status', 'ACTIVE');
    }

    const { data, error } = await query;
    if (error) throw error;

    const deliveryAgents = (data || []).filter((a) => a.role === 'AGENT');
    return deliveryAgents.length > 0 ? (deliveryAgents as DeliveryBoy[]) : (data as DeliveryBoy[] || []);
  } catch (error) {
    console.error('Error fetching delivery boys:', error);
    throw error;
  }
}

/**
 * Create a new delivery boy account & profile
 * Safely creates Auth credentials and agents table record
 */
export async function createDeliveryBoy(payload: CreateDeliveryBoyPayload): Promise<DeliveryBoy> {
  const cleanName = payload.name.trim();
  if (!cleanName) {
    throw new Error('Please enter a delivery boy name.');
  }

  // Generate safe lowercase alphanumeric username
  let cleanUsername = (payload.username || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]/g, '');

  if (!cleanUsername) {
    const baseSlug = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '');
    cleanUsername = baseSlug ? baseSlug.slice(0, 12) : `agent_${Math.floor(1000 + Math.random() * 9000)}`;
  }

  const cleanPhone = (payload.phone || '').trim().replace(/\s+/g, '');
  const password = payload.password && payload.password.length >= 6
    ? payload.password
    : cleanPhone.length >= 6
    ? cleanPhone
    : '123456';

  const client = getAdminClient();

  // 1. Check if username is already taken in agents table
  const { data: existingAgent } = await client
    .from('agents')
    .select('id, username')
    .eq('username', cleanUsername)
    .maybeSingle();

  if (existingAgent) {
    // If username is taken, append random 3 digits to ensure uniqueness
    cleanUsername = `${cleanUsername}_${Math.floor(100 + Math.random() * 899)}`;
  }

  const dummyEmail = `${cleanUsername}@bgcls.local`;

  // 2. Create User in Supabase Auth via Admin API
  let authUserId: string | null = null;
  const { data: authData, error: authError } = await client.auth.admin.createUser({
    email: dummyEmail,
    password: password,
    email_confirm: true,
  });

  if (authError) {
    // If user already exists in Auth, try retrieving or generating unique suffix
    if (authError.message?.includes('already been registered') || authError.message?.includes('already exists')) {
      cleanUsername = `${cleanUsername}_${Math.floor(1000 + Math.random() * 8999)}`;
      const retryEmail = `${cleanUsername}@bgcls.local`;
      const { data: retryAuth, error: retryErr } = await client.auth.admin.createUser({
        email: retryEmail,
        password: password,
        email_confirm: true,
      });
      if (retryErr) throw retryErr;
      authUserId = retryAuth.user.id;
    } else {
      throw authError;
    }
  } else {
    authUserId = authData.user.id;
  }

  if (!authUserId) {
    throw new Error('Failed to generate agent user account');
  }

  // 3. Insert record into `agents` table
  const { data: dbData, error: dbError } = await client
    .from('agents')
    .insert({
      id: authUserId,
      name: cleanName,
      username: cleanUsername,
      phone: cleanPhone || null,
      role: 'AGENT',
      status: 'ACTIVE',
      is_staff: false,
    })
    .select()
    .single();

  if (dbError) {
    // Rollback Auth user if database insert failed
    try {
      await client.auth.admin.deleteUser(authUserId);
    } catch (_) {}
    throw dbError;
  }

  return dbData as DeliveryBoy;
}

/**
 * Toggle active / inactive status of a delivery boy
 */
export async function setDeliveryBoyStatus(
  agentId: string,
  newStatus: 'ACTIVE' | 'INACTIVE' | 'DELETED'
): Promise<void> {
  const client = getAdminClient();
  const { error } = await client
    .from('agents')
    .update({ status: newStatus })
    .eq('id', agentId);

  if (error) throw error;
}

/**
 * Update delivery boy name and phone number
 */
export async function updateDeliveryBoy(
  agentId: string,
  updates: { name: string; phone?: string }
): Promise<void> {
  const client = getAdminClient();
  const { error } = await client
    .from('agents')
    .update({
      name: updates.name.trim(),
      phone: updates.phone ? updates.phone.trim() : null,
    })
    .eq('id', agentId);

  if (error) throw error;
}
