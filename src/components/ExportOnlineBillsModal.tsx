import React, { useState } from 'react';
import { 
  X, 
  Printer, 
  Copy, 
  Check, 
  FileSpreadsheet, 
  Globe
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
  const [viewMode, setViewMode] = useState<'ALL' | 'TWO_COL' | 'GROUPED'>('ALL');
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
    const originalTitle = document.title;
    document.title = `Siddhartha Bharat Gas - Online Bills (${formattedDate})`;
    window.print();
    setTimeout(() => {
      document.title = originalTitle;
    }, 1000);
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

  // Export to Excel (.xlsx) - Multi-sheet, beautifully formatted & professional
  const handleExportExcel = () => {
    if (displayedBills.length === 0) {
      toast.error('No online bills to export');
      return;
    }

    const workbook = XLSX.utils.book_new();
    const totalBillsCount = displayedBills.length;

    // -------------------------------------------------------------
    // SHEET 1: OFFICIAL SUBMISSION REPORT
    // -------------------------------------------------------------
    const sheet1Rows: any[][] = [
      ['SIDDHARTHA BHARAT GAS'],
      ['DAILY ONLINE BILLS (PAYNBOOK APPS) SUBMISSION REPORT'],
      [],
      ['Report Date:', formattedDate, 'Refill Type:', 'PayNBook Apps (Online Paid)', '', 'Total Online Bills:', totalBillsCount],
      [],
      ['DELIVERY BOYS SUMMARY BREAKDOWN'],
      ['S.No', 'Delivery Boy Name', 'Online Bills Count', 'Share %'],
    ];

    let boyIndex = 1;
    Object.entries(boyBreakdown).forEach(([boyName, data]) => {
      const pct = totalBillsCount > 0 ? ((data.count / totalBillsCount) * 100).toFixed(1) + '%' : '0%';
      sheet1Rows.push([
        boyIndex++,
        `#${data.serial} ${boyName}`,
        data.count,
        pct,
      ]);
    });

    sheet1Rows.push([
      'TOTAL',
      `${Object.keys(boyBreakdown).length} Delivery Boys`,
      totalBillsCount,
      '100.0%',
    ]);

    sheet1Rows.push([]);
    sheet1Rows.push(['DETAILED ONLINE BILLS SUBMISSION LIST']);
    sheet1Rows.push([
      'S.No',
      'Consumer Number',
      'Customer Name',
      'Delivery Boy',
      'Cash Memo No',
      'Order Number',
      'Book Date',
      'Refill Type',
      'Status',
    ]);

    displayedBills.forEach((b, index) => {
      sheet1Rows.push([
        index + 1,
        { t: 's', v: String(b.consumer_number || '') }, // explicitly string so Excel doesn't do scientific notation
        String(b.consumer_name || 'Consumer').toUpperCase(),
        `#${b.deliveryBoySerial} ${b.deliveryBoy}`,
        { t: 's', v: String(b.cash_memo || '-') },
        { t: 's', v: String(b.order_no || '-') },
        b.book_date || formattedDate,
        b.refill_type || 'PayNBook Apps',
        b.status || 'Online Bill (Delivery Done)',
      ]);
    });

    sheet1Rows.push([
      'TOTAL',
      `${totalBillsCount} Bills Verified`,
      '',
      '',
      '',
      '',
      '',
      '',
      'Verified for BPCL PayNBook Submission',
    ]);

    sheet1Rows.push([]);
    sheet1Rows.push([]);
    sheet1Rows.push(['OFFICIAL VERIFICATION & SIGNATURES']);
    sheet1Rows.push([
      'Prepared By (Staff):',
      '',
      'Verified By (Manager):',
      '',
      'Submitted To (BPCL Office):',
      '',
    ]);
    sheet1Rows.push([
      '__________________________',
      '',
      '__________________________',
      '',
      '__________________________',
      '',
    ]);
    sheet1Rows.push([
      'Signature & Date',
      '',
      'Signature & Seal',
      '',
      'Officer Stamp & Signature',
      '',
    ]);
    sheet1Rows.push([]);
    sheet1Rows.push([`Generated on: ${new Date().toLocaleString()} | Siddhartha Bharat Gas (BGCLS) System`]);

    const ws1 = XLSX.utils.aoa_to_sheet(sheet1Rows);

    const detailedHeaderRowIndex = 7 + Object.keys(boyBreakdown).length + 2;
    ws1['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }, // Title
      { s: { r: 1, c: 0 }, e: { r: 1, c: 8 } }, // Subtitle
      { s: { r: 5, c: 0 }, e: { r: 5, c: 3 } }, // Breakdown Title
      { s: { r: detailedHeaderRowIndex, c: 0 }, e: { r: detailedHeaderRowIndex, c: 8 } }, // Detailed list title
      { s: { r: sheet1Rows.length - 1, c: 0 }, e: { r: sheet1Rows.length - 1, c: 8 } }, // Footer
    ];

    ws1['!cols'] = [
      { wch: 7 },   // S.No
      { wch: 18 },  // Consumer No
      { wch: 34 },  // Customer Name
      { wch: 20 },  // Delivery Boy
      { wch: 15 },  // Cash Memo
      { wch: 15 },  // Order No
      { wch: 14 },  // Book Date
      { wch: 18 },  // Refill Type
      { wch: 30 },  // Status
    ];

    XLSX.utils.book_append_sheet(workbook, ws1, 'Submission Report');

    // -------------------------------------------------------------
    // SHEET 2: BOY-WISE BREAKDOWN
    // -------------------------------------------------------------
    const sheet2Rows: any[][] = [
      ['SIDDHARTHA BHARAT GAS - DELIVERY BOY WISE ONLINE BILLS'],
      [`Date: ${formattedDate} | Total Online Bills: ${totalBillsCount}`],
      [],
    ];

    Object.keys(boyBreakdown).forEach((boyName) => {
      const boyBills = allOnlineBills.filter(
        (b) => b.deliveryBoy.trim().toUpperCase() === boyName.trim().toUpperCase()
      );
      if (boyBills.length === 0) return;

      sheet2Rows.push([
        `DELIVERY BOY: #${boyBreakdown[boyName].serial} ${boyName} (${boyBills.length} Bills)`,
      ]);
      sheet2Rows.push([
        'S.No',
        'Consumer Number',
        'Customer Name',
        'Cash Memo No',
        'Order Number',
        'Refill Type',
        'Status',
      ]);

      boyBills.forEach((b, idx) => {
        sheet2Rows.push([
          idx + 1,
          { t: 's', v: String(b.consumer_number || '') },
          String(b.consumer_name || 'Consumer').toUpperCase(),
          { t: 's', v: String(b.cash_memo || '-') },
          { t: 's', v: String(b.order_no || '-') },
          b.refill_type || 'PayNBook Apps',
          b.status || 'Online Bill (Delivery Done)',
        ]);
      });

      sheet2Rows.push([
        'Subtotal',
        `${boyBills.length} Bills`,
        '',
        '',
        '',
        '',
        `Boy #${boyBreakdown[boyName].serial} Verified`,
      ]);
      sheet2Rows.push([]); // blank row between delivery boys
    });

    const ws2 = XLSX.utils.aoa_to_sheet(sheet2Rows);
    ws2['!cols'] = [
      { wch: 7 },
      { wch: 18 },
      { wch: 34 },
      { wch: 15 },
      { wch: 15 },
      { wch: 18 },
      { wch: 30 },
    ];
    XLSX.utils.book_append_sheet(workbook, ws2, 'Boy-wise Breakdown');

    // -------------------------------------------------------------
    // SHEET 3: RAW DATA (FILTER & PIVOT READY)
    // -------------------------------------------------------------
    const sheet3Rows: any[][] = [
      [
        'S.No',
        'Consumer Number',
        'Customer Name',
        'Delivery Boy',
        'Delivery Boy S.No',
        'Cash Memo No',
        'Order Number',
        'Book Date',
        'Refill Type',
        'Status',
        'Report Date',
      ],
    ];

    displayedBills.forEach((b, index) => {
      sheet3Rows.push([
        index + 1,
        { t: 's', v: String(b.consumer_number || '') },
        String(b.consumer_name || 'Consumer').toUpperCase(),
        b.deliveryBoy,
        b.deliveryBoySerial,
        { t: 's', v: String(b.cash_memo || '-') },
        { t: 's', v: String(b.order_no || '-') },
        b.book_date || formattedDate,
        b.refill_type || 'PayNBook Apps',
        b.status || 'Online Bill (Delivery Done)',
        reportDate,
      ]);
    });

    const ws3 = XLSX.utils.aoa_to_sheet(sheet3Rows);
    ws3['!cols'] = [
      { wch: 6 },
      { wch: 18 },
      { wch: 34 },
      { wch: 18 },
      { wch: 16 },
      { wch: 15 },
      { wch: 15 },
      { wch: 14 },
      { wch: 18 },
      { wch: 28 },
      { wch: 14 },
    ];
    XLSX.utils.book_append_sheet(workbook, ws3, 'Raw Data (Pivot Ready)');

    // Write file
    XLSX.writeFile(workbook, `Siddhartha_BharatGas_Online_Bills_${reportDate}.xlsx`);
    toast.success('Downloaded complete 3-sheet Excel report!');
  };

  // Split bills for 2-column view
  const halfLength = Math.ceil(displayedBills.length / 2);
  const leftColBills = displayedBills.slice(0, halfLength);
  const rightColBills = displayedBills.slice(halfLength);

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[120] flex items-center justify-center p-2 sm:p-4 overflow-y-auto print:p-0 print:m-0 print:bg-white print:static print:z-auto print:block print:w-full">
      {/* Dedicated Print Stylesheet: Compact fonts, no big letters, fits 50/page and 100 front+back */}
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 6mm 8mm 6mm 8mm;
          }
          /* Strictly hide Day End page, navigation bars, docks and non-print controls */
          .day-end-main-page,
          .print\\:hidden,
          nav,
          header,
          footer,
          .agent-bottom-nav {
            display: none !important;
          }
          /* Body reset for clean paper Xerox */
          body, html {
            background: #ffffff !important;
            color: #000000 !important;
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
            font-size: 8.5pt !important;
            line-height: 1.15 !important;
          }
          .print-modal-container {
            position: static !important;
            inset: auto !important;
            width: 100% !important;
            max-width: 100% !important;
            max-height: none !important;
            background: #ffffff !important;
            color: #000000 !important;
            border: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
            overflow: visible !important;
          }
          .print-sheet-content {
            padding: 0 !important;
            margin: 0 !important;
            width: 100% !important;
            background: #ffffff !important;
            color: #000000 !important;
            overflow: visible !important;
          }
          table {
            width: 100% !important;
            border-collapse: collapse !important;
            page-break-inside: auto;
          }
          thead {
            display: table-header-group !important;
          }
          tfoot {
            display: table-footer-group !important;
          }
          tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            height: 15.5px !important;
          }
          td, th {
            padding-top: 1.2px !important;
            padding-bottom: 1.2px !important;
            padding-left: 3px !important;
            padding-right: 3px !important;
            font-size: 8pt !important;
            line-height: 1.15 !important;
          }
          .signature-section {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            margin-top: 12px !important;
          }
        }
      `}</style>

      {/* Container Card */}
      <div className="bg-slate-900 border border-slate-700 w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden flex flex-col text-slate-100 max-h-[92vh] my-auto print-modal-container print:max-h-none print:shadow-none print:border-none print:bg-white print:text-black print:rounded-none">
        
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
                Compact Xerox sheet (up to 100 consumers in 1 page front & back)
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
              onClick={() => setViewMode('ALL')}
              className={`px-2 py-1 rounded-lg border transition-all ${
                viewMode === 'ALL'
                  ? 'bg-indigo-600 text-white font-bold border-indigo-500'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
              }`}
              title="Single compact table (50 rows per side, 100 on front & back)"
            >
              Single Table (50/side)
            </button>
            <button
              type="button"
              onClick={() => setViewMode('TWO_COL')}
              className={`px-2 py-1 rounded-lg border transition-all ${
                viewMode === 'TWO_COL'
                  ? 'bg-indigo-600 text-white font-bold border-indigo-500'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
              }`}
              title="2-Column Side-by-Side split"
            >
              2-Column Split
            </button>
            <button
              type="button"
              onClick={() => setViewMode('GROUPED')}
              className={`px-2 py-1 rounded-lg border transition-all ${
                viewMode === 'GROUPED'
                  ? 'bg-indigo-600 text-white font-bold border-indigo-500'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
              }`}
              title="Grouped by delivery boy"
            >
              Grouped
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* PRINTABLE XEROX SHEET CONTAINER                                          */}
        {/* ========================================================================= */}
        <div id="printable-online-bills-sheet" className="p-3 sm:p-5 overflow-y-auto flex-1 bg-white text-slate-950 print-sheet-content print:p-0 print:overflow-visible font-sans">
          
          {/* Official Agency Letterhead Header - Sleek & Compact (No Big Letters) */}
          <div className="border-b border-black pb-1.5 mb-2 text-center print:pb-1 print:mb-1.5">
            <h1 className="text-base sm:text-lg font-black uppercase tracking-tight text-black print:text-[12pt] print:leading-tight">
              SIDDHARTHA BHARAT GAS
            </h1>
            <h2 className="text-[11px] sm:text-xs font-bold uppercase tracking-wide text-slate-800 mt-0.5 print:text-[8.5pt] print:leading-tight">
              DAILY ONLINE BILLS (PAYNBOOK APPS) SUBMISSION REPORT
            </h2>
            <div className="flex items-center justify-between text-[10px] font-semibold text-slate-700 mt-1 px-1 border-t border-slate-300 pt-1 flex-wrap gap-1 print:text-[7.5pt]">
              <span>📅 <b>DATE:</b> {formattedDate}</span>
              <span>🏢 <b>REFILL TYPE:</b> PayNBook Apps (Online Paid)</span>
              <span>📊 <b>TOTAL ONLINE BILLS:</b> <b className="text-black">{displayedBills.length}</b></span>
            </div>
          </div>

          {/* Delivery Boy Summary Pill Box - Compact 1-liner */}
          <div className="mb-2 p-1.5 bg-slate-50 rounded-lg border border-slate-300 print:border-slate-400 text-[10px] print:text-[7.5pt] print:p-1 print:mb-1.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-bold text-slate-900 uppercase tracking-wider text-[9px] print:text-[7.5pt]">
                BOYS BREAKDOWN:
              </span>
              {Object.entries(boyBreakdown).map(([bName, data]) => (
                <span
                  key={bName}
                  className="bg-white border border-slate-300 text-slate-900 px-1.5 py-0.2 rounded font-semibold text-[9.5px] print:text-[7.5pt]"
                >
                  #{data.serial} <b>{bName}:</b> {data.count}
                </span>
              ))}
              <span className="bg-black text-white px-2 py-0.2 rounded font-bold text-[9.5px] print:text-[7.5pt] ml-auto">
                TOTAL: {allOnlineBills.length} BILLS
              </span>
            </div>
          </div>

          {/* Master Table of Bills (With CASH MEMO & ORDER NO, Compact Font) */}
          {displayedBills.length === 0 ? (
            <div className="py-8 text-center text-slate-500 font-semibold text-xs">
              No online bills recorded for any delivery boy on {formattedDate}.
            </div>
          ) : viewMode === 'ALL' || filterBoy !== 'ALL' ? (
            /* =================================================================== */
            /* SINGLE FULL-WIDTH TABLE: 50 rows per side, 100 on front & back      */
            /* =================================================================== */
            <div className="border border-black rounded-md overflow-hidden mb-3">
              <table className="w-full text-left border-collapse text-[10px] print:text-[8pt]">
                <thead>
                  <tr className="bg-slate-200 border-b border-black text-black uppercase font-bold text-[9px] print:text-[7.5pt] tracking-wider">
                    <th className="py-1 px-1 border-r border-slate-400 w-8 text-center">S.No</th>
                    <th className="py-1 px-1.5 border-r border-slate-400 font-mono w-24 text-center">Consumer No</th>
                    <th className="py-1 px-2 border-r border-slate-400">Customer Name</th>
                    <th className="py-1 px-1.5 border-r border-slate-400 w-24 text-center">Delivery Boy</th>
                    <th className="py-1 px-1.5 border-r border-slate-400 font-mono w-20 text-center">Cash Memo</th>
                    <th className="py-1 px-1.5 font-mono w-20 text-center">Order No</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-300">
                  {displayedBills.map((bill, index) => (
                    <tr
                      key={`${bill.consumer_number}-${index}`}
                      className="hover:bg-slate-50 print:hover:bg-transparent"
                    >
                      <td className="py-0.5 px-1 border-r border-slate-300 text-center font-semibold text-slate-700 text-[8.5px] print:text-[7.5pt]">
                        {index + 1}
                      </td>
                      <td className="py-0.5 px-1.5 border-r border-slate-300 font-mono font-bold text-slate-950 text-[9.5px] print:text-[8pt] text-center">
                        #{bill.consumer_number}
                      </td>
                      <td className="py-0.5 px-2 border-r border-slate-300 font-medium text-slate-900 uppercase truncate text-[9.5px] print:text-[8pt]">
                        {bill.consumer_name || 'Consumer'}
                      </td>
                      <td className="py-0.5 px-1.5 border-r border-slate-300 font-semibold text-slate-800 uppercase text-[8.5px] print:text-[7.5pt] text-center">
                        #{bill.deliveryBoySerial} {bill.deliveryBoy}
                      </td>
                      <td className="py-0.5 px-1.5 border-r border-slate-300 font-mono text-slate-700 text-[8.5px] print:text-[7.5pt] text-center">
                        {bill.cash_memo || '-'}
                      </td>
                      <td className="py-0.5 px-1.5 font-mono text-slate-700 text-[8.5px] print:text-[7.5pt] text-center">
                        {bill.order_no || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 border-t border-black font-bold text-slate-950 text-[9.5px] print:text-[7.5pt]">
                    <td colSpan={3} className="py-1 px-2 border-r border-slate-400">
                      TOTAL: {displayedBills.length} ONLINE BILLS
                    </td>
                    <td colSpan={3} className="py-1 px-2 text-right">
                      Verified for BPCL PayNBook Submission
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : viewMode === 'TWO_COL' ? (
            /* =================================================================== */
            /* 2-COLUMN SPLIT: Side-by-side columns (25-30/col = 50-60/side)       */
            /* =================================================================== */
            <div className="grid grid-cols-2 gap-2 mb-3">
              {/* Left Column Table */}
              <div className="border border-black rounded-md overflow-hidden">
                <table className="w-full text-left border-collapse text-[10px] print:text-[7.5pt]">
                  <thead>
                    <tr className="bg-slate-200 border-b border-black text-black uppercase font-bold text-[8.5px] print:text-[7pt]">
                      <th className="py-1 px-1 border-r border-slate-400 w-8 text-center">S.No</th>
                      <th className="py-1 px-1.5 border-r border-slate-400 font-mono w-24 text-center">Consumer No</th>
                      <th className="py-1 px-1.5 border-r border-slate-400">Customer Name</th>
                      <th className="py-1 px-1.5 w-20 text-center">Boy</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-300">
                    {leftColBills.map((bill, index) => (
                      <tr key={`left-${bill.consumer_number}-${index}`}>
                        <td className="py-0.5 px-1 border-r border-slate-300 text-center font-semibold text-slate-700 text-[8.5px] print:text-[7pt]">
                          {index + 1}
                        </td>
                        <td className="py-0.5 px-1.5 border-r border-slate-300 font-mono font-bold text-slate-950 text-[9.5px] print:text-[7.5pt] text-center">
                          #{bill.consumer_number}
                        </td>
                        <td className="py-0.5 px-1.5 border-r border-slate-300 font-medium text-slate-900 uppercase truncate text-[9.5px] print:text-[7.5pt]">
                          {bill.consumer_name || 'Consumer'}
                        </td>
                        <td className="py-0.5 px-1.5 font-semibold text-slate-800 uppercase text-[8.5px] print:text-[7pt] text-center">
                          #{bill.deliveryBoySerial} {bill.deliveryBoy}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Right Column Table */}
              <div className="border border-black rounded-md overflow-hidden">
                <table className="w-full text-left border-collapse text-[10px] print:text-[7.5pt]">
                  <thead>
                    <tr className="bg-slate-200 border-b border-black text-black uppercase font-bold text-[8.5px] print:text-[7pt]">
                      <th className="py-1 px-1 border-r border-slate-400 w-8 text-center">S.No</th>
                      <th className="py-1 px-1.5 border-r border-slate-400 font-mono w-24 text-center">Consumer No</th>
                      <th className="py-1 px-1.5 border-r border-slate-400">Customer Name</th>
                      <th className="py-1 px-1.5 w-20 text-center">Boy</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-300">
                    {rightColBills.map((bill, index) => (
                      <tr key={`right-${bill.consumer_number}-${index}`}>
                        <td className="py-0.5 px-1 border-r border-slate-300 text-center font-semibold text-slate-700 text-[8.5px] print:text-[7pt]">
                          {halfLength + index + 1}
                        </td>
                        <td className="py-0.5 px-1.5 border-r border-slate-300 font-mono font-bold text-slate-950 text-[9.5px] print:text-[7.5pt] text-center">
                          #{bill.consumer_number}
                        </td>
                        <td className="py-0.5 px-1.5 border-r border-slate-300 font-medium text-slate-900 uppercase truncate text-[9.5px] print:text-[7.5pt]">
                          {bill.consumer_name || 'Consumer'}
                        </td>
                        <td className="py-0.5 px-1.5 font-semibold text-slate-800 uppercase text-[8.5px] print:text-[7pt] text-center">
                          #{bill.deliveryBoySerial} {bill.deliveryBoy}
                        </td>
                      </tr>
                    ))}
                    {rightColBills.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-3 text-center text-slate-400 text-xs italic">
                          -
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* =================================================================== */
            /* GROUPED BY DELIVERY BOY (With Cash Memo & Order No)                 */
            /* =================================================================== */
            <div className="space-y-3 mb-3">
              {Object.keys(boyBreakdown).map((boyName) => {
                const boyBills = allOnlineBills.filter(
                  (b) => b.deliveryBoy.trim().toUpperCase() === boyName.trim().toUpperCase()
                );
                if (boyBills.length === 0) return null;

                return (
                  <div key={boyName} className="border border-black rounded-md overflow-hidden">
                    <div className="bg-slate-800 text-white p-1.5 flex items-center justify-between text-[10px] font-bold print:bg-slate-200 print:text-black print:border-b print:border-black print:text-[7.5pt]">
                      <span className="uppercase tracking-wide">
                        DELIVERY BOY: #{boyBreakdown[boyName].serial} {boyName}
                      </span>
                      <span>{boyBills.length} Online Bills</span>
                    </div>
                    <table className="w-full text-left border-collapse text-[10px] print:text-[7.5pt]">
                      <thead>
                        <tr className="bg-slate-100 border-b border-black text-black uppercase font-bold text-[8.5px] print:text-[7pt]">
                          <th className="py-0.5 px-1.5 border-r border-slate-300 w-9 text-center">S.No</th>
                          <th className="py-0.5 px-2 border-r border-slate-300 font-mono text-center w-28">Consumer No</th>
                          <th className="py-0.5 px-2 border-r border-slate-300">Customer Name</th>
                          <th className="py-0.5 px-2 border-r border-slate-300 font-mono text-center w-24">Cash Memo</th>
                          <th className="py-0.5 px-2 font-mono text-center w-24">Order No</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-300">
                        {boyBills.map((bill, index) => (
                          <tr key={`${bill.consumer_number}-${index}`}>
                            <td className="py-0.5 px-1.5 border-r border-slate-300 text-center font-semibold text-slate-700 text-[8.5px] print:text-[7pt]">
                              {index + 1}
                            </td>
                            <td className="py-0.5 px-2 border-r border-slate-300 font-mono font-bold text-slate-950 text-[9.5px] print:text-[7.5pt] text-center">
                              #{bill.consumer_number}
                            </td>
                            <td className="py-0.5 px-2 border-r border-slate-300 font-medium text-slate-900 uppercase truncate text-[9.5px] print:text-[7.5pt]">
                              {bill.consumer_name || 'Consumer'}
                            </td>
                            <td className="py-0.5 px-2 border-r border-slate-300 font-mono text-slate-700 text-[8.5px] print:text-[7pt] text-center">
                              {bill.cash_memo || '-'}
                            </td>
                            <td className="py-0.5 px-2 font-mono text-slate-700 text-[8.5px] print:text-[7pt] text-center">
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

          {/* Official Signatures Section for Office / Xerox Submission - Compact */}
          <div className="mt-4 pt-2 border-t border-black grid grid-cols-3 gap-3 text-center text-[10px] print:text-[8pt] signature-section print:mt-3 print:pt-2">
            <div>
              <p className="font-bold text-slate-800 mb-4 print:mb-3">Prepared By (Staff):</p>
              <div className="border-t border-dotted border-black pt-1">
                <span className="font-mono text-[9px] print:text-[7pt] text-slate-600">Signature & Date</span>
              </div>
            </div>
            <div>
              <p className="font-bold text-slate-800 mb-4 print:mb-3">Verified By (Manager):</p>
              <div className="border-t border-dotted border-black pt-1">
                <span className="font-mono text-[9px] print:text-[7pt] text-slate-600">Signature & Seal</span>
              </div>
            </div>
            <div>
              <p className="font-bold text-slate-800 mb-4 print:mb-3">Submitted To (BPCL Office):</p>
              <div className="border-t border-dotted border-black pt-1">
                <span className="font-mono text-[9px] print:text-[7pt] text-slate-600">Officer Signature & Stamp</span>
              </div>
            </div>
          </div>

          {/* Bottom Generation Timestamp - Compact 1-liner */}
          <div className="mt-3 text-[9px] text-slate-500 flex items-center justify-between border-t border-slate-200 pt-1 font-mono print:text-[7pt] print:mt-2">
            <span>Siddhartha Bharat Gas</span>
            <span>Printed / Generated: {new Date().toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
