import React from 'react';
import { NavLink } from 'react-router-dom';
import { Search, Compass, Map, ClipboardCheck } from 'lucide-react';

export const AgentBottomNav = () => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe z-50 shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.1)]">
      <div className="flex items-center justify-around p-1.5 sm:p-2 max-w-lg mx-auto">
        <NavLink 
          to="/agent/search" 
          className={({ isActive }) => `
            flex flex-col items-center py-1 px-2.5 rounded-xl transition-all
            ${isActive 
              ? 'text-blue-600 bg-blue-50 font-bold' 
              : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50 font-medium'}
          `}
        >
          {({ isActive }) => (
            <>
              <Search size={20} className={`mb-1 transition-transform ${isActive ? 'scale-110' : ''}`} />
              <span className="text-[10px] uppercase tracking-wider font-semibold">Search</span>
            </>
          )}
        </NavLink>

        <NavLink 
          to="/agent/find-agent" 
          className={({ isActive }) => `
            flex flex-col items-center py-1 px-2.5 rounded-xl transition-all
            ${isActive 
              ? 'text-amber-600 bg-amber-50 font-bold' 
              : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50 font-medium'}
          `}
        >
          {({ isActive }) => (
            <>
              <Compass size={20} className={`mb-1 transition-transform ${isActive ? 'scale-110 text-amber-600' : ''}`} />
              <span className="text-[10px] uppercase tracking-wider font-semibold">Find Area</span>
            </>
          )}
        </NavLink>

        <NavLink 
          to="/agent/route" 
          className={({ isActive }) => `
            flex flex-col items-center py-1 px-2.5 rounded-xl transition-all
            ${isActive 
              ? 'text-blue-600 bg-blue-50 font-bold' 
              : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50 font-medium'}
          `}
        >
          {({ isActive }) => (
            <>
              <Map size={20} className={`mb-1 transition-transform ${isActive ? 'scale-110' : ''}`} />
              <span className="text-[10px] uppercase tracking-wider font-semibold">My Route</span>
            </>
          )}
        </NavLink>

        <NavLink 
          to="/agent/dispatch" 
          className={({ isActive }) => `
            flex flex-col items-center py-1 px-2.5 rounded-xl transition-all
            ${isActive 
              ? 'text-blue-600 bg-blue-50 font-bold' 
              : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50 font-medium'}
          `}
        >
          {({ isActive }) => (
            <>
              <ClipboardCheck size={20} className={`mb-1 transition-transform ${isActive ? 'scale-110' : ''}`} />
              <span className="text-[10px] uppercase tracking-wider font-semibold">Day End</span>
            </>
          )}
        </NavLink>
      </div>
    </nav>
  );
};
