import React from 'react';
import { Globe, Activity } from 'lucide-react';

export const Header: React.FC = () => {
  return (
    <header className="h-16 border-b border-slate-800 bg-slate-900/80 backdrop-blur px-8 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-xs text-slate-300">
          <Globe className="w-3.5 h-3.5 text-sky-400" />
          <span className="font-medium text-slate-200">Global Capital Project Intelligence</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800/80 border border-slate-700/60 text-xs text-slate-300">
          <Activity className="w-3.5 h-3.5 text-emerald-400" />
          <span>System Active</span>
        </div>
      </div>
    </header>
  );
};
