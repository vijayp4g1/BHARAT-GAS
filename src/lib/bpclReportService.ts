import { supabase } from './supabase';
import { createClient } from '@supabase/supabase-js';

const serviceRoleKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://skkebmqxhrtarpfwffgx.supabase.co';
const adminClient = serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : supabase;

export interface BpclBillItem {
  consumer_number: string;
  consumer_name: string;
  order_no?: string;
  book_date?: string;
  cash_memo?: string;
  refill_type?: string;
  status: string;
  type: 'PENDING' | 'ONLINE';
}

export interface BpclReportData {
  agent_name: string;
  agent_id?: string;
  report_date: string;
  checked_done: boolean;
  checked_at?: string;
  checked_by?: string;
  pending_bills: BpclBillItem[];
  online_bills: BpclBillItem[];
  raw_text?: string;
  updated_at?: string;
}

const BPCL_STORAGE_PREFIX = 'bgcls_bpcl_report_';
const BPCL_TAG = '__BGCLS_BPCL_REPORT__';
const SCANNED_TAG = '__BGCLS_SCANNED_BILLS__';

const getStorageKey = (dateStr: string, agentName: string): string => {
  const norm = (agentName || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
  return `${BPCL_STORAGE_PREFIX}${dateStr}_${norm}`;
};

/**
 * Extract BPCL Report JSON from settlement notes column
 */
export function extractBpclReportFromNotes(notes: string | null | undefined): BpclReportData | null {
  if (!notes || !notes.includes(BPCL_TAG)) return null;
  try {
    const raw = notes.split(BPCL_TAG)[1];
    if (!raw) return null;
    const jsonStr = raw.trim();
    return JSON.parse(jsonStr);
  } catch (e) {
    console.warn('Failed to parse BPCL report from notes:', e);
    return null;
  }
}

/**
 * Merge BPCL Report into settlement notes column without clobbering scanned bills
 */
export function mergeBpclIntoNotes(currentNotes: string | null | undefined, bpclData: BpclReportData): string {
  const note = currentNotes || '';
  let scannedPart = '';
  if (note.includes(SCANNED_TAG)) {
    const afterScanned = note.split(SCANNED_TAG)[1];
    scannedPart = afterScanned.split(BPCL_TAG)[0].trim();
  }
  let baseText = note.split(SCANNED_TAG)[0].split(BPCL_TAG)[0].trim();

  let result = baseText ? `${baseText}\n` : '';
  if (scannedPart) {
    result += `${SCANNED_TAG}${scannedPart}\n`;
  }
  result += `${BPCL_TAG}${JSON.stringify(bpclData)}`;
  return result.trim();
}

/**
 * Robust parser for BPCL Status Report text from WhatsApp / AI agents
 */
export function parseBpclReportText(rawText: string): {
  pendingBills: BpclBillItem[];
  onlineBills: BpclBillItem[];
} {
  const pendingBills: BpclBillItem[] = [];
  const onlineBills: BpclBillItem[] = [];

  if (!rawText || !rawText.trim()) {
    return { pendingBills, onlineBills };
  }

  let currentSection: 'PENDING' | 'ONLINE' = 'PENDING';
  // Split on section headers
  const blocks = rawText.split(/(?=\*?BPCL Status Report:|\*?Status Report:|\*?Delivery Pending\*?|\*?Online Bills\*?)/i);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    if (/Delivery Pending/i.test(trimmed)) {
      currentSection = 'PENDING';
    } else if (/Online Bills/i.test(trimmed) || /PayNBook/i.test(trimmed)) {
      currentSection = 'ONLINE';
    }

    // Split block into individual consumer bills
    const billChunks = trimmed.split(/(?=\*?Consumer No:\*?|\*?Cons No:\*?|\*?Consumer Number:\*?)/i);
    for (const chunk of billChunks) {
      if (!/Consumer No|Cons No|Consumer Number/i.test(chunk)) continue;

      const consMatch = chunk.match(/\*?(?:Consumer No|Cons No|Consumer Number):\*?\s*([0-9a-zA-Z]+)/i);
      const nameMatch = chunk.match(/\*?(?:Customer Name|Name|Cons Name):\*?\s*([^\n\r]+)/i);
      const orderMatch = chunk.match(/\*?(?:Order No|Order Number):\*?\s*([0-9a-zA-Z]+)/i);
      const bookDateMatch = chunk.match(/\*?(?:Book Date|Booking Date|Date):\*?\s*([0-9\/\-]+)/i);
      const cashMemoMatch = chunk.match(/\*?(?:Cash Memo|Memo No|Memo Number|Invoice):\*?\s*([0-9a-zA-Z]+)/i);
      const refillTypeMatch = chunk.match(/\*?(?:Refill Type|Type):\*?\s*([^\n\r]+)/i);
      const statusMatch = chunk.match(/\*?(?:Status):\*?\s*([^\n\r]+)/i);

      if (consMatch) {
        const item: BpclBillItem = {
          consumer_number: consMatch[1].trim(),
          consumer_name: nameMatch ? nameMatch[1].replace(/\*/g, '').trim() : '',
          order_no: orderMatch ? orderMatch[1].trim() : '',
          book_date: bookDateMatch ? bookDateMatch[1].trim() : '',
          cash_memo: cashMemoMatch ? cashMemoMatch[1].trim() : '',
          refill_type: refillTypeMatch ? refillTypeMatch[1].replace(/\*/g, '').trim() : '',
          status: statusMatch 
            ? statusMatch[1].replace(/\*/g, '').trim() 
            : (currentSection === 'PENDING' ? 'Delivery Pending' : 'Online Bill (Delivery Done)'),
          type: currentSection,
        };

        // Prevent duplicates in same list
        if (currentSection === 'PENDING') {
          if (!pendingBills.some((b) => b.consumer_number.toLowerCase() === item.consumer_number.toLowerCase())) {
            pendingBills.push(item);
          }
        } else {
          if (!onlineBills.some((b) => b.consumer_number.toLowerCase() === item.consumer_number.toLowerCase())) {
            onlineBills.push(item);
          }
        }
      }
    }
  }

  return { pendingBills, onlineBills };
}

