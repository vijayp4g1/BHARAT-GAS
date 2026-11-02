import React, { useState } from 'react';
import { 
  X, 
  Printer, 
  Copy, 
  Check, 
  FileSpreadsheet, 
  Globe, 
  Layers, 
  Users, 
  Calendar,
  Sparkles
} from 'lucide-react';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import type { BpclBillItem, BpclReportData } from '../lib/bpclReportService';
import type { DeliveryBoy } from '../lib/agentService';

export interface OnlineBillEntry extends BpclBillItem {
  deliveryBoy: string;
  deliveryBoySerial: number;
}

interface ExportOnlineBillsModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportDate: string;
  deliveryBoys: DeliveryBoy[];
  bpclReportsMap: Record<string, BpclReportData>;
}

export const ExportOnlineBillsModal: React.FC<ExportOnlineBillsModalProps> = ({
  isOpen,
  onClose,
  reportDate,
  deliveryBoys,
  bpclReportsMap,
}) => {
  const [viewMode, setViewMode] = useState<'ALL' | 'GROUPED'>('ALL');
  const [copiedCsv, setCopiedCsv] = useState<boolean>(false);
  const [filterBoy, setFilterBoy] = useState<string>('ALL');

  if (!isOpen) return null;

  // Gather ALL online bills across all delivery boys for this date
  const allOnlineBills: OnlineBillEntry[] = [];
  const boyBreakdown: Record<string, { count: number; serial: number }> = {};

  deliveryBoys.forEach((boy, idx) => {
    const norm = boy.name.trim().toUpperCase();
    const rep = bpclReportsMap[norm];
    const onlineList = rep?.online_bills || [];

    if (onlineList.length > 0) {
      boyBreakdown[boy.name] = { count: onlineList.length, serial: idx + 1 };
      onlineList.forEach((bill) => {
        allOnlineBills.push({
          ...bill,
          deliveryBoy: boy.name,
          deliveryBoySerial: idx + 1,
        });
      });
    }
  });

  const displayedBills = filterBoy === 'ALL'
    ? allOnlineBills
    : allOnlineBills.filter((b) => b.deliveryBoy.trim().toUpperCase() === filterBoy.trim().toUpperCase());

  // Date formatted as DD/MM/YYYY
  const [year, month, day] = reportDate.split('-');
  const formattedDate = `${day}/${month}/${year}`;

  // Print Xerox sheet
  const handlePrint = () => {
    window.print();
  };

  // Copy CSV of all consumer numbers
  const handleCopyCsvNumbers = async () => {
    if (displayedBills.length === 0) {
      toast.error('No online bills to copy');
      return;
    }
    const csv = displayedBills.map((b) => b.consumer_number).join(',');
    await navigator.clipboard.writeText(csv);
    setCopiedCsv(true);
    toast.success(`Copied ${displayedBills.length} online consumer numbers!`);
    setTimeout(() => setCopiedCsv(false), 2000);
  };

  // Export to Excel (.xlsx)
  const handleExportExcel = () => {
    if (displayedBills.length === 0) {
      toast.error('No online bills to export');
      return;
    }

    const rows = displayedBills.map((b, index) => ({
      'S.No': index + 1,
      'Consumer No': b.consumer_number,
      'Customer Name': b.consumer_name,
      'Delivery Boy': b.deliveryBoy,
      'Cash Memo': b.cash_memo || '-',
      'Order No': b.order_no || '-',
      'Book Date': b.book_date || formattedDate,
      'Refill Type': b.refill_type || 'PayNBook Apps',
      'Status': b.status || 'Online Bill (Delivery Done)',
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Online Bills');

    // Set column widths
    worksheet['!cols'] = [
      { wch: 6 },
      { wch: 16 },
      { wch: 30 },
      { wch: 18 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 16 },
      { wch: 25 },
    ];

    XLSX.writeFile(workbook, `BharatGas_Online_Bills_${reportDate}.xlsx`);
    toast.success('Downloaded Excel spreadsheet!');
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[120] flex items-center justify-center p-2 sm:p-4 overflow-y-auto print:p-0 print:bg-white print:static print:z-auto">
      {/* Container Card */}
      <div className="bg-slate-900 border border-slate-700 w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden flex flex-col text-slate-100 max-h-[92vh] my-auto print:max-h-none print:shadow-none print:border-none print:bg-white print:text-black print:rounded-none">
        
        {/* ========================================================================= */}
        {/* NON-PRINT HEADER & ACTION CONTROLS (HIDDEN DURING PRINT)                  */}
        {/* ========================================================================= */}
        <div className="p-3.5 sm:p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/95 gap-2 shrink-0 print:hidden">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-xs border border-indigo-500/30 shrink-0">
              <Globe className="w-5 h-5 text-indigo-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-black text-white uppercase tracking-tight flex items-center gap-2">
                <span>Export All Online Bills</span>
                <span className="bg-indigo-600 text-white text-[11px] font-black px-2 py-0.5 rounded-full">
                  {allOnlineBills.length} Bills Total
                </span>
              </h2>
              <p className="text-[11px] text-slate-400 truncate">
                Print Xerox submission sheet or export Excel for BPCL office
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
            {/* Primary Action: Print Xerox */}
            <button
              type="button"
              onClick={handlePrint}
              disabled={allOnlineBills.length === 0}
              className="bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-950 font-black px-3.5 py-2 rounded-xl text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-500/30 transition-all disabled:opacity-40"
              title="Print Xerox Paper Copy (Ctrl+P)"
            >
              <Printer className="w-4 h-4 text-slate-950" />
              <span>Print Xerox</span>
            </button>

            {/* Excel Download */}
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={allOnlineBills.length === 0}
              className="bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-bold px-3 py-2 rounded-xl text-xs flex items-center gap-1.5 shadow-md shadow-blue-600/30 transition-all disabled:opacity-40"
              title="Download Excel Sheet (.xlsx)"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span className="hidden sm:inline">Excel</span>
            </button>

            {/* Copy CSV Numbers */}
            <button
              type="button"
              onClick={handleCopyCsvNumbers}
              disabled={allOnlineBills.length === 0}
              className="bg-white/10 hover:bg-white/20 active:scale-95 text-white font-bold px-3 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-all border border-white/10"
              title="Copy CSV Numbers to clipboard"
            >
              {copiedCsv ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              <span className="hidden sm:inline">CSV</span>
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-xl bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center hover:bg-slate-700 transition-colors ml-1"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filter Strip (Hidden on Print) */}
        <div className="p-2.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-2 flex-wrap text-xs print:hidden">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-bold text-slate-400 uppercase">Delivery Boy:</span>
            <button
              type="button"
              onClick={() => setFilterBoy('ALL')}
              className={`px-2.5 py-1 rounded-lg font-bold text-xs transition-all ${
                filterBoy === 'ALL'
                  ? 'bg-indigo-600 text-white font-black'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-750'
              }`}
            >
              All Boys ({allOnlineBills.length})
            </button>
            {Object.entries(boyBreakdown).map(([boyName, data]) => (
              <button
                key={boyName}
                type="button"
                onClick={() => setFilterBoy(boyName)}
                className={`px-2 py-1 rounded-lg font-bold text-xs transition-all ${
                  filterBoy === boyName
                    ? 'bg-amber-400 text-slate-950 font-black'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-750'
                }`}
              >
                #{data.serial} {boyName} ({data.count})
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-400">
            <span>Layout:</span>
            <button
              type="button"
              onClick={() => setViewMode(viewMode === 'ALL' ? 'GROUPED' : 'ALL')}
              className="bg-slate-800 hover:bg-slate-750 text-slate-200 px-2 py-1 rounded-lg border border-slate-700"
            >
              {viewMode === 'ALL' ? 'Single Master Table' : 'Grouped by Boy'}
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* PRINTABLE XEROX SHEET CONTAINER                                          */}
        {/* ========================================================================= */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 bg-white text-slate-950 print:p-0 print:overflow-visible font-sans">
          
          {/* Official Agency Letterhead Header */}
          <div className="border-b-2 border-black pb-3 mb-4 text-center">
            <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-black">
              BHARAT GAS CONSUMER LOCATION
            </h1>
            <h2 className="text-sm sm:text-base font-extrabold uppercase tracking-wide text-slate-800 mt-0.5">
              DAILY ONLINE BILLS (PAYNBOOK APPS) SUBMISSION REPORT
            </h2>
            <div className="flex items-center justify-between text-xs font-bold text-slate-700 mt-2 px-1 border-t border-slate-300 pt-1.5 flex-wrap gap-2">
              <span>📅 <b>DATE:</b> {formattedDate}</span>
              <span>🏢 <b>BPCL REFILL TYPE:</b> PayNBook Apps (Online Paid)</span>
              <span>📊 <b>TOTAL ONLINE BILLS:</b> <b className="text-black text-sm">{displayedBills.length}</b></span>
            </div>
          </div>

          {/* Delivery Boy Summary Pill Box */}
          <div className="mb-4 p-2.5 bg-slate-100 rounded-xl border border-slate-300 print:bg-slate-50 print:border-slate-400 text-xs">
            <span className="font-black text-slate-900 block mb-1 uppercase tracking-wider text-[11px]">
              DELIVERY BOYS SUMMARY BREAKDOWN:
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              {Object.entries(boyBreakdown).map(([bName, data]) => (
                <span
                  key={bName}
                  className="bg-white border border-slate-400 text-slate-900 px-2 py-0.5 rounded-md font-bold text-xs"
                >
                  #{data.serial} <b>{bName}:</b> {data.count} Bills
                </span>
              ))}
              <span className="bg-black text-white px-2.5 py-0.5 rounded-md font-black text-xs ml-auto">
                GRAND TOTAL: {allOnlineBills.length} BILLS
              </span>
            </div>
          </div>

          {/* Master Table of Bills */}
          {displayedBills.length === 0 ? (
            <div className="py-12 text-center text-slate-500 font-semibold text-sm">
              No online bills recorded for any delivery boy on {formattedDate}.
            </div>
          ) : viewMode === 'ALL' || filterBoy !== 'ALL' ? (
            <div className="border border-black rounded-lg overflow-hidden mb-6">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-200 border-b-2 border-black text-black uppercase font-black tracking-wider text-[11px]">
                    <th className="py-2 px-2.5 border-r border-slate-400 w-12 text-center">S.No</th>
                    <th className="py-2 px-3 border-r border-slate-400 font-mono text-sm w-36">Consumer No</th>
                    <th className="py-2 px-3 border-r border-slate-400">Customer Name</th>
                    <th className="py-2 px-3 border-r border-slate-400 w-32">Delivery Boy</th>
                    <th className="py-2 px-2.5 border-r border-slate-400 font-mono w-24">Cash Memo</th>
                    <th className="py-2 px-2.5 font-mono w-24">Order No</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-300">
                  {displayedBills.map((bill, index) => (
                    <tr
                      key={`${bill.consumer_number}-${index}`}
                      className="hover:bg-slate-50 print:hover:bg-transparent"
                    >
                      <td className="py-1.5 px-2.5 border-r border-slate-300 text-center font-black text-slate-700">
                        {index + 1}
                      </td>
                      <td className="py-1.5 px-3 border-r border-slate-300 font-mono font-black text-slate-950 text-sm">
                        #{bill.consumer_number}
                      </td>
                      <td className="py-1.5 px-3 border-r border-slate-300 font-bold text-slate-900 uppercase">
                        {bill.consumer_name || 'Consumer'}
                      </td>
                      <td className="py-1.5 px-3 border-r border-slate-300 font-black text-slate-800 uppercase">
                        #{bill.deliveryBoySerial} {bill.deliveryBoy}
                      </td>
                      <td className="py-1.5 px-2.5 border-r border-slate-300 font-mono text-slate-700">
                        {bill.cash_memo || '-'}
                      </td>
                      <td className="py-1.5 px-2.5 font-mono text-slate-700">
                        {bill.order_no || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-200 border-t-2 border-black font-black text-slate-950 text-xs">
                    <td colSpan={2} className="py-2 px-3 border-r border-slate-400">
                      TOTAL: {displayedBills.length} ONLINE BILLS
                    </td>
                    <td colSpan={4} className="py-2 px-3 text-right">
                      Verified for BPCL PayNBook Submission
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            // Grouped by Delivery Boy Sections
            <div className="space-y-4 mb-6">
              {Object.keys(boyBreakdown).map((boyName) => {
                const boyBills = allOnlineBills.filter(
                  (b) => b.deliveryBoy.trim().toUpperCase() === boyName.trim().toUpperCase()
                );
                if (boyBills.length === 0) return null;

                return (
                  <div key={boyName} className="border border-black rounded-lg overflow-hidden">
                    <div className="bg-slate-800 text-white p-2 flex items-center justify-between text-xs font-black print:bg-slate-200 print:text-black print:border-b print:border-black">
                      <span className="uppercase tracking-wide">
                        DELIVERY BOY: #{boyBreakdown[boyName].serial} {boyName}
                      </span>
                      <span>{boyBills.length} Online Bills</span>
                    </div>
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-100 border-b border-black text-black uppercase font-bold text-[10px]">
                          <th className="py-1.5 px-2.5 border-r border-slate-300 w-10 text-center">S.No</th>
                          <th className="py-1.5 px-3 border-r border-slate-300 font-mono text-xs w-36">Consumer No</th>
                          <th className="py-1.5 px-3 border-r border-slate-300">Customer Name</th>
                          <th className="py-1.5 px-2.5 border-r border-slate-300 font-mono w-24">Cash Memo</th>
                          <th className="py-1.5 px-2.5 font-mono w-24">Order No</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-300">
                        {boyBills.map((bill, index) => (
                          <tr key={`${bill.consumer_number}-${index}`}>
                            <td className="py-1 px-2.5 border-r border-slate-300 text-center font-bold text-slate-600">
                              {index + 1}
                            </td>
                            <td className="py-1 px-3 border-r border-slate-300 font-mono font-black text-slate-950 text-xs">
                              #{bill.consumer_number}
                            </td>
                            <td className="py-1 px-3 border-r border-slate-300 font-bold text-slate-900 uppercase">
                              {bill.consumer_name || 'Consumer'}
                            </td>
                            <td className="py-1 px-2.5 border-r border-slate-300 font-mono text-slate-700">
                              {bill.cash_memo || '-'}
                            </td>
                            <td className="py-1 px-2.5 font-mono text-slate-700">
                              {bill.order_no || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}

          {/* Official Signatures Section for Office / Xerox Submission */}
          <div className="mt-8 pt-4 border-t-2 border-black grid grid-cols-3 gap-4 text-center text-xs">
            <div>
              <p className="font-bold text-slate-800 mb-8">Prepared By (Staff):</p>
              <div className="border-t border-dotted border-black pt-1">
                <span className="font-mono text-[10px] text-slate-600">Signature & Date</span>
              </div>
            </div>
            <div>
              <p className="font-bold text-slate-800 mb-8">Verified By (Manager):</p>
              <div className="border-t border-dotted border-black pt-1">
                <span className="font-mono text-[10px] text-slate-600">Signature & Seal</span>
              </div>
            </div>
            <div>
              <p className="font-bold text-slate-800 mb-8">Submitted To (BPCL Office):</p>
              <div className="border-t border-dotted border-black pt-1">
                <span className="font-mono text-[10px] text-slate-600">Officer Signature & Stamp</span>
              </div>
            </div>
          </div>

          {/* Bottom Generation Timestamp */}
          <div className="mt-6 text-[10px] text-slate-500 flex items-center justify-between border-t border-slate-200 pt-2 font-mono">
            <span>Bharat Gas Consumer Location (BGCLS) System</span>
            <span>Printed / Generated: {new Date().toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
