import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { staffDb } from '../lib/staffDb';
import db from '../lib/db';
import { Loader2, User, ShieldCheck, Database } from 'lucide-react';
import toast from 'react-hot-toast';
import { getFastAuthSession } from '../lib/auth';
import { hasStaffPermission, refreshCurrentStaffPermission } from '../lib/staffAuth';
import { freeLocalStorageSpace, isStorageQuotaError, safeSetItem } from '../lib/storageCleanup';
import { AppRefreshButton } from '../components/AppRefreshButton';

export const Login = () => {
  const [role, setRole] = useState<'AGENT' | 'MANAGER'>('AGENT');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  
  const navigate = useNavigate();

  // Check session on mount
  useEffect(() => {
    let isMounted = true;

    const checkSession = async () => {
      const savedUsername = localStorage.getItem('bgcls_remember_username');
      if (savedUsername) {
        setUsername(savedUsername);
        setRememberMe(true);
      }
      
      const authSession = await getFastAuthSession();
      if (!isMounted) return;

      if (authSession) {
        // Live verify staff permission against database so newly granted staff
        // members get instant access (persists role/staff flags).
        const isStaff = await refreshCurrentStaffPermission();
        if (authSession.role === 'MANAGER') {
          navigate('/manager/dashboard', { replace: true });
        } else if (isStaff) {
          // Staff land on Day End (all delivery boys) directly.
          navigate('/staff/day-end', { replace: true });
        } else {
          navigate('/agent/search', { replace: true });
        }
      } else {
        // Explain a recent automatic sign-out (expired / rejected session) so
        // it does not look like a random bug. An explicit logout sets
        // `explicit: true` and shows no notice.
        try {
          const raw = localStorage.getItem('bgcls_last_auth_signout');
          if (raw) {
            const parsed = JSON.parse(raw);
            const age = Date.now() - Number(parsed?.at || 0);
            if (parsed?.explicit !== true && age > 0 && age < 12 * 60 * 60 * 1000) {
              setSessionNotice(
                'Your login session expired, so you were signed out. Please sign in again — saved bills, drafts and offline data are safe.'
              );
            }
            localStorage.removeItem('bgcls_last_auth_signout');
          }
        } catch (_) {}

        // Not logged in (or just logged out) -> reveal clean login form
        setIsCheckingSession(false);
      }
    };

    checkSession();

    return () => {
      isMounted = false;
    };
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      toast.error('Please enter both username and password');
      return;
    }

    setIsLoading(true);
    try {
      // Clear any prior logout flag
      sessionStorage.removeItem('bgcls_just_logged_out');

      // Login and Supabase auth both need to write to localStorage. A full
      // quota would abort sign-in (the screenshot's "exceeded the quota"
      // error), so free re-fetchable caches first. Saved bills, offline data
      // and recent drafts are kept.
      freeLocalStorageSpace({ aggressive: false });

      // Handle Remember Me
      if (rememberMe) {
        safeSetItem('bgcls_remember_username', username);
      } else {
        try {
          localStorage.removeItem('bgcls_remember_username');
        } catch (_) {}
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

      // Signed in again: clear the previous sign-out diagnostic/banner.
      try {
        localStorage.removeItem('bgcls_last_auth_signout');
      } catch (_) {}
      setSessionNotice(null);
      
      // Auto-detect actual user role and staff permissions from database
      let actualRole: 'AGENT' | 'MANAGER' = role;
      let isStaffMember = false;

      if (data?.user?.id) {
        let { data: agentData } = await staffDb
          .from('agents')
          .select('role, name, is_staff, username')
          .eq('id', data.user.id)
          .maybeSingle();

        if (!agentData && username) {
          const { data: byUser } = await staffDb
            .from('agents')
            .select('role, name, is_staff, username')
            .ilike('username', username.trim())
            .maybeSingle();
          if (byUser) agentData = byUser;
        }

        if (agentData?.role) {
          actualRole = agentData.role as 'AGENT' | 'MANAGER';
        }

        const cleanUser = username.toLowerCase().trim();
        isStaffMember = Boolean(
          agentData?.is_staff === true ||
          hasStaffPermission(data.user.id, username, agentData?.is_staff, agentData?.name) ||
          cleanUser === 'john' ||
          cleanUser === 'ganesh'
        );

        if (isStaffMember) {
          safeSetItem('bgcls_is_staff', 'true');
        } else {
          localStorage.removeItem('bgcls_is_staff');
          safeSetItem('bgcls_is_staff', 'false');
        }

        safeSetItem('bgcls_agent_id', data.user.id);
        safeSetItem('bgcls_user_role', actualRole);
        safeSetItem('bgcls_logged_username', username.toLowerCase().trim());
        if (agentData?.name) {
          safeSetItem('bgcls_agent_name', agentData.name);
        }

        let assignedBoy = data.user?.user_metadata?.assigned_delivery_boy;
        if (!assignedBoy && data.user.id) {
          const { data: auditLog } = await staffDb
            .from('audit_logs')
            .select('action_type')
            .like('action_type', 'ASSIGN_DELIVERY_BOY:%')
            .eq('entity_id', data.user.id)
            .order('timestamp', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (auditLog?.action_type) {
            const parsed = auditLog.action_type.replace('ASSIGN_DELIVERY_BOY:', '').trim().toUpperCase();
            if (parsed && parsed !== 'UNASSIGNED' && parsed !== 'NONE') {
              assignedBoy = parsed;
            }
          }
        }

        if (assignedBoy) {
          safeSetItem('bgcls_assigned_delivery_boy', assignedBoy.trim().toUpperCase());
        } else {
          localStorage.removeItem('bgcls_assigned_delivery_boy');
        }

        // The server is authoritative for role and staff access. Reconcile
        // whatever the fast local guess above produced with admin-api.
        isStaffMember = await refreshCurrentStaffPermission();
        if (localStorage.getItem('bgcls_user_role') === 'MANAGER') {
          actualRole = 'MANAGER';
        }
      }

      if (actualRole === 'MANAGER') {
        toast.success('Manager logged in successfully!');
        navigate('/manager/dashboard', { replace: true });
      } else if (isStaffMember) {
        toast.success('Staff Member logged in successfully!');
        // Staff open the app on Day End (all delivery boys).
        navigate('/staff/day-end', { replace: true });
      } else {
        toast.success('Agent logged in successfully!');
        navigate('/agent/search', { replace: true });
      }
      
    } catch (error: any) {
      // The browser's localStorage is full (the login screenshot error). Free
      // safe caches/old drafts and ask for one retry; Supabase auth cannot
      // persist a session without storage.
      if (isStorageQuotaError(error)) {
        const report = freeLocalStorageSpace({ aggressive: true });
        toast.error(
          report.removedKeys > 0 || report.trimmedAudit
            ? 'Device storage was full. Space has been freed — please tap Login again.'
            : 'Device storage is full. Close other browser tabs/apps and try again.',
          { id: 'storage-full', duration: 8000 }
        );
        return;
      }

      if (!navigator.onLine || error.message?.toLowerCase().includes('fetch')) {
        try {
          const localCount = await db.consumers.count();
          if (localCount > 0) {
            toast.success('Offline Mode Active: Logged in locally!');
            if (!localStorage.getItem('bgcls_agent_id')) {
              safeSetItem('bgcls_agent_id', 'offline_agent');
            }
            safeSetItem('bgcls_user_role', 'AGENT');
            navigate('/agent/search', { replace: true });
            return;
          }
        } catch (e) {
          console.error('Offline fallback error:', e);
        }
      }
      toast.error(error.message || 'Invalid login credentials');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFreeSpace = () => {
    const report = freeLocalStorageSpace({ aggressive: false });
    const kb = Math.round(report.freedBytes / 1024);
    if (report.removedKeys > 0 || report.trimmedAudit) {
      toast.success(
        `Freed ${kb > 0 ? `${kb} KB` : 'space'}. Saved bills, today's data and recent drafts are kept.`,
        { id: 'storage-free', duration: 5000 }
      );
    } else {
      toast(
        'No re-fetchable cache to remove. Your saved data is already minimal.',
        { icon: 'ℹ️', id: 'storage-free' }
      );
    }
  };

  if (isCheckingSession) {
    return (
      <div className="min-h-screen bg-premium-gradient flex flex-col items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob"></div>
        <div className="absolute top-[-10%] right-[-10%] w-96 h-96 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="relative z-10 flex flex-col items-center">
          <div className="bg-gradient-to-br from-blue-500 to-indigo-600 w-20 h-20 rounded-3xl flex items-center justify-center mb-6 shadow-2xl shadow-blue-500/30 transform rotate-3">
            <span className="font-black text-white text-3xl tracking-tighter">BG</span>
          </div>
          <h2 className="text-xl font-bold text-white tracking-wide mb-2">Siddhartha Gas</h2>
          <div className="flex items-center gap-2 text-blue-200/80 text-xs font-semibold">
            <Loader2 className="animate-spin" size={14} />
            <span>Loading Siddhartha Gas...</span>
          </div>
        </div>
      </div>
    );
  }

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
          {sessionNotice && (
            <div className="mb-5 rounded-2xl border border-amber-300/70 bg-amber-50/90 px-4 py-3 text-[12px] font-semibold leading-relaxed text-amber-900">
              {sessionNotice}
            </div>
          )}

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
      
      {/* Local storage/quota repair */}
      <button
        type="button"
        onClick={handleFreeSpace}
        className="absolute bottom-24 z-10 flex items-center gap-1.5 text-[11px] font-medium text-white/60 hover:text-white/90 bg-black/10 backdrop-blur-sm px-3 py-1 rounded-full border border-white/10"
        title="Free re-fetchable caches and old drafts"
      >
        <Database size={12} />
        <span>Storage full? Free space</span>
      </button>

      {/* App cache repair — useful when Chrome is serving an old app version */}
      <AppRefreshButton
        variant="link"
        className="absolute bottom-16 z-10 flex items-center gap-1.5 text-[11px] font-medium text-white/60 hover:text-white/90 bg-black/10 backdrop-blur-sm px-3 py-1 rounded-full border border-white/10"
        label="App not updating? Clear cache"
        title="Refresh app / clear cache"
      />

      {/* Version Label */}
      <div className="absolute bottom-6 text-white/50 text-xs font-medium font-mono tracking-wider z-10 backdrop-blur-sm bg-black/10 px-3 py-1 rounded-full border border-white/10">
        v2.0.0
      </div>
    </div>
  );
};