/**
 * Retrieve local cached BPCL report for a delivery boy
 */
export function getLocalBpclReport(dateStr: string, agentName: string): BpclReportData | null {
  try {
    const raw = localStorage.getItem(getStorageKey(dateStr, agentName));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Save BPCL report to local cache
 */
export function setLocalBpclReport(dateStr: string, agentName: string, data: BpclReportData): void {
  try {
    localStorage.setItem(getStorageKey(dateStr, agentName), JSON.stringify(data));
  } catch (err) {
    console.warn('Failed to save BPCL report to localStorage:', err);
  }
}

/**
 * Fetch BPCL report for a single delivery boy on a specific date (Cloud + Local)
 */
export async function fetchBpclReport(
  dateStr: string,
  agentName: string,
  agentId?: string
): Promise<BpclReportData | null> {
  const normName = agentName.trim().toUpperCase();

  // 1. Try cloud from staff_cylinder_settlements
  try {
    let query = adminClient
      .from('staff_cylinder_settlements')
      .select('notes, updated_at')
      .eq('settlement_date', dateStr);

    if (agentId) {
      query = query.or(`agent_id.eq.${agentId},agent_name.ilike.${agentName}`);
    } else {
      query = query.ilike('agent_name', agentName);
    }

    const { data } = await query.maybeSingle();
    if (data && data.notes) {
      const parsed = extractBpclReportFromNotes(data.notes);
      if (parsed) {
        setLocalBpclReport(dateStr, normName, parsed);
        return parsed;
      }
    }
  } catch (err) {
    console.warn('Failed to fetch BPCL report from cloud:', err);
  }

  // 2. Fallback to localStorage
  return getLocalBpclReport(dateStr, normName);
}

/**
 * Fetch all BPCL reports for all delivery boys for a specific date (for Roster badges)
 */
export async function fetchAllBpclReportsForDate(
  dateStr: string
): Promise<Record<string, BpclReportData>> {
  const result: Record<string, BpclReportData> = {};

  // 1. Fetch from cloud
  try {
    const { data, error } = await adminClient
      .from('staff_cylinder_settlements')
      .select('agent_name, agent_id, notes, updated_at')
      .eq('settlement_date', dateStr);

    if (!error && Array.isArray(data)) {
      data.forEach((row) => {
        const normName = (row.agent_name || '').trim().toUpperCase();
        if (row.notes) {
          const parsed = extractBpclReportFromNotes(row.notes);
          if (parsed) {
            result[normName] = parsed;
            setLocalBpclReport(dateStr, normName, parsed);
          }
        }
      });
    }
  } catch (err) {
    console.warn('Failed to fetch all BPCL reports for date:', err);
  }

  // 2. Merge local storage keys
  try {
    const prefix = `${BPCL_STORAGE_PREFIX}${dateStr}_`;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          const norm = (parsed.agent_name || '').trim().toUpperCase();
          if (norm && !result[norm]) {
            result[norm] = parsed;
          }
        }
      }
    }
  } catch (_) {}

  return result;
}

