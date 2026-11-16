import React, { useState, useMemo, useRef, useEffect } from 'react';
import { BookOpen, Check, ChevronDown, Layers, Search, Sparkles, X } from 'lucide-react';
import primarySectorsData from '../data/primary_sectors.json';
import { PrimarySector } from '../types';

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
  const [selectedGroup, setSelectedGroup] = useState<string>('All');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const sectors = useMemo(() => primarySectorsData as PrimarySector[], []);

  // Compute unique groups
  const groups = useMemo(() => {
    const set = new Set<string>();
    sectors.forEach((s) => {
      if (s.group) set.add(s.group);
    });
    return ['All', ...Array.from(set).sort()];
  }, [sectors]);

  // Find currently selected sector object
  const currentSectorObj = useMemo(() => {
    if (!selectedSector || selectedSector === 'All Categories') return null;
    return (
      sectors.find(
        (s) =>
          s.sector.toLowerCase() === selectedSector.toLowerCase() ||
          s.id === selectedSector.toLowerCase()
      ) || null
    );
  }, [selectedSector, sectors]);

  // Filter sectors by search query and group
  const filteredSectors = useMemo(() => {
    let result = sectors;
    if (selectedGroup !== 'All') {
      result = result.filter((s) => s.group === selectedGroup);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      result = result.filter(
        (s) =>
          s.sector.toLowerCase().includes(q) ||
          s.definition.toLowerCase().includes(q) ||
          (s.keywords && s.keywords.some((k) => k.toLowerCase().includes(q)))
      );
    }
    return result;
  }, [sectors, selectedGroup, searchTerm]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="space-y-3" ref={dropdownRef}>
      <div className="flex items-center justify-between">
        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
          Primary Sector Taxonomy ({sectors.length} Sectors)
        </label>
        {currentSectorObj && (
          <button
            type="button"
            onClick={() => onSelectSector(null)}
            className="text-[11px] text-slate-400 hover:text-rose-400 flex items-center gap-1 transition-colors"
          >
            <X className="w-3 h-3" />
            <span>Reset Sector</span>
          </button>
        )}
      </div>

      {/* Main Trigger Button */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-700 hover:border-slate-600 text-sm text-left transition-colors shadow-inner"
        >
          <div className="flex items-center gap-2 overflow-hidden">
            <Layers className="w-4 h-4 text-sky-400 shrink-0" />
            {currentSectorObj ? (
              <div className="flex items-center gap-2 truncate">
                <span className="font-medium text-white truncate">
                  {currentSectorObj.sector}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20 shrink-0">
                  {currentSectorObj.group}
                </span>
              </div>
            ) : (
              <span className="text-slate-400">
                All 462 Primary Sectors (e.g. Battery Cathode, Data Center, Solar PV, Urea...)
              </span>
            )}
          </div>
          <ChevronDown
            className={`w-4 h-4 text-slate-400 transition-transform ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {/* Dropdown Menu */}
        {isOpen && (
          <div className="absolute left-0 right-0 top-full mt-2 z-50 rounded-xl bg-slate-900 border border-slate-700/80 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
            {/* Search Input */}
            <div className="p-3 border-b border-slate-800 bg-slate-950/80">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search sectors..."
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  autoFocus
                />
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

              {/* Group Filter Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pt-2.5 pb-0.5 text-[10px] scrollbar-thin">
                {groups.slice(0, 10).map((grp) => (
                  <button
                    type="button"
                    key={grp}
                    onClick={() => setSelectedGroup(grp)}
                    className={`px-2 py-1 rounded-md shrink-0 font-medium transition-colors ${
                      selectedGroup === grp
                        ? 'bg-sky-500 text-white font-semibold'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {grp}
                  </button>
                ))}
              </div>
            </div>

            {/* Sectors Scrollable List */}
            <div className="max-h-64 overflow-y-auto divide-y divide-slate-800/60 p-1">
              {filteredSectors.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  No primary sectors match "{searchTerm}".
                </div>
              ) : (
                filteredSectors.map((sector) => {
                  const isSelected =
                    currentSectorObj?.sector.toLowerCase() ===
                    sector.sector.toLowerCase();
                  return (
                    <div
                      key={sector.id}
                      onClick={() => {
                        onSelectSector(sector);
                        setIsOpen(false);
                      }}
                      className={`p-3 rounded-lg cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-sky-500/15 border border-sky-500/30'
                          : 'hover:bg-slate-800/70'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-white text-xs">
                              {sector.sector}
                            </span>
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
                              {sector.group}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                            {sector.definition}
                          </p>
                        </div>
                        {isSelected && (
                          <Check className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Bottom Counter */}
            <div className="p-2 border-t border-slate-800 bg-slate-950/60 text-[10px] text-slate-400 text-right font-mono">
              Showing {filteredSectors.length} of {sectors.length} sectors
            </div>
          </div>
        )}
      </div>

      {/* Selected Sector Definition Box */}
      {currentSectorObj && (
        <div className="p-4 rounded-xl bg-slate-950/90 border border-sky-500/30 text-xs space-y-2 shadow-inner">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-sky-400" />
              <span className="font-bold text-sky-300 text-xs">
                Official Sector Definition:
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20">
                {currentSectorObj.group}
              </span>
            </div>
            {onApplyToQuery && (
              <button
                type="button"
                onClick={() => onApplyToQuery(currentSectorObj.sector)}
                className="text-[11px] font-medium text-sky-400 hover:text-sky-300 flex items-center gap-1 transition-colors underline"
              >
                <Sparkles className="w-3 h-3" />
                <span>Fill in Search Query</span>
              </button>
            )}
          </div>
          <p className="text-slate-200 text-xs leading-relaxed italic">
            "{currentSectorObj.definition}"
          </p>
        </div>
      )}
    </div>
  );
};
