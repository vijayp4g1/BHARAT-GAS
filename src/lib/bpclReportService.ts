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
  archived?: boolean;
  no_supply?: boolean;
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
    let raw = notes.split(BPCL_TAG)[1];
    if (!raw) return null;
    if (raw.includes(SCANNED_TAG)) {
      raw = raw.split(SCANNED_TAG)[0];
    }
    const jsonStr = raw.trim();
    const parsed: BpclReportData = JSON.parse(jsonStr);
    if (parsed && parsed.raw_text) {
      parsed.raw_text = sanitizeRawTextWithActiveBills(
        parsed.raw_text,
        parsed.pending_bills,
        parsed.online_bills
      );
    }
    return parsed;
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
  const blocks = rawText.split(/(?=\*?BPCL Status Report:|\*?Status Report:|\*?Delivery Pending\*?|\*?Online Bills\*?|\*?PayNBook\*?|\*?Online Paid\*?)/i);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    if (/Delivery Pending/i.test(trimmed)) {
      currentSection = 'PENDING';
    } else if (/Online Bills/i.test(trimmed) || /PayNBook/i.test(trimmed) || /Online Paid/i.test(trimmed)) {
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

        const isOnlinePaidStatus = /Online Paid|PayNBook/i.test(item.status || '') || /PayNBook|Online/i.test(item.refill_type || '');

        // Prevent duplicates in same list
        if (currentSection === 'PENDING') {
          if (!pendingBills.some((b) => b.consumer_number.toLowerCase() === item.consumer_number.toLowerCase())) {
            pendingBills.push(item);
          }
          // If the pending bill is already paid online (PayNBook), it belongs in onlineBills as well!
          if (isOnlinePaidStatus && !onlineBills.some((b) => b.consumer_number.toLowerCase() === item.consumer_number.toLowerCase())) {
            onlineBills.push({
              ...item,
              type: 'ONLINE',
            });
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
 * Removes a specific bill's text block from the raw BPCL report text.
 * Keeps the remaining text, section headers, and formatting completely clean.
 */
export function removeBillFromRawText(
  rawText: string | undefined | null,
  consumerNumber: string,
  billType?: 'PENDING' | 'ONLINE'
): string {
  if (!rawText || !rawText.trim()) return '';
  const num = consumerNumber.trim();
  const escapedNum = num.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const billPattern =
    '(?:\\r?\\n)*[\\t ]*\\*?(?:Consumer No|Cons No|Consumer Number):\\*?[\\t ]*' +
    escapedNum +
    '(?:\\b|\\*)(?:[\\s\\S]*?)(?=(?:\\r?\\n+[\\t ]*\\*?(?:Consumer No|Cons No|Consumer Number):|\\r?\\n+[\\t ]*\\*?(?:BPCL Status Report|Status Report|Delivery Pending|Online Bills|PayNBook)|$))';

  if (!billType) {
    return rawText
      .replace(new RegExp(billPattern, 'i'), '')
      .replace(/(\r?\n){3,}/g, '\n\n')
      .trim();
  }

  // Section-aware removal
  const sectionSplitter = /(?=(?:^|\r?\n)\s*\*?(?:BPCL Status Report|Status Report)[^\r\n]*)/i;
  const sections = rawText.split(sectionSplitter);

  const updatedSections = sections.map((sec) => {
    const firstLine = sec.trim().split(/\r?\n/)[0] || '';
    let secType: 'PENDING' | 'ONLINE' = 'PENDING';
    if (/Delivery Pending/i.test(firstLine)) {
      secType = 'PENDING';
    } else if (/Online Bills|PayNBook|Online Paid/i.test(firstLine)) {
      secType = 'ONLINE';
    }

    if (secType !== billType) {
      return sec;
    }

    return sec.replace(new RegExp(billPattern, 'i'), '');
  });

  return updatedSections
    .join('')
    .replace(/(\r?\n){3,}/g, '\n\n')
    .trim();
}

/**
 * Formats a single BpclBillItem as standard BPCL text chunk.
 */
export function formatBpclBillBlock(bill: BpclBillItem): string {
  const lines: string[] = [
    `*Consumer No:* ${bill.consumer_number}`,
    `*Customer Name:* ${bill.consumer_name || 'Consumer'}`,
  ];
  if (bill.order_no) lines.push(`Order No: ${bill.order_no}`);
  if (bill.refill_type) lines.push(`Refill Type: ${bill.refill_type}`);
  if (bill.book_date) lines.push(`Book Date: ${bill.book_date}`);
  if (bill.cash_memo) lines.push(`Cash Memo: ${bill.cash_memo}`);
  if (bill.status) lines.push(`Status: ${bill.status}`);
  return lines.join('\n');
}

/**
 * Appends a bill block to the raw BPCL text under the appropriate section.
 */
export function appendBillToRawText(
  rawText: string | undefined | null,
  bill: BpclBillItem
): string {
  const current = (rawText || '').trim();
  const billBlock = formatBpclBillBlock(bill);

  if (!current) {
    const header =
      bill.type === 'PENDING'
        ? '*BPCL Status Report: Delivery Pending*'
        : '*BPCL Status Report: Online Bills (PayNBook)*';
    return `${header}\n\n${billBlock}`;
  }

  const targetRegex =
    bill.type === 'PENDING' ? /Delivery Pending/i : /Online Bills|PayNBook|Online Paid/i;

  if (targetRegex.test(current)) {
    const sectionSplitter = /(?=(?:^|\r?\n)\s*\*?(?:BPCL Status Report|Status Report)[^\r\n]*)/i;
    const sections = current.split(sectionSplitter);
    let inserted = false;
    const updatedSections = sections.map((sec) => {
      if (inserted) return sec;
      let secType: 'PENDING' | 'ONLINE' = 'PENDING';
      if (/Online Bills/i.test(sec) || /PayNBook/i.test(sec) || /Online Paid/i.test(sec)) {
        secType = 'ONLINE';
      }
      if (secType === bill.type) {
        inserted = true;
        return `${sec.trim()}\n\n${billBlock}\n`;
      }
      return sec;
    });
    return updatedSections
      .join('\n\n')
      .replace(/(\r?\n){3,}/g, '\n\n')
      .trim();
  } else {
    const header =
      bill.type === 'PENDING'
        ? '*BPCL Status Report: Delivery Pending*'
        : '*BPCL Status Report: Online Bills (PayNBook)*';
    return `${current}\n\n${header}\n\n${billBlock}`;
  }
}

/**
 * Synchronizes rawText with active pending and online bills,
 * purging any deleted/stale bills that might linger in the raw report text.
 */
export function sanitizeRawTextWithActiveBills(
  rawText: string | undefined | null,
  pendingBills?: BpclBillItem[],
  onlineBills?: BpclBillItem[]
): string {
  if (!rawText || !rawText.trim()) return '';
  if (!pendingBills && !onlineBills) return rawText;

  const activePendingSet = new Set(
    (pendingBills || []).map((b) => b.consumer_number.trim().toLowerCase())
  );
  const activeOnlineSet = new Set(
    (onlineBills || []).map((b) => b.consumer_number.trim().toLowerCase())
  );

  const billPattern =
    '(?:\\r?\\n)*[\\t ]*\\*?(?:Consumer No|Cons No|Consumer Number):\\*?[\\t ]*' +
    '([0-9a-zA-Z]+)' +
    '(?:\\b|\\*)(?:[\\s\\S]*?)(?=(?:\\r?\\n+[\\t ]*\\*?(?:Consumer No|Cons No|Consumer Number):|\\r?\\n+[\\t ]*\\*?(?:BPCL Status Report|Status Report|Delivery Pending|Online Bills|PayNBook)|$))';

  const sectionSplitter = /(?=(?:^|\r?\n)\s*\*?(?:BPCL Status Report|Status Report)[^\r\n]*)/i;
  const sections = rawText.split(sectionSplitter);

  const cleanedSections = sections.map((sec) => {
    const firstLine = sec.trim().split(/\r?\n/)[0] || '';
    let secType: 'PENDING' | 'ONLINE' = 'PENDING';
    if (/Delivery Pending/i.test(firstLine)) {
      secType = 'PENDING';
    } else if (/Online Bills|PayNBook|Online Paid/i.test(firstLine)) {
      secType = 'ONLINE';
    }

    const activeSet = secType === 'PENDING' ? activePendingSet : activeOnlineSet;

    return sec.replace(new RegExp(billPattern, 'gi'), (match, consNo) => {
      const cleanNo = (consNo || '').trim().toLowerCase();
      if (!activeSet.has(cleanNo)) {
        return '';
      }
      return match;
    });
  });

  return cleanedSections
    .join('')
    .replace(/(\r?\n){3,}/g, '\n\n')
    .trim();
}

/**
 * Retrieve local cached BPCL report for a delivery boy
 */
export function getLocalBpclReport(dateStr: string, agentName: string): BpclReportData | null {
  try {
    const raw = localStorage.getItem(getStorageKey(dateStr, agentName));
    if (!raw) return null;
    const data: BpclReportData = JSON.parse(raw);
    if (data && data.raw_text) {
      data.raw_text = sanitizeRawTextWithActiveBills(
        data.raw_text,
        data.pending_bills,
        data.online_bills
      );
    }
    return data;
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
            const existing = result[normName];
            const parsedTime = new Date(parsed.updated_at || row.updated_at || 0).getTime();
            const existingTime = new Date(existing?.updated_at || 0).getTime();
            if (!existing || parsedTime >= existingTime) {
              result[normName] = parsed;
              setLocalBpclReport(dateStr, normName, parsed);
            }
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
          if (norm) {
            const existing = result[norm];
            if (!existing) {
              result[norm] = parsed;
            } else {
              const localTime = new Date(parsed.updated_at || 0).getTime();
              const existingTime = new Date(existing.updated_at || 0).getTime();
              if (localTime > existingTime) {
                result[norm] = parsed;
              }
            }
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
  archived?: boolean;
  no_supply?: boolean;
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
    archived: payload.archived,
    no_supply: payload.no_supply,
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

    // Dispatch local DOM event for immediate UI update on current device
    try {
      window.dispatchEvent(
        new CustomEvent('bgcls-bpcl-updated', {
          detail: {
            dateStr: payload.dateStr,
            agentName: normName,
            reportData,
          },
        })
      );
    } catch (_) {}

    return true;
  } catch (err) {
    console.warn('Failed to save BPCL report to cloud:', err);
    return false;
  }
}

/**
 * Add a single BPCL bill manually (Pending or Online)
 */
export async function addBpclBillManually(
  dateStr: string,
  agentName: string,
  bill: BpclBillItem,
  agentId?: string
): Promise<BpclReportData> {
  const normName = agentName.trim().toUpperCase();
  const current = (await fetchBpclReport(dateStr, normName, agentId)) || {
    agent_name: normName,
    agent_id: agentId,
    report_date: dateStr,
    checked_done: true,
    pending_bills: [],
    online_bills: [],
  };

  const updatedPending = [...current.pending_bills];
  const updatedOnline = [...current.online_bills];

  if (bill.type === 'PENDING') {
    // Remove if already exists to avoid duplicates, then prepend
    const idx = updatedPending.findIndex(
      (b) => b.consumer_number.toLowerCase() === bill.consumer_number.toLowerCase()
    );
    if (idx >= 0) updatedPending.splice(idx, 1);
    updatedPending.unshift(bill);
  } else {
    const idx = updatedOnline.findIndex(
      (b) => b.consumer_number.toLowerCase() === bill.consumer_number.toLowerCase()
    );
    if (idx >= 0) updatedOnline.splice(idx, 1);
    updatedOnline.unshift(bill);
  }

  const updatedRawText = appendBillToRawText(current.raw_text, bill);

  const updatedReport: BpclReportData = {
    ...current,
    checked_done: true,
    pending_bills: updatedPending,
    online_bills: updatedOnline,
    raw_text: updatedRawText,
    updated_at: new Date().toISOString(),
  };

  await saveBpclReportToCloud({
    dateStr,
    agentName: normName,
    agentId,
    checked_done: true,
    pending_bills: updatedPending,
    online_bills: updatedOnline,
    raw_text: updatedRawText,
    checked_by: localStorage.getItem('bgcls_agent_name') || 'Staff',
  });

  return updatedReport;
}

/**
 * Update an existing BPCL bill (edit details, or switch between PENDING and ONLINE)
 */
export async function updateBpclBill(
  dateStr: string,
  agentName: string,
  originalConsumerNumber: string,
  originalType: 'PENDING' | 'ONLINE',
  updatedBill: BpclBillItem,
  agentId?: string
): Promise<BpclReportData> {
  const normName = agentName.trim().toUpperCase();
  const current = (await fetchBpclReport(dateStr, normName, agentId)) || {
    agent_name: normName,
    agent_id: agentId,
    report_date: dateStr,
    checked_done: true,
    pending_bills: [],
    online_bills: [],
  };

  const origNum = originalConsumerNumber.trim().toLowerCase();

  // Remove the original bill from its list
  let updatedPending = current.pending_bills.filter(
    (b) => !(b.consumer_number.trim().toLowerCase() === origNum && b.type === originalType)
  );
  let updatedOnline = current.online_bills.filter(
    (b) => !(b.consumer_number.trim().toLowerCase() === origNum && b.type === originalType)
  );

  // Add the updated bill to the target list (handles switching category if type changed)
  if (updatedBill.type === 'PENDING') {
    // Avoid duplicate in target list
    updatedPending = updatedPending.filter(
      (b) => b.consumer_number.trim().toLowerCase() !== updatedBill.consumer_number.trim().toLowerCase()
    );
    updatedPending.unshift(updatedBill);
  } else {
    updatedOnline = updatedOnline.filter(
      (b) => b.consumer_number.trim().toLowerCase() !== updatedBill.consumer_number.trim().toLowerCase()
    );
    updatedOnline.unshift(updatedBill);
  }

  let updatedRawText = removeBillFromRawText(
    current.raw_text,
    originalConsumerNumber,
    originalType
  );
  updatedRawText = appendBillToRawText(updatedRawText, updatedBill);

  const updatedReport: BpclReportData = {
    ...current,
    checked_done: true,
    pending_bills: updatedPending,
    online_bills: updatedOnline,
    raw_text: updatedRawText,
    updated_at: new Date().toISOString(),
  };

  await saveBpclReportToCloud({
    dateStr,
    agentName: normName,
    agentId,
    checked_done: current.checked_done,
    pending_bills: updatedPending,
    online_bills: updatedOnline,
    raw_text: updatedRawText,
    checked_by: localStorage.getItem('bgcls_agent_name') || 'Staff',
  });

  return updatedReport;
}

/**
 * Delete a single BPCL bill (Pending or Online)
 */
export async function deleteBpclBill(
  dateStr: string,
  agentName: string,
  consumerNumber: string,
  billType: 'PENDING' | 'ONLINE',
  agentId?: string
): Promise<BpclReportData> {
  const normName = agentName.trim().toUpperCase();
  const current = (await fetchBpclReport(dateStr, normName, agentId)) || {
    agent_name: normName,
    agent_id: agentId,
    report_date: dateStr,
    checked_done: true,
    pending_bills: [],
    online_bills: [],
  };

  const cleanNum = consumerNumber.trim().toLowerCase();
  const updatedPending = billType === 'PENDING'
    ? current.pending_bills.filter((b) => b.consumer_number.trim().toLowerCase() !== cleanNum)
    : current.pending_bills;
  const updatedOnline = billType === 'ONLINE'
    ? current.online_bills.filter((b) => b.consumer_number.trim().toLowerCase() !== cleanNum)
    : current.online_bills;

  const updatedRawText = removeBillFromRawText(current.raw_text, consumerNumber, billType);

  const updatedReport: BpclReportData = {
    ...current,
    pending_bills: updatedPending,
    online_bills: updatedOnline,
    raw_text: updatedRawText,
    updated_at: new Date().toISOString(),
  };

  await saveBpclReportToCloud({
    dateStr,
    agentName: normName,
    agentId,
    checked_done: current.checked_done,
    pending_bills: updatedPending,
    online_bills: updatedOnline,
    raw_text: updatedRawText,
    checked_by: localStorage.getItem('bgcls_agent_name') || 'Staff',
  });

  return updatedReport;
}

/**
 * 1-Click "Delivered & Clear" for a Pending Bill:
 * Clears it from pending_bills, and if it was an online paid bill (PayNBook/Online),
 * ensures it is preserved in online_bills as "Online Bill (Delivery Done)" so it's
 * counted in Xerox Online export and never lost!
 */
export async function clearPendingBillAndMarkDelivered(
  dateStr: string,
  agentName: string,
  consumerNumber: string,
  agentId?: string
): Promise<BpclReportData> {
  const normName = agentName.trim().toUpperCase();
  const current = (await fetchBpclReport(dateStr, normName, agentId)) || {
    agent_name: normName,
    agent_id: agentId,
    report_date: dateStr,
    checked_done: true,
    pending_bills: [],
    online_bills: [],
  };

  const cleanNum = consumerNumber.trim().toLowerCase();
  const pendingBill = current.pending_bills.find(
    (b) => b.consumer_number.trim().toLowerCase() === cleanNum
  );
  const updatedPending = current.pending_bills.filter(
    (b) => b.consumer_number.trim().toLowerCase() !== cleanNum
  );

  let updatedOnline = [...current.online_bills];
  const isOnlinePaid = pendingBill && (
    /PayNBook|Online/i.test(pendingBill.refill_type || '') ||
    /Online Paid/i.test(pendingBill.status || '')
  );

  if (isOnlinePaid && pendingBill) {
    const existingIdx = updatedOnline.findIndex(
      (b) => b.consumer_number.trim().toLowerCase() === cleanNum
    );
    if (existingIdx >= 0) {
      updatedOnline[existingIdx] = {
        ...updatedOnline[existingIdx],
        status: 'Online Bill (Delivery Done)',
      };
    } else {
      updatedOnline.unshift({
        ...pendingBill,
        status: 'Online Bill (Delivery Done)',
        type: 'ONLINE',
      });
    }
  }

  let updatedRawText = removeBillFromRawText(current.raw_text, consumerNumber, 'PENDING');
  if (isOnlinePaid && pendingBill) {
    updatedRawText = appendBillToRawText(updatedRawText, {
      ...pendingBill,
      status: 'Online Bill (Delivery Done)',
      type: 'ONLINE',
    });
  }

  const updatedReport: BpclReportData = {
    ...current,
    pending_bills: updatedPending,
    online_bills: updatedOnline,
    raw_text: updatedRawText,
    updated_at: new Date().toISOString(),
  };

  await saveBpclReportToCloud({
    dateStr,
    agentName: normName,
    agentId,
    checked_done: current.checked_done,
    pending_bills: updatedPending,
    online_bills: updatedOnline,
    raw_text: updatedRawText,
    checked_by: localStorage.getItem('bgcls_agent_name') || 'Staff',
  });

  return updatedReport;
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
    archived: current.archived,
    pending_bills: current.pending_bills,
    online_bills: current.online_bills,
    raw_text: current.raw_text,
    checked_by: localStorage.getItem('bgcls_agent_name') || 'Staff',
  });
}

/**
 * Fast 1-click toggle for Delivery Boy "Archived / Completed" status
 */
export async function toggleBoyArchived(
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

  const nextStatus = explicitStatus !== undefined ? explicitStatus : !current.archived;

  return saveBpclReportToCloud({
    dateStr,
    agentName: normName,
    agentId,
    checked_done: current.checked_done,
    archived: nextStatus,
    no_supply: nextStatus ? false : current.no_supply,
    pending_bills: current.pending_bills,
    online_bills: current.online_bills,
    raw_text: current.raw_text,
    checked_by: localStorage.getItem('bgcls_agent_name') || 'Staff',
  });
}

/**
 * Fast 1-click toggle for Delivery Boy "No Supply Today" status
 */
export async function toggleBoyNoSupply(
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

  const nextStatus = explicitStatus !== undefined ? explicitStatus : !current.no_supply;

  return saveBpclReportToCloud({
    dateStr,
    agentName: normName,
    agentId,
    checked_done: current.checked_done,
    archived: nextStatus ? false : current.archived, // If marked no-supply, clear archived
    no_supply: nextStatus,
    pending_bills: current.pending_bills,
    online_bills: current.online_bills,
    raw_text: current.raw_text,
    checked_by: localStorage.getItem('bgcls_agent_name') || 'Staff',
  });
}

