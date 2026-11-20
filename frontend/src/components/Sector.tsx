import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ChevronDown,
  Compass,
  Filter,
  Info,
  Layers,
  Search,
  Sparkles,
  X
} from 'lucide-react';
import primarySectorsData from '../data/primary_sectors.json';
import { PrimarySector } from '../types';

// ==============================================================================
// 1. SECTOR BADGE COMPONENT
// ==============================================================================

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

export const findPrimarySector = (name: string): PrimarySector | undefined => {
  if (!name) return undefined;
  const lower = name.toLowerCase().trim();
  const all = primarySectorsData as PrimarySector[];

  // 1. Exact match by sector or id
  const exact = all.find((s) => s.sector.toLowerCase() === lower || s.id === lower);
  if (exact) return exact;

  // 2. Semantic aliases between common project descriptions and official 462 taxonomy
  if (lower.includes('data center') || lower.includes('data centre') || lower.includes('hyperscale')) {
    return all.find((s) => s.sector === 'Data Center');
  }
  if (lower.includes('semiconductor') || lower.includes('wafer') || lower.includes('fab') || lower.includes('megafab')) {
    return all.find((s) => s.sector === 'Semiconductor Plant');
  }
  if (lower.includes('battery storage') || lower.includes('bess') || lower.includes('energy storage')) {
    return all.find((s) => s.sector === 'Battery Energy Storage');
  }
  if (lower.includes('gigafactory') || lower.includes('battery cell') || lower.includes('battery fab') || lower.includes('battery plant') || lower.includes('lfp battery')) {
    return all.find((s) => s.sector === 'Lithium-ion (Li-ion) Battery Production Plant');
  }
  if (lower.includes('solar')) {
    return all.find((s) => s.sector === 'Solar Photovoltaic Power Plant (PV)');
  }
  if (lower.includes('wind')) {
    return all.find((s) => s.sector === 'Onshore Wind Power Plant');
  }
  if (lower.includes('hydrogen')) {
    return all.find((s) => s.sector === 'Hydrogen Production Plants');
  }

  // 3. Substring match
  return all.find((s) => s.sector.toLowerCase().includes(lower) || lower.includes(s.sector.toLowerCase()));
};

export const SectorBadge: React.FC<SectorBadgeProps> = ({
  sectorName,
  className = '',
  showDefinitionPopover = true,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const sectorItem = findPrimarySector(sectorName);

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

      {isOpen && definition && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
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

// ==============================================================================
// 2. SECTOR SELECTOR DROPDOWN & SEARCH MODAL
// ==============================================================================

interface SectorSelectorProps {
  selectedSector: string;
  onSelectSector: (sector: PrimarySector | null) => void;
  onApplyToQuery?: (sectorName: string) => void;
}

export const SectorSelector: React.FC<SectorSelectorProps> = ({
  selectedSector,
  onSelectSector,
  onApplyToQuery,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string>('All Groups');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const allSectors = primarySectorsData as PrimarySector[];

  const groups = useMemo(() => {
    const set = new Set<string>();
    allSectors.forEach((s) => set.add(s.group));
    return ['All Groups', ...Array.from(set).sort()];
  }, [allSectors]);

  const filteredSectors = useMemo(() => {
    return allSectors.filter((item) => {
      const matchGroup = selectedGroup === 'All Groups' || item.group === selectedGroup;
      if (!matchGroup) return false;

      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase();
      return (
        item.sector.toLowerCase().includes(term) ||
        item.definition.toLowerCase().includes(term) ||
        (item.keywords && item.keywords.some((k) => k.toLowerCase().includes(term)))
      );
    });
  }, [allSectors, selectedGroup, searchTerm]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activeSectorItem = allSectors.find(
    (s) => s.sector.toLowerCase() === selectedSector.toLowerCase() || s.id === selectedSector.toLowerCase()
  );

  return (
    <div className="relative w-full" ref={dropdownRef}>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-sky-400" />
          <span>Industrial Sector Taxonomy</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 font-mono">
            462 Sectors
          </span>
        </label>
        {selectedSector !== 'All Categories' && (
          <button
            type="button"
            onClick={() => onSelectSector(null)}
            className="text-[11px] text-slate-400 hover:text-white transition-colors"
          >
            Clear selection
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-700/80 text-left text-sm text-slate-200 hover:border-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-500 transition-all shadow-inner"
      >
        <div className="flex items-center gap-2 truncate">
          {activeSectorItem ? (
            <SectorBadge sectorName={activeSectorItem.sector} showDefinitionPopover={false} />
          ) : (
            <span className="text-slate-400">{selectedSector || 'All Categories'}</span>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-2 z-50 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
          <div className="p-3 border-b border-slate-800 space-y-2 bg-slate-950/60">
            <div className="relative">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search primary sectors or definitions..."
                className="w-full pl-8 pr-8 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-sky-500"
                autoFocus
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] no-scrollbar">
              {groups.map((grp) => (
                <button
                  key={grp}
                  type="button"
                  onClick={() => setSelectedGroup(grp)}
                  className={`px-2 py-0.5 rounded whitespace-nowrap transition-colors ${
                    selectedGroup === grp
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 font-semibold'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {grp}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto divide-y divide-slate-800/60">
            <div
              onClick={() => {
                onSelectSector(null);
                setIsOpen(false);
              }}
              className="p-2.5 hover:bg-slate-800/60 cursor-pointer flex items-center justify-between transition-colors text-xs text-slate-300 font-medium"
            >
              <span>All Categories (No Sector Filter)</span>
            </div>

            {filteredSectors.map((sector) => (
              <div
                key={sector.id}
                className="p-3 hover:bg-slate-800/60 cursor-pointer transition-colors space-y-1"
                onClick={() => {
                  onSelectSector(sector);
                  setIsOpen(false);
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-white group-hover:text-sky-400">
                    {sector.sector}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                    {sector.group}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                  {sector.definition}
                </p>
                {onApplyToQuery && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onApplyToQuery(sector.sector);
                      onSelectSector(sector);
                      setIsOpen(false);
                    }}
                    className="inline-flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300 mt-1 font-medium"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Apply to Discovery Query</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
