import React, { useState, useEffect } from 'react';
import { 
  Clock, 
  Globe, 
  Copy, 
  Check, 
  Plus, 
  Sparkles, 
  AlertTriangle, 
  CheckCircle2, 
  Search, 
  X, 
  Trash2,
  CheckCheck,
  UserCheck,
  Loader2,
  ChevronDown,
  Printer,
  Zap
} from 'lucide-react';
import toast from 'react-hot-toast';
import { 
  deleteBpclBill, 
  addBpclBillManually, 
  type BpclBillItem, 
  type BpclReportData 
} from '../lib/bpclReportService';
import type { DayEndEntry } from '../lib/dayEndService';
import { matchConsumerWithDatabase } from '../lib/consumerMatcher';
import db from '../lib/db';

interface BpclBillsViewProps {
  report: BpclReportData | null;
  agentName: string;
  reportDate: string;
  scannedEntries: DayEndEntry[];
  onOpenPasteModal: () => void;
  onToggleCheckedDone: () => void;
  onAddBillToScanned?: (bill: BpclBillItem) => void;
  onReportUpdated?: (report: BpclReportData) => void;
  onOpenExportAllOnline?: () => void;
  onConvertBillToOnline?: (consumerNo: string) => void;
  onConvertAllOnlineConflicts?: () => void;
}

