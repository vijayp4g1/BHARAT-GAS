import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Search, Loader2, ArrowLeft, Filter, MapPin, Camera, User, Phone, CheckCircle, XCircle } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

export const ManagerConsumers = () => {
  const navigate = useNavigate();
  const [consumers, setConsumers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  
  const ITEMS_PER_PAGE = 20;

  useEffect(() => {
    fetchConsumers();
  }, [page, filter, searchQuery]);

  const fetchConsumers = async () => {
    setIsLoading(true);
    try {
      // Query the optimized view we created in Supabase!
      let query = supabase
        .from('manager_consumer_summary')
        .select('*', { count: 'exact' });

      // Apply Search
      if (searchQuery) {
        query = query.or(`consumer_name.ilike.%${searchQuery}%,consumer_number.ilike.%${searchQuery}%,mobile.ilike.%${searchQuery}%`);
      }

      // Apply Filter
      if (filter === 'Completed') {
        query = query.eq('has_location', true).eq('has_photos', true);
      } else if (filter === 'Missing GPS') {
        query = query.eq('has_location', false);
      } else if (filter === 'Missing Photos') {
        query = query.eq('has_photos', false);
      }

      // Pagination
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
  };

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pb-10">
      <header className="glass-header text-white p-5 sticky top-0 z-20 shadow-sm">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center gap-4 justify-between">
          <div className="flex items-center gap-3">
            <Link to="/manager/dashboard" className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
              <ArrowLeft size={20} />
            </Link>
            <h1 className="text-2xl font-bold tracking-tight">All Consumers</h1>
            <span className="bg-blue-800 px-3 py-1 rounded-full text-sm font-semibold border border-blue-400/30">
              {totalCount} Total
            </span>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="relative flex-1 md:w-64">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
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
                className="w-full pl-10 pr-4 py-2.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder-blue-200 focus:outline-none focus:ring-2 focus:ring-white/50 focus:bg-white/20 transition-all"
              />
            </div>
            
            <div className="relative">
              <select
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setPage(0);
                }}
                className="appearance-none pl-10 pr-8 py-2.5 bg-white text-blue-900 font-semibold rounded-xl border-none focus:ring-2 focus:ring-blue-50 cursor-pointer shadow-lg"
              >
                <option value="All">All Consumers</option>
                <option value="Completed">Completed</option>
                <option value="Missing GPS">Missing GPS</option>
                <option value="Missing Photos">Missing Photos</option>
              </select>
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Filter size={16} className="text-blue-900" />
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl w-full mx-auto p-5 md:p-8 flex-1">
        <div className="glass-card rounded-3xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-bold">
                  <th className="p-4 pl-6">Consumer</th>
                  <th className="p-4">Contact</th>
                  <th className="p-4">Address</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-center">Data Collected</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="p-12 text-center">
                      <Loader2 className="animate-spin text-blue-500 mx-auto" size={32} />
                      <p className="text-slate-500 mt-2 font-medium">Loading consumers...</p>
                    </td>
                  </tr>
                ) : consumers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-12 text-center text-slate-500 font-medium">
                      No consumers found matching your criteria.
                    </td>
                  </tr>
                ) : (
                  consumers.map((c) => (
                    <tr 
                      key={c.id} 
                      onClick={() => navigate(`/manager/consumer/${c.id}`)}
                      className="border-b border-slate-100 hover:bg-slate-50/80 transition-colors cursor-pointer group"
                    >
                      <td className="p-4 pl-6 group-hover:bg-blue-50/30 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                            <User size={18} />
                          </div>
                          <div>
                            <p className="font-bold text-slate-800">{c.consumer_name}</p>
                            <p className="text-xs font-semibold text-slate-400">#{c.consumer_number}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2 text-slate-600 text-sm font-medium">
                          <Phone size={14} className="text-slate-400" />
                          {c.mobile}
                        </div>
                      </td>
                      <td className="p-4 text-sm text-slate-600 max-w-xs truncate">
                        {c.address}
                      </td>
                      <td className="p-4">
                        {(() => {
                          const isCompleted = c.has_location && c.has_photos;
                          
                          return (
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                              isCompleted ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                              'bg-amber-100 text-amber-700 border-amber-200'
                            }`}>
                              {isCompleted ? 'Completed' : 'Pending'}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center justify-center gap-2">
                          {c.has_location ? (
                            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-500 flex items-center justify-center border border-emerald-100" title="GPS Collected">
                              <MapPin size={16} />
                            </div>
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-slate-50 text-slate-300 flex items-center justify-center border border-slate-100" title="Missing GPS">
                              <MapPin size={16} />
                            </div>
                          )}
                          
                          {c.has_photos ? (
                            <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-500 flex items-center justify-center border border-purple-100" title="Photo Uploaded">
                              <Camera size={16} />
                            </div>
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-slate-50 text-slate-300 flex items-center justify-center border border-slate-100" title="Missing Photo">
                              <Camera size={16} />
                            </div>
                          )}
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
            <div className="border-t border-slate-100 p-4 flex items-center justify-between bg-slate-50/50">
              <p className="text-sm font-medium text-slate-500">
                Showing {Math.min(page * ITEMS_PER_PAGE + 1, totalCount)} to {Math.min((page + 1) * ITEMS_PER_PAGE, totalCount)} of {totalCount} consumers
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm transition-colors"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm transition-colors"
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
