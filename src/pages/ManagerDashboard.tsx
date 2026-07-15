import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { AgentPerformanceModal } from '../components/AgentPerformanceModal';
import { Users, MapPin, Camera, BarChart3, Map, Loader2, Plus, List, Download, Activity, Target, Navigation, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { ConsumerModal } from '../components/ConsumerModal';
import { ManagerBottomNav } from '../components/ManagerBottomNav';

const CountUp = ({ end, duration = 1500 }: { end: number, duration?: number }) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let startTimestamp: number | null = null;
    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      // easeOutQuart
      const ease = 1 - Math.pow(1 - progress, 4);
      setCount(Math.floor(ease * end));
      if (progress < 1) {
        window.requestAnimationFrame(step);
      } else {
        setCount(end);
      }
    };
    window.requestAnimationFrame(step);
  }, [end, duration]);

  return <>{count}</>;
};

export const ManagerDashboard = () => {
  const [stats, setStats] = useState<any>(null);
  const [agentStats, setAgentStats] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedAgentForModal, setSelectedAgentForModal] = useState<{id: string, name: string} | null>(null);
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

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayIso = today.toISOString();

      const { count: todaysGps } = await supabase
        .from('consumer_locations')
        .select('id', { count: 'exact', head: true })
        .gte('uploaded_at', todayIso);

      const { count: todaysPhotos } = await supabase
        .from('consumer_photos')
        .select('id', { count: 'exact', head: true })
        .gte('uploaded_at', todayIso);

      if (cError) throw cError;
      if (lError) throw lError;
      if (pError) throw pError;
      if (compError) throw compError;

      const { data: agentsData, error: agentsError } = await supabase
        .from('agents')
        .select(`
          id,
          name,
          role,
          consumer_locations(count),
          consumer_photos(count)
        `)
        .neq('status', 'DELETED')
        .order('name');
        
      if (agentsError) throw agentsError;

      const formattedAgentStats = (agentsData || []).map((agent: any) => ({
        id: agent.id,
        name: agent.name,
        locationsCount: Array.isArray(agent.consumer_locations) ? (agent.consumer_locations[0]?.count ?? 0) : (agent.consumer_locations?.count ?? 0),
        photosCount: Array.isArray(agent.consumer_photos) ? (agent.consumer_photos[0]?.count ?? 0) : (agent.consumer_photos?.count ?? 0)
      })).sort((a, b) => (b.locationsCount + b.photosCount) - (a.locationsCount + a.photosCount));

      setAgentStats(formattedAgentStats);

      const completionRate = (totalConsumers && totalConsumers > 0) 
        ? Math.round(((completedConsumers || 0) / totalConsumers) * 100) 
        : 0;

      setStats({
        totalConsumers: totalConsumers || 0,
        withGps: withGps || 0,
        withPhotos: withPhotos || 0,
        completionRate,
        todaysGps: todaysGps || 0,
        todaysPhotos: todaysPhotos || 0
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
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'consumer_locations' }, () => {
        if (isMounted) {
          triggerFetch();
          toast.success('New GPS location captured!', { position: 'bottom-right', duration: 3000, icon: '📍' });
        }
      })
      .subscribe();

    const photosChannel = supabase
      .channel('public:consumer_photos')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'consumer_photos' }, () => {
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
    <div className="min-h-screen bg-slate-50 flex flex-col pb-20 md:pb-10">
      <header className="glass-header text-white p-4 sm:p-5 sticky top-0 z-20 flex items-center justify-between gap-2">
        <h1 className="text-xl sm:text-2xl font-bold flex-1 min-w-0 truncate tracking-tight flex items-center gap-3">
          <div className="bg-white/10 p-1.5 rounded-lg border border-white/20">
            <BarChart3 size={22} className="text-blue-200" />
          </div>
          <span className="truncate">Dashboard</span>
          <span className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 rounded-full text-xs font-bold tracking-wider uppercase ml-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            Live
          </span>
        </h1>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setIsAddModalOpen(true)} className="flex items-center gap-1.5 bg-white text-blue-900 hover:bg-blue-50 px-3 sm:px-4 py-2.5 rounded-xl font-bold transition-all shadow-lg shadow-black/10 active:scale-95 text-sm">
            <Plus size={18} /> <span className="hidden sm:inline">Add Consumer</span>
          </button>
          
          <button onClick={handleLogout} className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/10 hover:bg-red-500/80 transition-colors border border-white/10 shrink-0" aria-label="Logout">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
          </button>
        </div>
      </header>

      <ManagerBottomNav />

      <ConsumerModal isOpen={isAddModalOpen} onClose={() => {
        setIsAddModalOpen(false);
        fetchDashboardData();
      }} />

      <main className="max-w-6xl w-full mx-auto p-4 sm:p-5 md:p-8 space-y-6 md:space-y-8 mt-2">
        
        {/* Quick Actions Grid */}
        <section className="grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4">
          <Link to="/manager/consumers" className="glass-card glass-card-hover p-4 sm:p-5 rounded-2xl flex flex-col gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <List size={20} />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm sm:text-base">Consumers</h3>
              <p className="text-xs text-slate-500 mt-0.5">Manage records</p>
            </div>
          </Link>
          <Link to="/manager/agents" className="glass-card glass-card-hover p-4 sm:p-5 rounded-2xl flex flex-col gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Users size={20} />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm sm:text-base">Agents</h3>
              <p className="text-xs text-slate-500 mt-0.5">Manage team</p>
            </div>
          </Link>
          <Link to="/manager/map" className="glass-card glass-card-hover p-4 sm:p-5 rounded-2xl flex flex-col gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Map size={20} />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm sm:text-base">Live Map</h3>
              <p className="text-xs text-slate-500 mt-0.5">View locations</p>
            </div>
          </Link>
          <Link to="/manager/dispatch" className="glass-card glass-card-hover p-4 sm:p-5 rounded-2xl flex flex-col gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-violet-100 text-violet-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Navigation size={20} />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm sm:text-base">Dispatch</h3>
              <p className="text-xs text-slate-500 mt-0.5">Route mapping</p>
            </div>
          </Link>
          <Link to="/manager/reports" className="glass-card glass-card-hover p-4 sm:p-5 rounded-2xl flex flex-col gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Download size={20} />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm sm:text-base">Reports</h3>
              <p className="text-xs text-slate-500 mt-0.5">Export data</p>
            </div>
          </Link>
        </section>

        {/* Primary Stats Grid */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6">
          <div className="glass-card glass-card-hover p-5 sm:p-6 rounded-2xl flex flex-col gap-4 relative overflow-hidden group">
            <div className="absolute -right-4 -top-4 w-24 h-24 bg-blue-100 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-500"></div>
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 text-white flex items-center justify-center shadow-lg shadow-blue-500/30 z-10">
              <Users size={22} className="sm:w-6 sm:h-6" />
            </div>
            <div className="z-10 mt-auto">
              <p className="text-[10px] sm:text-xs text-slate-500 font-bold uppercase tracking-wider mb-1">Total</p>
              <p className="text-2xl sm:text-4xl font-black text-slate-800 tracking-tight"><CountUp end={stats?.totalConsumers} /></p>
            </div>
          </div>
          
          <div className="glass-card glass-card-hover p-5 sm:p-6 rounded-2xl flex flex-col gap-4 relative overflow-hidden group">
            <div className="absolute -right-4 -top-4 w-24 h-24 bg-emerald-100 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-500"></div>
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-500 text-white flex items-center justify-center shadow-lg shadow-emerald-500/30 z-10">
              <MapPin size={22} className="sm:w-6 sm:h-6" />
            </div>
            <div className="z-10 mt-auto">
              <p className="text-[10px] sm:text-xs text-slate-500 font-bold uppercase tracking-wider mb-1">GPS Saved</p>
              <p className="text-2xl sm:text-4xl font-black text-slate-800 tracking-tight"><CountUp end={stats?.withGps} /></p>
            </div>
          </div>
          
          <div className="glass-card glass-card-hover p-5 sm:p-6 rounded-2xl flex flex-col gap-4 relative overflow-hidden group">
            <div className="absolute -right-4 -top-4 w-24 h-24 bg-purple-100 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-500"></div>
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-gradient-to-br from-purple-500 to-purple-600 text-white flex items-center justify-center shadow-lg shadow-purple-500/30 z-10">
              <Camera size={22} className="sm:w-6 sm:h-6" />
            </div>
            <div className="z-10 mt-auto">
              <p className="text-[10px] sm:text-xs text-slate-500 font-bold uppercase tracking-wider mb-1">Photos</p>
              <p className="text-2xl sm:text-4xl font-black text-slate-800 tracking-tight"><CountUp end={stats?.withPhotos} /></p>
            </div>
          </div>

          <div className="glass-card glass-card-hover p-5 sm:p-6 rounded-2xl flex flex-col gap-4 relative overflow-hidden group">
            <div className="absolute -right-4 -top-4 w-24 h-24 bg-amber-100 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-500"></div>
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 text-white flex items-center justify-center shadow-lg shadow-amber-500/30 z-10">
              <Target size={22} className="sm:w-6 sm:h-6" />
            </div>
            <div className="z-10 mt-auto">
              <p className="text-[10px] sm:text-xs text-slate-500 font-bold uppercase tracking-wider mb-1">Completion</p>
              <p className="text-2xl sm:text-4xl font-black text-slate-800 tracking-tight"><CountUp end={stats?.completionRate} />%</p>
            </div>
          </div>
        </section>

        {/* Progress & Today's Activity Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          <section className="glass-card p-6 sm:p-8 rounded-3xl relative overflow-hidden flex flex-col justify-center">
            <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
              <BarChart3 size={120} />
            </div>
            <div className="relative z-10 flex flex-col sm:flex-row justify-between items-start sm:items-end mb-6 gap-4">
              <div>
                <h2 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">Overall Progress</h2>
                <p className="text-sm text-slate-500 font-medium mt-1">Total database completion.</p>
              </div>
              <div className="bg-blue-50 px-4 py-2 rounded-xl border border-blue-100 shadow-sm">
                 <span className="text-2xl sm:text-3xl font-black text-blue-600 tracking-tighter"><CountUp end={stats?.completionRate} />%</span>
              </div>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-5 sm:h-6 overflow-hidden border border-slate-200/60 p-1 shadow-inner relative z-10">
              <div 
                className="bg-gradient-to-r from-blue-600 via-indigo-500 to-blue-400 h-full rounded-full transition-all duration-1500 ease-out relative overflow-hidden shadow-sm" 
                style={{ width: `${stats?.completionRate}%` }}
              >
                <div className="absolute top-0 bottom-0 left-0 right-0 bg-[linear-gradient(45deg,transparent_25%,rgba(255,255,255,0.2)_50%,transparent_75%,transparent_100%)] bg-[length:20px_20px] animate-[shimmer_2s_linear_infinite]"></div>
              </div>
            </div>
          </section>

          <section className="glass-card p-6 sm:p-8 rounded-3xl">
            <h2 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2 mb-6">
              <Activity className="text-blue-500" size={24} /> Today's Activity
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                    <MapPin size={18} />
                  </div>
                  <div>
                    <p className="font-bold text-slate-800">GPS Collected</p>
                    <p className="text-xs text-slate-500 font-medium">Added today</p>
                  </div>
                </div>
                <span className="text-xl font-black text-slate-800"><CountUp end={stats?.todaysGps} duration={1000} /></span>
              </div>
              
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center">
                    <Camera size={18} />
                  </div>
                  <div>
                    <p className="font-bold text-slate-800">Photos Uploaded</p>
                    <p className="text-xs text-slate-500 font-medium">Added today</p>
                  </div>
                </div>
                <span className="text-xl font-black text-slate-800"><CountUp end={stats?.todaysPhotos} duration={1000} /></span>
              </div>
            </div>
          </section>
        </div>

        {/* Agent Performance Section */}
        <section className="glass-card p-6 sm:p-8 rounded-3xl mt-4 sm:mt-6">
          <h2 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2 mb-6">
            <Users className="text-indigo-500" size={24} /> Agent Performance
          </h2>
          {agentStats.length === 0 ? (
            <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 text-center">
              <p className="text-slate-500 font-medium">No active agents found.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {agentStats.map((agent) => (
                <div 
                  key={agent.id} 
                  onClick={() => setSelectedAgentForModal({ id: agent.id, name: agent.name })}
                  className="flex flex-col p-5 bg-slate-50 hover:bg-white rounded-2xl border border-slate-100 hover:border-blue-100 transition-all shadow-sm hover:shadow-md group cursor-pointer"
                >
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center shrink-0">
                      {agent.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-800 text-base group-hover:text-blue-600 transition-colors line-clamp-1">{agent.name}</h3>
                      <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">
                        {agent.role === 'MANAGER' ? 'Manager' : 'Delivery Agent'}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-auto">
                    <div className="bg-white rounded-xl p-3 border border-slate-100 flex flex-col items-center justify-center">
                      <div className="flex items-center gap-1.5 text-emerald-600 mb-1">
                        <MapPin size={14} />
                        <span className="text-[10px] font-bold uppercase tracking-wider">Locations</span>
                      </div>
                      <span className="text-lg font-black text-slate-800">{agent.locationsCount}</span>
                    </div>
                    <div className="bg-white rounded-xl p-3 border border-slate-100 flex flex-col items-center justify-center">
                      <div className="flex items-center gap-1.5 text-purple-600 mb-1">
                        <Camera size={14} />
                        <span className="text-[10px] font-bold uppercase tracking-wider">Photos</span>
                      </div>
                      <span className="text-lg font-black text-slate-800">{agent.photosCount}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        
        <AgentPerformanceModal 
          isOpen={!!selectedAgentForModal} 
          onClose={() => setSelectedAgentForModal(null)} 
          agent={selectedAgentForModal} 
        />

      </main>
    </div>
  );
};
