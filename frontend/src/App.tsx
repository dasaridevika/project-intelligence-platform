import React from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, Outlet } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Database,
  Globe,
  Globe2,
  History,
  LayoutDashboard,
  Search,
  Settings
} from 'lucide-react';
import { SearchPage } from './pages/SearchPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SystemPage } from './pages/SystemPage';

const NAV_ITEMS = [
  { name: 'Discovery Search', path: '/search', icon: Search },
  { name: 'Project Repository', path: '/projects', icon: Database },
  { name: 'System & Analytics', path: '/system', icon: Activity },
];

const Layout: React.FC = () => {
  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
        <div className="h-16 flex items-center px-6 border-b border-slate-800 gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
            <Globe2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="font-semibold text-sm tracking-tight text-white block">Project Intel</span>
            <span className="text-[10px] uppercase font-bold tracking-wider text-sky-400 block">Edge AI Platform</span>
          </div>
        </div>

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

        <div className="p-4 border-t border-slate-800/80 bg-slate-950/40">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 block" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/60 animate-ping absolute inset-0" />
            </div>
            <div className="text-xs">
              <p className="font-medium text-slate-200">Edge AI Worker</p>
              <p className="text-[11px] text-slate-400">Llama 3.1 8B Active</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 border-b border-slate-800 bg-slate-900/80 backdrop-blur px-8 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <Globe className="w-3.5 h-3.5 text-sky-400" />
            <span className="font-medium text-slate-200">Global Capital Project Intelligence</span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800/80 border border-slate-700/60 text-xs text-slate-300">
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            <span>Edge Gateway Online</span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 sm:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/search" replace />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<ProjectsPage />} />
          <Route path="/results" element={<ProjectsPage />} />
          <Route path="/history" element={<SearchPage />} />
          <Route path="/system" element={<SystemPage />} />
          <Route path="/analytics" element={<SystemPage />} />
          <Route path="/monitoring" element={<SystemPage />} />
          <Route path="/settings" element={<SystemPage />} />
          <Route path="*" element={<Navigate to="/search" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
