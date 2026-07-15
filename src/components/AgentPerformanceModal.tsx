import React, { useState, useEffect } from 'react';
import { X, Loader2, MapPin, Camera, User, Phone, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

interface AgentPerformanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  agent: { id: string; name: string } | null;
}

export const AgentPerformanceModal: React.FC<AgentPerformanceModalProps> = ({ isOpen, onClose, agent }) => {
  const [consumers, setConsumers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (isOpen && agent) {
      fetchAgentConsumers();
    } else {
      setConsumers([]);
      setSearchTerm('');
    }
  }, [isOpen, agent]);

  const fetchAgentConsumers = async () => {
    if (!agent) return;
    setIsLoading(true);
    try {
      // 1. Fetch locations uploaded by this agent
      const { data: locations } = await supabase
        .from('consumer_locations')
        .select('consumer_id, uploaded_at')
        .eq('uploaded_by', agent.id);

      // 2. Fetch photos uploaded by this agent
      const { data: photos } = await supabase
        .from('consumer_photos')
        .select('consumer_id, uploaded_at')
        .eq('uploaded_by', agent.id);

      // 3. Get unique consumer IDs
      const consumerIds = new Set<string>();
      locations?.forEach(l => consumerIds.add(l.consumer_id));
      photos?.forEach(p => consumerIds.add(p.consumer_id));

      if (consumerIds.size === 0) {
        setConsumers([]);
        return;
      }

      // 4. Fetch the consumers
      const { data: consumersData, error } = await supabase
        .from('manager_consumer_summary')
        .select('*')
        .in('id', Array.from(consumerIds));

      if (error) throw error;
      setConsumers(consumersData || []);
    } catch (error) {
      console.error('Failed to fetch agent consumers:', error);
      toast.error('Failed to load customers for this agent');
    } finally {
      setIsLoading(false);
    }
  };

  const filteredConsumers = consumers.filter(c => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return c.consumer_name?.toLowerCase().includes(term) ||
           c.consumer_number?.toLowerCase().includes(term) ||
           c.mobile?.includes(term);
  });

  if (!isOpen || !agent) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose}></div>
      <div className="bg-white rounded-[2rem] w-full max-w-2xl max-h-[85vh] flex flex-col relative z-10 shadow-2xl border border-slate-200 overflow-hidden">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
          <div>
            <h2 className="text-xl font-black text-slate-800 line-clamp-1">{agent.name}'s Customers</h2>
            <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">{consumers.length} Processed</p>
          </div>
          <button 
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-white hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors border border-slate-200 shadow-sm shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-slate-100 shrink-0">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text"
              placeholder="Search by name, ID or mobile..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full bg-slate-50 pl-11 pr-4 py-3 rounded-xl border-2 border-slate-100 focus:border-indigo-500 focus:bg-white outline-none transition-all font-medium text-slate-800"
            />
          </div>
        </div>

        {/* List */}
        <div className="p-4 overflow-y-auto flex-1 bg-slate-50/50">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="animate-spin text-indigo-500 mb-4" size={40} />
              <p className="text-slate-500 font-bold">Loading customers...</p>
            </div>
          ) : filteredConsumers.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-2xl border border-slate-100 shadow-sm">
              <User className="mx-auto text-slate-300 mb-4" size={48} />
              <p className="text-lg font-bold text-slate-600">No customers found.</p>
              <p className="text-sm text-slate-400 font-medium">This agent hasn't processed any customers yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredConsumers.map(c => (
                <div key={c.id} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
                        #{c.consumer_number}
                      </span>
                      {c.has_location && c.has_photos ? (
                        <span className="text-[10px] font-black uppercase text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full tracking-wider border border-emerald-100">
                          Completed
                        </span>
                      ) : (
                        <span className="text-[10px] font-black uppercase text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full tracking-wider border border-amber-100">
                          Pending
                        </span>
                      )}
                    </div>
                    <h3 className="font-bold text-slate-800 text-lg">{c.consumer_name}</h3>
                    <p className="text-sm font-medium text-slate-500 flex items-center gap-1.5 mt-1">
                      <Phone size={14} className="text-slate-400" /> {c.mobile}
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-2 sm:self-end">
                    {c.has_location && (
                      <div className="flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-100">
                        <MapPin size={12} /> Location
                      </div>
                    )}
                    {c.has_photos && (
                      <div className="flex items-center gap-1 text-xs font-bold text-purple-600 bg-purple-50 px-2 py-1 rounded-lg border border-purple-100">
                        <Camera size={12} /> Photo
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
