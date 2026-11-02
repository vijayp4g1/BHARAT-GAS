import React, { useState } from 'react';
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
  FileText 
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { BpclBillItem, BpclReportData } from '../lib/bpclReportService';
import type { DayEndEntry } from '../lib/dayEndService';

interface BpclBillsViewProps {
  report: BpclReportData | null;
  agentName: string;
  reportDate: string;
  scannedEntries: DayEndEntry[];
  onOpenPasteModal: () => void;
  onToggleCheckedDone: () => void;
  onAddBillToScanned?: (bill: BpclBillItem) => void;
}

export const BpclBillsView: React.FC<BpclBillsViewProps> = ({
  report,
  agentName,
  reportDate,
  scannedEntries,
  onOpenPasteModal,
  onToggleCheckedDone,
  onAddBillToScanned,
}) => {
  const [activeTab, setActiveTab] = useState<'PENDING' | 'ONLINE'>('PENDING');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const pendingBills = report?.pending_bills || [];
  const onlineBills = report?.online_bills || [];
  const isCheckedDone = report?.checked_done ?? false;

  // Set of scanned consumer numbers (for cross-checking payment conflicts)
  const scannedCashSet = new Set(
    scannedEntries
      .filter((e) => e.payment_mode === 'CASH')
      .map((e) => e.consumer_number.toLowerCase().trim())
  );
  const scannedAnySet = new Set(
    scannedEntries.map((e) => e.consumer_number.toLowerCase().trim())
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

  return (
    <div className="bg-white rounded-3xl p-4 shadow-sm border border-slate-200 space-y-3.5">
      {/* Header Verification & Status Bar */}
      <div className="flex items-center justify-between gap-2 flex-wrap pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center font-bold">
            <Sparkles className="w-4 h-4 text-purple-600" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="text-xs font-black uppercase text-slate-800 tracking-tight">
                BPCL AI Verification Status
              </h3>
              {isCheckedDone ? (
                <span className="text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Bills Checked Done
                </span>
              ) : (
                <span className="text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 rounded-full">
                  ⚠️ Check Pending
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-500">
              {report?.updated_at 
                ? `Last updated: ${new Date(report.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` 
                : 'No report loaded yet for today'}
            </p>
          </div>
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
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
            onClick={onOpenPasteModal}
            className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-black flex items-center gap-1 shadow-md shadow-purple-600/20 active:scale-95 transition-all"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{report ? 'Update Report' : '+ Paste Report'}</span>
          </button>
        </div>
      </div>

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

          <button
            type="button"
            onClick={handleCopyAllCsv}
            className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 rounded-xl text-[11px] font-bold flex items-center gap-1 shrink-0 transition-colors"
            title="Copy numbers as CSV"
          >
            <Copy className="w-3 h-3" />
            <span>Copy CSV</span>
          </button>
        </div>
      )}

      {/* Bills Cards List */}
      <div className="space-y-2 max-h-96 overflow-y-auto pr-0.5">
        {filteredBills.length === 0 ? (
          <div className="p-6 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 space-y-2">
            <p className="text-xs text-slate-500 font-medium">
              {activeBills.length === 0
                ? `No ${activeTab === 'PENDING' ? 'delivery pending' : 'online PayNBook'} bills recorded for this date.`
                : 'No bills match your search filter.'}
            </p>
            {activeBills.length === 0 && (
              <button
                type="button"
                onClick={onOpenPasteModal}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-purple-600 text-white font-bold text-xs shadow-sm hover:bg-purple-700 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Paste BPCL Status Report</span>
              </button>
            )}
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
                        <span className="text-[9px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 px-1.5 py-0.5 rounded-md flex items-center gap-0.5">
                          <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" /> Scanned
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
                      <div className="mt-1.5 p-1.5 bg-rose-100 border border-rose-300 rounded-lg text-[10px] font-bold text-rose-800 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0 animate-bounce" />
                        <span>
                          🚨 Conflict: Scanned as <b>CASH</b> in Day End, but BPCL says <b>PayNBook Online</b>!
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Action for Pending: 1-click Add to Scanned Deliveries */}
                  {activeTab === 'PENDING' && onAddBillToScanned && (
                    <button
                      type="button"
                      onClick={() => onAddBillToScanned(bill)}
                      className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] flex items-center gap-1 active:scale-95 transition-all shadow-xs shrink-0"
                      title="Add to scanned bills if delivered"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add Bill</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

