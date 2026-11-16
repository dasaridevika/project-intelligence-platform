import React, { useState } from 'react';
import { Info, X } from 'lucide-react';
import primarySectorsData from '../data/primary_sectors.json';
import { PrimarySector } from '../types';

interface SectorBadgeProps {
  sectorName: string;
  className?: string;
  showDefinitionPopover?: boolean;
}

const GROUP_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'Batteries & Energy Storage': { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  'Carbon Capture & Clean Tech': { bg: 'bg-teal-500/10', text: 'text-teal-400', border: 'border-teal-500/30' },
  'Chemicals & Petrochemicals': { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/30' },
  'Hospitality & Leisure': { bg: 'bg-pink-500/10', text: 'text-pink-400', border: 'border-pink-500/30' },
  'Industrial Manufacturing': { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30' },
  'Metals & Mining': { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/30' },
  'Oil & Gas': { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/30' },
  'Pharmaceuticals & Life Sciences': { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/30' },
  'Power & Renewable Energy': { bg: 'bg-lime-500/10', text: 'text-lime-400', border: 'border-lime-500/30' },
  'Public & Institutional': { bg: 'bg-indigo-500/10', text: 'text-indigo-400', border: 'border-indigo-500/30' },
  'Real Estate & Commercial': { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/30' },
  'Technology & Data Infrastructure': { bg: 'bg-sky-500/10', text: 'text-sky-400', border: 'border-sky-500/30' },
  'Transportation & Logistics': { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/30' },
  'Water & Environmental Management': { bg: 'bg-teal-500/10', text: 'text-teal-400', border: 'border-teal-500/30' },
};

const DEFAULT_COLOR = { bg: 'bg-sky-500/10', text: 'text-sky-400', border: 'border-sky-500/30' };

export const SectorBadge: React.FC<SectorBadgeProps> = ({
  sectorName,
  className = '',
  showDefinitionPopover = true,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  // Find in local primary sectors taxonomy
  const sectorItem = (primarySectorsData as PrimarySector[]).find(
    (s) => s.sector.toLowerCase() === sectorName.toLowerCase() || s.id === sectorName.toLowerCase()
  );

  const groupName = sectorItem?.group || 'Primary Sector';
  const colors = GROUP_COLORS[groupName] || DEFAULT_COLOR;
  const definition = sectorItem?.definition;

  return (
    <div className="relative inline-flex items-center">
      <span
        onClick={() => definition && showDefinitionPopover && setIsOpen(!isOpen)}
        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-semibold tracking-wide ${colors.bg} ${colors.text} border ${colors.border} ${
          definition && showDefinitionPopover ? 'cursor-pointer hover:opacity-90' : ''
        } ${className}`}
        title={definition ? 'Click to view official definition' : undefined}
      >
        <span>{sectorItem?.sector || sectorName}</span>
        {definition && showDefinitionPopover && (
          <Info className="w-3 h-3 opacity-70 hover:opacity-100 shrink-0 ml-0.5" />
        )}
      </span>

      {/* Definition Popover Modal */}
      {isOpen && definition && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute left-0 top-full mt-2 z-50 w-80 sm:w-96 p-4 rounded-xl bg-slate-900 border border-slate-700/80 shadow-2xl text-left text-xs space-y-2 animate-in fade-in zoom-in-95">
            <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-2">
              <div>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${colors.bg} ${colors.text} border ${colors.border}`}>
                  {groupName}
                </span>
                <h4 className="font-semibold text-white text-sm mt-1">
                  {sectorItem?.sector || sectorName}
                </h4>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-slate-300 leading-relaxed text-[11px] pt-1">
              {definition}
            </p>
            {sectorItem?.keywords && sectorItem.keywords.length > 0 && (
              <div className="pt-2 border-t border-slate-800/80 flex flex-wrap gap-1">
                <span className="text-[10px] text-slate-400 font-medium">Keywords:</span>
                {sectorItem.keywords.slice(0, 6).map((kw) => (
                  <span
                    key={kw}
                    className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 text-[10px]"
                  >
                    #{kw}
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