/**
 * Save BPCL Report to Cloud & Local Storage
 */
export async function saveBpclReportToCloud(payload: {
  dateStr: string;
  agentName: string;
  agentId?: string;
  checked_done: boolean;
  pending_bills: BpclBillItem[];
  online_bills: BpclBillItem[];
  raw_text?: string;
  checked_by?: string;
}): Promise<boolean> {
  const normName = payload.agentName.trim().toUpperCase();
  const nowIso = new Date().toISOString();

  const reportData: BpclReportData = {
    agent_name: normName,
    agent_id: payload.agentId,
    report_date: payload.dateStr,
    checked_done: payload.checked_done,
    checked_at: payload.checked_done ? nowIso : undefined,
    checked_by: payload.checked_by || localStorage.getItem('bgcls_agent_name') || 'Staff',
    pending_bills: payload.pending_bills,
    online_bills: payload.online_bills,
    raw_text: payload.raw_text,
    updated_at: nowIso,
  };

  // 1. Immediately cache locally
  setLocalBpclReport(payload.dateStr, normName, reportData);

  // 2. Persist to Supabase staff_cylinder_settlements
  try {
    let query = adminClient
      .from('staff_cylinder_settlements')
      .select('id, notes, supplied_cylinders, empty_cylinders')
      .eq('settlement_date', payload.dateStr);

    if (payload.agentId) {
      query = query.or(`agent_id.eq.${payload.agentId},agent_name.ilike.${normName}`);
    } else {
      query = query.ilike('agent_name', normName);
    }

    const { data: existing } = await query.maybeSingle();

    if (existing) {
      const updatedNotes = mergeBpclIntoNotes(existing.notes, reportData);
      await adminClient
        .from('staff_cylinder_settlements')
        .update({
          notes: updatedNotes,
          updated_at: nowIso,
        })
        .eq('id', existing.id);
    } else {
      // Create new settlement record with this BPCL report
      const newNotes = mergeBpclIntoNotes('', reportData);
      await adminClient.from('staff_cylinder_settlements').insert({
        settlement_date: payload.dateStr,
        agent_id: payload.agentId || null,
        agent_name: normName,
        cylinder_price: 994,
        supplied_cylinders: 0,
        cash_cylinders: 0,
        online_cylinders: payload.online_bills.length,
        upi_cylinders: 0,
        due_cylinders: 0,
        returned_full_cylinders: 0,
        empty_cylinders: 0,
        expected_cash: 0,
        actual_cash: 0,
        cash_difference: 0,
        online_amount: 0,
        upi_amount: 0,
        total_amount: 0,
        status: 'PENDING',
        notes: newNotes,
        updated_at: nowIso,
      });
    }

    // Broadcast realtime update
    try {
      const channel = supabase.channel('bgcls_bpcl_channel');
      await channel.send({
        type: 'broadcast',
        event: 'bpcl_report_updated',
        payload: {
          dateStr: payload.dateStr,
          agentName: normName,
          reportData,
        },
      });
    } catch (_) {}

    return true;
  } catch (err) {
    console.warn('Failed to save BPCL report to cloud:', err);
    return false;
  }
}

/**
 * Fast 1-click toggle for "Bills Checked Done"
 */
export async function toggleBillsCheckedDone(
  dateStr: string,
  agentName: string,
  agentId?: string,
  explicitStatus?: boolean
): Promise<boolean> {
  const normName = agentName.trim().toUpperCase();
  const current = (await fetchBpclReport(dateStr, normName, agentId)) || {
    agent_name: normName,
    agent_id: agentId,
    report_date: dateStr,
    checked_done: false,
    pending_bills: [],
    online_bills: [],
  };

  const nextStatus = explicitStatus !== undefined ? explicitStatus : !current.checked_done;

  return saveBpclReportToCloud({
    dateStr,
    agentName: normName,
    agentId,
    checked_done: nextStatus,
    pending_bills: current.pending_bills,
    online_bills: current.online_bills,
    raw_text: current.raw_text,
    checked_by: localStorage.getItem('bgcls_agent_name') || 'Staff',
  });
}

