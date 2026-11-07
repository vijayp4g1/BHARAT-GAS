import { supabase } from './supabase';
import { staffDb } from './staffDb';

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
    if (parsed) {
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

type BpclSection = 'PENDING' | 'ONLINE';

const stripBpclMarkup = (value: string): string => value.replace(/[*_`]/g, '').trim();

// Field labels can legitimately contain words like "Pending" or "PayNBook" in their
// values (e.g. "Status: Online Paid - Pending", "Refill Type: PayNBook Apps").
// Never treat those lines as section headers.
const BPCL_FIELD_LINE_RE =
  /^(?:consumer|cons|customer|name|order|book(?:ing)?|cash|memo|invoice|refill|type|status(?!\s+report\b)|date|address|mobile|phone|amount|delivery\s*boy)\b/i;

const BPCL_BILL_START_RE =
  /^\s*\*{0,2}\s*(?:Consumer\s*(?:No\.?|Number|#)|Cons\s*(?:No\.?|Number|#))\s*\*{0,2}\s*[:.-]?/i;

/**
 * Classifies a header line. Only the header line itself may change the section,
 * so a bill's Status/Refill Type values can never flip the section mid-report.
 */
function classifyBpclSectionLine(line: string): BpclSection | null {
  const clean = stripBpclMarkup(line).replace(/\s+/g, ' ').trim();
  if (!clean || BPCL_FIELD_LINE_RE.test(clean)) return null;

  if (/\bdelivery\s+pending\b/i.test(clean)) {
    return 'PENDING';
  }
  if (/\bonline\s+(?:bills?|paid|pending)\b|\bpay\s*n?\s*book\b|^online\b/i.test(clean)) {
    return 'ONLINE';
  }
  if (/\bpending\s+(?:bills?|deliver(?:y|ies))\b|^pending\b/i.test(clean)) {
    return 'PENDING';
  }
  return null;
}

function parseBpclBillChunk(chunk: string, section: BpclSection): BpclBillItem | null {
  const consMatch = chunk.match(
    /^\s*\*{0,2}\s*(?:Consumer\s*(?:No\.?|Number|#)|Cons\s*(?:No\.?|Number|#))\s*\*{0,2}\s*[:.-]?\s*\*{0,2}\s*([0-9a-zA-Z]+)/im
  );
  if (!consMatch) return null;

  const pick = (re: RegExp): string => {
    const match = chunk.match(re);
    return match ? stripBpclMarkup(match[1]) : '';
  };

  const nameMatch = pick(
    /^\s*\*{0,2}\s*(?:Customer\s*Name|Consumer\s*Name|Cons\s*Name|Name)\s*\*{0,2}\s*[:.-]?\s*\*{0,2}\s*([^\n\r]+)/im
  );
  const orderMatch = pick(
    /^\s*\*{0,2}\s*(?:Order\s*(?:No\.?|Number|#)?)\s*\*{0,2}\s*[:.-]?\s*\*{0,2}\s*([0-9a-zA-Z]+)/im
  );
  const bookDateMatch = pick(
    /^\s*\*{0,2}\s*(?:Book(?:ing)?\s*Date|Date)\s*\*{0,2}\s*[:.-]?\s*\*{0,2}\s*([0-9][0-9/.-]*)/im
  );
  const cashMemoMatch = pick(
    /^\s*\*{0,2}\s*(?:Cash\s*Memo|Memo(?:\s*(?:No\.?|Number|#))?|Invoice(?:\s*(?:No\.?|Number|#))?)\s*\*{0,2}\s*[:.-]?\s*\*{0,2}\s*([0-9a-zA-Z]+)/im
  );
  const refillTypeMatch = pick(
    /^\s*\*{0,2}\s*(?:Refill\s*Type|Type)\s*\*{0,2}\s*[:.-]?\s*\*{0,2}\s*([^\n\r]+)/im
  );
  const statusMatch = pick(
    /^\s*\*{0,2}\s*Status\s*\*{0,2}\s*[:.-]?\s*\*{0,2}\s*([^\n\r]+)/im
  );

  return {
    consumer_number: consMatch[1].trim(),
    consumer_name: nameMatch,
    order_no: orderMatch,
    book_date: bookDateMatch,
    cash_memo: cashMemoMatch,
    refill_type: refillTypeMatch,
    status: statusMatch || (section === 'PENDING' ? 'Delivery Pending' : 'Online Bill (Delivery Done)'),
    type: section,
  };
}

const isOnlinePaidBpclBill = (bill: BpclBillItem): boolean =>
  /online|pay\s*n?\s*book/i.test(`${bill.status || ''} ${bill.refill_type || ''}`);

const isPendingDeliveryBpclBill = (bill: BpclBillItem): boolean =>
  /\bpending\b/i.test(bill.status || '');

const hasConsumerNumber = (list: BpclBillItem[], consumerNumber: string): boolean =>
  list.some((b) => b.consumer_number.trim().toLowerCase() === consumerNumber.trim().toLowerCase());

/**
 * Robust parser for BPCL Status Report text from WhatsApp / AI agents.
 *
 * Sections are detected from header lines only, so words inside bill fields
 * (e.g. "PayNBook Apps", "Online Paid - Pending", "Delivery Pending") can never
 * move a bill into the wrong list.
 *
 * A bill that is paid online but still awaiting delivery ("Online Paid - Pending")
 * is counted in BOTH the pending list and the online list.
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

  let currentSection: BpclSection = 'PENDING';
  const chunks: Array<{ text: string; section: BpclSection }> = [];
  let currentLines: string[] = [];
  let currentChunkSection: BpclSection = 'PENDING';

  const flushChunk = () => {
    if (currentLines.length > 0) {
      chunks.push({ text: currentLines.join('\n'), section: currentChunkSection });
      currentLines = [];
    }
  };

  const lines = rawText.replace(/\r\n?/g, '\n').split('\n');
  for (const line of lines) {
    const section = classifyBpclSectionLine(line);
    if (section) {
      flushChunk();
      currentSection = section;
      continue;
    }

    if (BPCL_BILL_START_RE.test(line)) {
      flushChunk();
      currentChunkSection = currentSection;
      currentLines = [line];
    } else if (currentLines.length > 0) {
      currentLines.push(line);
    }
  }
  flushChunk();

  for (const chunk of chunks) {
    const item = parseBpclBillChunk(chunk.text, chunk.section);
    if (!item) continue;

    if (item.type === 'PENDING') {
      if (!hasConsumerNumber(pendingBills, item.consumer_number)) {
        pendingBills.push(item);
      }
      // A pending bill already paid online (PayNBook) also belongs to the online list.
      if (
        isOnlinePaidBpclBill(item) &&
        !hasConsumerNumber(onlineBills, item.consumer_number)
      ) {
        onlineBills.push({ ...item, type: 'ONLINE' });
      }
    } else {
      if (!hasConsumerNumber(onlineBills, item.consumer_number)) {
        onlineBills.push(item);
      }
      // Online-paid but not yet delivered still needs a delivery boy: count it as pending too.
      if (
        isPendingDeliveryBpclBill(item) &&
        !hasConsumerNumber(pendingBills, item.consumer_number)
      ) {
        pendingBills.push({ ...item, type: 'PENDING' });
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
    '(?:\\b|\\*)(?:[\\s\\S]*?)(?=(?:\\r?\\n+[\\t ]*\\*?(?:Consumer No|Cons No|Consumer Number):|\\r?\\n+[\\t ]*\\*?(?:BPCL Status Report|Status Report|Delivery Pending|Online Bills|PayNBook|Online Paid)|$))';

  if (!billType) {
    return rawText
      .replace(new RegExp(billPattern, 'i'), '')
      .replace(/(\r?\n){3,}/g, '\n\n')
      .trim();
  }

  // Section-aware removal
  const sectionSplitter = /(?=(?:^|\r?\n)\s*\*?(?:BPCL Status Report|Status Report|Delivery Pending|Online Bills|PayNBook|Online Paid)[^\r\n]*)/i;
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

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Updates the Status line of every bill block that belongs to the given consumer.
 * Used when a bill is delivered/removed from the pending list but still exists in
 * the online section, so it is not re-added to pending by the parser.
 */
export function markBillStatusInRawText(
  rawText: string | undefined | null,
  consumerNumber: string,
  newStatus: string
): string {
  if (!rawText || !rawText.trim()) return rawText || '';

  const escapedNum = escapeRegExp(consumerNumber.trim());
  const blockPattern = new RegExp(
    '(\\*?(?:Consumer No|Cons No|Consumer Number)\\s*:?\\s*\\*?\\s*' +
      escapedNum +
      '\\b[\\s\\S]*?)(?=(?:\\r?\\n+[\\t ]*\\*?(?:Consumer No|Cons No|Consumer Number)\\s*:|\\r?\\n+[\\t ]*\\*?(?:BPCL Status Report|Status Report|Delivery Pending|Online Bills|PayNBook|Online Paid)[^\\r\\n]*)|$)',
    'gi'
  );

  return rawText.replace(blockPattern, (block) => {
    if (/^\s*\*?Status\s*:?/im.test(block)) {
      return block.replace(/^(\s*\*?Status\s*:?\s*\*?\s*).*$/im, `$1${newStatus}`);
    }
    return `${block.replace(/\s+$/, '')}\nStatus: ${newStatus}`;
  });
}

function rawTextContainsConsumer(rawText: string, consumerNumber: string): boolean {
  const escapedNum = escapeRegExp(consumerNumber.trim());
  return new RegExp(
    '(?:Consumer No|Cons No|Consumer Number)\\s*:?\\s*\\*?\\s*' + escapedNum + '\\b',
    'i'
  ).test(rawText);
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
 * Builds standard formatted BPCL text from structured pending and online bills.
 */
export function buildRawTextFromBills(
  pendingBills?: BpclBillItem[],
  onlineBills?: BpclBillItem[]
): string {
  const parts: string[] = [];
  if (pendingBills && pendingBills.length > 0) {
    parts.push('*BPCL Status Report: Delivery Pending*');
    pendingBills.forEach((b) => {
      parts.push(formatBpclBillBlock({ ...b, type: 'PENDING' }));
    });
  }
  if (onlineBills && onlineBills.length > 0) {
    parts.push('*BPCL Status Report: Online Bills (PayNBook)*');
    onlineBills.forEach((b) => {
      parts.push(formatBpclBillBlock({ ...b, type: 'ONLINE' }));
    });
  }
  return parts.join('\n\n').trim();
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
    const sectionSplitter = /(?=(?:^|\r?\n)\s*\*?(?:BPCL Status Report|Status Report|Delivery Pending|Online Bills|PayNBook|Online Paid)[^\r\n]*)/i;
    const sections = current.split(sectionSplitter);
    let inserted = false;
    const updatedSections = sections.map((sec) => {
      if (inserted) return sec;
      const firstLine = sec.trim().split(/\r?\n/)[0] || '';
      let secType: 'PENDING' | 'ONLINE' = 'PENDING';
      if (/Delivery Pending/i.test(firstLine)) {
        secType = 'PENDING';
      } else if (/Online Bills|PayNBook|Online Paid/i.test(firstLine)) {
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
 * purging any deleted/stale bills that might linger in the raw report text,
 * and ensuring newly added/cleared bills are present.
 */
export function sanitizeRawTextWithActiveBills(
  rawText: string | undefined | null,
  pendingBills?: BpclBillItem[],
  onlineBills?: BpclBillItem[]
): string {
  const hasPending = Array.isArray(pendingBills) && pendingBills.length > 0;
  const hasOnline = Array.isArray(onlineBills) && onlineBills.length > 0;

  if (!rawText || !rawText.trim()) {
    if (hasPending || hasOnline) {
      return buildRawTextFromBills(pendingBills, onlineBills);
    }
    return '';
  }

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
    '(?:\\b|\\*)(?:[\\s\\S]*?)(?=(?:\\r?\\n+[\\t ]*\\*?(?:Consumer No|Cons No|Consumer Number):|\\r?\\n+[\\t ]*\\*?(?:BPCL Status Report|Status Report|Delivery Pending|Online Bills|PayNBook|Online Paid)|$))';

  const sectionSplitter = /(?=(?:^|\r?\n)\s*\*?(?:BPCL Status Report|Status Report|Delivery Pending|Online Bills|PayNBook|Online Paid)[^\r\n]*)/i;
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

  let result = cleanedSections
    .join('')
    .replace(/(\r?\n){3,}/g, '\n\n')
    .trim();

  // Ensure any active bills that were not in rawText are preserved
  if (pendingBills) {
    pendingBills.forEach((bill) => {
      const cleanNo = bill.consumer_number.trim().toLowerCase();
      const pattern = new RegExp(`(?:Consumer No|Cons No|Consumer Number):\\*?[\\t ]*${cleanNo}\\b`, 'i');
      if (!pattern.test(result)) {
        result = appendBillToRawText(result, { ...bill, type: 'PENDING' });
      }
    });
  }
  if (onlineBills) {
    onlineBills.forEach((bill) => {
      const cleanNo = bill.consumer_number.trim().toLowerCase();
      const pattern = new RegExp(`(?:Consumer No|Cons No|Consumer Number):\\*?[\\t ]*${cleanNo}\\b`, 'i');
      if (!pattern.test(result)) {
        result = appendBillToRawText(result, { ...bill, type: 'ONLINE' });
      }
    });
  }

  return result.replace(/(\r?\n){3,}/g, '\n\n').trim();
}

/**
 * Retrieve local cached BPCL report for a delivery boy
 */
export function getLocalBpclReport(dateStr: string, agentName: string): BpclReportData | null {
  try {
    const raw = localStorage.getItem(getStorageKey(dateStr, agentName));
    if (!raw) return null;
    const data: BpclReportData = JSON.parse(raw);
    if (data) {
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
    let query = staffDb
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
    const { data, error } = await staffDb
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
    let query = staffDb
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
      await staffDb
        .from('staff_cylinder_settlements')
        .update({
          notes: updatedNotes,
          updated_at: nowIso,
        })
        .eq('id', existing.id);
    } else {
      // Create new settlement record with this BPCL report
      const newNotes = mergeBpclIntoNotes('', reportData);
      await staffDb.from('staff_cylinder_settlements').insert({
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
  // Converting a pending bill to online: drop the old online block as well so the
  // edited bill's new status is the single source of truth (prevents it from being
  // re-added to pending on the next parse).
  if (originalType === 'PENDING' && updatedBill.type === 'ONLINE') {
    updatedRawText = removeBillFromRawText(
      updatedRawText,
      originalConsumerNumber,
      'ONLINE'
    );
  }
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

  let updatedRawText = removeBillFromRawText(current.raw_text, consumerNumber, billType);

  // An online-paid bill is shown in both lists. When its pending entry is deleted,
  // mark the online entry as delivered so the parser does not re-create it as pending.
  if (
    billType === 'PENDING' &&
    updatedOnline.some((b) => b.consumer_number.trim().toLowerCase() === cleanNum)
  ) {
    updatedRawText = markBillStatusInRawText(
      updatedRawText,
      consumerNumber,
      'Online Bill (Delivery Done)'
    );
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
    const onlineCopyExists = updatedOnline.some(
      (b) => b.consumer_number.trim().toLowerCase() === cleanNum
    );
    if (onlineCopyExists) {
      // Update the existing online block instead of appending a duplicate.
      updatedRawText = markBillStatusInRawText(
        updatedRawText,
        consumerNumber,
        'Online Bill (Delivery Done)'
      );
    }
    if (!rawTextContainsConsumer(updatedRawText, consumerNumber)) {
      updatedRawText = appendBillToRawText(updatedRawText, {
        ...pendingBill,
        status: 'Online Bill (Delivery Done)',
        type: 'ONLINE',
      });
    }
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
 * Bulk clear pending bills.
 *
 * Removes the given consumer numbers from pending_bills ONLY. online_bills is
 * passed through untouched, so online-paid bills keep exactly the entries and
 * statuses they already had. Completed deliveries / day-end counts are not
 * affected either. One read + one cloud write for the whole batch.
 */
export async function clearPendingBillsBulk(params: {
  dateStr: string;
  agentName: string;
  agentId?: string;
  consumerNumbers: string[];
}): Promise<{ report: BpclReportData; cleared: BpclBillItem[] }> {
  const normName = params.agentName.trim().toUpperCase();
  const targets = new Set(
    params.consumerNumbers
      .map((n) => String(n || '').trim().toLowerCase())
      .filter(Boolean)
  );

  const current = (await fetchBpclReport(params.dateStr, normName, params.agentId)) || {
    agent_name: normName,
    agent_id: params.agentId,
    report_date: params.dateStr,
    checked_done: true,
    pending_bills: [],
    online_bills: [],
  };

  if (targets.size === 0 || current.pending_bills.length === 0) {
    return { report: current, cleared: [] };
  }

  const cleared = current.pending_bills.filter((b) =>
    targets.has(b.consumer_number.trim().toLowerCase())
  );

  if (cleared.length === 0) {
    return { report: current, cleared: [] };
  }

  const updatedPending = current.pending_bills.filter(
    (b) => !targets.has(b.consumer_number.trim().toLowerCase())
  );

  // Intentionally NOT modified: online bills stay exactly as they are.
  const updatedOnline = current.online_bills;

  // Remove each cleared bill from the pending section of the stored report text,
  // then run the consistency guard so a later paste/update cannot resurrect them.
  let updatedRawText = current.raw_text;
  for (const bill of cleared) {
    updatedRawText = removeBillFromRawText(updatedRawText, bill.consumer_number, 'PENDING');
  }
  updatedRawText = sanitizeRawTextWithActiveBills(
    updatedRawText,
    updatedPending,
    updatedOnline
  );

  const updatedReport: BpclReportData = {
    ...current,
    pending_bills: updatedPending,
    online_bills: updatedOnline,
    raw_text: updatedRawText,
    updated_at: new Date().toISOString(),
  };

  const saved = await saveBpclReportToCloud({
    dateStr: params.dateStr,
    agentName: normName,
    agentId: params.agentId,
    checked_done: current.checked_done,
    archived: current.archived,
    no_supply: current.no_supply,
    pending_bills: updatedPending,
    online_bills: updatedOnline,
    raw_text: updatedRawText,
    checked_by: localStorage.getItem('bgcls_agent_name') || 'Staff',
  });

  if (!saved) {
    throw new Error('Could not save cleared bills to the database. Nothing was removed.');
  }

  return { report: updatedReport, cleared };
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

