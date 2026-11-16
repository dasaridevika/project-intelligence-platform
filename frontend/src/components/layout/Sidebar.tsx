import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Compass,
  Database,
  Globe2,
  History,
  LayoutDashboard,
  Search,
  Settings,
  ShieldCheck
} from 'lucide-react';

const NAV_ITEMS = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard },
  { name: 'Project Search', path: '/search', icon: Search },
  { name: 'Project Repository', path: '/projects', icon: Database },
  { name: 'Search History', path: '/history', icon: History },
  { name: 'API Analytics', path: '/analytics', icon: BarChart3 },
  { name: 'System Monitoring', path: '/monitoring', icon: Activity },
  { name: 'Settings', path: '/settings', icon: Settings },
];

export const Sidebar: React.FC = () => {
  return (
    <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
      {/* Brand Header */}
      <div className="h-16 flex items-center px-6 border-b border-slate-800 gap-3">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
          <Globe2 className="w-5 h-5 text-white" />
        </div>
        <div>
          <span className="font-semibold text-sm tracking-tight text-white block">Project Intel</span>
          <span className="text-[10px] uppercase font-bold tracking-wider text-sky-400 block">Global Discovery</span>
        </div>
      </div>

      {/* Nav Menu */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Platform Workspace
        </div>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20 font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{item.name}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* Status Footer */}
      <div className="p-4 border-t border-slate-800/80 bg-slate-950/40">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 block" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/60 animate-ping absolute inset-0" />
          </div>
          <div className="text-xs">
            <p className="font-medium text-slate-200">Global Cluster Online</p>
            <p className="text-[11px] text-slate-300">Workers + Cloud Run</p>
          </div>
        </div>
      </div>
    </aside>
  );
};
