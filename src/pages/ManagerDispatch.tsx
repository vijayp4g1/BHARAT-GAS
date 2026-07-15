import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Loader2, ArrowLeft, Users, Map, Upload, FileText, CheckCircle2, Navigation, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ManagerBottomNav } from '../components/ManagerBottomNav';
import { SelectConsumersModal } from '../components/SelectConsumersModal';
import * as XLSX from 'xlsx';

export const ManagerDispatch = () => {
  const [agents, setAgents] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<any | null>(null);
  
  // Dispatch state for selected agent
  const [todayDispatch, setTodayDispatch] = useState<any | null>(null);
  const [dispatchItems, setDispatchItems] = useState<any[]>([]);
  const [isFetchingRoute, setIsFetchingRoute] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);

  useEffect(() => {
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('agents')
        .select('id, name, username, status, role')
        .eq('role', 'AGENT')
        .neq('status', 'DELETED')
        .order('name');
      
      if (error) throw error;
      setAgents(data || []);
    } catch (error) {
      console.error('Error fetching agents:', error);
      toast.error('Failed to load agents');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectAgent = async (agent: any) => {
    setSelectedAgent(agent);
    setIsFetchingRoute(true);
    setTodayDispatch(null);
    setDispatchItems([]);
    
    try {
      const today = new Date().toISOString().split('T')[0];
      
      const { data: dispatches, error: dispatchError } = await supabase
        .from('daily_dispatch')
        .select('*')
        .eq('agent_id', agent.id)
        .eq('dispatch_date', today);
        
      if (dispatchError) throw dispatchError;
      
      if (dispatches && dispatches.length > 0) {
        // Just take the first one if multiple exist due to old bug
        setTodayDispatch(dispatches[0]);
        
        const dispatchIds = dispatches.map(d => d.id);
        
        const { data: items, error: itemsError } = await supabase
          .from('dispatch_items')
          .select(`
            *,
            consumers (
              id, consumer_name, consumer_number, address, mobile,
              consumer_locations ( id ),
              consumer_photos ( id )
            )
          `)
          .in('dispatch_id', dispatchIds)
          .order('sequence_order', { ascending: true });
          
        if (itemsError) throw itemsError;
        setDispatchItems(items || []);
      }
    } catch (error) {
      console.error('Error fetching route:', error);
      toast.error('Failed to load agent route');
    } finally {
      setIsFetchingRoute(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedAgent) return;
    
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
        
        const consumerNumbers = data.map((row: any) => row[0]?.toString().trim()).filter(Boolean);
        
        if (consumerNumbers.length === 0) {
          toast.error('No consumer numbers found in the file.');
          return;
        }

        const { data: dbConsumers, error: consumersError } = await supabase
          .from('consumers')
          .select('id, consumer_number')
          .in('consumer_number', consumerNumbers);

        if (consumersError) throw consumersError;
        
        if (dbConsumers.length === 0) {
          toast.error('No matching consumers found in the database.');
          return;
        }

        // Create or get dispatch
        const today = new Date().toISOString().split('T')[0];
        let dispatchId = todayDispatch?.id;
        
        if (!dispatchId) {
          const { data: newDispatch, error: dispatchError } = await supabase
            .from('daily_dispatch')
            .insert([{ agent_id: selectedAgent.id }])
            .select()
            .single();
            
          if (dispatchError) throw dispatchError;
          dispatchId = newDispatch.id;
        }
        
        // Determine starting sequence
        let startSequence = 1;
        if (dispatchItems.length > 0) {
           startSequence = Math.max(...dispatchItems.map(item => item.sequence_order || 0)) + 1;
        }
        
        const itemsToInsert = dbConsumers.map((c, index) => ({
          dispatch_id: dispatchId,
          consumer_id: c.id,
          sequence_order: startSequence + index
        }));
        
        const { error: itemsError } = await supabase
          .from('dispatch_items')
          .insert(itemsToInsert);
          
        if (itemsError) throw itemsError;
        
        toast.success(`Successfully assigned ${dbConsumers.length} consumers to ${selectedAgent.name}!`);
        // Refresh route
        handleSelectAgent(selectedAgent);
        
      } catch (error) {
        console.error('Error parsing file:', error);
        toast.error('Failed to parse or assign file.');
      } finally {
        setIsUploading(false);
        e.target.value = ''; // Reset
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleManualAssign = async (selectedIds: string[]) => {
    if (!selectedAgent || selectedIds.length === 0) return;
    
    setIsAssigning(true);
    try {
      // Create or get dispatch
      const today = new Date().toISOString().split('T')[0];
      let dispatchId = todayDispatch?.id;
      
      if (!dispatchId) {
        const { data: newDispatch, error: dispatchError } = await supabase
          .from('daily_dispatch')
          .insert([{ agent_id: selectedAgent.id }])
          .select()
          .single();
          
        if (dispatchError) throw dispatchError;
        dispatchId = newDispatch.id;
      }
      
      // Determine starting sequence
      let startSequence = 1;
      if (dispatchItems.length > 0) {
         startSequence = Math.max(...dispatchItems.map(item => item.sequence_order || 0)) + 1;
      }
      
      const itemsToInsert = selectedIds.map((consumerId, index) => ({
        dispatch_id: dispatchId,
        consumer_id: consumerId,
        sequence_order: startSequence + index
      }));
      
      const { error: itemsError } = await supabase
        .from('dispatch_items')
        .insert(itemsToInsert);
        
      if (itemsError) throw itemsError;
      
      toast.success(`Successfully assigned ${selectedIds.length} consumers to ${selectedAgent.name}!`);
      setIsManualModalOpen(false);
      
      // Refresh route
      handleSelectAgent(selectedAgent);
    } catch (error) {
      console.error('Error assigning consumers:', error);
      toast.error('Failed to assign consumers.');
    } finally {
      setIsAssigning(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pb-20 md:pb-10">
      <header className="glass-header text-white p-4 sm:p-5 sticky top-0 z-20 shadow-md">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          {selectedAgent ? (
            <button onClick={() => setSelectedAgent(null)} className="p-2 hover:bg-white/20 rounded-xl transition-colors active:scale-95 shadow-sm">
              <ArrowLeft size={20} />
            </button>
          ) : (
            <Link to="/manager/dashboard" className="p-2 hover:bg-white/20 rounded-xl transition-colors active:scale-95 shadow-sm">
              <ArrowLeft size={20} />
            </Link>
          )}
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
            {selectedAgent ? `Dispatch: ${selectedAgent.name}` : 'Route Dispatch'}
          </h1>
        </div>
      </header>
      
      <ManagerBottomNav />

      <main className="max-w-6xl w-full mx-auto p-4 flex-1">
        {!selectedAgent ? (
          // AGENT SELECTION VIEW
          <div className="space-y-4">
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center shrink-0">
                <Users size={24} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">Select an Agent</h2>
                <p className="text-sm text-slate-500">Choose a delivery agent to view or assign their daily route.</p>
              </div>
            </div>

            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="animate-spin text-blue-500" size={40} />
              </div>
            ) : agents.length === 0 ? (
              <div className="text-center py-12 text-slate-500">No active agents found.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {agents.map(agent => (
                  <div 
                    key={agent.id}
                    onClick={() => handleSelectAgent(agent)}
                    className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer group active:scale-95"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center font-black text-xl group-hover:bg-blue-600 group-hover:text-white transition-colors">
                        {agent.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-800 text-lg">{agent.name}</h3>
                        <p className="text-sm font-semibold text-slate-400">@{agent.username}</p>
                      </div>
                      <div className="ml-auto w-8 h-8 rounded-full bg-slate-50 text-slate-400 flex items-center justify-center group-hover:bg-blue-50 group-hover:text-blue-600">
                        <ArrowLeft size={16} className="rotate-180" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          // SPECIFIC AGENT ROUTE VIEW
          <div className="space-y-6">
            
            {/* Action Bar */}
            <div className="flex flex-col sm:flex-row gap-4 justify-between sm:items-center">
              <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex-1">
                <div className="flex justify-between items-center mb-1">
                  <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Today's Progress</h3>
                  <span className="text-xs font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{dispatchItems.length} Total</span>
                </div>
                <div className="flex items-end gap-2">
                  <span className="text-3xl font-black text-slate-800">
                    {dispatchItems.filter(i => i.status === 'COMPLETED').length}
                  </span>
                  <span className="text-slate-500 font-medium mb-1">/ {dispatchItems.length} Completed</span>
                </div>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => setIsManualModalOpen(true)}
                  className="flex-1 sm:flex-none bg-white text-blue-600 border-2 border-blue-100 px-5 py-3 sm:py-4 rounded-2xl font-bold flex flex-col items-center justify-center gap-1 hover:border-blue-200 hover:bg-blue-50 transition-all shadow-sm active:scale-95 text-center"
                >
                  <Search size={24} />
                  <span className="text-sm">Manual Add</span>
                </button>
                <label className="flex-1 sm:flex-none cursor-pointer bg-gradient-to-r from-emerald-500 to-emerald-400 text-white px-5 py-3 sm:py-4 rounded-2xl font-bold flex flex-col items-center justify-center gap-1 hover:from-emerald-600 hover:to-emerald-500 transition-all shadow-md active:scale-95 text-center">
                  {isUploading ? <Loader2 className="animate-spin" size={24} /> : <Upload size={24} />}
                  <span className="text-sm">Upload Excel</span>
                  <input type="file" accept=".csv, .xlsx" className="hidden" onChange={handleFileUpload} />
                </label>
              </div>
            </div>

            {/* Route List */}
            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center gap-3">
                <Map size={20} className="text-blue-500" />
                <h2 className="font-bold text-slate-800">Assigned Deliveries</h2>
              </div>

              {isFetchingRoute ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="animate-spin text-blue-500" size={32} />
                </div>
              ) : dispatchItems.length === 0 ? (
                <div className="text-center py-16 px-4">
                  <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-200">
                    <FileText size={24} />
                  </div>
                  <h3 className="font-bold text-slate-700 text-lg mb-1">No Deliveries Assigned</h3>
                  <p className="text-slate-500 text-sm max-w-sm mx-auto">Upload an Excel sheet to assign consumers to {selectedAgent.name}'s route today.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {dispatchItems.map((item, index) => {
                    const isCompleted = item.status === 'COMPLETED';
                    return (
                      <div key={item.id} className={`p-4 flex items-center gap-4 transition-colors ${isCompleted ? 'bg-slate-50/50' : 'hover:bg-slate-50'}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${isCompleted ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                          {isCompleted ? <CheckCircle2 size={16} /> : index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className={`font-bold truncate ${isCompleted ? 'text-slate-500 line-through' : 'text-slate-800'}`}>
                            {item.consumers.consumer_name}
                          </h4>
                          <p className="text-xs font-bold text-slate-400">#{item.consumers.consumer_number}</p>
                        </div>
                        <div className="shrink-0 text-xs font-bold text-slate-400">
                           {isCompleted ? 'Done' : 'Pending'}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

          </div>
        )}
      </main>

      <SelectConsumersModal 
        isOpen={isManualModalOpen}
        onClose={() => setIsManualModalOpen(false)}
        onSuccess={handleManualAssign}
        agentName={selectedAgent?.name || ''}
      />
    </div>
  );
};
