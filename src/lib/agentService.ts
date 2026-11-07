import { staffAction, staffDb } from './staffDb';
import cylinderBookPreset from '../data/cylinderBookDeliveryBoys.json';

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
    const client = staffDb;
    const { data, error } = await client
      .from('agents')
      .select('id, name, username, phone, status, role, is_staff, created_at')
      .eq('status', 'ACTIVE')
      .order('name');

    if (error || !data || data.length === 0) {
      return cylinderBookPreset as DeliveryBoy[];
    }

    const rows = data as DeliveryBoy[];

    // Match each official name to database record or fallback to preset
    const matchingOfficial = OFFICIAL_CYLINDER_BOOK_NAMES.map((targetName) => {
      const found = rows.find(
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
    const extraCustom = rows.filter(
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
    const client = staffDb;
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

    const agents = (data || []) as DeliveryBoy[];
    const deliveryAgents = agents.filter((a) => a.role === 'AGENT');
    return deliveryAgents.length > 0 ? deliveryAgents : agents;
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

  // Account creation, username de-duplication and auth rollback all happen
  // server-side inside the admin-api Edge Function.
  const { data, error } = await staffAction<DeliveryBoy>('create_agent', {
    name: cleanName,
    phone: payload.phone || '',
    username: payload.username || '',
    password: payload.password || '',
  });

  if (error) throw new Error(error.message);
  if (!data) throw new Error('Failed to create delivery boy account.');
  return data;
}

/**
 * Toggle active / inactive status of a delivery boy
 */
export async function setDeliveryBoyStatus(
  agentId: string,
  newStatus: 'ACTIVE' | 'INACTIVE' | 'DELETED'
): Promise<void> {
  const { error } = await staffDb
    .from('agents')
    .update({ status: newStatus })
    .eq('id', agentId);

  if (error) throw new Error(error.message);
}

/**
 * Update delivery boy name and phone number
 */
export async function updateDeliveryBoy(
  agentId: string,
  updates: { name: string; phone?: string }
): Promise<void> {
  const { error } = await staffDb
    .from('agents')
    .update({
      name: updates.name.trim(),
      phone: updates.phone ? updates.phone.trim() : null,
    })
    .eq('id', agentId);

  if (error) throw new Error(error.message);
}
