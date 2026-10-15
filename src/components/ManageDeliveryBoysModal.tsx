import React, { useState, useEffect } from 'react';
import {
  X,
  Users,
  UserPlus,
  Search,
  Phone,
  CheckCircle2,
  EyeOff,
  Eye,
  Edit2,
  Check,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  fetchCylinderBookDeliveryBoys,
  setDeliveryBoyStatus,
  updateDeliveryBoy,
  type DeliveryBoy,
} from '../lib/agentService';

interface ManageDeliveryBoysModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenAddModal: () => void;
  onListUpdated: () => void;
}

export const ManageDeliveryBoysModal: React.FC<ManageDeliveryBoysModalProps> = ({
  isOpen,
  onClose,
  onOpenAddModal,
  onListUpdated,
}) => {
  const [boys, setBoys] = useState<DeliveryBoy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [isUpdating, setIsUpdating] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const data = await fetchCylinderBookDeliveryBoys();
      setBoys(data);
    } catch (err) {
      toast.error('Failed to load delivery boys list');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleToggleStatus = async (boy: DeliveryBoy) => {
    const newStatus = boy.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    setIsUpdating(boy.id);
    try {
      await setDeliveryBoyStatus(boy.id, newStatus);
      setBoys((prev) =>
        prev.map((b) => (b.id === boy.id ? { ...b, status: newStatus } : b))
      );
      toast.success(
        newStatus === 'ACTIVE'
          ? `Activated "${boy.name}"`
          : `Deactivated "${boy.name}" (hidden from settlement entries)`
      );
      onListUpdated();
    } catch (err) {
      toast.error('Failed to change status');
    } finally {
      setIsUpdating(null);
    }
  };

  const handleStartEdit = (boy: DeliveryBoy) => {
    setEditingId(boy.id);
    setEditName(boy.name);
    setEditPhone(boy.phone || '');
  };

  const handleSaveEdit = async (boyId: string) => {
    if (!editName.trim()) {
      toast.error('Name cannot be empty');
      return;
    }
    setIsUpdating(boyId);
    try {
      await updateDeliveryBoy(boyId, {
        name: editName.trim(),
        phone: editPhone.trim() || undefined,
      });
      setBoys((prev) =>
        prev.map((b) =>
          b.id === boyId
            ? { ...b, name: editName.trim(), phone: editPhone.trim() || null }
            : b
        )
      );
      setEditingId(null);
      toast.success('Updated delivery boy details');
      onListUpdated();
    } catch (err) {
      toast.error('Failed to save update');
    } finally {
      setIsUpdating(null);
    }
  };

  const filteredBoys = boys.filter((b) => {
    if (filter === 'ACTIVE' && b.status !== 'ACTIVE') return false;
    if (filter === 'INACTIVE' && b.status !== 'INACTIVE') return false;
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      const matchName = b.name.toLowerCase().includes(q);
      const matchUsername = b.username.toLowerCase().includes(q);
      const matchPhone = (b.phone || '').includes(q);
      return matchName || matchUsername || matchPhone;
    }
    return true;
  });

  const activeCount = boys.filter((b) => b.status === 'ACTIVE').length;
  const inactiveCount = boys.filter((b) => b.status === 'INACTIVE').length;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Users size={20} />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-black text-white">Manage Delivery Boys</h2>
              <p className="text-[11px] text-slate-400">
                Hide old/test names & keep only your active delivery boys
              </p>
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

        {/* Toolbar: Search, Filters, Add Button */}
        <div className="p-4 border-b border-slate-800 bg-slate-900/50 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search delivery boys by name, phone..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white font-bold placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenAddModal();
              }}
              className="px-3.5 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 active:scale-95 text-slate-950 font-black text-xs rounded-xl shadow-md flex items-center gap-1.5 shrink-0"
            >
              <UserPlus size={14} />
              <span className="hidden sm:inline">Add New</span>
              <span className="sm:hidden">New</span>
            </button>
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFilter('ALL')}
              className={`px-3 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                filter === 'ALL'
                  ? 'bg-slate-800 text-white border-slate-600'
                  : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:text-white'
              }`}
            >
              All ({boys.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('ACTIVE')}
              className={`px-3 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                filter === 'ACTIVE'
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:text-emerald-400'
              }`}
            >
              Active ({activeCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter('INACTIVE')}
              className={`px-3 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                filter === 'INACTIVE'
                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                  : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:text-rose-400'
              }`}
            >
              Hidden / Inactive ({inactiveCount})
            </button>
          </div>
        </div>

        {/* Delivery Boys List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {isLoading ? (
            <div className="py-12 text-center text-slate-400">
              <RefreshCw className="animate-spin mx-auto mb-2 text-amber-500" size={24} />
              <p className="text-xs font-bold">Loading delivery boys...</p>
            </div>
          ) : filteredBoys.length === 0 ? (
            <div className="py-12 text-center text-slate-400 bg-slate-950/40 rounded-2xl border border-slate-800/80 p-4">
              <AlertTriangle className="mx-auto mb-2 text-amber-400/80" size={24} />
              <p className="text-xs font-bold text-white mb-1">No delivery boys match criteria</p>
              <p className="text-[11px] text-slate-400 mb-3">Add your real delivery boys to get started</p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAddModal();
                }}
                className="px-4 py-2 bg-amber-500 text-slate-950 font-black text-xs rounded-xl inline-flex items-center gap-1.5"
              >
                <UserPlus size={14} /> Add First Delivery Boy
              </button>
            </div>
          ) : (
            filteredBoys.map((boy) => {
              const isEditing = editingId === boy.id;
              const isBusy = isUpdating === boy.id;
              const isActive = boy.status === 'ACTIVE';

              return (
                <div
                  key={boy.id}
                  className={`p-3.5 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    isActive
                      ? 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                      : 'bg-slate-950/30 border-slate-900 opacity-60'
                  }`}
                >
                  {isEditing ? (
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="Delivery Boy Name"
                          className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-bold"
                          autoFocus
                        />
                        <input
                          type="tel"
                          maxLength={10}
                          value={editPhone}
                          onChange={(e) => setEditPhone(e.target.value.replace(/\D/g, ''))}
                          placeholder="Phone number"
                          className="w-32 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-bold"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(boy.id)}
                          disabled={isBusy}
                          className="px-3 py-1 bg-emerald-500 text-slate-950 font-bold text-xs rounded-lg inline-flex items-center gap-1"
                        >
                          <Check size={12} /> Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="px-3 py-1 bg-slate-800 text-slate-300 font-bold text-xs rounded-lg"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-xs shrink-0 ${
                          isActive
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : 'bg-slate-800 text-slate-500'
                        }`}
                      >
                        {boy.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs sm:text-sm text-white truncate">
                            {boy.name}
                          </span>
                          <span
                            className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider ${
                              isActive
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {isActive ? 'Active' : 'Hidden'}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                          <span>@{boy.username}</span>
                          {boy.phone ? (
                            <span className="flex items-center gap-1 text-slate-300">
                              <Phone size={10} className="text-emerald-400" /> {boy.phone}
                            </span>
                          ) : (
                            <span className="text-slate-500 italic">No phone</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Actions for each delivery boy */}
                  {!isEditing && (
                    <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                      {/* Edit Name / Phone */}
                      <button
                        type="button"
                        onClick={() => handleStartEdit(boy)}
                        title="Edit name and phone"
                        className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded-lg transition-colors"
                      >
                        <Edit2 size={14} />
                      </button>

                      {/* Toggle Active / Inactive Status */}
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(boy)}
                        disabled={isBusy}
                        title={isActive ? 'Hide from settlement entry' : 'Show in settlement entry'}
                        className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5 ${
                          isActive
                            ? 'bg-rose-500/10 border-rose-500/30 text-rose-300 hover:bg-rose-500/20'
                            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
                        }`}
                      >
                        {isActive ? (
                          <>
                            <EyeOff size={13} />
                            <span>Hide</span>
                          </>
                        ) : (
                          <>
                            <Eye size={13} />
                            <span>Activate</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-xs text-slate-400">
          <span>Active delivery boys appear in Speed Entry dropdown</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
