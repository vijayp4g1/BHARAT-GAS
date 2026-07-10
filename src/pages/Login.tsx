import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import db from '../lib/db';
import { Loader2, User, ShieldCheck } from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';

export const Login = () => {
  const [role, setRole] = useState<'AGENT' | 'MANAGER'>('AGENT');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  const navigate = useNavigate();

  // Check session on mount
  React.useEffect(() => {
    const checkSession = async () => {
      const savedUsername = localStorage.getItem('bgcls_remember_username');
      if (savedUsername) {
        setUsername(savedUsername);
        setRememberMe(true);
      }
      
      const { data: { session } } = await supabase.auth.getSession();
      if (session && session.user) {
        if (session.user.email?.includes('@bgcls.local')) {
          navigate('/agent/search');
        } else {
          navigate('/manager/dashboard');
        }
      }
    };
    checkSession();
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      toast.error('Please enter both username and password');
      return;
    }

    setIsLoading(true);
    try {
      // Handle Remember Me
      if (rememberMe) {
        localStorage.setItem('bgcls_remember_username', username);
      } else {
        localStorage.removeItem('bgcls_remember_username');
      }

      // If the user enters a full email (like the owner), use it directly.
      // If they enter a plain username (like an agent), map it to the dummy email.
      let authEmail = username.toLowerCase().trim();
      if (!authEmail.includes('@')) {
        authEmail = `${authEmail}@bgcls.local`;
      }
      
      const { data, error } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password: password,
      });

      if (error) throw error;
      
      if (data?.user?.id) {
        localStorage.setItem('bgcls_agent_id', data.user.id);
      }

      if (role === 'AGENT') {
        const consumerCount = await db.consumers.count();
        if (consumerCount === 0) {
          toast.success('Agent logged in! Downloading data...');
          // Hydrate offline database with consumers from Supabase in batches
          let allConsumers: any[] = [];
          let from = 0;
          const step = 1000;
          let fetchMore = true;

          while (fetchMore) {
            const { data, error } = await supabase
              .from('manager_consumer_summary')
              .select('*')
              .range(from, from + step - 1);
              
            if (error) {
              console.error('Error fetching consumers:', error);
              break;
            }
            
            if (data && data.length > 0) {
              allConsumers = [...allConsumers, ...data];
              from += step;
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
              return { ...c, searchWords, last_interacted_at: c.created_at || new Date().toISOString() };
            });
            await db.consumers.clear(); 
            await db.consumers.bulkAdd(formattedConsumers);
            console.log(`Hydrated ${formattedConsumers.length} consumers into Dexie`);
          }
        } else {
          toast.success('Agent logged in! Local data ready.');
        }
        navigate('/agent/search');
      } else {
        toast.success('Manager logged in!');
        navigate('/manager/dashboard');
      }
      
    } catch (error: any) {
      toast.error(error.message || 'Invalid login credentials');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-premium-gradient flex flex-col items-center justify-center p-4 overflow-hidden relative">
      {/* Decorative background elements */}
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob"></div>
      <div className="absolute top-[-10%] right-[-10%] w-96 h-96 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-2000"></div>
      <div className="absolute bottom-[-20%] left-[20%] w-96 h-96 bg-indigo-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-4000"></div>
      
      <div className="glass-card rounded-[2rem] shadow-2xl overflow-hidden max-w-md w-full relative z-10 border border-white/20">
        <div className="p-10 text-center relative">
          <div className="absolute inset-0 bg-white/5 backdrop-blur-sm pointer-events-none"></div>
          <div className="relative z-10">
            <div className="bg-gradient-to-br from-blue-500 to-indigo-600 w-24 h-24 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-blue-500/30 transform rotate-3">
              <div className="transform -rotate-3">
                <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
                </svg>
              </div>
            </div>
            <h1 className="text-3xl font-black mb-1 text-slate-800 tracking-tight">SIDDHARTHA BHARAT GAS</h1>
            <p className="text-slate-500 font-medium">Consumer Location System</p>
          </div>
        </div>
        
        <div className="px-10 pb-10">
          {/* Role Selection Tabs */}
          <div className="flex p-1.5 mb-8 bg-slate-100/50 rounded-2xl border border-slate-200/50 backdrop-blur-md">
            <button
              type="button"
              onClick={() => setRole('AGENT')}
              className={`flex-1 py-2.5 text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-all duration-300 ${role === 'AGENT' ? 'bg-white text-blue-600 shadow-md transform scale-[1.02]' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}
            >
              <User size={18} /> Agent
            </button>
            <button
              type="button"
              onClick={() => setRole('MANAGER')}
              className={`flex-1 py-2.5 text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-all duration-300 ${role === 'MANAGER' ? 'bg-white text-blue-600 shadow-md transform scale-[1.02]' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}
            >
              <ShieldCheck size={18} /> Manager
            </button>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2 ml-1">Username</label>
                <input
                  type="text"
                  required
                  className="block w-full px-5 py-4 bg-white/50 backdrop-blur-md rounded-2xl border border-slate-200 focus:bg-white focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium text-slate-800 placeholder-slate-400"
                  placeholder={role === 'AGENT' ? "e.g. agent1" : "e.g. admin"}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2 ml-1">Password</label>
                <input
                  type="password"
                  required
                  className="block w-full px-5 py-4 bg-white/50 backdrop-blur-md rounded-2xl border border-slate-200 focus:bg-white focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium text-slate-800 placeholder-slate-400"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {/* Remember Me Checkbox */}
              <div className="flex items-center ml-1">
                <input
                  id="remember-me"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded cursor-pointer transition-colors"
                />
                <label htmlFor="remember-me" className="ml-2 block text-sm text-slate-600 font-medium cursor-pointer">
                  Remember my username
                </label>
              </div>
            </div>
            
            <button 
              type="submit" 
              disabled={isLoading}
              className="w-full flex justify-center items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold py-4 px-6 rounded-2xl transition-all duration-300 shadow-[0_8px_30px_rgb(0,0,0,0.12)] hover:shadow-[0_8px_30px_rgb(59,130,246,0.3)] disabled:opacity-70 disabled:cursor-not-allowed transform hover:-translate-y-1 active:translate-y-0"
            >
              {isLoading && <Loader2 size={20} className="animate-spin" />}
              {role === 'AGENT' ? 'Login as Agent' : 'Login to Dashboard'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
