import { supabase } from './supabase';
import { staffDb } from './staffDb';
import { fetchCylinderBookDeliveryBoys, type DeliveryBoy } from './agentService';
import cylinderBookPreset from '../data/cylinderBookDeliveryBoys.json';

const LIVE_SYNC_TOPIC = 'bgcls_cash_memo_live_sync';

/**
 * A single, long-lived broadcast channel owned by this module.
 *
 * Realtime `send()` is only delivered on a channel that has finished joining.
 * The previous code created a brand-new channel and immediately called
 * `send()` on it, so the broadcast was dropped and other staff devices only
 * refreshed when the user manually reloaded. Subscribing once here keeps the
 * socket joined, which makes cross-device updates actually arrive.
 */
let liveSyncChannel: ReturnType<typeof supabase.channel> | null = null;
let liveSyncJoined = false;

function getLiveSyncChannel() {
  if (!liveSyncChannel) {
    liveSyncChannel = supabase.channel(LIVE_SYNC_TOPIC);
    liveSyncChannel.subscribe((status: string) => {
      liveSyncJoined = status === 'SUBSCRIBED';
    });
  }
  return liveSyncChannel;
}

/** Wait briefly for the socket to join, then broadcast. Failures are non-fatal. */
async function broadcastCashMemosUpdated(payload: Record<string, unknown>): Promise<void> {
  try {
    const channel = getLiveSyncChannel();
    if (!liveSyncJoined) {
      for (let i = 0; i < 10 && !liveSyncJoined; i++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    await channel.send({ type: 'broadcast', event: 'cash_memos_updated', payload });
  } catch (_) {
    // Realtime is an optimisation; the database write has already succeeded.
  }
}

export interface DayEndEntry {
  consumer_id?: string;
  consumer_number: string;
  consumer_name: string;
  address?: string;
  mobile?: string;
  found: boolean;
  source?: 'local' | 'remote' | 'manual' | 'route' | 'camera';
  cylinder_type: '14.2KG_STD' | '10KG_LITE' | '19KG_COMM';
  payment_mode: 'CASH' | 'UPI' | 'DUE';
  empty_collected: boolean;
  dispatch_item_id?: string;
  scanned_at?: string;
  duplicate_of_agent?: string;
  duplicate_claimed_date?: string;
}

export interface DayEndReportSummary {
  id?: string;
  report_date: string; // YYYY-MM-DD
  agent_id?: string;
  agent_name: string;
  total_deliveries: number;
  domestic_14kg: number;
  composite_10kg: number;
  commercial_19kg: number;
  empties_collected: number;
  cash_count: number;
  upi_count: number;
  due_count: number;
  entries: DayEndEntry[];
  raw_csv?: string;
  supervisor_phone?: string;
  scanned_by_staff?: string;
  created_at?: string;
  updated_at?: string;
}

// Memory & local cache keys
export const SCANNED_BILLS_TAG = '__BGCLS_SCANNED_BILLS__';
export const BPCL_REPORT_TAG = '__BGCLS_BPCL_REPORT__';

/**
 * Shared local working-draft key for a (date, delivery boy) pair.
 * Both the staff screen and the agent screen must use this exact key so a
 * draft written by one screen can never be read as another day's draft.
 */
export const getWorkingDraftKey = (dateStr: string, agentName: string): string => {
  const norm = (agentName || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
  return `bgcls_day_end_working_draft_${dateStr}_${norm}`;
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Calendar date (YYYY-MM-DD) of a timestamp in India Standard Time.
 * `scanned_at` is stored as UTC, so a bill scanned at 02:00 IST on 07-11 is
 * 20:30 UTC on 06-11. Comparing the raw UTC date would put it on the wrong day.
 */
export function toIstDateString(value?: string | number | Date | null): string {
  if (value === undefined || value === null || value === '') return '';
  const ms =
    value instanceof Date
      ? value.getTime()
      : typeof value === 'number'
        ? value
        : Date.parse(String(value));
  if (!Number.isFinite(ms)) return '';
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Safely parse scanned bills JSON from settlement notes.
 * Robust against co-existence with BPCL reports, arbitrary text, and formatting.
 */
export function extractScannedBillsFromNotes(notes: string | null | undefined): DayEndEntry[] {
  if (!notes || !notes.includes(SCANNED_BILLS_TAG)) return [];
  try {
    let raw = notes.split(SCANNED_BILLS_TAG)[1];
    if (!raw) return [];
    if (raw.includes(BPCL_REPORT_TAG)) {
      raw = raw.split(BPCL_REPORT_TAG)[0];
    }
    const parsed = JSON.parse(raw.trim());
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (err) {
    console.warn('Failed to parse scanned bills from notes:', err);
  }
  return [];
}

const getDayEndStorageKey = (dateStr: string, agentNameOrId: string): string => {
  const cleanAgent = agentNameOrId.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
  return `bgcls_day_end_cloud_cache_${dateStr}_${cleanAgent}`;
};

/**
 * Fetch the roster of available delivery boys for day-end bill scanning.
 */
export async function getDayEndDeliveryBoys(): Promise<DeliveryBoy[]> {
  try {
    const list = await fetchCylinderBookDeliveryBoys();
    if (list && list.length > 0) return list;
  } catch (err) {
    console.warn('Failed to fetch delivery boys from agent service, using preset:', err);
  }
  return cylinderBookPreset as DeliveryBoy[];
}

/**
 * Fetch all saved day end reports for a given date across ALL delivery boys.
 * Used for the unified "All Delivery Boys" overview.
 */
export async function fetchAllDayEndReportsForDate(dateStr: string): Promise<Record<string, DayEndReportSummary>> {
  const result: Record<string, DayEndReportSummary> = {};

  // 1. Try querying day_end_reports from Supabase
  try {
    const { data, error } = await staffDb
      .from('day_end_reports')
      .select('*')
      .eq('report_date', dateStr);

    if (!error && data && data.length > 0) {
      data.forEach((r: any) => {
        const normName = (r.agent_name || '').trim().toUpperCase();
        result[normName] = {
          id: r.id,
          report_date: r.report_date,
          agent_id: r.agent_id,
          agent_name: r.agent_name,
          total_deliveries: r.total_deliveries || (Array.isArray(r.entries) ? r.entries.length : 0),
          domestic_14kg: r.domestic_14kg || 0,
          composite_10kg: r.composite_10kg || 0,
          commercial_19kg: r.commercial_19kg || 0,
          empties_collected: r.empties_collected || 0,
          cash_count: r.cash_count || 0,
          upi_count: r.upi_count || 0,
          due_count: r.due_count || 0,
          entries: Array.isArray(r.entries) ? r.entries : [],
          raw_csv: r.raw_csv || '',
          supervisor_phone: r.supervisor_phone || '',
          scanned_by_staff: r.scanned_by_staff || '',
          updated_at: r.updated_at || r.created_at,
        };
      });
      return result;
    }
  } catch (err) {
    console.warn('day_end_reports query notice, checking settlement notes fallback:', err);
  }

  // 2. Fallback: Check staff_cylinder_settlements for this date
  try {
    const { data: settlements, error: setErr } = await staffDb
      .from('staff_cylinder_settlements')
      .select('agent_name, agent_id, cash_cylinders, upi_cylinders, due_cylinders, notes, updated_at')
      .eq('settlement_date', dateStr);

    if (!setErr && settlements && settlements.length > 0) {
      settlements.forEach((s: any) => {
        const normName = (s.agent_name || '').trim().toUpperCase();
        const parsed = extractScannedBillsFromNotes(s.notes);
        if (parsed.length > 0) {
          result[normName] = {
            report_date: dateStr,
            agent_id: s.agent_id,
            agent_name: s.agent_name,
            total_deliveries: parsed.length,
            domestic_14kg: parsed.filter((e: any) => e.cylinder_type === '14.2KG_STD').length,
            composite_10kg: parsed.filter((e: any) => e.cylinder_type === '10KG_LITE').length,
            commercial_19kg: parsed.filter((e: any) => e.cylinder_type === '19KG_COMM').length,
            empties_collected: parsed.filter((e: any) => e.empty_collected).length,
            cash_count: parsed.filter((e: any) => e.payment_mode === 'CASH').length,
            upi_count: parsed.filter((e: any) => e.payment_mode === 'UPI').length,
            due_count: parsed.filter((e: any) => e.payment_mode === 'DUE').length,
            entries: parsed,
            updated_at: s.updated_at,
          };
        } else if (s.cash_cylinders || s.upi_cylinders || s.due_cylinders) {
          const total = (s.cash_cylinders || 0) + (s.upi_cylinders || 0) + (s.due_cylinders || 0);
          if (total > 0 && !result[normName]) {
            result[normName] = {
              report_date: dateStr,
              agent_id: s.agent_id,
              agent_name: s.agent_name,
              total_deliveries: total,
              domestic_14kg: total,
              composite_10kg: 0,
              commercial_19kg: 0,
              empties_collected: total,
              cash_count: s.cash_cylinders || 0,
              upi_count: s.upi_cylinders || 0,
              due_count: s.due_cylinders || 0,
              entries: [],
              updated_at: s.updated_at,
            };
          }
        }
      });
    }
  } catch (_) {}

  // 3. Fallback: Merge any local cached copies for this date
  try {
    const prefix = `bgcls_day_end_cloud_cache_${dateStr}_`;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          const normName = (parsed.agent_name || '').trim().toUpperCase();
          if (!result[normName]) {
            result[normName] = parsed;
          }
        }
      }
    }
  } catch (_) {}

  return result;
}

/**
 * Fetch saved bills for a single delivery boy on a given date.
 */
export async function fetchDayEndReportForAgent(
  dateStr: string,
  agentName: string,
  agentId?: string
): Promise<DayEndReportSummary | null> {
  const normName = agentName.trim().toUpperCase();

  // 1. Try Supabase day_end_reports
  try {
    let query = staffDb.from('day_end_reports').select('*').eq('report_date', dateStr);
    if (agentId) {
      query = query.or(`agent_id.eq.${agentId},agent_name.ilike.${agentName}`);
    } else {
      query = query.ilike('agent_name', agentName);
    }

    const { data, error } = await query.maybeSingle();
    if (!error && data) {
      const summary: DayEndReportSummary = {
        id: data.id,
        report_date: data.report_date,
        agent_id: data.agent_id,
        agent_name: data.agent_name,
        total_deliveries: data.total_deliveries || (Array.isArray(data.entries) ? data.entries.length : 0),
        domestic_14kg: data.domestic_14kg || 0,
        composite_10kg: data.composite_10kg || 0,
        commercial_19kg: data.commercial_19kg || 0,
        empties_collected: data.empties_collected || 0,
        cash_count: data.cash_count || 0,
        upi_count: data.upi_count || 0,
        due_count: data.due_count || 0,
        entries: Array.isArray(data.entries) ? data.entries : [],
        raw_csv: data.raw_csv || '',
        supervisor_phone: data.supervisor_phone || '',
        scanned_by_staff: data.scanned_by_staff || '',
        updated_at: data.updated_at || data.created_at,
      };

      // Cache locally
      try {
        localStorage.setItem(getDayEndStorageKey(dateStr, normName), JSON.stringify(summary));
      } catch (_) {}

      return summary;
    }
  } catch (err) {
    console.warn('Direct fetch from day_end_reports error:', err);
  }

  // 2. Check staff_cylinder_settlements notes fallback
  try {
    let sQuery = staffDb.from('staff_cylinder_settlements').select('*').eq('settlement_date', dateStr);
    if (agentId) {
      sQuery = sQuery.eq('agent_id', agentId);
    } else {
      sQuery = sQuery.ilike('agent_name', agentName);
    }

    const { data: sData } = await sQuery.maybeSingle();
    if (sData) {
      const parsed = extractScannedBillsFromNotes(sData.notes);
      if (parsed.length > 0) {
        const summary: DayEndReportSummary = {
          report_date: dateStr,
          agent_id: sData.agent_id,
          agent_name: sData.agent_name,
          total_deliveries: parsed.length,
          domestic_14kg: parsed.filter((e: any) => e.cylinder_type === '14.2KG_STD').length,
          composite_10kg: parsed.filter((e: any) => e.cylinder_type === '10KG_LITE').length,
          commercial_19kg: parsed.filter((e: any) => e.cylinder_type === '19KG_COMM').length,
          empties_collected: parsed.filter((e: any) => e.empty_collected).length,
          cash_count: parsed.filter((e: any) => e.payment_mode === 'CASH').length,
          upi_count: parsed.filter((e: any) => e.payment_mode === 'UPI').length,
          due_count: parsed.filter((e: any) => e.payment_mode === 'DUE').length,
          entries: parsed,
          updated_at: sData.updated_at,
        };

        try {
          localStorage.setItem(getDayEndStorageKey(dateStr, normName), JSON.stringify(summary));
        } catch (_) {}

        return summary;
      }

      // Check if local cache has valid scanned entries before falling back to 0
      try {
        const rawLocal = localStorage.getItem(getDayEndStorageKey(dateStr, normName));
        if (rawLocal) {
          const parsedLocal = JSON.parse(rawLocal);
          if (Array.isArray(parsedLocal.entries) && parsedLocal.entries.length > 0) {
            return parsedLocal;
          }
        }
      } catch (_) {}

      // If settlement record exists in cloud with 0 bills, return explicit 0 deliveries
      return {
        report_date: dateStr,
        agent_id: sData.agent_id,
        agent_name: sData.agent_name,
        total_deliveries: 0,
        domestic_14kg: 0,
        composite_10kg: 0,
        commercial_19kg: 0,
        empties_collected: 0,
        cash_count: 0,
        upi_count: 0,
        due_count: 0,
        entries: [],
        updated_at: sData.updated_at,
      };
    }
  } catch (_) {}

  // 3. Fallback to local cache
  try {
    const raw = localStorage.getItem(getDayEndStorageKey(dateStr, normName));
    if (raw) return JSON.parse(raw);
  } catch (_) {}

  return null;
}

const normalizeBillKey = (consumerNumber?: string): string =>
  String(consumerNumber || '').trim().toUpperCase().replace(/\s+/g, '');

/**
 * Read the stored scanned bills for one (date, agent) pair, from both the
 * day-end report and the godown settlement notes. Used to decide whether a
 * bill scanned on another day is already safely recorded there.
 */
async function fetchStoredEntriesForDate(
  dateStr: string,
  agentName: string,
  agentId?: string
): Promise<DayEndEntry[]> {
  const entries: DayEndEntry[] = [];

  try {
    let query = staffDb
      .from('day_end_reports')
      .select('entries')
      .eq('report_date', dateStr);
    if (agentId) {
      query = query.or(`agent_id.eq.${agentId},agent_name.ilike.${agentName.trim()}`);
    } else {
      query = query.ilike('agent_name', agentName.trim());
    }
    const { data, error } = await query.maybeSingle();
    if (!error && data && Array.isArray(data.entries)) {
      entries.push(...data.entries);
    }
  } catch (_) {}

  try {
    let query = staffDb
      .from('staff_cylinder_settlements')
      .select('notes')
      .eq('settlement_date', dateStr);
    if (agentId) {
      query = query.or(`agent_id.eq.${agentId},agent_name.ilike.${agentName.trim()}`);
    } else {
      query = query.ilike('agent_name', agentName.trim());
    }
    const { data, error } = await query.maybeSingle();
    if (!error && data) {
      entries.push(...extractScannedBillsFromNotes(data.notes));
    }
  } catch (_) {}

  return entries;
}

/**
 * Cross-date duplicate guard.
 *
 * A report for date D must never store a second copy of a bill that is already
 * recorded on the day it was actually scanned. This is what caused the same 33
 * bills to appear in both the 06-11 and 07-11 reports for SURENDER J GUTTA.
 *
 * Rules:
 *  - Entries scanned on D (or without a scanned_at timestamp) always belong to
 *    this report and are kept.
 *  - Entries scanned on another day are kept ONLY when they are not already
 *    recorded on that day. This preserves a genuine late-night scan while
 *    dropping copies created by a date switch.
 *
 * The check is exact by consumer number, so it still works when the same bill
 * was re-scanned and therefore has a different scanned_at value.
 */
export async function filterEntriesCrossDateDuplicates(
  entries: DayEndEntry[],
  reportDate: string,
  agentName: string,
  agentId?: string
): Promise<DayEndEntry[]> {
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const foreignDates = new Set<string>();
  for (const entry of entries) {
    const scanDate = toIstDateString(entry?.scanned_at);
    if (scanDate && scanDate !== reportDate) foreignDates.add(scanDate);
  }
  if (foreignDates.size === 0) return entries;

  const recordedOnOwnDay = new Set<string>();
  await Promise.all(
    [...foreignDates].map(async (date) => {
      const stored = await fetchStoredEntriesForDate(date, agentName, agentId);
      for (const entry of stored) {
        const key = normalizeBillKey(entry?.consumer_number);
        if (key) recordedOnOwnDay.add(key);
      }
    })
  );

  return entries.filter((entry) => {
    const scanDate = toIstDateString(entry?.scanned_at);
    // Belongs to this report (or cannot be attributed) -> always keep.
    if (!scanDate || scanDate === reportDate) return true;
    const key = normalizeBillKey(entry?.consumer_number);
    if (!key) return true;
    // Already recorded on its own day -> this copy is a duplicate.
    return !recordedOnOwnDay.has(key);
  });
}


/**
 * Merge two bill lists WITHOUT ever dropping a bill.
 * Incoming entries win on duplicate consumer numbers (so edits to payment mode,
 * empties, etc. persist), while bills that only exist in the database are kept.
 * This is the core protection against a stale device overwriting newer bills.
 */
export function mergeDayEndEntries(existing: DayEndEntry[], incoming: DayEndEntry[]): DayEndEntry[] {
  const merged = new Map<string, DayEndEntry>();
  for (const entry of existing) {
    const key = normalizeBillKey(entry?.consumer_number);
    if (key) merged.set(key, entry);
  }
  for (const entry of incoming) {
    const key = normalizeBillKey(entry?.consumer_number);
    if (key) merged.set(key, entry);
  }
  return [...merged.values()];
}

/**
 * Stable signature of a bill list (order-independent) used to detect whether
 * a local draft actually contains edits that the cloud copy does not have.
 */
export function dayEndEntrySignature(entries: DayEndEntry[]): string {
  return entries
    .map((e) =>
      [
        normalizeBillKey(e?.consumer_number),
        e?.consumer_name || '',
        e?.cylinder_type || '',
        e?.payment_mode || '',
        e?.empty_collected ? '1' : '0',
      ].join('|')
    )
    .sort()
    .join(';');
}

const summarizeDayEndEntries = (entries: DayEndEntry[]) => ({
  total: entries.length,
  domestic14kg: entries.filter((e) => e.cylinder_type === '14.2KG_STD').length,
  composite10kg: entries.filter((e) => e.cylinder_type === '10KG_LITE').length,
  commercial19kg: entries.filter((e) => e.cylinder_type === '19KG_COMM').length,
  emptiesCollected: entries.filter((e) => e.empty_collected).length,
  cashCount: entries.filter((e) => e.payment_mode === 'CASH').length,
  upiCount: entries.filter((e) => e.payment_mode === 'UPI').length,
  dueCount: entries.filter((e) => e.payment_mode === 'DUE').length,
  rawCsv: entries.map((e) => e.consumer_number).join(','),
});

/**
 * Save day-end scanned bills for a delivery boy directly into the Supabase database.
 * Dual-persists into day_end_reports AND staff_cylinder_settlements so the godown ledger
 * and bill scanner are always in complete sync across all staff devices.
 *
 * mode = 'merge' (default): union with whatever is already in the database. A device
 *   holding a stale list can never delete bills added by another device.
 * mode = 'replace': intentionally overwrite (only used for explicit delete / clear).
 */
export async function saveDayEndReportToDatabase(payload: {
  report_date: string;
  agent_id?: string;
  agent_name: string;
  entries: DayEndEntry[];
  scanned_by_staff?: string;
  supervisor_phone?: string;
  sender_session_id?: string;
  mode?: 'merge' | 'replace';
}): Promise<{ success: boolean; error?: string }> {
  const mode: 'merge' | 'replace' = payload.mode === 'replace' ? 'replace' : 'merge';
  const normName = payload.agent_name.trim().toUpperCase();
  const nowIso = new Date().toISOString();
  let lastError: string | undefined;

  // ---- 1. Read the freshest server-side state BEFORE writing anything ----
  const fetchReportRow = async () => {
    try {
      let query = staffDb
        .from('day_end_reports')
        .select('id, entries, updated_at')
        .eq('report_date', payload.report_date);
      if (payload.agent_id) {
        query = query.or(`agent_id.eq.${payload.agent_id},agent_name.ilike.${payload.agent_name.trim()}`);
      } else {
        query = query.ilike('agent_name', payload.agent_name.trim());
      }
      const { data, error } = await query.maybeSingle();
      if (error) return null;
      return data;
    } catch (_) {
      return null;
    }
  };

  const fetchSettlementRow = async () => {
    let query = staffDb
      .from('staff_cylinder_settlements')
      .select('id, notes, supplied_cylinders, empty_cylinders, updated_at')
      .eq('settlement_date', payload.report_date);
    if (payload.agent_id) {
      query = query.or(`agent_id.eq.${payload.agent_id},agent_name.ilike.${payload.agent_name.trim()}`);
    } else {
      query = query.ilike('agent_name', payload.agent_name.trim());
    }
    const { data, error } = await query.maybeSingle();
    if (error) return null;
    return data;
  };

  let existingReport: any = null;
  let existingSettlement: any = null;
  try { existingReport = await fetchReportRow(); } catch (_) {}
  try { existingSettlement = await fetchSettlementRow(); } catch (_) {}

  const existingReportEntries: DayEndEntry[] = Array.isArray(existingReport?.entries) ? existingReport.entries : [];
  const existingSettlementEntries: DayEndEntry[] = mode === 'merge'
    ? extractScannedBillsFromNotes(existingSettlement?.notes)
    : [];

  // ---- 1b. Cross-date guard (the permanent double-bill fix) ----
  // Drop any bill that was scanned on another day and is already recorded on
  // that day. If the whole payload belongs to another date, refuse the save so
  // a date switch can never move or duplicate a day's bills.
  const payloadEntriesForDate = await filterEntriesCrossDateDuplicates(
    payload.entries,
    payload.report_date,
    payload.agent_name,
    payload.agent_id
  );

  if (payload.entries.length > 0 && payloadEntriesForDate.length === 0) {
    return {
      success: false,
      error:
        'These bills were scanned on a different date and are already saved there. ' +
        'Nothing was changed. Switch to the correct date and try again.',
    };
  }

  const existingEntriesForDate = await filterEntriesCrossDateDuplicates(
    [...existingReportEntries, ...existingSettlementEntries],
    payload.report_date,
    payload.agent_name,
    payload.agent_id
  );

  const finalEntries = mode === 'merge'
    ? mergeDayEndEntries(existingEntriesForDate, payloadEntriesForDate)
    : payloadEntriesForDate;
  const summary = summarizeDayEndEntries(finalEntries);

  const recordSummary: DayEndReportSummary = {
    report_date: payload.report_date,
    agent_id: payload.agent_id,
    agent_name: payload.agent_name,
    total_deliveries: summary.total,
    domestic_14kg: summary.domestic14kg,
    composite_10kg: summary.composite10kg,
    commercial_19kg: summary.commercial19kg,
    empties_collected: summary.emptiesCollected,
    cash_count: summary.cashCount,
    upi_count: summary.upiCount,
    due_count: summary.dueCount,
    entries: finalEntries,
    raw_csv: summary.rawCsv,
    supervisor_phone: payload.supervisor_phone,
    scanned_by_staff: payload.scanned_by_staff,
    updated_at: nowIso,
  };

  // 2. Immediately cache locally (merged snapshot, never a shrinking one)
  try {
    localStorage.setItem(getDayEndStorageKey(payload.report_date, normName), JSON.stringify(recordSummary));
  } catch (_) {}

  let savedReport = false;
  let savedSettlement = false;

  // ---- 3. day_end_reports: CAS-retry so concurrent staff devices never lose bills ----
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const current = attempt === 0 ? existingReport : await fetchReportRow();
      const currentEntriesForDate = current
        ? await filterEntriesCrossDateDuplicates(
            Array.isArray(current.entries) ? current.entries : [],
            payload.report_date,
            payload.agent_name,
            payload.agent_id
          )
        : [];
      const merged = mode === 'merge'
        ? (current ? mergeDayEndEntries(currentEntriesForDate, payloadEntriesForDate) : finalEntries)
        : payloadEntriesForDate;
      const s = summarizeDayEndEntries(merged);
      const row = {
        report_date: payload.report_date,
        agent_id: payload.agent_id || null,
        agent_name: payload.agent_name,
        total_deliveries: s.total,
        domestic_14kg: s.domestic14kg,
        composite_10kg: s.composite10kg,
        commercial_19kg: s.commercial19kg,
        empties_collected: s.emptiesCollected,
        cash_count: s.cashCount,
        upi_count: s.upiCount,
        due_count: s.dueCount,
        entries: merged,
        raw_csv: s.rawCsv,
        supervisor_phone: payload.supervisor_phone || null,
        scanned_by_staff: payload.scanned_by_staff || null,
        updated_at: nowIso,
      };

      if (current?.id) {
        let updateQuery = staffDb.from('day_end_reports').update(row).eq('id', current.id);
        if (mode === 'merge' && current.updated_at) {
          updateQuery = updateQuery.eq('updated_at', current.updated_at);
        }
        const { data: updatedRows, error } = await updateQuery.select('id');
        if (!error && updatedRows && updatedRows.length > 0) {
          savedReport = true;
          break;
        }
        if (error) {
          lastError = error.message;
          break;
        }
        // 0 rows updated => another device wrote in between. Re-read and retry.
      } else {
        const { error } = await staffDb.from('day_end_reports').insert(row);
        if (!error) {
          savedReport = true;
          break;
        }
        lastError = error.message;
        // Unique violation => row created concurrently. Retry as an update.
      }
    } catch (err: any) {
      lastError = err?.message;
    }
  }

  // ---- 4. Dual-persist to staff_cylinder_settlements notes & counters ----
  if (payload.agent_id || payload.agent_name) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const current = attempt === 0 ? existingSettlement : await fetchSettlementRow();
        const currentBillsRaw = mode === 'merge' ? extractScannedBillsFromNotes(current?.notes) : [];
        const currentBills = mode === 'merge'
          ? await filterEntriesCrossDateDuplicates(
              currentBillsRaw,
              payload.report_date,
              payload.agent_name,
              payload.agent_id
            )
          : [];
        const merged = mode === 'merge'
          ? (current ? mergeDayEndEntries(currentBills, payloadEntriesForDate) : finalEntries)
          : payloadEntriesForDate;
        const s = summarizeDayEndEntries(merged);

        // Preserve any BPCL Report from existing notes OR local cache so it is NEVER lost!
        let bpclPart = '';
        if (current && (current.notes || '').includes(BPCL_REPORT_TAG)) {
          let afterBpcl = (current.notes || '').split(BPCL_REPORT_TAG)[1];
          if (afterBpcl.includes(SCANNED_BILLS_TAG)) {
            afterBpcl = afterBpcl.split(SCANNED_BILLS_TAG)[0];
          }
          bpclPart = `\n${BPCL_REPORT_TAG}` + afterBpcl.trim();
        } else {
          try {
            const norm = payload.agent_name.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
            const rawLocal = localStorage.getItem(`bgcls_bpcl_report_${payload.report_date}_${norm}`);
            if (rawLocal) {
              bpclPart = `\n${BPCL_REPORT_TAG}` + rawLocal.trim();
            }
          } catch (_) {}
        }

        const baseNote = (current?.notes || '')
          .split(SCANNED_BILLS_TAG)[0]
          .split(BPCL_REPORT_TAG)[0]
          .trim();
        const combinedNote = `${baseNote ? baseNote + '\n' : ''}${SCANNED_BILLS_TAG}${JSON.stringify(merged)}${bpclPart}`;

        if (current?.id) {
          let updateQuery = staffDb
            .from('staff_cylinder_settlements')
            .update({
              notes: combinedNote,
              supplied_cylinders: s.total,
              empty_cylinders: s.emptiesCollected,
              cash_cylinders: s.cashCount,
              upi_cylinders: s.upiCount,
              due_cylinders: s.dueCount,
              updated_at: nowIso,
            })
            .eq('id', current.id);
          if (mode === 'merge' && current.updated_at) {
            updateQuery = updateQuery.eq('updated_at', current.updated_at);
          }
          const { data: updatedRows, error } = await updateQuery.select('id');
          if (!error && updatedRows && updatedRows.length > 0) {
            savedSettlement = true;
            break;
          }
          if (error) {
            lastError = error.message;
            break;
          }
          // 0 rows updated => concurrent write. Re-read and retry.
        } else {
          const { error } = await staffDb
            .from('staff_cylinder_settlements')
            .insert({
              settlement_date: payload.report_date,
              agent_id: payload.agent_id || null,
              agent_name: payload.agent_name,
              cylinder_price: 994,
              supplied_cylinders: s.total,
              cash_cylinders: s.cashCount,
              upi_cylinders: s.upiCount,
              due_cylinders: s.dueCount,
              empty_cylinders: s.emptiesCollected,
              expected_cash: s.cashCount * 994,
              actual_cash: s.cashCount * 994,
              cash_difference: 0,
              online_amount: 0,
              upi_amount: s.upiCount * 994,
              total_amount: (s.cashCount + s.upiCount) * 994,
              status: 'BALANCED',
              notes: combinedNote,
              updated_at: nowIso,
            });
          if (!error) {
            savedSettlement = true;
            break;
          }
          lastError = error.message;
          // Unique violation => settlement created concurrently. Retry as an update.
        }
      } catch (settleErr: any) {
        lastError = settleErr?.message;
      }
    }
  }

  // 5. Update any associated dispatch_items
  const dispatchItemIds = payloadEntriesForDate
    .map((e) => e.dispatch_item_id)
    .filter((id): id is string => Boolean(id));

  if (dispatchItemIds.length > 0) {
    try {
      await staffDb
        .from('dispatch_items')
        .update({ status: 'COMPLETED', completed_at: nowIso })
        .in('id', dispatchItemIds);
    } catch (_) {}
  }

  // 6. Broadcast live WebSocket event to all other open staff screens.
  // Do not block the save on the socket round-trip.
  void broadcastCashMemosUpdated({
    report_date: payload.report_date,
    agent_name: payload.agent_name,
    agent_id: payload.agent_id,
    total_deliveries: summary.total,
    sender_session_id: payload.sender_session_id,
    updated_at: nowIso,
  });

  // Local window dispatch
  window.dispatchEvent(
    new CustomEvent('bgcls-day-end-updated', {
      detail: { report_date: payload.report_date, agent_name: payload.agent_name },
    })
  );

  return {
    success: savedReport || savedSettlement,
    error: savedReport || savedSettlement ? undefined : lastError,
  };
}

