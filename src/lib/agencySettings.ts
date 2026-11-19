import { supabase } from './supabase';
import { getIstDateString } from './dateUtils';

/**
 * Shared agency settings (currently the 14.2kg cylinder selling rate).
 *
 * The table is manager-writable. If the migration has not been applied yet the
 * app falls back to the existing localStorage rate so nothing breaks.
 */
export interface AgencySettings {
  cylinder_rate: number;
  rate_effective_from?: string | null;
  updated_at?: string | null;
}

const RATE_STORAGE_KEY = 'bgcls_cylinder_rate';
const SETTINGS_STORAGE_KEY = 'bgcls_agency_settings';

export function getCachedCylinderRate(): number {
  try {
    const raw = localStorage.getItem(RATE_STORAGE_KEY);
    const rate = Number(raw);
    return rate > 0 ? rate : 994;
  } catch {
    return 994;
  }
}

export function cacheCylinderRate(rate: number): void {
  try {
    if (rate > 0) localStorage.setItem(RATE_STORAGE_KEY, String(rate));
  } catch (_) {}
}

export async function fetchAgencySettings(): Promise<AgencySettings | null> {
  try {
    const { data, error } = await supabase
      .from('agency_settings')
      .select('cylinder_rate, rate_effective_from, updated_at')
      .eq('id', 1)
      .maybeSingle();

    if (error || !data) return null;

    const rate = Number(data.cylinder_rate);
    if (!(rate > 0)) return null;

    cacheCylinderRate(rate);
    try {
      localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify({
          cylinder_rate: rate,
          rate_effective_from: data.rate_effective_from,
          updated_at: data.updated_at,
        })
      );
    } catch (_) {}

    return {
      cylinder_rate: rate,
      rate_effective_from: data.rate_effective_from,
      updated_at: data.updated_at,
    };
  } catch (_) {
    return null;
  }
}

export async function saveAgencyRate(
  rate: number
): Promise<{ ok: boolean; shared: boolean; error?: string }> {
  if (!(rate > 0)) {
    return { ok: false, shared: false, error: 'Invalid rate amount' };
  }

  // Always keep a local copy so day-end entry still uses the latest rate offline.
  cacheCylinderRate(rate);

  try {
    const { data: userData } = await supabase.auth.getUser();
    const now = new Date().toISOString();
    const today = getIstDateString();

    const { error } = await supabase.from('agency_settings').upsert(
      {
        id: 1,
        cylinder_rate: rate,
        rate_effective_from: today,
        updated_by: userData?.user?.id ?? null,
        updated_at: now,
      },
      { onConflict: 'id' }
    );

    if (error) {
      return { ok: true, shared: false, error: error.message };
    }
    return { ok: true, shared: true };
  } catch (err: any) {
    return { ok: true, shared: false, error: err?.message || 'Network error' };
  }
}
