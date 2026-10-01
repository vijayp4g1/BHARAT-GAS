import React, { useState, useRef } from 'react';
import { X, Upload, Loader2, FileSpreadsheet, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
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
  const [shouldMerge, setShouldMerge] = useState(true);
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
      const workbook = XLSX.read(data, { type: 'buffer' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];

      // Check if this is a Bharat Gas / BPCL export with header banner at row 1-3
      let rawData = XLSX.utils.sheet_to_json(worksheet) as any[];

      if (!rawData || rawData.length === 0) {
        toast.error('The uploaded file is empty.');
        setIsUploading(false);
        return;
      }

      // Check first row to see if it's the BPCL banner (e.g. DistCode)
      const firstRowKeys = Object.keys(rawData[0] || {});
      const hasDistCodeBanner = firstRowKeys.some(k => k.toLowerCase().includes('distcode') || k.toLowerCase().includes('textbox'));

      if (hasDistCodeBanner) {
        // Parse with range: 3 to skip metadata banner rows
        rawData = XLSX.utils.sheet_to_json(worksheet, { range: 3 }) as any[];
      }

      if (!rawData || rawData.length === 0) {
        toast.error('Could not extract table records from file.');
        setIsUploading(false);
        return;
      }

      // Dynamic header mapping
      const sampleRow = rawData[0];
      const keys = Object.keys(sampleRow);
      
      const consumerNumKey = keys.find(k => k.toLowerCase() === 'consumernumber' || k.toLowerCase().includes('number') || k.toLowerCase().includes('no')) || '';
      const consumerNameKey = keys.find(k => k.toLowerCase() === 'consumername' || k.toLowerCase().includes('name')) || '';
      const mobileKey = keys.find(k => k.toLowerCase() === 'mobilenumber' || k.toLowerCase().includes('mobile') || k.toLowerCase().includes('phone')) || '';
      const addressKey = keys.find(k => k.toLowerCase() === 'address' || k.toLowerCase().includes('address')) || '';
      const areaKey = keys.find(k => k.toLowerCase() === 'areacodedesc' || k.toLowerCase().includes('area')) || '';

      if (!consumerNumKey || !consumerNameKey) {
        toast.error('Could not find required columns (Consumer Number, Name) in the file.');
        setIsUploading(false);
        return;
      }

      // Deduplicate on consumer number & clean fields
      const consumerMap = new Map<string, any>();

      for (const row of rawData) {
        const rawNum = String(row[consumerNumKey] !== undefined ? row[consumerNumKey] : '').trim();
        if (!rawNum || !/^\d+$/.test(rawNum)) continue;

        const name = String(row[consumerNameKey] || '').trim();
        let mobile = String(row[mobileKey] || '').replace(/\D/g, '').trim();
        if (mobile.length > 10 && mobile.startsWith('91')) mobile = mobile.slice(2);
        if (mobile.length !== 10) mobile = String(row[mobileKey] || '').trim() || 'N/A';

        let directAddress = String(row[addressKey] || '').replace(/\s+/g, ' ').trim();
        const areaLandmark = String(row['AreaLandMark'] || '').trim();
        const village = String(row['CityTownVillage'] || '').trim();
        const pincode = String(row['PinCode'] || '').trim();

        let address = directAddress;
        if (areaLandmark && areaLandmark !== '-' && !address.toLowerCase().includes(areaLandmark.toLowerCase())) {
          address += `, Near ${areaLandmark}`;
        }
        if (village && village !== '-' && !address.toLowerCase().includes(village.toLowerCase())) {
          address += `, ${village}`;
        }
        if (pincode && pincode !== '0' && !address.includes(pincode)) {
          address += ` - ${pincode}`;
        }
        address = address.replace(/,\s*,/g, ',').trim();

        const areaCode = areaKey ? String(row[areaKey] || '').trim() || null : null;

        if (!consumerMap.has(rawNum)) {
          const item: any = {
            consumer_number: rawNum,
            consumer_name: name || 'Unknown',
            mobile: mobile || 'N/A',
            address: address || 'Address not provided',
            area_code: areaCode,
            updated_at: new Date().toISOString()
          };

          // Only include verification_status if NOT merging (insert new only)
          if (!shouldMerge) {
            item.verification_status = 'Not Collected';
          }

          consumerMap.set(rawNum, item);
        }
      }

      const formattedData = Array.from(consumerMap.values());

      if (formattedData.length === 0) {
        toast.error('No valid consumer records found to import.');
        setIsUploading(false);
        return;
      }

      // Fast chunking in batches of 500
      const batchSize = 500;
      let successCount = 0;
      let skippedCount = 0;

      for (let i = 0; i < formattedData.length; i += batchSize) {
        const batch = formattedData.slice(i, i + batchSize);
        
        const { data: insertedData, error } = await supabase
          .from('consumers')
          .upsert(batch, { 
            onConflict: 'consumer_number', 
            ignoreDuplicates: !shouldMerge 
          })
          .select('id');

        if (error) {
          console.error('Error inserting batch:', error);
          toast.error(`Error importing chunk ${Math.floor(i / batchSize) + 1}`);
        } else {
          const count = insertedData?.length || batch.length;
          successCount += count;
        }

        setProgress(Math.round(((i + batch.length) / formattedData.length) * 100));
      }

      setImportStats({
        total: formattedData.length,
        success: successCount,
        skipped: skippedCount
      });
      
      toast.success(shouldMerge ? 'Merged and updated consumers successfully!' : 'Imported consumers successfully!');
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
      <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-300">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-5 flex justify-between items-center text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 -mr-8 -mt-8 w-32 h-32 rounded-full bg-white/10 blur-2xl"></div>
          <h2 className="text-xl font-bold flex items-center gap-2 relative z-10">
            <FileSpreadsheet size={20} />
            Bulk Import & Merge Consumers
          </h2>
          <button onClick={onClose} disabled={isUploading} className="p-2 text-white/80 hover:text-white hover:bg-white/20 rounded-full transition-colors disabled:opacity-50 relative z-10">
            <X size={20} />
          </button>
        </div>
        
        <div className="p-6">
          {!importStats ? (
            <div className="flex flex-col gap-4">
              <p className="text-slate-600 text-sm">
                Upload an Excel (.xlsx) or CSV file containing your consumer data (including standard Bharat Gas portal exports).
              </p>

              {/* Mode Toggle */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className={`p-2 rounded-xl ${shouldMerge ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
                    <RefreshCw size={18} className={shouldMerge ? 'animate-spin-slow' : ''} />
                  </div>
                  <div>
                    <p className="text-xs font-black text-slate-800">
                      {shouldMerge ? 'Merge & Update Mode (Recommended)' : 'Insert Only Mode'}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {shouldMerge 
                        ? 'Updates names, addresses & area codes while preserving GPS & photos'
                        : 'Skips existing consumer records and only inserts new ones'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShouldMerge(!shouldMerge)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${shouldMerge ? 'bg-blue-600' : 'bg-slate-300'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${shouldMerge ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
              
              <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl">
                <p className="text-xs font-bold text-blue-800 mb-2">Supported Columns (Auto-Detected):</p>
                <ul className="text-xs text-blue-700 space-y-1 list-disc list-inside">
                  <li>Consumer Number (or Number, No, ConsumerNumber)</li>
                  <li>Consumer Name (or Name, ConsumerName)</li>
                  <li>Mobile (or Phone, MobileNumber)</li>
                  <li>Address (or Landmark, Village, PinCode)</li>
                  <li>Area Code (AreaCodeDesc, e.g. 146-RAJESH, 11-NAVEEN)</li>
                </ul>
              </div>

              {isUploading ? (
                <div className="mt-4 flex flex-col items-center justify-center py-6">
                  <Loader2 className="animate-spin text-blue-600 mb-4" size={40} />
                  <p className="text-slate-700 font-bold mb-2">
                    {shouldMerge ? 'Merging & Updating Consumers...' : 'Importing Consumers...'}
                  </p>
                  <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                    <div className="bg-blue-600 h-full rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                  </div>
                  <p className="text-slate-500 text-xs mt-2">{progress}% completed</p>
                </div>
              ) : (
                <div className="mt-2">
                  <input
                    type="file"
                    accept=".xlsx, .csv"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                  />
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full bg-slate-50 hover:bg-slate-100 border-2 border-dashed border-slate-300 hover:border-blue-500 text-slate-700 font-bold py-7 px-4 rounded-2xl transition-all flex flex-col justify-center items-center gap-3 group"
                  >
                    <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform group-hover:text-blue-600">
                      <Upload size={24} />
                    </div>
                    <span>Select Bharat Gas Excel / CSV File</span>
                    <span className="text-xs font-normal text-slate-400">Supports files up to 30,000+ records</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-4 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-500 flex items-center justify-center mb-4">
                <CheckCircle size={32} />
              </div>
              <h3 className="text-xl font-bold text-slate-800 mb-2">Processing Complete!</h3>
              <p className="text-slate-600 mb-6">Your consumer database has been successfully updated.</p>
              
              <div className="grid grid-cols-2 gap-3 w-full mb-6">
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                  <p className="text-xs text-emerald-600 font-bold uppercase tracking-wider mb-1">Processed</p>
                  <p className="text-2xl font-black text-emerald-700">{importStats.success}</p>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <p className="text-xs text-blue-700 font-bold uppercase tracking-wider">Mode</p>
                  </div>
                  <p className="text-sm font-black text-blue-800 mt-1">{shouldMerge ? 'Merged & Updated' : 'Inserted Only'}</p>
                  <p className="text-[10px] text-blue-500">(GPS & Photos safe)</p>
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
