import { supabase } from './supabase';
import { fetchCylinderBookDeliveryBoys, type DeliveryBoy } from './agentService';
import cylinderBookPreset from '../data/cylinderBookDeliveryBoys.json';

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
    const { data, error } = await supabase
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
    const { data: settlements, error: setErr } = await supabase
      .from('staff_cylinder_settlements')
      .select('agent_name, agent_id, cash_cylinders, upi_cylinders, due_cylinders, notes, updated_at')
      .eq('settlement_date', dateStr);

    if (!setErr && settlements && settlements.length > 0) {
      settlements.forEach((s) => {
        const normName = (s.agent_name || '').trim().toUpperCase();
        if (s.notes && s.notes.includes('__BGCLS_SCANNED_BILLS__')) {
          try {
            const rawJson = s.notes.split('__BGCLS_SCANNED_BILLS__')[1];
            const parsed = JSON.parse(rawJson);
            if (Array.isArray(parsed)) {
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
            }
          } catch (_) {}
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
    let query = supabase.from('day_end_reports').select('*').eq('report_date', dateStr);
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
    let sQuery = supabase.from('staff_cylinder_settlements').select('*').eq('settlement_date', dateStr);
    if (agentId) {
      sQuery = sQuery.eq('agent_id', agentId);
    } else {
      sQuery = sQuery.ilike('agent_name', agentName);
    }

    const { data: sData } = await sQuery.maybeSingle();
    if (sData && sData.notes && sData.notes.includes('__BGCLS_SCANNED_BILLS__')) {
      const rawJson = sData.notes.split('__BGCLS_SCANNED_BILLS__')[1];
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed)) {
        return {
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
      }
    }
  } catch (_) {}

  // 3. Fallback to local cache
  try {
    const raw = localStorage.getItem(getDayEndStorageKey(dateStr, normName));
    if (raw) return JSON.parse(raw);
  } catch (_) {}

  return null;
}

/**
 * Save day-end scanned bills for a delivery boy directly into the Supabase database.
 * Dual-persists into day_end_reports AND staff_cylinder_settlements so the godown ledger
 * and bill scanner are always in complete sync across all staff devices.
 */
export async function saveDayEndReportToDatabase(payload: {
  report_date: string;
  agent_id?: string;
  agent_name: string;
  entries: DayEndEntry[];
  scanned_by_staff?: string;
  supervisor_phone?: string;
}): Promise<{ success: boolean; error?: string }> {
  const normName = payload.agent_name.trim().toUpperCase();
  const rawCsv = payload.entries.map((e) => e.consumer_number).join(',');
  const count14kg = payload.entries.filter((e) => e.cylinder_type === '14.2KG_STD').length;
  const count10kg = payload.entries.filter((e) => e.cylinder_type === '10KG_LITE').length;
  const count19kg = payload.entries.filter((e) => e.cylinder_type === '19KG_COMM').length;
  const emptiesCollected = payload.entries.filter((e) => e.empty_collected).length;
  const cashCount = payload.entries.filter((e) => e.payment_mode === 'CASH').length;
  const upiCount = payload.entries.filter((e) => e.payment_mode === 'UPI').length;
  const dueCount = payload.entries.filter((e) => e.payment_mode === 'DUE').length;
  const nowIso = new Date().toISOString();

  const recordSummary: DayEndReportSummary = {
    report_date: payload.report_date,
    agent_id: payload.agent_id,
    agent_name: payload.agent_name,
    total_deliveries: payload.entries.length,
    domestic_14kg: count14kg,
    composite_10kg: count10kg,
    commercial_19kg: count19kg,
    empties_collected: emptiesCollected,
    cash_count: cashCount,
    upi_count: upiCount,
    due_count: dueCount,
    entries: payload.entries,
    raw_csv: rawCsv,
    supervisor_phone: payload.supervisor_phone,
    scanned_by_staff: payload.scanned_by_staff,
    updated_at: nowIso,
  };

  // 1. Immediately cache locally
  try {
    localStorage.setItem(getDayEndStorageKey(payload.report_date, normName), JSON.stringify(recordSummary));
  } catch (_) {}

  let savedCloud = false;

  // 2. Try upserting to day_end_reports
  try {
    const { error: upsertErr } = await supabase.from('day_end_reports').upsert(
      {
        report_date: payload.report_date,
        agent_id: payload.agent_id || null,
        agent_name: payload.agent_name,
        total_deliveries: payload.entries.length,
        domestic_14kg: count14kg,
        composite_10kg: count10kg,
        commercial_19kg: count19kg,
        empties_collected: emptiesCollected,
        cash_count: cashCount,
        upi_count: upiCount,
        due_count: dueCount,
        entries: payload.entries,
        raw_csv: rawCsv,
        supervisor_phone: payload.supervisor_phone || null,
        scanned_by_staff: payload.scanned_by_staff || null,
        updated_at: nowIso,
      },
      { onConflict: 'report_date, agent_name' }
    );

    if (!upsertErr) {
      savedCloud = true;
    } else {
      console.warn('Upsert to day_end_reports encountered notice, falling back:', upsertErr.message);
    }
  } catch (err) {
    console.warn('day_end_reports write error:', err);
  }

  // 3. Dual-persist to staff_cylinder_settlements notes & counters
  if (payload.agent_id) {
    try {
      const serialJson = `__BGCLS_SCANNED_BILLS__${JSON.stringify(payload.entries)}`;
      const { data: existingSet } = await supabase
        .from('staff_cylinder_settlements')
        .select('id, notes, supplied_cylinders, empty_cylinders')
        .eq('settlement_date', payload.report_date)
        .eq('agent_id', payload.agent_id)
        .maybeSingle();

      if (existingSet) {
        // Clean existing note text
        let baseNote = (existingSet.notes || '').split('__BGCLS_SCANNED_BILLS__')[0].trim();
        const combinedNote = baseNote ? `${baseNote}\n${serialJson}` : serialJson;

        await supabase
          .from('staff_cylinder_settlements')
          .update({
            notes: combinedNote,
            supplied_cylinders: payload.entries.length,
            empty_cylinders: emptiesCollected,
            cash_cylinders: cashCount,
            upi_cylinders: upiCount,
            due_cylinders: dueCount,
            updated_at: nowIso,
          })
          .eq('id', existingSet.id);
        savedCloud = true;
      } else {
        // Create settlement row if not existing yet
        await supabase
          .from('staff_cylinder_settlements')
          .upsert(
            {
              settlement_date: payload.report_date,
              agent_id: payload.agent_id,
              agent_name: payload.agent_name,
              cylinder_price: 994,
              supplied_cylinders: payload.entries.length,
              cash_cylinders: cashCount,
              upi_cylinders: upiCount,
              due_cylinders: dueCount,
              empty_cylinders: emptiesCollected,
              expected_cash: cashCount * 994,
              actual_cash: cashCount * 994,
              cash_difference: 0,
              online_amount: 0,
              upi_amount: upiCount * 994,
              total_amount: (cashCount + upiCount) * 994,
              status: 'BALANCED',
              notes: serialJson,
              updated_at: nowIso,
            },
            { onConflict: 'settlement_date, agent_id' }
          );
        savedCloud = true;
      }
    } catch (settleErr) {
      console.warn('Secondary settlement sync notice:', settleErr);
    }
  }

  // 4. Update any associated dispatch_items
  const dispatchItemIds = payload.entries
    .map((e) => e.dispatch_item_id)
    .filter((id): id is string => Boolean(id));

  if (dispatchItemIds.length > 0) {
    try {
      await supabase
        .from('dispatch_items')
        .update({ status: 'COMPLETED', completed_at: nowIso })
        .in('id', dispatchItemIds);
    } catch (_) {}
  }

  // 5. Broadcast live WebSocket event to all other open staff screens
  try {
    const channel = supabase.channel('bgcls_cash_memo_live_sync');
    channel.send({
      type: 'broadcast',
      event: 'cash_memos_updated',
      payload: {
        report_date: payload.report_date,
        agent_name: payload.agent_name,
        agent_id: payload.agent_id,
        total_deliveries: payload.entries.length,
        updated_at: nowIso,
      },
    });
  } catch (_) {}

  // Local window dispatch
  window.dispatchEvent(
    new CustomEvent('bgcls-day-end-updated', {
      detail: { report_date: payload.report_date, agent_name: payload.agent_name },
    })
  );

  return { success: true };
}
