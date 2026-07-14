import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Users, MapPin, Camera, CheckCircle, BarChart3, Map, Loader2, Plus, List, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { ConsumerModal } from '../components/ConsumerModal';
import { ManagerBottomNav } from '../components/ManagerBottomNav';

export const ManagerDashboard = () => {
  const [stats, setStats] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success('Logged out successfully');
    navigate('/');
  };

  const fetchDashboardData = async () => {
    try {
      // 1. Get exact counts efficiently using !inner joins to count distinct consumers
      const { count: totalConsumers, error: cError } = await supabase
        .from('consumers')
        .select('*', { count: 'exact', head: true });
        
      const { count: withGps, error: lError } = await supabase
        .from('consumers')
        .select('id, consumer_locations!inner(id)', { count: 'exact', head: true });
        
      const { count: withPhotos, error: pError } = await supabase
        .from('consumers')
        .select('id, consumer_photos!inner(id)', { count: 'exact', head: true });

      const { count: completedConsumers, error: compError } = await supabase
        .from('consumers')
        .select('id, consumer_locations!inner(id), consumer_photos!inner(id)', { count: 'exact', head: true });

      if (cError) throw cError;
      if (lError) throw lError;
      if (pError) throw pError;
      if (compError) throw compError;

      const completionRate = (totalConsumers && totalConsumers > 0) 
        ? Math.round(((completedConsumers || 0) / totalConsumers) * 100) 
        : 0;

      setStats({
        totalConsumers: totalConsumers || 0,
        withGps: withGps || 0,
        withPhotos: withPhotos || 0,
        completionRate
      });
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      toast.error('Failed to load dashboard data from server');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    
    // Initial fetch
    fetchDashboardData();

    const fetchTimeoutRef = { current: null as any };
    const triggerFetch = () => {
      if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
      fetchTimeoutRef.current = setTimeout(() => {
        fetchDashboardData();
      }, 1000);
    };

    // Set up realtime subscriptions for live updates
    const locationsChannel = supabase
      .channel('public:consumer_locations')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'consumer_locations' }, (payload) => {
        if (isMounted) {
          triggerFetch();
          toast.success('New GPS location captured!', { position: 'bottom-right', duration: 3000, icon: '📍' });
        }
      })
      .subscribe();

    const photosChannel = supabase
      .channel('public:consumer_photos')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'consumer_photos' }, (payload) => {
        if (isMounted) {
          triggerFetch();
          toast.success('New photo uploaded!', { position: 'bottom-right', duration: 3000, icon: '📸' });
        }
      })
      .subscribe();

    return () => {
      isMounted = false;
      if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
      supabase.removeChannel(locationsChannel);
      supabase.removeChannel(photosChannel);
    };
  }, []);


  if (isLoading) {
    return (
      <div className="min-h-screen bg-premium-gradient flex flex-col items-center justify-center">
        <Loader2 className="animate-spin text-white mb-4" size={48} />
        <p className="text-white/80 font-medium">Loading live dashboard...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pb-10">
      <header className="glass-header text-white p-4 sm:p-5 sticky top-0 z-20 flex items-center justify-between gap-2">
        <h1 className="text-xl sm:text-2xl font-bold flex-1 min-w-0 truncate tracking-tight flex items-center gap-2">
          <BarChart3 size={24} className="text-blue-300 shrink-0" />
          <span className="truncate">Manager Dashboard</span>
        </h1>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setIsAddModalOpen(true)} className="flex items-center gap-1.5 bg-white text-blue-900 hover:bg-blue-50 px-3 sm:px-4 py-2 rounded-xl font-bold transition-all shadow-lg active:scale-95">
            <Plus size={18} /> <span className="hidden sm:inline">Add</span>
          </button>
          
          {/* Desktop Navigation Links */}
          <nav className="hidden md:flex items-center gap-2">
            <Link to="/manager/consumers" className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 transition-colors border border-white/10" title="Consumers">
              <List size={20} />
            </Link>
            <Link to="/manager/agents" className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 transition-colors border border-white/10" title="Agents">
              <Users size={20} />
            </Link>
            <Link to="/manager/map" className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 transition-colors border border-white/10" title="Map">
              <Map size={20} />
            </Link>
            <Link to="/manager/reports" className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 transition-colors border border-white/10" title="Reports">
              <Download size={20} />
            </Link>
          </nav>
          
          <button onClick={handleLogout} className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/10 hover:bg-red-500/80 transition-colors border border-white/10 shrink-0" aria-label="Logout">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
          </button>
        </div>
      </header>

      <ManagerBottomNav />

      <ConsumerModal isOpen={isAddModalOpen} onClose={() => {
        setIsAddModalOpen(false);
        fetchDashboardData();
      }} />

      <main className="max-w-6xl w-full mx-auto p-5 md:p-8 space-y-8 mt-4">
        
        {/* Stats Grid */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="glass-card glass-card-hover p-6 rounded-2xl flex flex-col gap-4 relative overflow-hidden group">
            <div className="absolute -right-4 -top-4 w-24 h-24 bg-blue-100 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-500"></div>
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 text-white flex items-center justify-center shadow-lg shadow-blue-500/30 z-10">
              <Users size={24} />
            </div>
            <div className="z-10">
              <p className="text-sm text-slate-500 font-semibold uppercase tracking-wider mb-1">Total Consumers</p>
              <p className="text-4xl font-black text-slate-800 tracking-tight">{stats?.totalConsumers}</p>
            </div>
          </div>
          
          <div className="glass-card glass-card-hover p-6 rounded-2xl flex flex-col gap-4 relative overflow-hidden group">
            <div className="absolute -right-4 -top-4 w-24 h-24 bg-emerald-100 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-500"></div>
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-500 text-white flex items-center justify-center shadow-lg shadow-emerald-500/30 z-10">
              <MapPin size={24} />
            </div>
            <div className="z-10">
              <p className="text-sm text-slate-500 font-semibold uppercase tracking-wider mb-1">GPS Collected</p>
              <p className="text-4xl font-black text-slate-800 tracking-tight">{stats?.withGps}</p>
            </div>
          </div>
          
          <div className="glass-card glass-card-hover p-6 rounded-2xl flex flex-col gap-4 relative overflow-hidden group">
            <div className="absolute -right-4 -top-4 w-24 h-24 bg-purple-100 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-500"></div>
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500 to-purple-600 text-white flex items-center justify-center shadow-lg shadow-purple-500/30 z-10">
              <Camera size={24} />
            </div>
            <div className="z-10">
              <p className="text-sm text-slate-500 font-semibold uppercase tracking-wider mb-1">Photos Uploaded</p>
              <p className="text-4xl font-black text-slate-800 tracking-tight">{stats?.withPhotos}</p>
            </div>
          </div>
        </section>

        {/* Progress Section */}
        <section className="glass-card p-8 rounded-3xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-5">
            <BarChart3 size={120} />
          </div>
          <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4">
            <div>
              <h2 className="text-2xl font-black text-slate-800 tracking-tight">Overall Progress</h2>
              <p className="text-slate-500 font-medium mt-1">Consumers with completed location data.</p>
            </div>
            <div className="bg-blue-50 px-4 py-2 rounded-xl border border-blue-100">
               <span className="text-3xl font-black text-blue-600 tracking-tighter">{stats?.completionRate}%</span>
            </div>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-6 overflow-hidden border border-slate-200/60 p-1 shadow-inner relative z-10">
            <div 
              className="bg-gradient-to-r from-blue-600 via-indigo-500 to-blue-400 h-full rounded-full transition-all duration-1500 ease-out relative overflow-hidden shadow-sm" 
              style={{ width: `${stats?.completionRate}%` }}
            >
              <div className="absolute top-0 bottom-0 left-0 right-0 bg-[linear-gradient(45deg,transparent_25%,rgba(255,255,255,0.2)_50%,transparent_75%,transparent_100%)] bg-[length:20px_20px] animate-[shimmer_2s_linear_infinite]"></div>
            </div>
          </div>
        </section>


      </main>
    </div>
  );
};
