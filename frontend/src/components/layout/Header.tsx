import React from 'react';
import { Globe, Shield, Sparkles, Server, Zap } from 'lucide-react';

export const Header: React.FC = () => {
  return (
    <header className="h-16 border-b border-slate-800 bg-slate-900/80 backdrop-blur px-8 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700/60 text-xs text-slate-300">
          <Globe className="w-3.5 h-3.5 text-sky-400" />
          <span>Worldwide Projects: North America, Europe, Asia-Pacific & Middle East</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400">
          <Zap className="w-3.5 h-3.5" />
          <span>Transactional Outbox Active</span>
        </div>

        <div className="flex items-center gap-2 pl-3 border-l border-slate-800">
          <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-semibold text-slate-300">
            SA
          </div>
          <div className="text-left hidden sm:block">
            <span className="text-xs font-medium text-slate-200 block leading-tight">Architect</span>
            <span className="text-[10px] text-slate-400 block">Administrator</span>
          </div>
        </div>
      </div>
    </header>
  );
};
