import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { List, Users, Map, Download } from 'lucide-react';

export const ManagerBottomNav = () => {
  const location = useLocation();
  const path = location.pathname;

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-slate-200/50 flex items-center justify-around p-2 pb-safe z-[1000] shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
      <Link 
        to="/manager/consumers" 
        className={`flex flex-col items-center p-2 transition-colors ${path.startsWith('/manager/consumer') ? 'text-blue-600' : 'text-slate-500 hover:text-blue-600'}`}
      >
        <List size={22} className="mb-1" />
        <span className="text-[10px] font-bold">Consumers</span>
      </Link>
      <Link 
        to="/manager/agents" 
        className={`flex flex-col items-center p-2 transition-colors ${path.startsWith('/manager/agent') ? 'text-blue-600' : 'text-slate-500 hover:text-blue-600'}`}
      >
        <Users size={22} className="mb-1" />
        <span className="text-[10px] font-bold">Agents</span>
      </Link>
      <Link 
        to="/manager/map" 
        className={`flex flex-col items-center p-2 transition-colors ${path === '/manager/map' ? 'text-blue-600' : 'text-slate-500 hover:text-blue-600'}`}
      >
        <Map size={22} className="mb-1" />
        <span className="text-[10px] font-bold">Map</span>
      </Link>
      <Link 
        to="/manager/reports" 
        className={`flex flex-col items-center p-2 transition-colors ${path === '/manager/reports' ? 'text-blue-600' : 'text-slate-500 hover:text-blue-600'}`}
      >
        <Download size={22} className="mb-1" />
        <span className="text-[10px] font-bold">Reports</span>
      </Link>
    </nav>
  );
};
