import React, { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { X, Save, Loader2 } from 'lucide-react';
import db, { type Consumer } from '../lib/db';
import toast from 'react-hot-toast';

export const ConsumerModal = ({ isOpen, onClose, initialData }: { isOpen: boolean, onClose: () => void, initialData?: Consumer }) => {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    consumer_number: '',
    consumer_name: '',
    mobile: '',
    address: ''
  });

  useEffect(() => {
    if (initialData) {
      setFormData({
        consumer_number: initialData.consumer_number,
        consumer_name: initialData.consumer_name,
        mobile: initialData.mobile,
        address: initialData.address
      });
    } else {
      setFormData({
        consumer_number: '',
        consumer_name: '',
        mobile: '',
        address: ''
      });
    }
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      
      if (!initialData) {
        // Basic check if consumer number already exists locally only on Add
        const existing = await db.consumers.where({ consumer_number: formData.consumer_number }).first();
        if (existing) {
          toast.error('Consumer Number already exists!');
          return;
        }

        await db.consumers.add({
          id: uuidv4(),
          consumer_number: formData.consumer_number,
          consumer_name: formData.consumer_name,
          mobile: formData.mobile,
          address: formData.address,
          verification_status: 'Not Collected',
          created_at: new Date().toISOString(),
          synced: false,
          searchWords: [
            ...(formData.consumer_name ? formData.consumer_name.toLowerCase().split(/\s+/) : []),
            ...(formData.consumer_number ? [formData.consumer_number.toLowerCase()] : []),
            ...(formData.mobile ? [formData.mobile.toLowerCase()] : [])
          ],
          last_interacted_at: new Date().toISOString()
        });
        toast.success('Consumer added successfully!');
      } else {
        // Edit Mode
        await db.consumers.update(initialData.id, {
          consumer_number: formData.consumer_number,
          consumer_name: formData.consumer_name,
          mobile: formData.mobile,
          address: formData.address,
          synced: false,
          searchWords: [
            ...(formData.consumer_name ? formData.consumer_name.toLowerCase().split(/\s+/) : []),
            ...(formData.consumer_number ? [formData.consumer_number.toLowerCase()] : []),
            ...(formData.mobile ? [formData.mobile.toLowerCase()] : [])
          ],
          last_interacted_at: new Date().toISOString()
        });
        toast.success('Consumer updated successfully!');
      }

      onClose();
    } catch (error) {
      console.error(error);
      toast.error(initialData ? 'Failed to update consumer' : 'Failed to add consumer');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center p-5 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-xl font-bold text-slate-800">{initialData ? 'Edit Consumer' : 'Add New Consumer'}</h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4 overflow-y-auto">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Consumer Number *</label>
            <input required type="text" value={formData.consumer_number} onChange={e => setFormData({...formData, consumer_number: e.target.value})} className="w-full border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium placeholder:font-normal placeholder:text-slate-400" placeholder="e.g. 12345678" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Consumer Name *</label>
            <input required type="text" value={formData.consumer_name} onChange={e => setFormData({...formData, consumer_name: e.target.value})} className="w-full border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium placeholder:font-normal placeholder:text-slate-400" placeholder="Full Name" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Mobile Number *</label>
            <input required type="tel" value={formData.mobile} onChange={e => setFormData({...formData, mobile: e.target.value})} className="w-full border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium placeholder:font-normal placeholder:text-slate-400" placeholder="10-digit mobile number" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Address *</label>
            <textarea required rows={3} value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} className="w-full border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium placeholder:font-normal placeholder:text-slate-400 resize-none" placeholder="Complete address..." />
          </div>

          <button type="submit" disabled={loading} className="mt-2 w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 disabled:from-slate-400 disabled:to-slate-400 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 active:scale-[0.98] transition-all flex justify-center items-center gap-2">
            {loading ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />}
            {initialData ? 'Update Consumer' : 'Save Consumer'}
          </button>
        </form>
      </div>
    </div>
  );
};
