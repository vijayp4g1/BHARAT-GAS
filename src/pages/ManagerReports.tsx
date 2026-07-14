import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Loader2, FileSpreadsheet, Filter, CheckCircle, Database } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { ManagerBottomNav } from '../components/ManagerBottomNav';

export const ManagerReports = () => {
  const [isExporting, setIsExporting] = useState(false);
  const [exportFilter, setExportFilter] = useState<'All' | 'Completed' | 'Pending'>('All');
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState('');
  const navigate = useNavigate();

  const handleExport = async () => {
    setIsExporting(true);
    setExportProgress(5);
    setExportStatus('Connecting to database...');

    try {
      // 1. Fetch Consumers based on filter
      let query = supabase
        .from('manager_consumer_summary')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });
      
      if (exportFilter === 'Completed') {
        query = query.eq('has_location', true).eq('has_photos', true);
      } else if (exportFilter === 'Pending') {
        query = query.or('has_location.eq.false,has_photos.eq.false');
      }

      setExportProgress(15);
      setExportStatus('Fetching record count...');

      const { count, error: countError } = await query.range(0, 0);
      if (countError) throw countError;

      if (!count || count === 0) {
        toast.error('No data found for the selected filter.');
        setIsExporting(false);
        setExportProgress(0);
        return;
      }

      // Fetch all pages (handle pagination if > 1000)
      let allData: any[] = [];
      let from = 0;
      const step = 1000;
      let fetchMore = true;

      while (fetchMore) {
        setExportStatus(`Downloading records... (${allData.length} / ${count})`);
        const { data, error } = await query.range(from, from + step - 1);
        if (error) throw error;
        
        if (data && data.length > 0) {
          allData = [...allData, ...data];
          from += step;
          const progress = 15 + Math.floor((allData.length / count) * 60);
          setExportProgress(progress);
        }
        
        if (!data || data.length < step) {
          fetchMore = false;
        }
      }

      setExportStatus(`Formatting ${allData.length} records...`);
      setExportProgress(80);

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

      setExportStatus('Generating Excel file...');
      setExportProgress(90);

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

      setExportProgress(100);
      setExportStatus('Download complete!');

      // 4. Download
      const fileName = `BGCLS_Export_${exportFilter}_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(workbook, fileName);

      toast.success(`Successfully exported ${allData.length} records!`, { duration: 4000 });
      
      setTimeout(() => {
        setIsExporting(false);
        setExportProgress(0);
      }, 1500);

    } catch (error: any) {
      console.error('Export error:', error);
      toast.error(`Export failed: ${error.message}`);
      setIsExporting(false);
      setExportProgress(0);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pb-20 md:pb-10 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-400/20 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

      <header className="glass-header text-white p-4 sm:p-5 sticky top-0 z-20 flex items-center gap-4 shadow-sm">
        <Link to="/manager/dashboard" className="p-2 hover:bg-white/20 rounded-xl transition-colors backdrop-blur-sm active:scale-95 shadow-sm">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl sm:text-2xl font-bold flex-1 truncate tracking-tight flex items-center gap-2">
          <FileSpreadsheet size={24} className="text-blue-300 hidden sm:block" />
          Data & Reports
        </h1>
      </header>

      <main className="max-w-4xl w-full mx-auto p-4 sm:p-5 md:p-8 flex-1 relative z-10">
        
        <div className="glass-card rounded-3xl overflow-hidden shadow-sm p-5 sm:p-8 max-w-2xl mx-auto relative group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none group-hover:bg-blue-500/10 transition-colors"></div>

          <div className="text-center mb-8 relative z-10">
            <div className="w-20 h-20 bg-gradient-to-br from-blue-100 to-indigo-100 text-blue-600 rounded-3xl flex items-center justify-center mx-auto mb-5 shadow-inner border border-white">
              <Database size={36} className="drop-shadow-sm" />
            </div>
            <h2 className="text-2xl font-black text-slate-800">Export Consumer Data</h2>
            <p className="text-slate-500 mt-2 font-medium max-w-md mx-auto">Download consumer records as an Excel (.xlsx) file for offline analysis and reporting.</p>
          </div>

          <div className="space-y-6 relative z-10">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                <Filter size={16} className="text-blue-500" />
                Select Data to Export
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  onClick={() => !isExporting && setExportFilter('All')}
                  disabled={isExporting}
                  className={`p-4 rounded-2xl border-2 text-left transition-all ${
                    exportFilter === 'All' 
                      ? 'border-blue-500 bg-blue-50/50 shadow-md ring-2 ring-blue-500/20' 
                      : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/30'
                  } ${isExporting ? 'opacity-50 cursor-not-allowed' : 'active:scale-95'}`}
                >
                  <p className={`font-bold ${exportFilter === 'All' ? 'text-blue-700' : 'text-slate-700'}`}>All Consumers</p>
                  <p className="text-xs text-slate-500 mt-1">Export entire database</p>
                </button>

                <button
                  onClick={() => !isExporting && setExportFilter('Completed')}
                  disabled={isExporting}
                  className={`p-4 rounded-2xl border-2 text-left transition-all ${
                    exportFilter === 'Completed' 
                      ? 'border-emerald-500 bg-emerald-50/50 shadow-md ring-2 ring-emerald-500/20' 
                      : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/30'
                  } ${isExporting ? 'opacity-50 cursor-not-allowed' : 'active:scale-95'}`}
                >
                  <p className={`font-bold ${exportFilter === 'Completed' ? 'text-emerald-700' : 'text-slate-700'}`}>Completed</p>
                  <p className="text-xs text-slate-500 mt-1">Only verified records</p>
                </button>

                <button
                  onClick={() => !isExporting && setExportFilter('Pending')}
                  disabled={isExporting}
                  className={`p-4 rounded-2xl border-2 text-left transition-all ${
                    exportFilter === 'Pending' 
                      ? 'border-amber-500 bg-amber-50/50 shadow-md ring-2 ring-amber-500/20' 
                      : 'border-slate-200 bg-white hover:border-amber-300 hover:bg-amber-50/30'
                  } ${isExporting ? 'opacity-50 cursor-not-allowed' : 'active:scale-95'}`}
                >
                  <p className={`font-bold ${exportFilter === 'Pending' ? 'text-amber-700' : 'text-slate-700'}`}>Pending</p>
                  <p className="text-xs text-slate-500 mt-1">Missing GPS/Photos</p>
                </button>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-200/60">
              {isExporting ? (
                <div className="bg-slate-50 p-5 rounded-2xl border border-blue-100 shadow-inner">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-sm font-bold text-blue-800 flex items-center gap-2">
                      <Loader2 className="animate-spin text-blue-500" size={16} />
                      {exportStatus}
                    </span>
                    <span className="text-sm font-black text-blue-600">{exportProgress}%</span>
                  </div>
                  <div className="w-full bg-blue-100/50 rounded-full h-3 overflow-hidden border border-blue-100">
                    <div 
                      className="bg-gradient-to-r from-blue-500 to-indigo-500 h-3 rounded-full transition-all duration-300 ease-out relative"
                      style={{ width: `${exportProgress}%` }}
                    >
                      <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  onClick={handleExport}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold py-4 rounded-2xl shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all"
                >
                  <Download size={20} className="animate-bounce" style={{ animationDuration: '2s' }} />
                  Generate Excel Report
                </button>
              )}
            </div>
            
            <div className="bg-blue-50/50 rounded-2xl p-4 border border-blue-100 flex items-start gap-3">
              <div className="p-1 bg-white text-blue-600 rounded-lg mt-0.5 shadow-sm border border-blue-100">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
              </div>
              <p className="text-xs sm:text-sm text-slate-600 font-medium leading-relaxed">
                Large databases (30,000+ records) may take up to <span className="font-bold text-slate-700">10-15 seconds</span> to download. The file will automatically save to your downloads folder once ready.
              </p>
            </div>
          </div>
        </div>
      </main>

      <ManagerBottomNav />
    </div>
  );
};