export interface PastClaimantInfo {
  agentName: string;
  agentId?: string;
  date: string;
  consumerName?: string;
  paymentMode?: string;
  cylinderType?: string;
  isPast7Days?: boolean;
  isSameAgent?: boolean;
}

/**
 * Retrieve local cached past 7 days bills map
 */
export function getLocalPast7DaysBills(reportDateStr: string): Record<string, PastClaimantInfo> {
  try {
    const raw = localStorage.getItem(`bgcls_past_7days_bills_${reportDateStr}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Fetch all bills submitted across the preceding 7 days (from reportDate - 7 days to reportDate - 1 day).
 * Detects if a bill was ALREADY given in the past 7 days by the same delivery boy or another boy.
 */
export async function fetchPast7DaysBills(
  reportDateStr: string,
  daysBack: number = 7
): Promise<Record<string, PastClaimantInfo>> {
  const result: Record<string, PastClaimantInfo> = {};

  try {
    const [yStr, mStr, dStr] = reportDateStr.split('-').map(Number);
    const targetDate = new Date(yStr, (mStr || 1) - 1, dStr || 1, 12, 0, 0);

    const startDate = new Date(targetDate);
    startDate.setDate(targetDate.getDate() - daysBack);
    const yS = startDate.getFullYear();
    const mS = String(startDate.getMonth() + 1).padStart(2, '0');
    const dS = String(startDate.getDate()).padStart(2, '0');
    const startDateStr = `${yS}-${mS}-${dS}`;

    const prevDate = new Date(targetDate);
    prevDate.setDate(targetDate.getDate() - 1);
    const yP = prevDate.getFullYear();
    const mP = String(prevDate.getMonth() + 1).padStart(2, '0');
    const dP = String(prevDate.getDate()).padStart(2, '0');
    const prevDateStr = `${yP}-${mP}-${dP}`;

    // Query settlements in the 7-day range preceding reportDate
    const { data, error } = await staffDb
      .from('staff_cylinder_settlements')
      .select('agent_name, agent_id, settlement_date, notes')
      .gte('settlement_date', startDateStr)
      .lte('settlement_date', prevDateStr)
      .order('settlement_date', { ascending: false });

    if (!error && Array.isArray(data)) {
      data.forEach((row) => {
        const parsed = extractScannedBillsFromNotes(row.notes);
        if (Array.isArray(parsed)) {
          parsed.forEach((bill) => {
            if (bill && bill.consumer_number) {
              const clean = bill.consumer_number.trim().toLowerCase();
              // Retain the latest past submission date
              if (!result[clean]) {
                result[clean] = {
                  agentName: row.agent_name || 'Delivery Boy',
                  agentId: row.agent_id,
                  date: row.settlement_date,
                  consumerName: bill.consumer_name,
                  paymentMode: bill.payment_mode,
                  cylinderType: bill.cylinder_type,
                  isPast7Days: true,
                };
              }
            }
          });
        }
      });

      // Cache locally for fast instant access on next load
      try {
        localStorage.setItem(`bgcls_past_7days_bills_${reportDateStr}`, JSON.stringify(result));
      } catch (_) {}
    }
  } catch (err) {
    console.warn('Failed to fetch past 7 days bills from cloud, falling back to local cache:', err);
    return getLocalPast7DaysBills(reportDateStr);
  }

  return result;
}

/**
 * Format duplicate claim details for user-facing alerts and badges (e.g. "04-11-2026 (Yesterday)").
 */
export function formatDuplicateClaimNotice(
  claimant: {
    agentName: string;
    date: string;
    isSameAgent?: boolean;
  },
  referenceDateStr?: string
): {
  formattedDate: string;
  relativeText: string;
  shortNotice: string;
  fullWarning: string;
} {
  const [y, m, d] = (claimant.date || '').split('-');
  const formattedDate = d && m && y ? `${d}-${m}-${y}` : claimant.date;

  let relativeText = '';
  if (claimant.date) {
    let refDate: Date;
    if (referenceDateStr) {
      const [ry, rm, rd] = referenceDateStr.split('-').map(Number);
      refDate = new Date(ry, (rm || 1) - 1, rd || 1, 12, 0, 0);
    } else {
      refDate = new Date();
      refDate.setHours(12, 0, 0, 0);
    }

    const [cy, cm, cd] = claimant.date.split('-').map(Number);
    const cDate = new Date(cy, (cm || 1) - 1, cd || 1, 12, 0, 0);

    const diffDays = Math.round((refDate.getTime() - cDate.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) relativeText = 'Today';
    else if (diffDays === 1) relativeText = 'Yesterday';
    else if (diffDays > 1) relativeText = `${diffDays} days ago`;
    else if (diffDays < 0) relativeText = `${Math.abs(diffDays)} days ahead`;
  }

  const agentUpper = claimant.agentName.trim().toUpperCase();
  const relSuffix = relativeText ? ` (${relativeText})` : '';

  const shortNotice = claimant.isSameAgent
    ? `Already given by ${agentUpper} on ${formattedDate}${relSuffix}`
    : `Already given by ${agentUpper} on ${formattedDate}${relSuffix}`;

  const fullWarning = claimant.isSameAgent
    ? `This bill was already submitted by ${agentUpper} on ${formattedDate}${relSuffix}! A delivery boy cannot submit the same bill twice within 7 days.`
    : `This bill was already submitted by ${agentUpper} on ${formattedDate}${relSuffix}! Another delivery boy cannot submit the same bill.`;

  return {
    formattedDate,
    relativeText,
    shortNotice,
    fullWarning,
  };
}
