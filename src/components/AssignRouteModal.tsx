import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { X, Loader2, Map, Users } from 'lucide-react';
import toast from 'react-hot-toast';

interface AssignRouteModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedConsumerIds: string[];
  onSuccess: () => void;
}

export const AssignRouteModal: React.FC<AssignRouteModalProps> = ({ isOpen, onClose, selectedConsumerIds, onSuccess }) => {
  const [agents, setAgents] = useState<any[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchAgents();
    }
  }, [isOpen]);

  const fetchAgents = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('agents')
        .select('id, name, username')
        .eq('role', 'AGENT')
        .neq('status', 'DELETED')
        .order('name');
      
      if (error) throw error;
      setAgents(data || []);
      if (data && data.length > 0) {
        setSelectedAgentId(data[0].id);
      }
    } catch (error) {
      console.error('Error fetching agents:', error);
      toast.error('Failed to load agents');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAssign = async () => {
    if (!selectedAgentId) {
      toast.error('Please select an agent');
      return;
    }
    
    if (selectedConsumerIds.length === 0) {
      toast.error('No consumers selected');
      return;
    }

    setIsSubmitting(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      let dispatchId = '';

      // 1. Check if dispatch already exists for today
      const { data: existingDispatches, error: existingError } = await supabase
        .from('daily_dispatch')
        .select('id')
        .eq('agent_id', selectedAgentId)
        .eq('dispatch_date', today);

      if (existingError) throw existingError;

      if (existingDispatches && existingDispatches.length > 0) {
        dispatchId = existingDispatches[0].id;
      } else {
        // Create new dispatch
        const { data: dispatchData, error: dispatchError } = await supabase
          .from('daily_dispatch')
          .insert([{ agent_id: selectedAgentId }])
          .select()
          .single();
          
        if (dispatchError) throw dispatchError;
        dispatchId = dispatchData.id;
      }
      
      // 2. Get highest sequence order currently
      const { data: currentItems, error: currentItemsError } = await supabase
        .from('dispatch_items')
        .select('sequence_order')
        .eq('dispatch_id', dispatchId)
        .order('sequence_order', { ascending: false })
        .limit(1);
        
      let startSequence = 1;
      if (!currentItemsError && currentItems && currentItems.length > 0) {
        startSequence = (currentItems[0].sequence_order || 0) + 1;
      }
      
      // 3. Insert Items
      const itemsToInsert = selectedConsumerIds.map((consumerId, index) => ({
        dispatch_id: dispatchId,
        consumer_id: consumerId,
        sequence_order: startSequence + index
      }));
      
      const { error: itemsError } = await supabase
        .from('dispatch_items')
        .insert(itemsToInsert);
        
      if (itemsError) throw itemsError;
      
      toast.success(`Successfully assigned ${selectedConsumerIds.length} locations!`);
      onSuccess();
    } catch (error) {
      console.error('Error assigning route:', error);
      toast.error('Failed to assign route');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-5 flex justify-between items-center text-white relative">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Map size={20} /> Assign Daily Route
          </h2>
          <button onClick={onClose} className="p-2 text-white/80 hover:text-white hover:bg-white/20 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <div className="p-6">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6 text-blue-800 text-sm">
            You are about to assign <strong>{selectedConsumerIds.length}</strong> consumers to a delivery agent for today's route.
          </div>
          
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="animate-spin text-blue-500" size={32} />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Select Delivery Agent</label>
              {agents.length === 0 ? (
                <p className="text-red-500 text-sm">No active delivery agents found.</p>
              ) : (
                <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
                  {agents.map(agent => (
                    <div 
                      key={agent.id}
                      onClick={() => setSelectedAgentId(agent.id)}
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                        selectedAgentId === agent.id 
                          ? 'border-blue-500 bg-blue-50 shadow-sm' 
                          : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg shrink-0 ${
                        selectedAgentId === agent.id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {agent.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-bold text-slate-800">{agent.name}</p>
                        <p className="text-xs text-slate-500">@{agent.username}</p>
                      </div>
                      
                      <div className={`ml-auto w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        selectedAgentId === agent.id ? 'border-blue-600' : 'border-slate-300'
                      }`}>
                        {selectedAgentId === agent.id && <div className="w-2.5 h-2.5 bg-blue-600 rounded-full" />}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        
        <div className="p-5 border-t border-slate-100 bg-slate-50 flex gap-3">
          <button 
            onClick={onClose}
            className="flex-1 py-3 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={handleAssign}
            disabled={isSubmitting || !selectedAgentId}
            className="flex-1 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold rounded-xl hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-blue-500/30 transition-all"
          >
            {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Map size={18} />}
            Assign Route
          </button>
        </div>
      </div>
    </div>
  );
};
