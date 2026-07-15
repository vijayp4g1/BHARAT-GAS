import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Search, Loader2, ArrowLeft, Filter, MapPin, Camera, Phone, Upload, X, MessageCircle, MessageSquare } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ManagerBottomNav } from '../components/ManagerBottomNav';

export const ManagerConsumers = () => {
  const navigate = useNavigate();
  const [consumers, setConsumers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  
  const ITEMS_PER_PAGE = 20;

  // Search Debouncing
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);


  const fetchConsumers = useCallback(async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('manager_consumer_summary')
        .select('*', { count: 'exact' });

      if (debouncedSearchQuery) {
        const escaped = debouncedSearchQuery.replace(/[%_]/g, '\\$&');
        query = query.or(`consumer_name.ilike.%${escaped}%,consumer_number.ilike.%${escaped}%,mobile.ilike.%${escaped}%`);
      }

      if (filter === 'Completed') {
        query = query.eq('has_location', true).eq('has_photos', true);
      } else if (filter === 'Missing GPS') {
        query = query.eq('has_location', false);
      } else if (filter === 'Missing Photos') {
        query = query.eq('has_photos', false);
      }

      const from = page * ITEMS_PER_PAGE;
      const to = from + ITEMS_PER_PAGE - 1;
      query = query.range(from, to).order('created_at', { ascending: false });

      const { data, count, error } = await query;
      
      if (error) throw error;
      
      setConsumers(data || []);
      setTotalCount(count || 0);
      
    } catch (error) {
      console.error('Error fetching consumers:', error);
      toast.error('Failed to load consumers');
    } finally {
      setIsLoading(false);
    }
  }, [page, filter, debouncedSearchQuery]);

  useEffect(() => {
    fetchConsumers();
  }, [fetchConsumers]);

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pb-20 md:pb-10">
      <header className="glass-header text-white p-4 sm:p-5 sticky top-0 z-20 shadow-md">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center gap-4 justify-between">
          <div className="flex items-center gap-3">
            <Link to="/manager/dashboard" className="p-2 hover:bg-white/20 rounded-xl transition-colors active:scale-95 shadow-sm">
              <ArrowLeft size={20} />
            </Link>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Consumers</h1>
            <span className="bg-white/10 px-3 py-1 rounded-full text-xs font-bold border border-white/20 shadow-sm backdrop-blur-md hidden sm:inline-block">
              {totalCount} Total
            </span>
          </div>

          <div className="w-full md:w-auto">
            <div className="relative w-full md:w-72">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Search size={18} className="text-blue-200" />
              </div>
              <input
                type="search"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                placeholder="Search name, number..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(0);
                }}
                className="w-full pl-11 pr-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-blue-100/70 focus:outline-none focus:ring-2 focus:ring-white/50 focus:bg-white/20 transition-all font-medium shadow-sm backdrop-blur-md"
              />
            </div>
          </div>
        </div>
      </header>
      
      <ManagerBottomNav />

      {/* Pill Filter Tabs */}
      <div className="bg-white border-b border-slate-200 sticky top-[72px] sm:top-[88px] z-10">
        <div className="max-w-6xl mx-auto p-3 overflow-x-auto hide-scrollbar">
          <div className="flex gap-2">
            {['All', 'Completed', 'Missing GPS', 'Missing Photos'].map(tab => (
              <button
                key={tab}
                onClick={() => {
                  setFilter(tab);
                  setPage(0);
                }}
                className={`px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-all shadow-sm ${
                  filter === tab 
                    ? 'bg-blue-600 text-white border border-blue-700 shadow-blue-500/20' 
                    : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100 hover:text-slate-800'
                }`}
              >
                {tab === 'All' ? 'All Consumers' : tab}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-6xl w-full mx-auto p-4 sm:p-5 md:p-8 flex-1">
        <div className="glass-card rounded-3xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-[10px] sm:text-xs uppercase tracking-wider text-slate-500 font-bold">
                  <th className="p-3 sm:p-4 pl-4 sm:pl-6">Consumer</th>
                  <th className="p-3 sm:p-4 hidden md:table-cell">Contact</th>
                  <th className="p-3 sm:p-4 hidden lg:table-cell">Address</th>
                  <th className="p-3 sm:p-4">Status</th>
                  <th className="p-3 sm:p-4 text-center">Data</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  // Skeleton Rows
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-slate-100 relative overflow-hidden">
                      <td className="p-4 relative z-10">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-slate-200/50 skeleton"></div>
                          <div className="space-y-2">
                            <div className="w-32 h-4 bg-slate-200/50 rounded skeleton"></div>
                            <div className="w-20 h-3 bg-slate-200/50 rounded skeleton"></div>
                          </div>
                        </div>
                      </td>
                      <td className="p-4 hidden md:table-cell relative z-10"><div className="w-24 h-4 bg-slate-200/50 rounded skeleton"></div></td>
                      <td className="p-4 hidden lg:table-cell relative z-10"><div className="w-48 h-4 bg-slate-200/50 rounded skeleton"></div></td>
                      <td className="p-4 relative z-10"><div className="w-16 h-6 bg-slate-200/50 rounded-full skeleton"></div></td>
                      <td className="p-4 relative z-10">
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-slate-200/50 skeleton"></div>
                          <div className="w-8 h-8 rounded-lg bg-slate-200/50 skeleton"></div>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : consumers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-12 text-center">
                      <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-200">
                        <Filter size={24} className="text-slate-400" />
                      </div>
                      <p className="text-slate-800 font-bold mb-1">No consumers found</p>
                      <p className="text-slate-500 text-sm">Try adjusting your filters or search terms.</p>
                    </td>
                  </tr>
                ) : (
                  consumers.map((c) => (
                    <tr 
                      key={c.id} 
                      tabIndex={0}
                      onClick={() => navigate(`/manager/consumer/${c.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          navigate(`/manager/consumer/${c.id}`);
                        }
                      }}
                      className="border-b border-slate-100 hover:bg-slate-50/80 transition-colors cursor-pointer group focus:outline-none focus:bg-slate-100/80"
                    >
                      <td className="p-3 sm:p-4 group-hover:bg-blue-50/30 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shrink-0 font-bold border border-blue-200">
                            {c.consumer_name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-bold text-slate-800 text-sm sm:text-base">{c.consumer_name}</p>
                            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 mt-0.5">
                              <p className="text-[10px] sm:text-xs font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded uppercase tracking-wider inline-block">#{c.consumer_number}</p>
                              <div className="md:hidden flex items-center gap-1 text-[10px] text-slate-500 font-medium">
                                <Phone size={10} /> {c.mobile}
                              </div>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="p-4 hidden md:table-cell">
                        <div className="flex items-center gap-2 text-slate-600 text-sm font-bold bg-slate-50 px-2 py-1 rounded border border-slate-100 w-fit">
                          <Phone size={14} className="text-blue-500" />
                          {c.mobile}
                        </div>
                      </td>
                      <td className="p-4 text-sm text-slate-600 max-w-xs truncate hidden lg:table-cell font-medium">
                        {c.address}
                      </td>
                      <td className="p-3 sm:p-4">
                        {(() => {
                          const isCompleted = c.has_location && c.has_photos;
                          
                          return (
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[10px] sm:text-xs font-bold border uppercase tracking-wider ${
                              isCompleted ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
                              'bg-amber-50 text-amber-600 border-amber-200'
                            }`}>
                              {isCompleted ? 'Completed' : 'Pending'}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="p-3 sm:p-4">
                        <div className="flex items-center justify-center gap-1.5 sm:gap-2">
                          {c.has_location ? (
                            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-emerald-50 text-emerald-500 flex items-center justify-center border border-emerald-100 shadow-sm" title="GPS Collected">
                              <MapPin size={14} className="sm:w-4 sm:h-4" />
                            </div>
                          ) : (
                            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-slate-50 text-slate-300 flex items-center justify-center border border-slate-100 shadow-sm" title="Missing GPS">
                              <MapPin size={14} className="sm:w-4 sm:h-4" />
                            </div>
                          )}
                          
                          {c.has_photos ? (
                            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-purple-50 text-purple-500 flex items-center justify-center border border-purple-100 shadow-sm" title="Photo Uploaded">
                              <Camera size={14} className="sm:w-4 sm:h-4" />
                            </div>
                          ) : (
                            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-slate-50 text-slate-300 flex items-center justify-center border border-slate-100 shadow-sm" title="Missing Photo">
                              <Camera size={14} className="sm:w-4 sm:h-4" />
                            </div>
                          )}

                          {/* WhatsApp Link Generator */}
                          <a 
                            href={`https://wa.me/91${c.mobile.replace(/\D/g, '')}?text=${encodeURIComponent(`*SIDDHARTHA BHARAT GAS* ⛽\n_Official Notice_\n\nDear *${c.consumer_name}*,\nTo ensure fast and accurate delivery of your gas cylinder, please verify your GPS location and house photo through our secure portal.\n\n🔗 *Click here to verify:*\n${window.location.origin}/portal\n\nLogin securely using:\n📱 Your Registered Mobile\n🔢 Your 6-Digit Consumer Number\n\nThank you,\nSiddhartha Bharat Gas Agency`)}`}
                            target="_blank" rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-green-50 hover:bg-green-100 text-green-600 flex items-center justify-center border border-green-200 shadow-sm transition-colors" 
                            title="Send Portal Link via WhatsApp"
                          >
                            <MessageCircle size={14} className="sm:w-4 sm:h-4" />
                          </a>

                          {/* Standard SMS Fallback Link Generator */}
                          <a 
                            href={`sms:${c.mobile.replace(/\D/g, '')}?body=${encodeURIComponent(`SIDDHARTHA BHARAT GAS ⛽\nOfficial Notice\n\nDear ${c.consumer_name},\nTo ensure fast delivery of your gas cylinder, please verify your GPS location and house photo.\n\n🔗 Click here to verify:\n${window.location.origin}/portal\n\nLogin with:\n📱 Registered Mobile\n🔢 Consumer Number\n\nThank you,\nSiddhartha Bharat Gas`)}`}
                            onClick={(e) => e.stopPropagation()}
                            className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 flex items-center justify-center border border-blue-200 shadow-sm transition-colors" 
                            title="Send Portal Link via Standard SMS"
                          >
                            <MessageSquare size={14} className="sm:w-4 sm:h-4" />
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="border-t border-slate-100 p-4 flex flex-col sm:flex-row items-center justify-between bg-slate-50/80 gap-4">
              <p className="text-xs sm:text-sm font-bold text-slate-500">
                Showing <span className="text-slate-800">{Math.min(page * ITEMS_PER_PAGE + 1, totalCount)}</span> to <span className="text-slate-800">{Math.min((page + 1) * ITEMS_PER_PAGE, totalCount)}</span> of <span className="text-slate-800">{totalCount}</span>
              </p>
              <div className="flex gap-2 w-full sm:w-auto">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="flex-1 sm:flex-none px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed font-bold text-sm transition-all shadow-sm active:scale-95"
                >
                  Previous
                </button>
                <div className="hidden sm:flex items-center justify-center px-4 font-bold text-sm text-slate-600 bg-white border border-slate-200 rounded-xl">
                  {page + 1} / {totalPages}
                </div>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="flex-1 sm:flex-none px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed font-bold text-sm transition-all shadow-sm active:scale-95"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
