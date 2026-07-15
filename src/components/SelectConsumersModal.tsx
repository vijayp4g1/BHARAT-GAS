import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { X, Search, Loader2, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface SelectConsumersModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (selectedIds: string[]) => void;
  agentName: string;
}

export const SelectConsumersModal: React.FC<SelectConsumersModalProps> = ({ isOpen, onClose, onSuccess, agentName }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [consumers, setConsumers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Simple debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.length >= 3) {
        searchConsumers();
      } else if (searchQuery.length === 0) {
        setConsumers([]);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const searchConsumers = async () => {
    setIsLoading(true);
    try {
      const escaped = searchQuery.replace(/[%_]/g, '\\$&');
      const { data, error } = await supabase
        .from('consumers')
        .select('id, consumer_name, consumer_number, address, mobile')
        .or(`consumer_name.ilike.%${escaped}%,consumer_number.ilike.%${escaped}%,mobile.ilike.%${escaped}%`)
        .limit(50);
        
      if (error) throw error;
      
      const results = data || [];
      
      // Local Relevance Sorting
      const queryLower = searchQuery.toLowerCase().trim();
      results.sort((a, b) => {
        // 1. Exact match on consumer number
        if (a.consumer_number === queryLower && b.consumer_number !== queryLower) return -1;
        if (b.consumer_number === queryLower && a.consumer_number !== queryLower) return 1;
        
        // 2. Exact match on mobile
        if (a.mobile === queryLower && b.mobile !== queryLower) return -1;
        if (b.mobile === queryLower && a.mobile !== queryLower) return 1;
        
        // 3. Starts with on consumer number
        const aStartsNum = a.consumer_number?.startsWith(queryLower) || false;
        const bStartsNum = b.consumer_number?.startsWith(queryLower) || false;
        if (aStartsNum && !bStartsNum) return -1;
        if (bStartsNum && !aStartsNum) return 1;
        
        return 0; // maintain original DB order for the rest
      });
      
      setConsumers(results);
    } catch (error) {
      console.error('Error searching consumers:', error);
      toast.error('Search failed');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Add Consumers</h2>
            <p className="text-sm text-slate-500">Manually select consumers for {agentName}</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-4 border-b border-slate-100">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search size={18} className="text-slate-400" />
            </div>
            <input 
              type="text" 
              placeholder="Search by name, consumer number, or mobile... (min 3 chars)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="block w-full pl-10 pr-3 py-3 border border-slate-200 rounded-xl leading-5 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium text-slate-800"
            />
          </div>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-2 bg-slate-50">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="animate-spin text-blue-500" size={32} />
            </div>
          ) : searchQuery.length > 0 && searchQuery.length < 3 ? (
             <div className="text-center py-12 text-slate-400">Type at least 3 characters to search</div>
          ) : consumers.length === 0 && searchQuery.length >= 3 ? (
             <div className="text-center py-12 text-slate-400">No consumers found matching your search.</div>
          ) : (
            <div className="space-y-2">
              {consumers.map((c) => (
                <div 
                  key={c.id} 
                  onClick={() => toggleSelect(c.id)}
                  className={`p-3 rounded-xl border cursor-pointer flex items-center gap-3 transition-colors ${selectedIds.has(c.id) ? 'bg-blue-50 border-blue-200 shadow-sm' : 'bg-white border-slate-200 hover:border-blue-300'}`}
                >
                  <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 border ${selectedIds.has(c.id) ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 bg-white'}`}>
                    {selectedIds.has(c.id) && <CheckCircle2 size={16} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start">
                      <h4 className="font-bold text-slate-800 truncate">{c.consumer_name}</h4>
                      <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded ml-2 shrink-0">#{c.consumer_number}</span>
                    </div>
                    <div className="text-xs text-slate-500 font-medium mt-0.5 flex items-center gap-2 truncate">
                      <span>{c.mobile || 'No Mobile'}</span>
                      <span className="text-slate-300">•</span>
                      <span className="truncate">{c.address}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-white flex justify-between items-center">
          <div className="text-sm font-bold text-slate-500">
            <span className="text-blue-600 text-lg mr-1">{selectedIds.size}</span>
            Selected
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-5 py-2.5 rounded-xl font-bold text-slate-500 hover:bg-slate-100 transition-colors">
              Cancel
            </button>
            <button 
              onClick={() => onSuccess(Array.from(selectedIds))}
              disabled={selectedIds.size === 0}
              className="px-6 py-2.5 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-blue-500/20 active:scale-95 transition-all"
            >
              Assign to Route
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
