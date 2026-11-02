import React, { useState } from 'react';
import { 
  X, 
  FileText, 
  CheckCircle2, 
  Sparkles, 
  Clock, 
  Globe, 
  AlertTriangle, 
  Clipboard, 
  Trash2, 
  Check, 
  Loader2 
} from 'lucide-react';
import toast from 'react-hot-toast';
import { 
  parseBpclReportText, 
  saveBpclReportToCloud, 
  type BpclBillItem, 
  type BpclReportData 
} from '../lib/bpclReportService';

interface BpclReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  agentName: string;
  agentId?: string;
  reportDate: string;
  existingReport?: BpclReportData | null;
  onSaved: (report: BpclReportData) => void;
}

export const BpclReportModal: React.FC<BpclReportModalProps> = ({
  isOpen,
  onClose,
  agentName,
  agentId,
  reportDate,
  existingReport,
  onSaved,
}) => {
  const [rawText, setRawText] = useState<string>(existingReport?.raw_text || '');
  const [markCheckedDone, setMarkCheckedDone] = useState<boolean>(
    existingReport?.checked_done ?? true
  );
  const [isSaving, setIsSaving] = useState<boolean>(false);

  if (!isOpen) return null;

  // Real-time preview parse
  const parsed = parseBpclReportText(rawText);
  const pendingCount = parsed.pendingBills.length;
  const onlineCount = parsed.onlineBills.length;
  const totalCount = pendingCount + onlineCount;

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setRawText(text);
        toast.success('Pasted from clipboard!');
      } else {
        toast.error('Clipboard is empty');
      }
    } catch {
      toast.error('Please paste manually into the text box');
    }
  };

  const handleSave = async () => {
    if (!rawText.trim() && totalCount === 0) {
      toast.error('Please paste the BPCL Status Report text first');
      return;
    }

    setIsSaving(true);
    try {
      const success = await saveBpclReportToCloud({
        dateStr: reportDate,
        agentName,
        agentId,
        checked_done: markCheckedDone,
        pending_bills: parsed.pendingBills,
        online_bills: parsed.onlineBills,
        raw_text: rawText,
      });

      if (success) {
        toast.success(
          `Imported ${pendingCount} Pending & ${onlineCount} Online bills for ${agentName}!`
        );
        onSaved({
          agent_name: agentName,
          agent_id: agentId,
          report_date: reportDate,
          checked_done: markCheckedDone,
          pending_bills: parsed.pendingBills,
          online_bills: parsed.onlineBills,
          raw_text: rawText,
          updated_at: new Date().toISOString(),
        });
        onClose();
      } else {
        toast.error('Failed to save to cloud. Saved locally.');
      }
    } catch (e) {
      console.error(e);
      toast.error('Failed to save BPCL report');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[100] flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh] my-auto">
        {/* Modal Header */}
        <div className="p-3.5 sm:p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/90 gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold text-xs border border-purple-500/30 shrink-0">
              <Sparkles className="w-4 h-4 text-purple-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h3 className="text-xs sm:text-sm font-black text-white uppercase tracking-tight">
                  BPCL AI Status Report
                </h3>
                <span className="text-[10px] bg-purple-500/20 text-purple-300 font-bold px-1.5 py-0.5 rounded-md border border-purple-500/30 truncate max-w-[120px]">
                  {agentName}
                </span>
              </div>
              <p className="text-[10px] text-slate-400 truncate">
                Extracts Pending & Online bills for {agentName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Quick Top Save Button */}
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || (!rawText.trim() && totalCount === 0)}
              className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-950 font-black text-xs flex items-center gap-1 shadow-md shadow-emerald-500/30 disabled:opacity-40 transition-all"
            >
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              <span>Save</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-xl bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center hover:bg-slate-700 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-4 overflow-y-auto space-y-3.5 flex-1 text-slate-200 text-xs">
          {/* Quick Paste & Clear Bar */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Paste Report Text
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handlePasteFromClipboard}
                className="px-2.5 py-1 rounded-lg bg-blue-600/30 hover:bg-blue-600/50 border border-blue-500/40 text-blue-300 text-[11px] font-bold flex items-center gap-1 active:scale-95 transition-all"
              >
                <Clipboard className="w-3 h-3" /> Paste Clipboard
              </button>
              {rawText && (
                <button
                  type="button"
                  onClick={() => setRawText('')}
                  className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-rose-900/40 border border-slate-700 hover:border-rose-500/40 text-slate-400 hover:text-rose-300 text-[11px] font-bold transition-all"
                  title="Clear text"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Text Area */}
          <div className="relative">
            <textarea
              rows={8}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={`*BPCL Status Report: Delivery Pending*\n*Consumer No:* 173\n*Customer Name:* B LALITHA\nCash Memo: 115694\n\n*BPCL Status Report: Online Bills (PayNBook)*\n*Consumer No:* 12384\n*Customer Name:* B VENKATA RAMANA\nCash Memo: 116116...`}
              className="w-full bg-slate-950/80 border border-slate-700 rounded-2xl p-3 text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all leading-relaxed resize-none"
            />
          </div>

          {/* Live Extraction Metric Badges */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-amber-950/30 border border-amber-500/30 rounded-2xl p-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400" />
                <div>
                  <span className="text-[10px] uppercase font-bold text-amber-300/80 block">
                    Delivery Pending
                  </span>
                  <span className="text-base font-black text-amber-200">
                    {pendingCount} Bills
                  </span>
                </div>
              </div>
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                pendingCount > 0 ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-500'
              }`}>
                {pendingCount}
              </span>
            </div>

            <div className="bg-indigo-950/30 border border-indigo-500/30 rounded-2xl p-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-indigo-400" />
                <div>
                  <span className="text-[10px] uppercase font-bold text-indigo-300/80 block">
                    Online (PayNBook)
                  </span>
                  <span className="text-base font-black text-indigo-200">
                    {onlineCount} Bills
                  </span>
                </div>
              </div>
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                onlineCount > 0 ? 'bg-indigo-400 text-slate-950' : 'bg-slate-800 text-slate-500'
              }`}>
                {onlineCount}
              </span>
            </div>
          </div>

          {/* Checked Done Toggle Option */}
          <div 
            onClick={() => setMarkCheckedDone(!markCheckedDone)}
            className="cursor-pointer bg-slate-950/60 border border-slate-800 hover:border-emerald-500/40 rounded-2xl p-3 flex items-center justify-between transition-all"
          >
            <div className="flex items-center gap-2.5">
              <div className={`w-6 h-6 rounded-lg flex items-center justify-center transition-colors ${
                markCheckedDone ? 'bg-emerald-500 text-slate-950 font-black' : 'border border-slate-700 bg-slate-900 text-transparent'
              }`}>
                <Check className="w-4 h-4 stroke-[3]" />
              </div>
              <div>
                <span className="text-xs font-bold text-white block">
                  Mark as "Bills Checked Done"
                </span>
                <span className="text-[10px] text-slate-400">
                  Shows the green "Bills Checked Done" badge on the roster for {agentName}
                </span>
              </div>
            </div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg uppercase ${
              markCheckedDone ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800 text-slate-500'
            }`}>
              {markCheckedDone ? 'Checked Done' : 'Pending'}
            </span>
          </div>

          {/* Direct Save Button inside form body */}
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || (!rawText.trim() && totalCount === 0)}
            className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 hover:from-purple-500 hover:to-indigo-500 active:scale-98 text-white font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-purple-600/30 disabled:opacity-40 transition-all border border-purple-400/30"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Saving to Database...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                <span>Save Report Now ({totalCount} Bills Detected)</span>
              </>
            )}
          </button>
        </div>

        {/* Modal Footer (Sticky, always visible above everything) */}
        <div className="p-3.5 sm:p-4 border-t border-slate-800 bg-slate-950 flex items-center justify-between gap-2 shrink-0 shadow-[0_-4px_20px_rgba(0,0,0,0.5)]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors shrink-0"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || (!rawText.trim() && totalCount === 0)}
            className="flex-1 py-3 px-4 rounded-2xl bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 hover:from-emerald-400 hover:to-teal-400 active:scale-98 text-slate-950 font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-xl shadow-emerald-500/25 border-2 border-emerald-300 disabled:opacity-40 disabled:border-transparent transition-all"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                <span>Saving Report to Database...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 text-slate-950" />
                <span>SAVE REPORT & MARK DONE ({totalCount} Bills)</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

