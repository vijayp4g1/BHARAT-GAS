import React, { useState } from 'react';
import { X, UserPlus, Phone, User, KeyRound, Loader2, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { createDeliveryBoy, type DeliveryBoy } from '../lib/agentService';

interface AddDeliveryBoyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (newBoy: DeliveryBoy) => void;
}

export const AddDeliveryBoyModal: React.FC<AddDeliveryBoyModalProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  // Auto-generate suggested username from name
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    setName(newName);
    if (!username || username === name.toLowerCase().replace(/[^a-z0-9]/g, '')) {
      const slug = newName.toLowerCase().replace(/[^a-z0-9]/g, '');
      setUsername(slug);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      toast.error('Please enter delivery boy full name');
      return;
    }

    const cleanPhone = phone.trim().replace(/\D/g, '');
    if (phone.trim() && cleanPhone.length !== 10) {
      toast.error('Please enter a valid 10-digit mobile number');
      return;
    }

    setIsSubmitting(true);
    try {
      const newBoy = await createDeliveryBoy({
        name: cleanName,
        phone: cleanPhone || undefined,
        username: username.trim() || undefined,
        password: password.trim() || undefined,
      });

      toast.success(`🎉 Added ${newBoy.name} to delivery boys!`);
      onCreated(newBoy);
      // Reset form
      setName('');
      setPhone('');
      setUsername('');
      setPassword('');
      setShowAdvanced(false);
      onClose();
    } catch (err: any) {
      console.error('Failed to create delivery boy:', err);
      toast.error(err.message || 'Failed to add delivery boy');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <UserPlus size={18} />
            </div>
            <div>
              <h2 className="text-sm font-black text-white tracking-wide">Add New Delivery Boy</h2>
              <p className="text-[11px] text-slate-400">Creates delivery staff profile for daily settlements</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Full Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <User size={13} className="text-amber-400" />
              Delivery Boy Name <span className="text-amber-400">*</span>
            </label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={handleNameChange}
              placeholder="e.g. Ramesh Kumar"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white font-bold text-sm placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
            />
          </div>

          {/* Mobile Number */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <Phone size={13} className="text-emerald-400" />
              Mobile Number <span className="text-slate-500 text-[10px] font-normal">(for WhatsApp receipts)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">+91</span>
              <input
                type="tel"
                maxLength={10}
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                placeholder="9876543210"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-12 pr-3.5 py-2.5 text-white font-bold text-sm tracking-wider placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none tabular-nums"
              />
            </div>
          </div>

          {/* Toggle Advanced fields (Username & Login Password) */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-[11px] font-bold text-amber-400/90 hover:text-amber-300 flex items-center gap-1 transition-colors"
            >
              <Sparkles size={12} />
              {showAdvanced ? 'Hide login details' : 'Configure login details (optional)'}
            </button>
          </div>

          {showAdvanced && (
            <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-3 animate-in fade-in duration-150">
              {/* Username */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-400">Username / ID Code</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-bold">@</span>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    placeholder="ramesh"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-8 pr-3 py-2 text-white font-bold text-xs focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
                  <KeyRound size={11} /> Password / Mobile PIN
                </label>
                <input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Defaults to mobile number or 123456"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-bold text-xs focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Modal Action Buttons */}
          <div className="pt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 py-3 bg-slate-800 hover:bg-slate-750 text-slate-300 font-bold text-xs rounded-xl transition-all border border-slate-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="flex-1 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 active:scale-[0.98] text-slate-950 font-black text-xs rounded-xl transition-all shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Saving...
                </>
              ) : (
                <>
                  <UserPlus size={15} /> Save & Select
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
