import React from 'react';
import { NavLink } from 'react-router-dom';
import { Search, Map } from 'lucide-react';

export const AgentBottomNav = () => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 pb-safe z-50 shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.1)]">
      <div className="flex items-center justify-around p-2">
        <NavLink 
          to="/agent/search" 
          className={({ isActive }) => `
            flex flex-col items-center p-2 rounded-xl min-w-[80px] transition-all
            ${isActive 
              ? 'text-blue-600 bg-blue-50 font-bold' 
              : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50 font-medium'}
          `}
        >
          {({ isActive }) => (
            <>
              <Search size={22} className={`mb-1 transition-transform ${isActive ? 'scale-110' : ''}`} />
              <span className="text-[10px] uppercase tracking-wider">Search</span>
            </>
          )}
        </NavLink>

        <NavLink 
          to="/agent/route" 
          className={({ isActive }) => `
            flex flex-col items-center p-2 rounded-xl min-w-[80px] transition-all
            ${isActive 
              ? 'text-blue-600 bg-blue-50 font-bold' 
              : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50 font-medium'}
          `}
        >
          {({ isActive }) => (
            <>
              <Map size={22} className={`mb-1 transition-transform ${isActive ? 'scale-110' : ''}`} />
              <span className="text-[10px] uppercase tracking-wider">My Route</span>
            </>
          )}
        </NavLink>
      </div>
    </nav>
  );
};
