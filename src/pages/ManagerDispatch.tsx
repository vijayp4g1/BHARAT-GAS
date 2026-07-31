import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Loader2, ArrowLeft, Users, Map as MapIcon, Upload, FileText, CheckCircle2, Navigation, Search, Sparkles, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ManagerBottomNav } from '../components/ManagerBottomNav';
import { SelectConsumersModal } from '../components/SelectConsumersModal';
import { optimizeDispatchWithGemini } from '../lib/gemini';
import db from '../lib/db';
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
  const [isAiDispatching, setIsAiDispatching] = useState(false);
  const [aiRationale, setAiRationale] = useState<string | null>(null);

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

      // Ultra-fast single combined query joining daily_dispatch + dispatch_items + consumers in 1 HTTP roundtrip
      const { data: dispatchData, error: dispatchError } = await supabase
        .from('daily_dispatch')
        .select(`
          id,
          agent_id,
          dispatch_date,
          dispatch_items (
            id,
            dispatch_id,
            consumer_id,
            sequence_order,
            status,
            completed_at,
            consumers (
              id,
              consumer_name,
              consumer_number,
              address,
              mobile,
              cylinder_type
            )
          )
        `)
        .eq('agent_id', agent.id)
        .eq('dispatch_date', today)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (dispatchError) {
        console.warn('Single-query fetch notice, using split fallback:', dispatchError);
        const { data: dispatches } = await supabase
          .from('daily_dispatch')
          .select('*')
          .eq('agent_id', agent.id)
          .eq('dispatch_date', today)
          .limit(1);

        if (dispatches && dispatches.length > 0) {
          setTodayDispatch(dispatches[0]);
          const { data: items } = await supabase
            .from('dispatch_items')
            .select(`
              id, dispatch_id, consumer_id, sequence_order, status, completed_at,
              consumers ( id, consumer_name, consumer_number, address, mobile, cylinder_type )
            `)
            .eq('dispatch_id', dispatches[0].id);

          const uniqueMap = new Map<string, any>();
          (items || []).forEach(item => {
            if (item && item.consumer_id && !uniqueMap.has(item.consumer_id)) {
              uniqueMap.set(item.consumer_id, item);
            }
          });
          setDispatchItems(Array.from(uniqueMap.values()));
        }
      } else if (dispatchData) {
        setTodayDispatch(dispatchData);

        const rawItems = (dispatchData as any).dispatch_items || [];
        // Deduplicate items by consumer_id to prevent UI repetition
        const uniqueMap = new Map<string, any>();
        rawItems.forEach((item: any) => {
          if (item && item.consumer_id && !uniqueMap.has(item.consumer_id)) {
            uniqueMap.set(item.consumer_id, item);
          }
        });

        // Sort sequence order
        const sortedItems = Array.from(uniqueMap.values()).sort(
          (a: any, b: any) => (a.sequence_order || 0) - (b.sequence_order || 0)
        );

        setDispatchItems(sortedItems);
      }
    } catch (error: any) {
      console.error('Error fetching route:', error);
      toast.error(error?.message || 'Failed to load agent route');
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

        // Filter out consumers already in this dispatch route
        const existingConsumerIds = new Set(dispatchItems.map(i => i.consumer_id));
        const newConsumers = dbConsumers.filter(c => !existingConsumerIds.has(c.id));

        if (newConsumers.length === 0) {
          toast.error('All consumers in this file are already assigned to this route!');
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
        
        const itemsToInsert = newConsumers.map((c, index) => ({
          dispatch_id: dispatchId,
          consumer_id: c.id,
          sequence_order: startSequence + index
        }));
        
        const { error: itemsError } = await supabase
          .from('dispatch_items')
          .insert(itemsToInsert);
          
        if (itemsError) throw itemsError;
        
        toast.success(`Successfully assigned ${newConsumers.length} new consumers to ${selectedAgent.name}!`);
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

    // Filter out consumers already in this route
    const existingConsumerIds = new Set(dispatchItems.map(i => i.consumer_id));
    const newSelectedIds = selectedIds.filter(id => !existingConsumerIds.has(id));

    if (newSelectedIds.length === 0) {
      toast.error('All selected consumers are already in this route!');
      setIsManualModalOpen(false);
      return;
    }
    
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
      
      const itemsToInsert = newSelectedIds.map((consumerId, index) => ({
        dispatch_id: dispatchId,
        consumer_id: consumerId,
        sequence_order: startSequence + index
      }));
      
      const { error: itemsError } = await supabase
        .from('dispatch_items')
        .insert(itemsToInsert);
        
      if (itemsError) throw itemsError;
      
      toast.success(`Successfully assigned ${newSelectedIds.length} consumers to ${selectedAgent.name}!`);
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

  const handleAiSmartDispatch = async () => {
    if (agents.length === 0) {
      toast.error('No active agents available for dispatch');
      return;
    }

    setIsAiDispatching(true);
    toast.loading('Gemini AI is calculating optimal route clusters...', { id: 'ai-dispatch' });

    try {
      // 1. Fetch unassigned consumers or top 30 pending consumers from DB
      const localConsumers = await db.consumers.toArray();
      let consumersForDispatch = localConsumers.slice(0, 30);

      if (consumersForDispatch.length === 0) {
        const { data: remoteConsumers } = await supabase
          .from('consumers')
          .select('id, consumer_name, consumer_number, address, cylinder_type')
          .limit(30);
        consumersForDispatch = remoteConsumers || [];
      }

      if (consumersForDispatch.length === 0) {
        toast.error('No consumers available to dispatch.', { id: 'ai-dispatch' });
        return;
      }

      // 2. Call Gemini AI
      const aiResult = await optimizeDispatchWithGemini(
        agents.map(a => ({ id: a.id, name: a.name })),
        consumersForDispatch
      );

      if (aiResult.error) {
        toast.error(`AI Dispatch Error: ${aiResult.error}`, { id: 'ai-dispatch' });
        return;
      }

      // 3. Process assignments
      const today = new Date().toISOString().split('T')[0];
      let assignedCount = 0;

      for (const assignment of aiResult.assignments) {
        if (!assignment.consumerIds || assignment.consumerIds.length === 0) continue;

        let { data: existingDispatch } = await supabase
          .from('daily_dispatch')
          .select('id')
          .eq('agent_id', assignment.agentId)
          .eq('dispatch_date', today)
          .maybeSingle();

        let dispatchId = existingDispatch?.id;

        if (!dispatchId) {
          const { data: newDispatch } = await supabase
            .from('daily_dispatch')
            .insert([{ agent_id: assignment.agentId }])
            .select()
            .single();
          dispatchId = newDispatch?.id;
        }

        if (dispatchId) {
          const itemsToInsert = assignment.consumerIds.map((cId, idx) => ({
            dispatch_id: dispatchId,
            consumer_id: cId,
            sequence_order: idx + 1
          }));

          await supabase.from('dispatch_items').insert(itemsToInsert);
          assignedCount += assignment.consumerIds.length;
        }
      }

      setAiRationale(aiResult.overallSummary);
      toast.success(`Gemini AI allocated ${assignedCount} deliveries!`, { id: 'ai-dispatch', duration: 4000 });

      if (selectedAgent) {
        handleSelectAgent(selectedAgent);
      }
    } catch (err) {
      console.error('AI Smart Dispatch failed:', err);
      toast.error('AI Dispatch failed.', { id: 'ai-dispatch' });
    } finally {
      setIsAiDispatching(false);
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    try {
      const { error } = await supabase
        .from('dispatch_items')
        .delete()
        .eq('id', itemId);
        
      if (error) throw error;
      toast.success('Removed stop from route');
      if (selectedAgent) handleSelectAgent(selectedAgent);
    } catch (err) {
      console.error('Failed to remove item:', err);
      toast.error('Failed to remove stop');
    }
  };

  const handleCleanDuplicates = async () => {
    if (!selectedAgent || dispatchItems.length === 0) return;
    
    try {
      const seenConsumerIds = new Set<string>();
      const duplicateItemIds: string[] = [];

      dispatchItems.forEach(item => {
        if (seenConsumerIds.has(item.consumer_id)) {
          duplicateItemIds.push(item.id);
        } else {
          seenConsumerIds.add(item.consumer_id);
        }
      });

      if (duplicateItemIds.length === 0) {
        toast.success('No duplicate stops found!');
        return;
      }

      const { error } = await supabase
        .from('dispatch_items')
        .delete()
        .in('id', duplicateItemIds);

      if (error) throw error;

      toast.success(`Removed ${duplicateItemIds.length} duplicate stops!`);
      handleSelectAgent(selectedAgent);
    } catch (err) {
      console.error('Failed to remove duplicates:', err);
      toast.error('Failed to clean duplicate stops');
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
            <div className="bg-gradient-to-r from-purple-900 via-indigo-900 to-slate-900 p-6 rounded-3xl text-white shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/20 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"></div>
              <div className="flex items-center gap-4 relative z-10">
                <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center shrink-0 border border-white/20 shadow-inner">
                  <Sparkles size={28} className="text-purple-300 animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-black">Gemini 3.6 Flash AI Dispatch</h2>
                    <span className="text-[10px] font-black bg-purple-500 text-white px-2 py-0.5 rounded-md uppercase tracking-wider">AI Powered</span>
                  </div>
                  <p className="text-sm text-purple-200 mt-1 max-w-xl">
                    Automatically balance order allocations, minimize travel distances, and prioritize 10kg Lite Composite orders across all active delivery agents.
                  </p>
                </div>
              </div>
              
              <button 
                onClick={handleAiSmartDispatch}
                disabled={isAiDispatching}
                className="w-full md:w-auto bg-gradient-to-r from-emerald-400 to-teal-400 hover:from-emerald-500 hover:to-teal-500 text-slate-950 px-6 py-3.5 rounded-2xl font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 active:scale-95 transition-all shrink-0 relative z-10"
              >
                {isAiDispatching ? <Loader2 className="animate-spin" size={20} /> : <Sparkles size={20} />}
                Run Gemini AI Smart Dispatch
              </button>
            </div>

            {aiRationale && (
              <div className="bg-purple-50 p-4 rounded-2xl border border-purple-200 text-purple-900 text-xs font-medium flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-purple-600 shrink-0" />
                  <span><strong>AI Rationale:</strong> {aiRationale}</span>
                </div>
                <button onClick={() => setAiRationale(null)} className="text-purple-500 hover:text-purple-800 font-bold ml-2">Dismiss</button>
              </div>
            )}

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
                  <div className="flex gap-2">
                    <span className="text-xs font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{dispatchItems.length} Total</span>
                    {dispatchItems.filter(i => i.consumers?.cylinder_type === '10KG_LITE').length > 0 && (
                      <span className="text-xs font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full flex items-center gap-1 border border-purple-200">
                        🔥 {dispatchItems.filter(i => i.consumers?.cylinder_type === '10KG_LITE').length} Composite 10kg
                      </span>
                    )}
                  </div>
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
              <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <MapIcon size={20} className="text-blue-500" />
                  <h2 className="font-bold text-slate-800">Assigned Deliveries</h2>
                </div>
                <div className="flex items-center gap-2">
                  {dispatchItems.some(i => i.consumers?.cylinder_type === '10KG_LITE') && (
                    <span className="text-xs font-black bg-purple-50 text-purple-700 px-3 py-1 rounded-lg border border-purple-200">
                      Includes 10kg Composite Bookings
                    </span>
                  )}
                  {dispatchItems.length > 0 && (
                    <button
                      onClick={handleCleanDuplicates}
                      className="text-xs font-bold bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-600 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-red-200 transition-colors flex items-center gap-1"
                    >
                      <Trash2 size={13} /> Clean Duplicates
                    </button>
                  )}
                </div>
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
                    const is10kgLite = item.consumers?.cylinder_type === '10KG_LITE';
                    return (
                      <div key={item.id} className={`p-4 flex items-center gap-4 transition-colors ${isCompleted ? 'bg-slate-50/50' : is10kgLite ? 'bg-purple-50/30 hover:bg-purple-50/60' : 'hover:bg-slate-50'}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${isCompleted ? 'bg-emerald-100 text-emerald-600' : is10kgLite ? 'bg-purple-600 text-white font-black' : 'bg-slate-100 text-slate-500'}`}>
                          {isCompleted ? <CheckCircle2 size={16} /> : index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className={`font-bold truncate ${isCompleted ? 'text-slate-500 line-through' : 'text-slate-800'}`}>
                              {item.consumers.consumer_name}
                            </h4>
                            {is10kgLite && (
                              <span className="text-[10px] font-black bg-purple-600 text-white px-2 py-0.5 rounded-md shadow-xs shrink-0">
                                🔥 10kg Composite
                              </span>
                            )}
                          </div>
                          <p className="text-xs font-bold text-slate-400">#{item.consumers.consumer_number}</p>
                        </div>
                        <div className="shrink-0 flex items-center gap-3">
                          <span className="text-xs font-bold text-slate-400">
                            {isCompleted ? 'Done' : 'Pending'}
                          </span>
                          <button
                            onClick={() => handleRemoveItem(item.id)}
                            className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            title="Remove stop from route"
                          >
                            <Trash2 size={15} />
                          </button>
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
