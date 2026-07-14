import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { List, Users, Map, Download, LayoutDashboard } from 'lucide-react';

export const ManagerBottomNav = () => {
  const location = useLocation();
  const path = location.pathname;

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-slate-200/50 flex items-center justify-around p-2 pb-safe z-[1000] shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
      <Link 
        to="/manager/dashboard" 
        className={`flex flex-col items-center justify-center p-2 min-h-[56px] min-w-[56px] transition-colors relative ${path === '/manager/dashboard' ? 'text-blue-600' : 'text-slate-500 hover:text-blue-600'}`}
      >
        <LayoutDashboard size={24} className="mb-1" />
        <span className="text-[10px] font-bold">Dashboard</span>
        {path === '/manager/dashboard' && (
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-8 h-1 bg-blue-600 rounded-t-full"></div>
        )}
      </Link>
      <Link 
        to="/manager/consumers" 
        className={`flex flex-col items-center justify-center p-2 min-h-[56px] min-w-[56px] transition-colors relative ${path.startsWith('/manager/consumer') && path !== '/manager/consumers/map' && path !== '/manager/consumers/reports' ? 'text-blue-600' : 'text-slate-500 hover:text-blue-600'}`}
      >
        <List size={24} className="mb-1" />
        <span className="text-[10px] font-bold">Consumers</span>
        {path.startsWith('/manager/consumer') && (
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-8 h-1 bg-blue-600 rounded-t-full"></div>
        )}
      </Link>
      <Link 
        to="/manager/agents" 
        className={`flex flex-col items-center justify-center p-2 min-h-[56px] min-w-[56px] transition-colors relative ${path.startsWith('/manager/agent') ? 'text-blue-600' : 'text-slate-500 hover:text-blue-600'}`}
      >
        <Users size={24} className="mb-1" />
        <span className="text-[10px] font-bold">Agents</span>
        {path.startsWith('/manager/agent') && (
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-8 h-1 bg-blue-600 rounded-t-full"></div>
        )}
      </Link>
      <Link 
        to="/manager/map" 
        className={`flex flex-col items-center justify-center p-2 min-h-[56px] min-w-[56px] transition-colors relative ${path === '/manager/map' ? 'text-blue-600' : 'text-slate-500 hover:text-blue-600'}`}
      >
        <Map size={24} className="mb-1" />
        <span className="text-[10px] font-bold">Map</span>
        {path === '/manager/map' && (
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-8 h-1 bg-blue-600 rounded-t-full"></div>
        )}
      </Link>
      <Link 
        to="/manager/reports" 
        className={`flex flex-col items-center justify-center p-2 min-h-[56px] min-w-[56px] transition-colors relative ${path === '/manager/reports' ? 'text-blue-600' : 'text-slate-500 hover:text-blue-600'}`}
      >
        <Download size={24} className="mb-1" />
        <span className="text-[10px] font-bold">Reports</span>
        {path === '/manager/reports' && (
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-8 h-1 bg-blue-600 rounded-t-full"></div>
        )}
      </Link>
    </nav>
  );
};
