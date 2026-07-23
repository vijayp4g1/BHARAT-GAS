import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Loader2, RefreshCw, Database, Users } from 'lucide-react';
import db from '../lib/db';
import { ConsumerCard } from '../components/ConsumerCard';
import { ConsumerModal } from '../components/ConsumerModal';
import { useLiveQuery } from 'dexie-react-hooks';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { useAgentLocationTracking } from '../hooks/useAgentLocationTracking';
import { AgentBottomNav } from '../components/AgentBottomNav';
import { pullLatestCloudData } from '../lib/sync';

export const AgentSearch = () => {
  useAgentLocationTracking();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all'); // 'all', 'pending', 'completed'
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [limit, setLimit] = useState(20);
  const observerTarget = useRef(null);
  const [isHydrating, setIsHydrating] = useState(false);
  const [hydrationProgress, setHydrationProgress] = useState(0);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success('Logged out successfully');
    navigate('/');
  };

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Check if DB is empty and hydrate if needed (fixes 0 search results after clear cache)
  useEffect(() => {
    const hydrateIfNeeded = async () => {
      if (!isOnline) return;
      const count = await db.consumers.count();
      if (count === 0) {
        setIsHydrating(true);
        try {
          const { count: totalRemote } = await supabase.from('manager_consumer_summary').select('*', { count: 'exact', head: true });
          const totalToFetch = totalRemote || 10000;
          
          let allConsumers: any[] = [];
          let from = 0;
          const step = 1000;
          let fetchMore = true;

          while (fetchMore) {
            const { data, error } = await supabase
              .from('manager_consumer_summary')
              .select('*')
              .range(from, from + step - 1);
              
            if (error) break;
            if (data && data.length > 0) {
              allConsumers = [...allConsumers, ...data];
              from += step;
              setHydrationProgress(Math.min(100, Math.round((allConsumers.length / totalToFetch) * 100)));
            }
            if (!data || data.length < step) {
              fetchMore = false;
            }
          }
            
          if (allConsumers.length > 0) {
            const formattedConsumers = allConsumers.map(c => {
              const searchWords = [
                ...(c.consumer_name ? c.consumer_name.toLowerCase().split(/\s+/) : []),
                ...(c.consumer_number ? [c.consumer_number.toLowerCase()] : []),
                ...(c.mobile ? [c.mobile.toLowerCase()] : [])
              ];
              return { 
                ...c, 
                has_location: !!c.has_location,
                has_photos: !!c.has_photos,
                searchWords
              };
            });
            await db.consumers.bulkAdd(formattedConsumers);
            console.log(`Hydrated ${allConsumers.length} consumers from background sync`);
          }
        } catch (_e) {
          toast.error('Failed to download data.');
        } finally {
          setIsHydrating(false);
        }
      }
    };
    hydrateIfNeeded();
    if (isOnline) {
      pullLatestCloudData().catch(console.error);
    }
  }, [isOnline]);

  // Debounce search to prevent UI freezing on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Reset limit when searching or filtering
  useEffect(() => {
    setLimit(20);
  }, [debouncedSearch, filterStatus]);

  // Use Dexie live query to fetch and filter consumers with limit for infinite scroll
  const consumers = useLiveQuery(async () => {
    const term = debouncedSearch.toLowerCase().trim();
    const searchWords = term.split(/\s+/).filter(w => w.length > 0);
    
    if (searchWords.length === 0) {
      // Fetch all consumers (bulk read is much faster than indexed cursor for full scans)
      let allConsumers = await db.consumers.toArray();
      
      // Get device & agent scoped recent interaction timestamps
      let recentMap: Record<string, string> = {};
      try {
        const devId = localStorage.getItem('bgcls_device_id') || 'dev_default';
        const agentId = localStorage.getItem('bgcls_agent_id') || 'agent_default';
        const storageKey = `bgcls_recent_interactions_${devId}_${agentId}`;
        const saved = localStorage.getItem(storageKey);
        if (saved) recentMap = JSON.parse(saved);
      } catch (e) {}

      // Filter in-memory
      let filtered = allConsumers.filter(c => {
        if (c.isDeleted) return false;
        if (filterStatus === 'completed' && !(c.has_location && c.has_photos)) return false;
        if (filterStatus === 'pending' && (c.has_location && c.has_photos)) return false;
        return true;
      });

      // Sort strictly by local device interaction timestamp descending
      filtered.sort((a, b) => {
        const tAStr = recentMap[a.id] || a.last_interacted_at;
        const tBStr = recentMap[b.id] || b.last_interacted_at;
        const tA = tAStr ? new Date(tAStr).getTime() : 0;
        const tB = tBStr ? new Date(tBStr).getTime() : 0;
        if (tA !== tB) return tB - tA;
        return (a.consumer_number || '').localeCompare(b.consumer_number || '');
      });

      return filtered.slice(0, limit);
    }
    
    // Has search term: Use ultra-fast index
    let baseCollection = db.consumers.where('searchWords').startsWith(searchWords[0]);
    
    // Apply remaining filters
    let results = await baseCollection.filter(c => {
      if (c.isDeleted) return false;
      if (filterStatus === 'completed' && !(c.has_location && c.has_photos)) return false;
      if (filterStatus === 'pending' && (c.has_location && c.has_photos)) return false;
      
      if (searchWords.length > 1) {
        return searchWords.slice(1).every(word => 
          c.searchWords && c.searchWords.some(sw => sw.startsWith(word))
        );
      }
      return true;
    }).toArray();
    
    // Sort by relevance (exact match first)
    return results.sort((a, b) => {
      if (a.consumer_number === term && b.consumer_number !== term) return -1;
      if (b.consumer_number === term && a.consumer_number !== term) return 1;
      if (a.mobile === term && b.mobile !== term) return -1;
      if (b.mobile === term && a.mobile !== term) return 1;
      return 0;
    }).slice(0, limit);
  }, [debouncedSearch, filterStatus, limit]);

  // Total count for the results header
  const totalCount = useLiveQuery(async () => {
    const term = debouncedSearch.toLowerCase().trim();
    const searchWords = term.split(/\s+/).filter(w => w.length > 0);
    
    if (searchWords.length === 0) {
      return await db.consumers.filter(c => {
        if (c.isDeleted) return false;
        if (filterStatus === 'completed') return !!(c.has_location && c.has_photos);
        if (filterStatus === 'pending') return !(c.has_location && c.has_photos);
        return true;
      }).count();
    }
    
    return await db.consumers.where('searchWords').startsWith(searchWords[0]).filter(c => {
      if (c.isDeleted) return false;
      if (filterStatus === 'completed' && !(c.has_location && c.has_photos)) return false;
      if (filterStatus === 'pending' && (c.has_location && c.has_photos)) return false;
      
      if (searchWords.length > 1) {
        return searchWords.slice(1).every(word => 
          c.searchWords && c.searchWords.some(sw => sw.startsWith(word))
        );
      }
      return true;
    }).count();
  }, [debouncedSearch, filterStatus]);

  // Intersection Observer for Infinite Scrolling
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) {
          setLimit(prev => prev + 20);
        }
      },
      { threshold: 1.0 }
    );
    
    const currentTarget = observerTarget.current;
    
    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }
    
    return () => {
      if (currentTarget) observer.unobserve(currentTarget);
    };
  }, [consumers?.length, totalCount]);

  // Realtime listeners for portal updates
  useEffect(() => {
    if (!isOnline) return;

    const locSub = supabase.channel('locations_channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'consumer_locations' }, payload => {
         db.consumers.update(payload.new.consumer_id, { has_location: true }).catch(() => {});
      }).subscribe();

    const photoSub = supabase.channel('photos_channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'consumer_photos' }, payload => {
         db.consumers.update(payload.new.consumer_id, { has_photos: true }).catch(() => {});
      }).subscribe();

    return () => {
      supabase.removeChannel(locSub);
      supabase.removeChannel(photoSub);
    };
  }, [isOnline]);

  const handleSyncData = async () => {
    if (!isOnline) {
      toast.error("You are offline. Cannot sync data.");
      return;
    }
    
    toast.loading('Syncing latest updates...', { id: 'sync' });
    try {
      await pullLatestCloudData();
      toast.success('Data synced successfully!', { id: 'sync' });
    } catch (err) {
      console.error(err);
      toast.error('Failed to sync data', { id: 'sync' });
    }
  };

  return (
    <div className="min-h-screen bg-premium-gradient flex flex-col relative overflow-hidden">
      {/* Background blobs for premium feel */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-400/20 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-indigo-500/20 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/4 pointer-events-none"></div>

      {isHydrating && (
        <div className="fixed top-0 left-0 right-0 z-50">
          <div className="h-1.5 w-full bg-blue-900/50 backdrop-blur-sm overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-all duration-300 shadow-[0_0_10px_rgba(52,211,153,0.5)]" 
              style={{ width: `${hydrationProgress}%` }}
            ></div>
          </div>
          <div className="bg-blue-900/90 backdrop-blur-md text-white text-xs py-1.5 px-4 flex items-center justify-center gap-2 border-b border-white/10">
            <Database size={12} className="animate-pulse text-emerald-400" />
            <span className="font-medium tracking-wide">Downloading offline data... {hydrationProgress}%</span>
          </div>
        </div>
      )}

      <header className={`glass-header text-white p-5 sticky ${isHydrating ? 'top-8' : 'top-0'} z-10 transition-all duration-300`}>
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-white/20 to-white/5 border border-white/20 flex items-center justify-center backdrop-blur-sm shadow-inner">
              <span className="font-black text-white text-lg tracking-tighter">BG</span>
            </div>
            <h1 className="text-lg sm:text-xl font-bold tracking-wide truncate">Siddhartha Gas</h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <button 
              onClick={handleSyncData}
              title="Sync latest updates"
              className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white backdrop-blur-md transition-all active:scale-95 border border-white/20 shadow-sm"
            >
              <RefreshCw size={16} className="text-white" />
            </button>
            <span className="flex items-center gap-1.5 text-xs sm:text-sm font-bold bg-white/10 px-3 py-1.5 rounded-xl border border-white/10 shadow-sm backdrop-blur-sm">
              {isOnline ? (
                <><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse"></span> <span className="hidden sm:inline">Online</span></>
              ) : (
                <><span className="w-1.5 h-1.5 rounded-full bg-red-400"></span> <span className="hidden sm:inline text-red-200">Offline</span></>
              )}
            </span>
            <button onClick={handleLogout} className="p-2 bg-white/5 hover:bg-red-500/80 rounded-xl transition-all border border-white/10 shadow-sm text-white cursor-pointer active:scale-95">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            </button>
          </div>
        </div>
        
        <div className="flex items-center gap-3 mb-4">
          <div className="relative group flex-1">
            <input 
              type="search" 
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              placeholder="Search by ID, Name or Mobile..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-white/90 backdrop-blur-xl border border-white/40 text-slate-900 rounded-2xl pl-12 pr-5 py-3.5 focus:outline-none transition-all placeholder:text-slate-400 font-medium shadow-[0_4px_20px_rgba(0,0,0,0.1)] focus:bg-white focus:ring-2 focus:ring-blue-400/50"
            />
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" size={20} />
          </div>
          <button 
            onClick={() => setIsAddModalOpen(true)}
            className="shrink-0 bg-gradient-to-r from-emerald-400 to-emerald-500 hover:from-emerald-500 hover:to-emerald-600 border border-emerald-400/50 text-white px-5 py-3.5 rounded-2xl font-bold shadow-lg shadow-emerald-500/20 flex items-center justify-center transition-all active:scale-95"
            title="Add New Consumer"
          >
            + Add
          </button>
        </div>

        {/* Filter Options */}
        <div className="flex gap-2 bg-black/20 p-1.5 rounded-2xl backdrop-blur-md border border-white/10 overflow-x-auto hide-scrollbar">
          <button 
            onClick={() => setFilterStatus('all')}
            className={`flex-1 min-w-[80px] px-3 py-2 rounded-xl text-sm font-bold transition-all ${filterStatus === 'all' ? 'bg-white text-blue-900 shadow-md transform scale-[1.02]' : 'text-white/80 hover:bg-white/20 hover:text-white'}`}
          >
            All
          </button>
          <button 
            onClick={() => setFilterStatus('pending')}
            className={`flex-1 min-w-[80px] px-3 py-2 rounded-xl text-sm font-bold transition-all ${filterStatus === 'pending' ? 'bg-amber-100 text-amber-700 shadow-md transform scale-[1.02]' : 'text-white/80 hover:bg-white/20 hover:text-white'}`}
          >
            Pending
          </button>
          <button 
            onClick={() => setFilterStatus('completed')}
            className={`flex-1 min-w-[80px] px-3 py-2 rounded-xl text-sm font-bold transition-all ${filterStatus === 'completed' ? 'bg-emerald-100 text-emerald-700 shadow-md transform scale-[1.02]' : 'text-white/80 hover:bg-white/20 hover:text-white'}`}
          >
            Completed
          </button>
        </div>
      </header>

      <ConsumerModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} />

      <main className="flex-1 p-4 sm:p-5 overflow-y-auto relative z-0">
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-white font-bold tracking-wide flex items-center gap-2 text-lg">
            {debouncedSearch ? 'Search Results' : 'Recent Consumers'}
          </h2>
          <div className="flex items-center gap-1.5 bg-black/20 backdrop-blur-md border border-white/10 px-3 py-1 rounded-xl shadow-inner">
            <Users size={14} className="text-blue-200" />
            <span className="text-sm font-bold text-white">
              {totalCount !== undefined ? totalCount.toLocaleString() : '...'}
            </span>
          </div>
        </div>

        <div className="space-y-4 pb-20">
          {consumers === undefined ? (
            // Skeleton Loader
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="glass-card rounded-2xl p-5 border-white/20 relative overflow-hidden">
                  <div className="absolute inset-0 skeleton opacity-20"></div>
                  <div className="flex justify-between items-start mb-4 relative z-10">
                    <div className="flex gap-3">
                      <div className="w-11 h-11 rounded-full bg-slate-200/50"></div>
                      <div className="space-y-2">
                        <div className="w-16 h-4 bg-slate-200/50 rounded"></div>
                        <div className="w-32 h-5 bg-slate-200/50 rounded"></div>
                      </div>
                    </div>
                  </div>
                  <div className="w-3/4 h-3 bg-slate-200/50 rounded mb-2 ml-[56px] relative z-10"></div>
                  <div className="w-1/2 h-3 bg-slate-200/50 rounded mb-4 ml-[56px] relative z-10"></div>
                  <div className="flex gap-2 ml-[56px] relative z-10">
                    <div className="w-16 h-6 bg-slate-200/50 rounded-full"></div>
                    <div className="w-16 h-6 bg-slate-200/50 rounded-full"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : consumers.length === 0 ? (
            // Empty State
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <div className="w-24 h-24 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center mb-6 shadow-inner border border-white/20">
                <Search size={40} className="text-blue-200" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">No consumers found</h3>
              <p className="text-blue-100/80 mb-8 max-w-xs text-sm">
                We couldn't find any consumers matching your search criteria. Try a different filter or search term.
              </p>
              {filterStatus !== 'all' || debouncedSearch !== '' ? (
                <button 
                  onClick={() => {
                    setFilterStatus('all');
                    setSearchTerm('');
                  }}
                  className="bg-white/20 hover:bg-white/30 text-white border border-white/30 px-6 py-2.5 rounded-xl font-bold transition-colors active:scale-95"
                >
                  Clear Filters
                </button>
              ) : null}
            </div>
          ) : (
            <>
              {consumers.map(consumer => (
                <ConsumerCard 
                  key={consumer.id} 
                  consumer={consumer} 
                  onClick={() => navigate(`/agent/consumer/${consumer.id}`)} 
                />
              ))}
              
              {/* Infinite Scroll Trigger */}
              {(totalCount ?? 0) > consumers.length && (
                <div ref={observerTarget} className="py-6 flex justify-center">
                  <div className="bg-white/10 backdrop-blur-md p-3 rounded-full border border-white/20">
                    <Loader2 className="animate-spin text-white" size={24} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
      <AgentBottomNav />
    </div>
  );
};