export const BpclBillsView: React.FC<BpclBillsViewProps> = ({
  report,
  agentName,
  reportDate,
  scannedEntries,
  onOpenPasteModal,
  onToggleCheckedDone,
  onAddBillToScanned,
  onReportUpdated,
  onOpenExportAllOnline,
  onConvertBillToOnline,
  onConvertAllOnlineConflicts,
}) => {
  const [activeTab, setActiveTab] = useState<'PENDING' | 'ONLINE'>('PENDING');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Manual Add Modal State
  const [isManualModalOpen, setIsManualModalOpen] = useState<boolean>(false);
  const [manualType, setManualType] = useState<'PENDING' | 'ONLINE'>('PENDING');
  const [manualConsNo, setManualConsNo] = useState<string>('');
  const [manualName, setManualName] = useState<string>('');
  const [manualAddress, setManualAddress] = useState<string>('');
  const [manualMemo, setManualMemo] = useState<string>('');
  const [manualOrder, setManualOrder] = useState<string>('');
  const [manualDate, setManualDate] = useState<string>(reportDate);
  const [manualRefillType, setManualRefillType] = useState<string>('PayNBook Apps');
  const [isSearchingDb, setIsSearchingDb] = useState<boolean>(false);
  const [isDbMatched, setIsDbMatched] = useState<boolean>(false);
  const [isSubmittingManual, setIsSubmittingManual] = useState<boolean>(false);

  const pendingBills = report?.pending_bills || [];
  const onlineBills = report?.online_bills || [];
  const isCheckedDone = report?.checked_done ?? false;

  // Collapsible Accordion State:
  // Starts expanded if pending bills exist, or collapsed if all clear/empty
  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    return (report?.pending_bills?.length ?? 0) > 0;
  });

  // Auto-expand if new pending bills arrive
  useEffect(() => {
    if (pendingBills.length > 0) {
      setIsExpanded(true);
    }
  }, [pendingBills.length]);

  // Auto-search 33k database when consumer number changes in manual modal
  useEffect(() => {
    let active = true;
    const clean = manualConsNo.trim();
    if (clean.length < 3) {
      setIsDbMatched(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearchingDb(true);
      try {
        const found = await matchConsumerWithDatabase(clean);
        if (!active) return;
        if (found && found.found) {
          setIsDbMatched(true);
          if (found.consumer_name && !manualName) {
            setManualName(found.consumer_name);
          }
          if (found.address) {
            setManualAddress(found.address);
          }
        } else {
          setIsDbMatched(false);
        }
      } catch (_) {
        if (active) setIsDbMatched(false);
      } finally {
        if (active) setIsSearchingDb(false);
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [manualConsNo, manualName]);

  // Set of scanned consumer numbers (for cross-checking payment conflicts)
  const scannedCashSet = new Set(
    scannedEntries
      .filter((e) => e.payment_mode === 'CASH')
      .map((e) => e.consumer_number.toLowerCase().trim())
  );
  const scannedAnySet = new Set(
    scannedEntries.map((e) => e.consumer_number.toLowerCase().trim())
  );

  const onlineCashConflicts = onlineBills.filter((b) =>
    scannedCashSet.has(b.consumer_number.toLowerCase().trim())
  );

  const activeBills = activeTab === 'PENDING' ? pendingBills : onlineBills;
  const filteredBills = activeBills.filter((b) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      b.consumer_number.toLowerCase().includes(q) ||
      b.consumer_name.toLowerCase().includes(q) ||
      (b.cash_memo && b.cash_memo.toLowerCase().includes(q)) ||
      (b.order_no && b.order_no.toLowerCase().includes(q))
    );
  });

  const handleCopySingle = (consNo: string) => {
    navigator.clipboard.writeText(consNo);
    setCopiedKey(consNo);
    toast.success(`Copied Cons No: ${consNo}`);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleCopyAllCsv = () => {
    const numbers = activeBills.map((b) => b.consumer_number).join(',');
    if (!numbers) {
      toast.error('No consumer numbers to copy');
      return;
    }
    navigator.clipboard.writeText(numbers);
    toast.success(`Copied ${activeBills.length} ${activeTab.toLowerCase()} consumer numbers!`);
  };

  // Delete a bill from the pending or online list
  const handleDeleteBill = async (bill: BpclBillItem) => {
    const confirmMsg = `Delete bill #${bill.consumer_number} (${bill.consumer_name || 'Consumer'}) from ${bill.type.toLowerCase()} bills?`;
    if (!window.confirm(confirmMsg)) return;

    try {
      const updated = await deleteBpclBill(
        reportDate,
        agentName,
        bill.consumer_number,
        bill.type,
        report?.agent_id
      );
      if (onReportUpdated) {
        onReportUpdated(updated);
      }
      toast.success(`Deleted #${bill.consumer_number} from ${bill.type.toLowerCase()} list`);
    } catch {
      toast.error('Failed to delete bill');
    }
  };

  // 1-Click "Delivered & Clear" for a Pending Bill:
  // Adds it to completed scanned deliveries and immediately removes it from pending bills!
  const handleDeliveredAndClear = async (bill: BpclBillItem) => {
    try {
      if (onAddBillToScanned) {
        onAddBillToScanned(bill);
      }
      const updated = await deleteBpclBill(
        reportDate,
        agentName,
        bill.consumer_number,
        'PENDING',
        report?.agent_id
      );
      if (onReportUpdated) {
        onReportUpdated(updated);
      }
      toast.success(`Cleared #${bill.consumer_number} & added to Completed Deliveries!`);
    } catch {
      toast.error('Failed to clear bill');
    }
  };

  // Submit Manual Add Form
  const handleSubmitManual = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCons = manualConsNo.trim();
    if (!cleanCons) {
      toast.error('Please enter a consumer number');
      return;
    }

    setIsSubmittingManual(true);
    try {
      const newBill: BpclBillItem = {
        consumer_number: cleanCons,
        consumer_name: manualName.trim() || 'Consumer',
        cash_memo: manualMemo.trim() || undefined,
        order_no: manualOrder.trim() || undefined,
        book_date: manualDate.trim() || reportDate,
        refill_type: manualType === 'ONLINE' ? (manualRefillType.trim() || 'PayNBook Apps') : undefined,
        status: manualType === 'PENDING' ? 'Delivery Pending' : 'Online Bill (Delivery Done)',
        type: manualType,
      };

      const updated = await addBpclBillManually(
        reportDate,
        agentName,
        newBill,
        report?.agent_id
      );

      if (onReportUpdated) {
        onReportUpdated(updated);
      }

      // Automatically convert scanned bill payment from CASH to Online (UPI) if present in Day End
      if (manualType === 'ONLINE' && onConvertBillToOnline) {
        onConvertBillToOnline(cleanCons);
      }

      toast.success(`Added #${cleanCons} to ${manualType.toLowerCase()} bills!`);
      // Reset form and close
      setManualConsNo('');
      setManualName('');
      setManualAddress('');
      setManualMemo('');
      setManualOrder('');
      setIsDbMatched(false);
      setIsManualModalOpen(false);
      setActiveTab(manualType);
    } catch (err) {
      console.error(err);
      toast.error('Failed to add bill manually');
    } finally {
      setIsSubmittingManual(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl p-3.5 shadow-sm border border-slate-200 space-y-3 transition-all">
      {/* Header Verification & Status Bar */}
      <div className="flex items-center justify-between gap-2 flex-wrap pb-2.5 border-b border-slate-100">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center font-bold shrink-0">
            <Sparkles className="w-4 h-4 text-purple-600" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="text-xs font-black uppercase text-slate-800 tracking-tight truncate">
                BPCL AI Verification
              </h3>
              {isCheckedDone ? (
                <span className="text-[10px] font-black bg-emerald-600 text-white px-2 py-0.5 rounded-full flex items-center gap-1 shadow-xs">
                  <CheckCircle2 className="w-3 h-3 text-white" /> Checked Done
                </span>
              ) : (
                <span className="text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 rounded-full">
                  ⚠️ Check Pending
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-500 truncate">
              {report?.updated_at 
                ? `Updated: ${new Date(report.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` 
                : 'No report loaded yet for today'}
            </p>
          </div>
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          <button
            type="button"
            onClick={onToggleCheckedDone}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-black flex items-center gap-1 transition-all active:scale-95 shadow-xs ${
              isCheckedDone
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20'
                : 'bg-slate-100 hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 border border-slate-200'
            }`}
            title="Click to toggle Bills Checked Done"
          >
            <CheckCircle2 className={`w-3.5 h-3.5 ${isCheckedDone ? 'text-white' : 'text-slate-400'}`} />
            <span>{isCheckedDone ? 'Checked Done' : 'Mark Done'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setManualType(activeTab);
              setIsManualModalOpen(true);
            }}
            className="px-2.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black flex items-center gap-1 shadow-sm active:scale-95 transition-all"
            title="Manually add a single pending or online bill"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">+ Add Bill</span>
          </button>

          <button
            type="button"
            onClick={onOpenPasteModal}
            className="px-2.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-black flex items-center gap-1 shadow-md shadow-purple-600/20 active:scale-95 transition-all"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{report ? 'Update' : '+ Paste'}</span>
          </button>

          {/* Collapsible Accordion Toggle */}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-black flex items-center gap-1 transition-all active:scale-95 border ${
              isExpanded
                ? 'bg-slate-800 text-white border-slate-700 shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-200'
            }`}
            title={isExpanded ? 'Collapse bill details' : 'Expand bill details'}
          >
            <span>{isExpanded ? 'Hide' : 'View'}</span>
            <span className="text-[10px] opacity-80">({pendingBills.length + onlineBills.length})</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Quick Summary Pill Bar (Always visible) */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => {
            setActiveTab('PENDING');
            setIsExpanded(true);
          }}
          className={`px-2.5 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 border transition-all ${
            pendingBills.length > 0
              ? 'bg-amber-100 hover:bg-amber-200 text-amber-900 border-amber-300 shadow-xs ring-1 ring-amber-300/50'
              : 'bg-slate-50 text-slate-500 border-slate-200'
          }`}
        >
          <Clock className="w-3.5 h-3.5 text-amber-600" />
          <span>Pending: <b>{pendingBills.length}</b></span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('ONLINE');
            setIsExpanded(true);
          }}
          className={`px-2.5 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 border transition-all ${
            onlineBills.length > 0
              ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border-indigo-200 shadow-xs'
              : 'bg-slate-50 text-slate-500 border-slate-200'
          }`}
        >
          <Globe className="w-3.5 h-3.5 text-indigo-600" />
          <span>Online (PayNBook): <b>{onlineBills.length}</b></span>
        </button>

        {!isExpanded && (
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="text-[11px] font-bold text-purple-600 hover:text-purple-700 ml-auto flex items-center gap-0.5"
          >
            <span>Tap to show details</span>
            <ChevronDown className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Accordion Body: Tabs, Filter & Bills List */}
      {isExpanded && (
        <div className="space-y-3 pt-1 border-t border-slate-100">
          {/* Sub Tabs: Pending Deliveries vs Online PayNBook */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('PENDING')}
              className={`flex-1 py-2 px-3 rounded-2xl font-black text-xs flex items-center justify-center gap-1.5 border transition-all ${
                activeTab === 'PENDING'
                  ? 'bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-500/20'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Pending Deliveries</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                activeTab === 'PENDING' ? 'bg-amber-900/40 text-amber-100' : 'bg-slate-200 text-slate-700'
              }`}>
                {pendingBills.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('ONLINE')}
              className={`flex-1 py-2 px-3 rounded-2xl font-black text-xs flex items-center justify-center gap-1.5 border transition-all ${
                activeTab === 'ONLINE'
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-600/20'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Online (PayNBook)</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                activeTab === 'ONLINE' ? 'bg-indigo-900/40 text-indigo-100' : 'bg-slate-200 text-slate-700'
              }`}>
                {onlineBills.length}
              </span>
            </button>
          </div>

          {/* Filter and Quick Copy Toolbar */}
          {activeBills.length > 0 && (
            <div className="flex items-center justify-between gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Search ${activeTab.toLowerCase()} by consumer or name...`}
                  className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-purple-500 font-medium text-slate-800 placeholder:text-slate-400"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleCopyAllCsv}
                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 rounded-xl text-[11px] font-bold flex items-center gap-1 transition-colors"
                  title="Copy numbers as CSV"
                >
                  <Copy className="w-3 h-3" />
                  <span>Copy CSV</span>
                </button>

                {onOpenExportAllOnline && (
                  <button
                    type="button"
                    onClick={onOpenExportAllOnline}
                    className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 rounded-xl text-[11px] font-black flex items-center gap-1 transition-colors"
                    title="Print or Export all delivery boys online bills"
                  >
                    <Printer className="w-3 h-3 text-indigo-600" />
                    <span>Print All</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Online Bills Scanned as CASH Conflict Banner */}
          {activeTab === 'ONLINE' && onlineCashConflicts.length > 0 && (
            <div className="mb-2.5 p-2.5 bg-gradient-to-r from-rose-500 via-rose-600 to-amber-600 text-white rounded-2xl flex items-center justify-between gap-2 shadow-sm border border-rose-300">
              <div className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0 animate-pulse" />
                <div className="min-w-0 text-xs">
                  <span className="font-black uppercase tracking-wide">
                    {onlineCashConflicts.length} Online Bill{onlineCashConflicts.length > 1 ? 's' : ''} Scanned as CASH
                  </span>
                  <p className="text-[10px] text-rose-100 truncate">
                    BPCL confirms these as PayNBook Online. Convert payment to Online (UPI)?
                  </p>
                </div>
              </div>
              {onConvertAllOnlineConflicts && (
                <button
                  type="button"
                  onClick={onConvertAllOnlineConflicts}
                  className="px-2.5 py-1 bg-white text-rose-900 hover:bg-emerald-50 hover:text-emerald-900 active:scale-95 rounded-xl font-black text-[10px] flex items-center gap-1 shadow-xs transition-all shrink-0"
                >
                  <Zap className="w-3 h-3 text-amber-500 fill-amber-500" />
                  <span>Convert All ({onlineCashConflicts.length})</span>
                </button>
              )}
            </div>
          )}

          {/* Bills Cards List */}
          <div className="space-y-2 max-h-96 overflow-y-auto overscroll-contain pr-0.5">
        {filteredBills.length === 0 ? (
          <div className="p-6 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 space-y-2">
            <p className="text-xs text-slate-500 font-medium">
              {activeBills.length === 0
                ? `No ${activeTab === 'PENDING' ? 'delivery pending' : 'online PayNBook'} bills recorded for this date.`
                : 'No bills match your search filter.'}
            </p>
            <div className="flex items-center justify-center gap-2 pt-1 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  setManualType(activeTab);
                  setIsManualModalOpen(true);
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-600 text-white font-bold text-xs shadow-sm hover:bg-blue-700 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Add {activeTab === 'PENDING' ? 'Pending' : 'Online'} Bill</span>
              </button>
              {activeBills.length === 0 && (
                <button
                  type="button"
                  onClick={onOpenPasteModal}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-purple-600 text-white font-bold text-xs shadow-sm hover:bg-purple-700 transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Paste Report</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          filteredBills.map((bill, index) => {
            const cleanConsNo = bill.consumer_number.toLowerCase().trim();
            const isScannedAsCash = scannedCashSet.has(cleanConsNo);
            const isScannedAny = scannedAnySet.has(cleanConsNo);

            return (
              <div
                key={`${bill.consumer_number}-${index}`}
                className={`p-3 rounded-2xl border transition-all text-left ${
                  activeTab === 'PENDING'
                    ? 'bg-amber-50/50 border-amber-200 hover:bg-amber-50'
                    : 'bg-indigo-50/50 border-indigo-200 hover:bg-indigo-50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono font-black text-slate-900 text-xs">
                        #{bill.consumer_number}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopySingle(bill.consumer_number)}
                        className="text-slate-400 hover:text-slate-700 p-0.5 rounded transition-colors"
                        title="Copy Consumer Number"
                      >
                        {copiedKey === bill.consumer_number ? (
                          <Check className="w-3 h-3 text-emerald-600" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>

                      <span
                        className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                          bill.type === 'PENDING'
                            ? 'bg-amber-200 text-amber-900 border border-amber-300'
                            : 'bg-indigo-200 text-indigo-900 border border-indigo-300'
                        }`}
                      >
                        {bill.status || (bill.type === 'PENDING' ? 'Pending' : 'Online PayNBook')}
                      </span>

                      {/* Scanned status indicator */}
                      {isScannedAny && (
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md flex items-center gap-0.5 ${
                            isScannedAsCash
                              ? 'bg-amber-100 text-amber-900 border border-amber-300'
                              : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          }`}
                        >
                          <CheckCircle2 className={`w-2.5 h-2.5 ${isScannedAsCash ? 'text-amber-600' : 'text-emerald-600'}`} />
                          <span>{isScannedAsCash ? 'Scanned (CASH)' : 'Scanned (Online)'}</span>
                        </span>
                      )}
                    </div>

                    <h4 className="font-bold text-xs text-slate-800 truncate mt-0.5">
                      {bill.consumer_name || 'Consumer Name Unknown'}
                    </h4>

                    {/* Metadata tags */}
                    <div className="flex items-center gap-2 mt-1 flex-wrap text-[10px] text-slate-500 font-mono">
                      {bill.cash_memo && (
                        <span>Memo: <b className="text-slate-700">{bill.cash_memo}</b></span>
                      )}
                      {bill.order_no && (
                        <span>Order: <b className="text-slate-700">{bill.order_no}</b></span>
                      )}
                      {bill.book_date && (
                        <span>Date: <b className="text-slate-700">{bill.book_date}</b></span>
                      )}
                      {bill.refill_type && (
                        <span className="text-indigo-600 font-bold">{bill.refill_type}</span>
                      )}
                    </div>

                    {/* Cross-check conflict alert for Online Bills:
                        If the bill was paid online via PayNBook, but the delivery boy collected CASH in day end! */}
                    {activeTab === 'ONLINE' && isScannedAsCash && (
                      <div className="mt-1.5 p-2 bg-gradient-to-r from-rose-50 to-amber-50 border border-rose-300 rounded-xl text-[10px] font-bold text-rose-900 flex items-center justify-between gap-2 flex-wrap shadow-xs">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0 animate-bounce" />
                          <span>
                            🚨 Scanned as <b>CASH</b>, but BPCL says <b>PayNBook Online</b>!
                          </span>
                        </div>
                        {onConvertBillToOnline && (
                          <button
                            type="button"
                            onClick={() => onConvertBillToOnline(bill.consumer_number)}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-lg font-black text-[10px] flex items-center gap-1 shadow-xs transition-all shrink-0 ml-auto"
                            title="Convert payment from CASH to Online (UPI) in Day End"
                          >
                            <Zap className="w-3 h-3 text-amber-300 fill-amber-300" />
                            <span>Convert to Online</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions Bar for Individual Bill */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Action for Pending: 1-Click Delivered & Clear */}
                    {activeTab === 'PENDING' && (
                      <button
                        type="button"
                        onClick={() => handleDeliveredAndClear(bill)}
                        className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10px] flex items-center gap-1 active:scale-95 transition-all shadow-xs"
                        title="Mark Delivered & Remove from Pending"
                      >
                        <CheckCheck className="w-3 h-3" />
                        <span>Delivered & Clear</span>
                      </button>
                    )}

                    {/* Delete / Remove Bill Button */}
                    <button
                      type="button"
                      onClick={() => handleDeleteBill(bill)}
                      className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-100 text-slate-400 hover:text-rose-600 border border-slate-200 hover:border-rose-300 transition-colors"
                      title="Delete this bill"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  )}

      {/* ========================================================================= */}
      {/* MANUAL ADD BILL MODAL (EASY MANUAL ENTRY WITH 33K DATABASE AUTO-MATCH)     */}
      {/* ========================================================================= */}
      {isManualModalOpen && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[110] flex items-center justify-center p-3 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col text-slate-100">
            {/* Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/90">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs border border-blue-500/30">
                  <Plus className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <h3 className="text-xs sm:text-sm font-black text-white uppercase tracking-tight">
                    Add Bill Manually
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    Add single pending or online bill for {agentName}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsManualModalOpen(false)}
                className="w-8 h-8 rounded-xl bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center hover:bg-slate-700 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmitManual} className="p-4 space-y-3.5 overflow-y-auto max-h-[75vh]">
              {/* Type Switcher */}
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Bill Category
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setManualType('PENDING')}
                    className={`py-2 px-3 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 border transition-all ${
                      manualType === 'PENDING'
                        ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md shadow-amber-500/20'
                        : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-750'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>⚠️ Delivery Pending</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setManualType('ONLINE')}
                    className={`py-2 px-3 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 border transition-all ${
                      manualType === 'ONLINE'
                        ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-600/20'
                        : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-750'
                    }`}
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>🌐 Online (PayNBook)</span>
                  </button>
                </div>
              </div>

              {/* Consumer Number Input with live 33k database indicator */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    Consumer Number *
                  </label>
                  {isSearchingDb ? (
                    <span className="text-[10px] text-blue-400 font-bold flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> Searching 33k DB...
                    </span>
                  ) : isDbMatched ? (
                    <span className="text-[10px] text-emerald-400 font-black flex items-center gap-0.5">
                      <UserCheck className="w-3 h-3" /> Auto-matched in Database!
                    </span>
                  ) : null}
                </div>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="e.g. 173 or 12384"
                  value={manualConsNo}
                  onChange={(e) => setManualConsNo(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-mono font-bold text-white placeholder:text-slate-600 focus:outline-none"
                />
              </div>

              {/* Customer Name */}
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Customer Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. B LALITHA"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-bold text-white placeholder:text-slate-600 focus:outline-none"
                />
                {manualAddress && (
                  <p className="text-[10px] text-slate-400 truncate mt-1">
                    📍 {manualAddress}
                  </p>
                )}
              </div>

              {/* Cash Memo & Order No */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Cash Memo No
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 115694"
                    value={manualMemo}
                    onChange={(e) => setManualMemo(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-mono font-bold text-white placeholder:text-slate-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Order No
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 104110"
                    value={manualOrder}
                    onChange={(e) => setManualOrder(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-mono font-bold text-white placeholder:text-slate-600 focus:outline-none"
                  />
                </div>
              </div>

              {/* Book Date & Refill Type */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Book Date
                  </label>
                  <input
                    type="text"
                    placeholder="DD/MM/YYYY"
                    value={manualDate}
                    onChange={(e) => setManualDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-mono font-bold text-white placeholder:text-slate-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Refill Type
                  </label>
                  <input
                    type="text"
                    placeholder="PayNBook Apps"
                    value={manualRefillType}
                    onChange={(e) => setManualRefillType(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-xs font-bold text-white placeholder:text-slate-600 focus:outline-none"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsManualModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 font-bold text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingManual || !manualConsNo.trim()}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-black text-xs shadow-md shadow-blue-600/30 flex items-center justify-center gap-1.5 transition-all"
                >
                  {isSubmittingManual ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4 stroke-[3]" />
                  )}
                  <span>Add to {manualType === 'PENDING' ? 'Pending' : 'Online'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
