import React, { useMemo, useState } from 'react';
import { X, Trash2, Loader2, ListChecks, AlertCircle, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { clearPendingBillsBulk, type BpclBillItem, type BpclReportData } from '../lib/bpclReportService';
import type { DayEndReportSummary } from '../lib/dayEndService';

interface PendingClearAllModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportDate: string;
  bpclReportsMap: Record<string, BpclReportData>;
  rosterSummaries: Record<string, DayEndReportSummary>;
  onReportUpdated: (normName: string, report: BpclReportData) => void;
}

type ClearMode = 'SELECTED' | 'KEEP_SELECTED' | 'ALL';
type ClearScope = { scope: 'BOY'; boy: string; mode: ClearMode } | { scope: 'ALL'; mode: 'SELECTED' };

const keyOf = (value?: string | null): string => String(value || '').trim().toLowerCase();

export const PendingClearAllModal: React.FC<PendingClearAllModalProps> = ({
  isOpen,
  onClose,
  reportDate,
  bpclReportsMap,
  rosterSummaries,
  onReportUpdated,
}) => {
  const [activeBoy, setActiveBoy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const [confirm, setConfirm] = useState<ClearScope | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const boys = useMemo(
    () =>
      Object.entries(bpclReportsMap)
        .filter(([, rep]) => (rep.pending_bills || []).length > 0)
        .sort(([a], [b]) => a.localeCompare(b)),
    [bpclReportsMap]
  );

  if (!isOpen) return null;

  const tab = boys.some(([name]) => name === activeBoy) ? activeBoy : boys[0]?.[0] ?? null;
  const tabPending: BpclBillItem[] = tab ? bpclReportsMap[tab]?.pending_bills || [] : [];

  const selectedOf = (boy: string): Set<string> => selected[boy] || new Set<string>();
  const scannedOf = (boy: string): Set<string> =>
    new Set((rosterSummaries[boy]?.entries || []).map((e) => keyOf(e.consumer_number)));

  const setSelectionFor = (boy: string, next: Set<string>) =>
    setSelected((prev) => ({ ...prev, [boy]: next }));

  const toggleBill = (boy: string, consumerNumber: string) => {
    const next = new Set(selectedOf(boy));
    const k = keyOf(consumerNumber);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setSelectionFor(boy, next);
  };

  const planFor = (boy: string, mode: ClearMode): BpclBillItem[] => {
    const list = bpclReportsMap[boy]?.pending_bills || [];
    const chosen = selectedOf(boy);
    if (mode === 'ALL') return list;
    if (mode === 'SELECTED') return list.filter((b) => chosen.has(keyOf(b.consumer_number)));
    return list.filter((b) => !chosen.has(keyOf(b.consumer_number)));
  };

  const buildPlan = (scope: ClearScope): { boy: string; bills: BpclBillItem[] }[] => {
    const boyNames = scope.scope === 'BOY' ? [scope.boy] : boys.map(([name]) => name);
    return boyNames
      .map((boy) => ({
        boy,
        bills: planFor(boy, scope.scope === 'BOY' ? scope.mode : 'SELECTED'),
      }))
      .filter((p) => p.bills.length > 0);
  };

  const confirmPlan = confirm ? buildPlan(confirm) : [];
  const confirmTotal = confirmPlan.reduce((sum, p) => sum + p.bills.length, 0);

  const tabSelected = tab ? selectedOf(tab) : new Set<string>();
  const tabSelectedCount = tabPending.filter((b) => tabSelected.has(keyOf(b.consumer_number))).length;
  const tabKeepCount = tabPending.length - tabSelectedCount;
  const tabScanned = tab ? scannedOf(tab) : new Set<string>();
  const tabScannedCount = tabPending.filter((b) => tabScanned.has(keyOf(b.consumer_number))).length;
  const allSelectedCount = boys.reduce((sum, [name]) => sum + planFor(name, 'SELECTED').length, 0);

  const runClear = async () => {
    if (!confirm || isRunning) return;
    const plan = buildPlan(confirm);
    if (plan.length === 0) {
      setConfirm(null);
      return;
    }

    setIsRunning(true);
    let clearedTotal = 0;
    const failures: string[] = [];

    // One save per delivery boy, run one after another so writes never race.
    for (const step of plan) {
      const rep = bpclReportsMap[step.boy];
      try {
        const { report, cleared } = await clearPendingBillsBulk({
          dateStr: reportDate,
          agentName: rep?.agent_name || step.boy,
          agentId: rep?.agent_id,
          consumerNumbers: step.bills.map((b) => b.consumer_number),
        });
        onReportUpdated(step.boy, report);
        setSelectionFor(step.boy, new Set());
        clearedTotal += cleared.length;
      } catch (err: any) {
        failures.push(`${step.boy}: ${err?.message || 'could not save'}`);
      }
    }

    setIsRunning(false);
    setConfirm(null);

    if (clearedTotal > 0) {
      toast.success(`Cleared ${clearedTotal} pending bill${clearedTotal === 1 ? '' : 's'} — online bills were not changed`);
    }
    if (failures.length > 0) {
      toast.error(`Not cleared for ${failures.length} boy(s): ${failures.join('; ')}`, { duration: 8000 });
    }
    if (clearedTotal === 0 && failures.length === 0) {
      toast('Those bills are no longer in the pending list', { icon: 'ℹ️' });
    }
  };

  return (
    <div className="fixed inset-0 z-[110] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col text-slate-100 max-h-[92vh]">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/90 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-300 flex items-center justify-center border border-amber-500/30 shrink-0">
              <ListChecks className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs sm:text-sm font-black text-white uppercase tracking-tight">Clear Pending Bills</h3>
              <p className="text-[10px] text-slate-400 truncate">All delivery boys • {reportDate}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={isRunning} className="p-2 text-slate-400 hover:text-white rounded-xl disabled:opacity-50">
            <X className="w-4 h-4" />
          </button>
        </div>

        {boys.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">No pending bills for {reportDate}.</div>
        ) : (
          <>
            {/* Tabs: one per delivery boy with pending bills */}
            <div className="flex gap-1.5 overflow-x-auto px-3 pt-3 pb-2 border-b border-slate-800 shrink-0">
              {boys.map(([name, rep]) => {
                const isActive = name === tab;
                const count = (rep.pending_bills || []).length;
                const chosen = selectedOf(name).size;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setActiveBoy(name)}
                    className={`shrink-0 px-2.5 py-1.5 rounded-xl text-[11px] font-black border transition-all ${
                      isActive
                        ? 'bg-amber-400 text-slate-950 border-amber-300'
                        : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    {name} <span className="opacity-80">({count})</span>
                    {chosen > 0 && <span className="ml-1 text-[10px] text-rose-600 font-black">• {chosen} ticked</span>}
                  </button>
                );
              })}
            </div>

            {tab && (
              <div className="flex flex-col min-h-0 flex-1">
                {/* Tab toolbar */}
                <div className="flex items-center gap-1.5 flex-wrap px-3 py-2 border-b border-slate-800 shrink-0">
                  <button
                    type="button"
                    onClick={() => setSelectionFor(tab, new Set(tabPending.map((b) => keyOf(b.consumer_number))))}
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] font-bold"
                  >
                    Select all ({tabPending.length})
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectionFor(tab, new Set(tabPending.filter((b) => tabScanned.has(keyOf(b.consumer_number))).map((b) => keyOf(b.consumer_number))))
                    }
                    disabled={tabScannedCount === 0}
                    title="Pending bills already present in this boy's Completed Deliveries"
                    className="px-2 py-1 rounded-lg bg-emerald-900/50 hover:bg-emerald-900 border border-emerald-700 text-emerald-200 text-[10px] font-bold disabled:opacity-40"
                  >
                    Select scanned ({tabScannedCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectionFor(tab, new Set())}
                    disabled={tabSelectedCount === 0}
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] font-bold disabled:opacity-40"
                  >
                    Clear ticks
                  </button>
                  <span className="ml-auto text-[10px] font-black text-amber-300">{tabSelectedCount} ticked</span>
                </div>

                {/* Pending bill rows */}
                <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-800">
                  {tabPending.map((bill, index) => {
                    const k = keyOf(bill.consumer_number);
                    const isTicked = tabSelected.has(k);
                    const isScanned = tabScanned.has(k);
                    return (
                      <label
                        key={`${bill.consumer_number}-${index}`}
                        className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors ${isTicked ? 'bg-amber-500/15' : 'hover:bg-slate-800/60'}`}
                      >
                        <input
                          type="checkbox"
                          checked={isTicked}
                          onChange={() => toggleBill(tab, bill.consumer_number)}
                          className="w-4 h-4 accent-amber-500 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-black text-xs text-white">#{bill.consumer_number}</span>
                            {isScanned && (
                              <span className="text-[9px] font-black uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                                In day-end
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400 truncate">{bill.consumer_name || 'Consumer'}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>

                {/* Per-boy actions */}
                <div className="p-3 border-t border-slate-800 bg-slate-950/60 flex items-center gap-1.5 flex-wrap shrink-0">
                  <button
                    type="button"
                    onClick={() => setConfirm({ scope: 'BOY', boy: tab, mode: 'SELECTED' })}
                    disabled={tabSelectedCount === 0}
                    className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-black disabled:opacity-40 flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" /> Clear ticked ({tabSelectedCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirm({ scope: 'BOY', boy: tab, mode: 'KEEP_SELECTED' })}
                    disabled={tabSelectedCount === 0 || tabKeepCount === 0}
                    className="px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-black disabled:opacity-40"
                  >
                    Keep only ticked (clear {tabKeepCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirm({ scope: 'BOY', boy: tab, mode: 'ALL' })}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-rose-500/40 text-rose-300 text-[11px] font-black"
                  >
                    Clear all {tabPending.length}
                  </button>
                </div>

                {allSelectedCount > 0 && (
                  <div className="px-3 py-2 border-t border-slate-800 flex items-center justify-between gap-2 shrink-0">
                    <span className="text-[10px] text-slate-400">Ticked across all boys: <b className="text-white">{allSelectedCount}</b></span>
                    <button
                      type="button"
                      onClick={() => setConfirm({ scope: 'ALL', mode: 'SELECTED' })}
                      className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-black"
                    >
                      Clear all ticked boys ({allSelectedCount})
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Confirmation */}
        {confirm && (
          <div className="absolute inset-0 bg-slate-950/90 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-3xl p-4 w-full max-w-md space-y-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-amber-400" />
                <h4 className="text-sm font-black text-white">Clear {confirmTotal} pending bill{confirmTotal === 1 ? '' : 's'}?</h4>
              </div>
              <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-800 divide-y divide-slate-800">
                {confirmPlan.map((p) => (
                  <div key={p.boy} className="px-3 py-1.5 flex items-center justify-between text-[11px]">
                    <span className="font-bold text-slate-200">{p.boy}</span>
                    <span className="text-slate-400">{p.bills.length} bill{p.bills.length === 1 ? '' : 's'}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] font-bold text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-2.5">
                Only pending bills are removed. Online bills and completed deliveries are not changed.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirm(null)}
                  disabled={isRunning}
                  className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-black disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={runClear}
                  disabled={isRunning || confirmTotal === 0}
                  className="flex-1 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  <span>{isRunning ? 'Clearing...' : `Clear ${confirmTotal}`}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
