import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Loader2 } from 'lucide-react';

export const ProtectedRoute = ({ children, allowedRole }: { children: React.ReactNode, allowedRole?: 'AGENT' | 'MANAGER' }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const location = useLocation();

  useEffect(() => {
    const checkAuth = async () => {
      // 1. Check if user is logged into Supabase
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        setIsAuthenticated(false);
        return;
      }

      // 2. Check Role if required
      if (allowedRole) {
        // Fetch role from agents table
        const { data: agent } = await supabase
          .from('agents')
          .select('role')
          .eq('id', session.user.id)
          .single();
          
        setUserRole(agent?.role || null);
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

  // Logged in, but wrong role (e.g. Agent trying to access Manager URL)
  if (allowedRole && userRole && allowedRole !== userRole) {
    if (userRole === 'AGENT') return <Navigate to="/agent/search" replace />;
    if (userRole === 'MANAGER') return <Navigate to="/manager/dashboard" replace />;
  }

  // Logged in and authorized
  return <>{children}</>;
};
