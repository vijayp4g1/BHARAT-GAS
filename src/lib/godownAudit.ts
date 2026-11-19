import { supabase } from './supabase';

export type GodownAuditAction =
  | 'SETTLEMENT_SAVE'
  | 'SETTLEMENT_DELETE'
  | 'DAY_UNLOCK'
  | 'RATE_CHANGE';

export interface GodownAuditEntry {
  action: GodownAuditAction;
  entity_type?: 'settlement' | 'day' | 'settings';
  entity_id?: string | null;
  settlement_date?: string | null;
  agent_id?: string | null;
  agent_name?: string | null;
  before_data?: unknown;
  after_data?: unknown;
  reason?: string | null;
  source?: string;
}

/**
 * Best-effort audit log. It never blocks the user action if the audit table is
 * missing or the network is down.
 */
export async function logGodownAudit(entry: GodownAuditEntry): Promise<void> {
  try {
    let changedByName = '';
    try {
      changedByName =
        localStorage.getItem('bgcls_agent_name') ||
        localStorage.getItem('bgcls_logged_username') ||
        '';
    } catch (_) {}

    let changedBy: string | null = null;
    try {
      const { data } = await supabase.auth.getUser();
      changedBy = data?.user?.id ?? null;
    } catch (_) {}

    await supabase.from('godown_audit').insert({
      action: entry.action,
      entity_type: entry.entity_type || null,
      entity_id: entry.entity_id || null,
      settlement_date: entry.settlement_date || null,
      agent_id: entry.agent_id || null,
      agent_name: entry.agent_name || null,
      before_data: entry.before_data ?? null,
      after_data: entry.after_data ?? null,
      changed_by: changedBy,
      changed_by_name: changedByName || null,
      reason: entry.reason || null,
      source: entry.source || 'staff_book',
    });
  } catch (err) {
    console.warn('Audit log write failed (non-blocking):', err);
  }
}
