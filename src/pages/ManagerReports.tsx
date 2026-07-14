import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Loader2, FileSpreadsheet, Filter } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';

export const ManagerReports = () => {
  const [isExporting, setIsExporting] = useState(false);
  const [exportFilter, setExportFilter] = useState<'All' | 'Completed' | 'Pending'>('All');
  const navigate = useNavigate();

  const handleExport = async () => {
    setIsExporting(true);
    const toastId = toast.loading('Preparing export... This may take a moment for large datasets.');

    try {
      // 1. Fetch Consumers based on filter
      let query = supabase
        .from('manager_consumer_summary')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (exportFilter === 'Completed') {
        query = query.eq('has_location', true).eq('has_photos', true);
      } else if (exportFilter === 'Pending') {
        query = query.or('has_location.eq.false,has_photos.eq.false');
      }

      // Fetch all pages (handle pagination if > 1000, but for now we'll do 1000 max per request)
      // Supabase has a max 1000 limit per request by default. We loop to get all.
      let allData: any[] = [];
      let from = 0;
      const step = 1000;
      let fetchMore = true;

      while (fetchMore) {
        const { data, error } = await query.range(from, from + step - 1);
        if (error) throw error;
        
        if (data && data.length > 0) {
          allData = [...allData, ...data];
          from += step;
        }
        
        if (!data || data.length < step) {
          fetchMore = false;
        }
      }

      if (allData.length === 0) {
        toast.dismiss(toastId);
        toast.error('No data found for the selected filter.');
        setIsExporting(false);
        return;
      }

      toast.loading(`Formatting ${allData.length} records...`, { id: toastId });

      // 2. Format Data for Excel
      const excelData = allData.map(c => ({
        'Consumer Number': c.consumer_number,
        'Consumer Name': c.consumer_name,
        'Mobile Number': c.mobile,
        'Address': c.address,
        'GPS Status': c.has_location ? 'Captured' : 'Missing',
        'Photo Status': c.has_photos ? 'Uploaded' : 'Missing',
        'Overall Status': (c.has_location && c.has_photos) ? 'Completed' : 'Pending',
        'Created At': new Date(c.created_at).toLocaleString()
      }));

      // 3. Generate Excel File
      const worksheet = XLSX.utils.json_to_sheet(excelData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Consumers");

      // Set column widths
      worksheet['!cols'] = [
        { wch: 15 }, // Consumer Number
        { wch: 25 }, // Consumer Name
        { wch: 15 }, // Mobile
        { wch: 40 }, // Address
        { wch: 15 }, // GPS
        { wch: 15 }, // Photos
        { wch: 15 }, // Status
        { wch: 20 }, // Created At
      ];

      // 4. Download
      const fileName = `BGCLS_Export_${exportFilter}_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(workbook, fileName);

      toast.success(`Successfully exported ${allData.length} records!`, { id: toastId });
    } catch (error: any) {
      console.error('Export error:', error);
      toast.error(`Export failed: ${error.message}`, { id: toastId });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pb-10">
      <header className="glass-header text-white p-5 sticky top-0 z-20 flex items-center gap-4">
        <button onClick={() => navigate('/manager/dashboard')} className="p-2 hover:bg-white/10 rounded-full transition-colors backdrop-blur-sm border border-white/10 bg-white/5">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-2xl font-bold flex-1 truncate tracking-tight flex items-center gap-2">
          <Download size={24} className="text-blue-300" />
          Data Export & Reports
        </h1>
      </header>

      <main className="max-w-4xl w-full mx-auto p-5 md:p-8 flex-1">
        
        <div className="glass-card rounded-3xl overflow-hidden shadow-sm p-8 max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-inner">
              <FileSpreadsheet size={32} />
            </div>
            <h2 className="text-2xl font-black text-slate-800">Export Consumer Data</h2>
            <p className="text-slate-500 mt-2 font-medium">Download consumer records as an Excel (.xlsx) file for offline analysis and reporting.</p>
          </div>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                <Filter size={16} className="text-blue-500" />
                Select Data to Export
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  onClick={() => setExportFilter('All')}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${
                    exportFilter === 'All' 
                      ? 'border-blue-500 bg-blue-50/50 shadow-sm' 
                      : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/30'
                  }`}
                >
                  <p className={`font-bold ${exportFilter === 'All' ? 'text-blue-700' : 'text-slate-700'}`}>All Consumers</p>
                  <p className="text-xs text-slate-500 mt-1">Export entire database</p>
                </button>

                <button
                  onClick={() => setExportFilter('Completed')}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${
                    exportFilter === 'Completed' 
                      ? 'border-emerald-500 bg-emerald-50/50 shadow-sm' 
                      : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/30'
                  }`}
                >
                  <p className={`font-bold ${exportFilter === 'Completed' ? 'text-emerald-700' : 'text-slate-700'}`}>Completed</p>
                  <p className="text-xs text-slate-500 mt-1">Only verified records</p>
                </button>

                <button
                  onClick={() => setExportFilter('Pending')}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${
                    exportFilter === 'Pending' 
                      ? 'border-amber-500 bg-amber-50/50 shadow-sm' 
                      : 'border-slate-200 bg-white hover:border-amber-300 hover:bg-amber-50/30'
                  }`}
                >
                  <p className={`font-bold ${exportFilter === 'Pending' ? 'text-amber-700' : 'text-slate-700'}`}>Pending</p>
                  <p className="text-xs text-slate-500 mt-1">Missing GPS/Photos</p>
                </button>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200/60">
              <button
                onClick={handleExport}
                disabled={isExporting}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold py-4 rounded-xl shadow-[0_8px_20px_-6px_rgba(59,130,246,0.5)] hover:shadow-[0_12px_25px_-6px_rgba(59,130,246,0.6)] hover:-translate-y-0.5 transition-all disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none"
              >
                {isExporting ? (
                  <>
                    <Loader2 className="animate-spin" size={20} />
                    Processing Export...
                  </>
                ) : (
                  <>
                    <Download size={20} />
                    Download Excel Report
                  </>
                )}
              </button>
            </div>
            
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 flex items-start gap-3">
              <div className="p-1 bg-blue-100 text-blue-600 rounded mt-0.5">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Large databases (30,000+ records) may take up to 10-15 seconds to download. The file will automatically save to your downloads folder once ready.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
