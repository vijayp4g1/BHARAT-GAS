import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase, readPersistedAuthSession } from '../lib/supabase';
import { Loader2 } from 'lucide-react';

import { isCurrentStaffOrManager, refreshCurrentStaffPermission } from '../lib/staffAuth';
import toast from 'react-hot-toast';

export const ProtectedRoute = ({ children, allowedRole }: { children: React.ReactNode, allowedRole?: 'AGENT' | 'MANAGER' | 'STAFF' }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const location = useLocation();

  useEffect(() => {
    const checkAuth = async () => {
      // 1. Check if user is logged into Supabase. Auth-js may still be
      //    restoring/refreshing the stored session on a fresh load, so retry
      //    once before treating it as a logout.
      let session = (await supabase.auth.getSession()).data.session;
      if (!session) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        session = (await supabase.auth.getSession()).data.session;
      }

      let sessionEmail = session?.user?.email;

      // A transient refresh failure keeps the token in localStorage; auth-js
      // only removes it on a real sign-out. Don't bounce the user to Login on
      // a network blip — the app keeps working offline.
      if (!session) {
        const persisted = readPersistedAuthSession();
        if (!persisted) {
          setIsAuthenticated(false);
          return;
        }
        sessionEmail = persisted.email;
      }

      // 2. Check Role if required
      if (allowedRole) {
        // If checking a STAFF-only route, live verify staff permission against cloud
        if (allowedRole === 'STAFF') {
          const liveStaff = await refreshCurrentStaffPermission();
          if (!liveStaff) {
            setUserRole('AGENT');
            setIsAuthenticated(true);
            return;
          }
        }

        const fallbackRole = sessionEmail?.includes('@bgcls.local') ? 'AGENT' : 'MANAGER';
        const cachedRole = localStorage.getItem('bgcls_user_role') || fallbackRole;
        setUserRole(cachedRole);
        setIsAuthenticated(true);
        return;
      }
      
      setIsAuthenticated(true);
    };

    checkAuth();
  }, [allowedRole]);

  // Still verifying
  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center">
        <Loader2 className="animate-spin text-blue-500 mb-4" size={48} />
        <p className="text-slate-500 font-medium">Verifying secure access...</p>
      </div>
    );
  }

  // Not logged in at all
  if (!isAuthenticated) {
    return <Navigate to="/" state={{ from: location }} replace />;
  }

  // Staff Route Protection: strictly accessible by Managers and Authorized Staff
  if (allowedRole === 'STAFF') {
    const hasStaffAccess = isCurrentStaffOrManager();
    if (!hasStaffAccess) {
      toast.error('Restricted: Staff permission required.');
      return <Navigate to="/agent/dispatch" replace />;
    }
    return <>{children}</>;
  }

  // Logged in, but wrong role (e.g. Agent trying to access Manager URL)
  if (allowedRole && userRole && allowedRole !== userRole) {
    // Managers and Authorized Staff can freely access agent routes (e.g. Day End Cash Memos, Search, Routes)
    if ((userRole === 'MANAGER' || isCurrentStaffOrManager()) && allowedRole === 'AGENT') {
      return <>{children}</>;
    }
    if (userRole === 'AGENT') return <Navigate to="/agent/search" replace />;
    if (userRole === 'MANAGER') return <Navigate to="/manager/dashboard" replace />;
  }

  // Logged in and authorized
  return <>{children}</>;
};
