import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { List, Users, Map, Download, LayoutDashboard, Compass } from 'lucide-react';

export const ManagerBottomNav = () => {
  const location = useLocation();
  const path = location.pathname;

  const navItems = [
    {
      to: '/manager/dashboard',
      label: 'Dashboard',
      icon: LayoutDashboard,
      isActive: path === '/manager/dashboard',
      activeColor: 'text-blue-600',
      activeIndicator: 'bg-blue-600',
    },
    {
      to: '/manager/find-agent',
      label: 'Find Area',
      icon: Compass,
      isActive: path.startsWith('/manager/find-agent'),
      activeColor: 'text-amber-600',
      activeIndicator: 'bg-amber-600',
    },
    {
      to: '/manager/consumers',
      label: 'Consumers',
      icon: List,
      isActive: path.startsWith('/manager/consumer') && path !== '/manager/consumers/map' && path !== '/manager/consumers/reports',
      activeColor: 'text-blue-600',
      activeIndicator: 'bg-blue-600',
    },
    {
      to: '/manager/agents',
      label: 'Agents',
      icon: Users,
      isActive: path.startsWith('/manager/agent'),
      activeColor: 'text-blue-600',
      activeIndicator: 'bg-blue-600',
    },
    {
      to: '/manager/map',
      label: 'Map',
      icon: Map,
      isActive: path === '/manager/map',
      activeColor: 'text-blue-600',
      activeIndicator: 'bg-blue-600',
    },
    {
      to: '/manager/reports',
      label: 'Reports',
      icon: Download,
      isActive: path === '/manager/reports',
      activeColor: 'text-blue-600',
      activeIndicator: 'bg-blue-600',
    },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-slate-200/80 pb-safe z-[1000] shadow-[0_-4px_25px_rgba(0,0,0,0.08)]">
      <div className="grid grid-cols-6 max-w-lg mx-auto py-1 px-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex flex-col items-center justify-center py-1 px-0.5 min-h-[50px] transition-all relative ${
                item.isActive ? `${item.activeColor} font-bold` : 'text-slate-500 hover:text-slate-900 font-medium'
              }`}
            >
              <Icon size={19} className={`mb-1 transition-transform ${item.isActive ? 'scale-110' : ''}`} />
              <span className="text-[8.5px] leading-tight tracking-tight text-center truncate max-w-full">
                {item.label}
              </span>
              {item.isActive && (
                <div className={`absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-1 ${item.activeIndicator} rounded-full`}></div>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
};
