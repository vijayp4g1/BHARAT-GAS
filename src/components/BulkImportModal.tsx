import React, { useState, useRef } from 'react';
import { X, Upload, Loader2, FileSpreadsheet, CheckCircle, AlertCircle } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

interface BulkImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const BulkImportModal: React.FC<BulkImportModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [importStats, setImportStats] = useState<{ total: number; success: number; skipped: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setProgress(0);
    setImportStats(null);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawData = XLSX.utils.sheet_to_json(worksheet) as any[];

      if (!rawData || rawData.length === 0) {
        toast.error('The uploaded file is empty.');
        setIsUploading(false);
        return;
      }

      // Find the correct column names by checking the first row
      const firstRow = rawData[0];
      const keys = Object.keys(firstRow).map(k => k.toLowerCase());
      
      const consumerNumKey = Object.keys(firstRow).find(k => k.toLowerCase().includes('number') || k.toLowerCase().includes('no')) || '';
      const consumerNameKey = Object.keys(firstRow).find(k => k.toLowerCase().includes('name')) || '';
      const mobileKey = Object.keys(firstRow).find(k => k.toLowerCase().includes('mobile') || k.toLowerCase().includes('phone')) || '';
      const addressKey = Object.keys(firstRow).find(k => k.toLowerCase().includes('address')) || '';

      if (!consumerNumKey || !consumerNameKey) {
        toast.error('Could not find required columns (Consumer Number, Name) in the file.');
        setIsUploading(false);
        return;
      }

      // Format data for Supabase
      const formattedData = rawData.map(row => ({
        consumer_number: String(row[consumerNumKey] || '').trim(),
        consumer_name: String(row[consumerNameKey] || '').trim(),
        mobile: String(row[mobileKey] || '').trim(),
        address: String(row[addressKey] || '').trim(),
        verification_status: 'Not Collected',
      })).filter(c => c.consumer_number && c.consumer_name); // Filter out empty rows

      if (formattedData.length === 0) {
        toast.error('No valid consumer records found to import.');
        setIsUploading(false);
        return;
      }

      // Batch insert logic (100 at a time)
      const batchSize = 100;
      let successCount = 0;
      let skippedCount = 0;

      for (let i = 0; i < formattedData.length; i += batchSize) {
        const batch = formattedData.slice(i, i + batchSize);
        
        // Use insert with ignoreDuplicates to safely handle existing consumers
        const { data: insertedData, error } = await supabase
          .from('consumers')
          .upsert(batch, { onConflict: 'consumer_number', ignoreDuplicates: true })
          .select('id');

        if (error) {
          console.error('Error inserting batch:', error);
          toast.error(`Error importing chunk ${i / batchSize + 1}`);
        } else {
          const insertedCount = insertedData?.length || 0;
          successCount += insertedCount;
          skippedCount += (batch.length - insertedCount);
        }

        setProgress(Math.round(((i + batch.length) / formattedData.length) * 100));
      }

      setImportStats({
        total: formattedData.length,
        success: successCount,
        skipped: skippedCount
      });
      
      toast.success('Import completed successfully!');
      onSuccess();
      
    } catch (error) {
      console.error('Import error:', error);
      toast.error('Failed to parse the file. Please ensure it is a valid Excel/CSV file.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm transition-opacity">
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-300">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-5 flex justify-between items-center text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 -mr-8 -mt-8 w-32 h-32 rounded-full bg-white/10 blur-2xl"></div>
          <h2 className="text-xl font-bold flex items-center gap-2 relative z-10">
            <FileSpreadsheet size={20} />
            Bulk Import Consumers
          </h2>
          <button onClick={onClose} disabled={isUploading} className="p-2 text-white/80 hover:text-white hover:bg-white/20 rounded-full transition-colors disabled:opacity-50 relative z-10">
            <X size={20} />
          </button>
        </div>
        
        <div className="p-6">
          {!importStats ? (
            <div className="flex flex-col gap-4">
              <p className="text-slate-600 text-sm">
                Upload an Excel (.xlsx) or CSV file containing your consumer data. 
                <br/><br/>
                <strong>Duplicates will be safely ignored!</strong> If a consumer already exists in the system, they will be skipped so their existing data (GPS, photos) is not overwritten.
              </p>
              
              <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl">
                <p className="text-xs font-bold text-blue-800 mb-2">Required Columns (Case Insensitive):</p>
                <ul className="text-xs text-blue-700 space-y-1 list-disc list-inside">
                  <li>Consumer Number (or Number, No)</li>
                  <li>Consumer Name (or Name)</li>
                  <li>Mobile (or Phone)</li>
                  <li>Address</li>
                </ul>
              </div>

              {isUploading ? (
                <div className="mt-4 flex flex-col items-center justify-center py-6">
                  <Loader2 className="animate-spin text-blue-600 mb-4" size={40} />
                  <p className="text-slate-700 font-bold mb-2">Importing Consumers...</p>
                  <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                    <div className="bg-blue-600 h-full rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                  </div>
                  <p className="text-slate-500 text-xs mt-2">{progress}% completed</p>
                </div>
              ) : (
                <div className="mt-4">
                  <input
                    type="file"
                    accept=".xlsx, .csv"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                  />
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full bg-slate-50 hover:bg-slate-100 border-2 border-dashed border-slate-300 hover:border-blue-500 text-slate-700 font-bold py-8 px-4 rounded-2xl transition-all flex flex-col justify-center items-center gap-3 group"
                  >
                    <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform group-hover:text-blue-600">
                      <Upload size={24} />
                    </div>
                    <span>Select Excel / CSV File</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-4 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-500 flex items-center justify-center mb-4">
                <CheckCircle size={32} />
              </div>
              <h3 className="text-xl font-bold text-slate-800 mb-2">Import Finished!</h3>
              <p className="text-slate-600 mb-6">Your file has been processed successfully.</p>
              
              <div className="grid grid-cols-2 gap-3 w-full mb-6">
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                  <p className="text-xs text-emerald-600 font-bold uppercase tracking-wider mb-1">New Added</p>
                  <p className="text-2xl font-black text-emerald-700">{importStats.success}</p>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Skipped</p>
                    <AlertCircle size={12} className="text-slate-400" />
                  </div>
                  <p className="text-2xl font-black text-slate-700">{importStats.skipped}</p>
                  <p className="text-[10px] text-slate-400">(Already existed)</p>
                </div>
              </div>
              
              <button 
                onClick={onClose}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-xl shadow-md transition-all active:scale-95"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
