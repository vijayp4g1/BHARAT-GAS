import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Wifi, WifiOff, Loader2 } from 'lucide-react';
import db, { type Consumer } from '../lib/db';
import { ConsumerCard } from '../components/ConsumerCard';
import { ConsumerModal } from '../components/ConsumerModal';
import { useLiveQuery } from 'dexie-react-hooks';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

export const AgentSearch = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all'); // 'all', 'pending', 'completed'
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [limit, setLimit] = useState(20);
  const observerTarget = useRef(null);

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
  // Use Dexie live query to fetch and filter consumers with limit for infinite scroll
  const consumers = useLiveQuery(async () => {
    const term = debouncedSearch.toLowerCase().trim();
    const searchWords = term.split(/\s+/).filter(w => w.length > 0);
    
    if (searchWords.length === 0) {
      // No search term: Fast scan with early exit (limit)
      return await db.consumers.filter(c => {
        if (c.isDeleted) return false;
        if (filterStatus === 'completed' && !(c.has_location && c.has_photos)) return false;
        if (filterStatus === 'pending' && (c.has_location && c.has_photos)) return false;
        return true;
      }).limit(limit).toArray();
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
    
    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }
    
    return () => {
      if (observerTarget.current) observer.unobserve(observerTarget.current);
    };
  }, [observerTarget.current]);

  return (
    <div className="min-h-screen bg-premium-gradient flex flex-col">
      <header className="glass-header text-white p-5 sticky top-0 z-10">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold tracking-tight">SIDDHARTHA BHARAT GAS</h1>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-sm font-medium bg-white/10 px-2.5 py-1 rounded-full border border-white/10">
              {isOnline ? <Wifi size={14} className="text-green-400" /> : <WifiOff size={14} className="text-red-400" />}
              {isOnline ? 'Online' : 'Offline'}
            </span>
            <button onClick={handleLogout} className="text-sm font-medium text-white/80 hover:text-white transition-colors cursor-pointer">Logout</button>
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
              placeholder="Search Consumer No, Name, Mobile..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full glass-input text-gray-900 rounded-full pl-12 pr-5 py-3.5 focus:outline-none transition-all placeholder:text-gray-500 font-medium"
            />
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={20} />
          </div>
          <button 
            onClick={() => setIsAddModalOpen(true)}
            className="shrink-0 bg-white/20 hover:bg-white/30 border border-white/30 backdrop-blur-md text-white px-4 py-3.5 rounded-full font-bold shadow-lg flex items-center justify-center transition-all active:scale-95"
            title="Add New Consumer"
          >
            + Add
          </button>
        </div>

        {/* Filter Options */}
        <div className="flex gap-2 bg-white/10 p-1.5 rounded-full backdrop-blur-sm border border-white/10 overflow-x-auto hide-scrollbar">
          <button 
            onClick={() => setFilterStatus('all')}
            className={`flex-1 min-w-[80px] px-3 py-1.5 rounded-full text-sm font-bold transition-all ${filterStatus === 'all' ? 'bg-white text-blue-900 shadow-sm' : 'text-white/80 hover:bg-white/20 hover:text-white'}`}
          >
            All
          </button>
          <button 
            onClick={() => setFilterStatus('pending')}
            className={`flex-1 min-w-[80px] px-3 py-1.5 rounded-full text-sm font-bold transition-all ${filterStatus === 'pending' ? 'bg-white text-amber-600 shadow-sm' : 'text-white/80 hover:bg-white/20 hover:text-white'}`}
          >
            Pending
          </button>
          <button 
            onClick={() => setFilterStatus('completed')}
            className={`flex-1 min-w-[80px] px-3 py-1.5 rounded-full text-sm font-bold transition-all ${filterStatus === 'completed' ? 'bg-white text-emerald-600 shadow-sm' : 'text-white/80 hover:bg-white/20 hover:text-white'}`}
          >
            Completed
          </button>
        </div>
      </header>

      <ConsumerModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} />

      <main className="flex-1 p-5 overflow-y-auto">
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-white/90 font-semibold tracking-wide">
            {debouncedSearch ? 'Search Results' : 'Recent Consumers'}
          </h2>
          <span className="text-sm font-medium text-white/90 bg-white/10 backdrop-blur-md border border-white/20 px-3 py-1 rounded-full shadow-sm">
            {totalCount !== undefined ? totalCount : '...'}
          </span>
        </div>

        <div className="space-y-4 pb-20">
          {consumers === undefined ? (
            <div className="flex justify-center py-12 text-white/70">
               <Loader2 className="animate-spin" size={28} />
            </div>
          ) : consumers.length === 0 ? (
            <div className="text-center py-12 text-white/70 font-medium">No consumers found.</div>

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
                <div ref={observerTarget} className="py-4 flex justify-center text-gray-400">
                  <Loader2 className="animate-spin" size={24} />
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
};
