import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Database,
  Download,
  ExternalLink,
  Filter,
  Globe,
  Info,
  Layers,
  MapPin,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Tag,
  X
} from 'lucide-react';
import { api, cleanSummaryText, validateAndSanitizeProject } from '../api';
import { PrimarySector, Project, SearchRun } from '../types';
import { SectorBadge, findPrimarySector } from '../components/Sector';
import { GLOBAL_LOCATIONS } from './SearchPage';
import primarySectorsData from '../data/primary_sectors.json';

const ALL_SECTORS = primarySectorsData as PrimarySector[];

export function formatProjectDate(d?: string): string {
  if (!d) return '';
  const trimmed = d.trim();
  if (/^(?:latest 2026|not specified|unknown|tbd|none|n\/a)$/i.test(trimmed)) return '';
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (isoMatch) {
    const year = isoMatch[1];
    const monthNum = parseInt(isoMatch[2], 10);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (monthNum >= 1 && monthNum <= 12) {
      return `${months[monthNum - 1]} ${year}`;
    }
    return year;
  }
  return trimmed;
}

export const ProjectsPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const searchId = searchParams.get('search_id');

  const [projects, setProjects] = useState<Project[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [searchRun, setSearchRun] = useState<SearchRun | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string>('All Groups');
  const [selectedSector, setSelectedSector] = useState<string>('');
  const [selectedLocation, setSelectedLocation] = useState<string>('All Regions');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [sectorSearchTerm, setSectorSearchTerm] = useState<string>('');
  const [isSectorDropdownOpen, setIsSectorDropdownOpen] = useState<boolean>(false);
  const sectorDropdownRef = useRef<HTMLDivElement>(null);

  // 15 Taxonomy Groups with counts
  const taxonomyGroups = useMemo(() => {
    const map = new Map<string, number>();
    ALL_SECTORS.forEach((s) => {
      map.set(s.group, (map.get(s.group) || 0) + 1);
    });
    return [
      { group: 'All Groups', count: ALL_SECTORS.length },
      ...Array.from(map.entries())
        .map(([group, count]) => ({ group, count }))
        .sort((a, b) => a.group.localeCompare(b.group)),
    ];
  }, []);

  // Sectors filtered by currently selected group & search term
  const sectorsInGroup = useMemo(() => {
    let list = ALL_SECTORS;
    if (selectedGroup && selectedGroup !== 'All Groups') {
      list = list.filter((s) => s.group === selectedGroup);
    }
    if (sectorSearchTerm.trim()) {
      const term = sectorSearchTerm.toLowerCase();
      list = list.filter(
        (s) =>
          s.sector.toLowerCase().includes(term) ||
          s.group.toLowerCase().includes(term) ||
          s.definition.toLowerCase().includes(term) ||
          (s.keywords && s.keywords.some((k) => k.toLowerCase().includes(term)))
      );
    }
    return list;
  }, [selectedGroup, sectorSearchTerm]);

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (sectorDropdownRef.current && !sectorDropdownRef.current.contains(e.target as Node)) {
        setIsSectorDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const copyToClipboard = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        if (searchId) {
          const [run, res] = await Promise.all([
            api.getSearchRun(searchId),
            api.getSearchResults(searchId),
          ]);
          setSearchRun(run);
          const searchLoc = (run?.location || run?.parsed_query?.location || '').toLowerCase().trim();
          const mapped: Project[] = (res.results || [])
            .map((r: any) => validateAndSanitizeProject(r.project || r))
            .filter((p: Project | null): p is Project => p !== null)
            .filter((p: Project) => {
              if (searchLoc && searchLoc !== 'all regions' && searchLoc !== 'worldwide (global)') {
                const pLoc = ((p.location || '') + ' ' + (p.country || '') + ' ' + (p.summary || '')).toLowerCase();
                const selAliases = [searchLoc];
                if (searchLoc === 'india') selAliases.push('indian', 'gujarat', 'rajasthan', 'karnataka', 'maharashtra', 'tamil nadu', 'telangana', 'andhra', 'uttar pradesh', 'madhya pradesh', 'odisha', 'haryana', 'punjab', 'kerala');
                if (searchLoc === 'united states' || searchLoc === 'usa') selAliases.push('us', 'america', 'texas', 'california', 'arizona', 'nevada', 'ohio', 'new york', 'georgia');
                const hasMatchingAlias = selAliases.some(a => new RegExp(`\\b${a}\\b`, 'i').test(pLoc));
                // Reject if clearly in another country
                if (searchLoc === 'india' && /\b(?:texas|california|arizona|ohio|nevada|new york|usa|united states|korea|singapore|japan|germany)\b/i.test(pLoc) && !/\b(?:india|indian)\b/i.test(pLoc)) {
                  return false;
                }
                return hasMatchingAlias;
              }
              return true;
            });
          setProjects(mapped);
          setTotalCount(mapped.length);
        } else {
          const res = await api.listProjects({
            search: searchQuery || undefined,
            category: selectedSector || undefined,
            group: selectedGroup !== 'All Groups' ? selectedGroup : undefined,
            location: selectedLocation !== 'All Regions' ? selectedLocation : undefined,
            status: statusFilter || undefined,
          });
          const validProjects = (res.projects || [])
            .map((p: any) => validateAndSanitizeProject(p))
            .filter((p): p is Project => p !== null);
          setProjects(validProjects);
          setTotalCount(validProjects.length);
        }
      } catch (err) {
        console.error('Failed to load project records:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [searchId, selectedSector, selectedGroup, selectedLocation, statusFilter]);

  // Active Selected Sector Metadata
  const activeSectorItem = useMemo(() => {
    if (!selectedSector) return null;
    return ALL_SECTORS.find(
      (s) => s.sector.toLowerCase() === selectedSector.toLowerCase() || s.id === selectedSector.toLowerCase()
    );
  }, [selectedSector]);

  // Comprehensive Project Filtering using 462-Sector Taxonomy + Status + Text Search
  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      // 1. Status Filter
      if (statusFilter) {
        const pStatus = (p.status || '').toLowerCase();
        if (!pStatus.includes(statusFilter.toLowerCase())) return false;
      }

      // 2. Text Search (Project Name, Developer, URL, Summary)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesQuery =
          p.canonical_name.toLowerCase().includes(q) ||
          (p.company && p.company.toLowerCase().includes(q)) ||
          (p.developer && p.developer.toLowerCase().includes(q)) ||
          (p.project_url && p.project_url.toLowerCase().includes(q)) ||
          (p.summary && p.summary.toLowerCase().includes(q)) ||
          (p.category && p.category.toLowerCase().includes(q));
        if (!matchesQuery) return false;
      }

      const pCat = (p.category || '').toLowerCase();
      const pName = (p.canonical_name || '').toLowerCase();
      const pSum = (p.summary || '').toLowerCase();

      // 3. Exact 462 Primary Sector Filter
      if (selectedSector) {
        const s = ALL_SECTORS.find(
          (item) => item.sector.toLowerCase() === selectedSector.toLowerCase() || item.id === selectedSector.toLowerCase()
        );
        if (s) {
          const sName = s.sector.toLowerCase();
          // Exact or substring match
          if (pCat.includes(sName) || sName.includes(pCat)) return true;

          // Semantic aliases across 462 sectors
          if (sName === 'data center' && (pCat.includes('data center') || pCat.includes('hyperscale') || pName.includes('data center'))) return true;
          if (sName === 'semiconductor plant' && (pCat.includes('semiconductor') || pCat.includes('wafer') || pCat.includes('fab') || pCat.includes('megafab'))) return true;
          if (sName === 'semiconductor chemicals plant' && (pCat.includes('semiconductor chemical') || pSum.includes('semiconductor chemical'))) return true;
          if (sName === 'battery energy storage' && (pCat.includes('energy storage') || pCat.includes('bess') || pSum.includes('bess') || pName.includes('bess'))) return true;
          if (sName === 'lithium-ion (li-ion) battery production plant' && (pCat.includes('gigafactory') || pCat.includes('battery cell') || pCat.includes('battery fab') || pCat.includes('battery plant') || pCat.includes('lfp battery'))) return true;
          if (sName.includes('solar') && (pCat.includes('solar') || pName.includes('solar') || pCat.includes('pv'))) return true;
          if (sName.includes('wind') && (pCat.includes('wind') || pName.includes('wind'))) return true;
          if (sName.includes('hydrogen') && (pCat.includes('hydrogen') || pName.includes('hydrogen'))) return true;

          // Keyword match
          if (s.keywords && s.keywords.some((k) => k.length > 3 && (pCat.includes(k) || pName.includes(k) || pSum.includes(k)))) {
            return true;
          }
          return false;
        }
      }

      // 4. Taxonomy Group Filter (15 Groups)
      if (selectedGroup && selectedGroup !== 'All Groups') {
        if (selectedGroup === 'Technology & Data Infrastructure') {
          if (pCat.includes('data center') || pCat.includes('semiconductor') || pCat.includes('technology') || pCat.includes('hyperscale')) return true;
        } else if (selectedGroup === 'Batteries & Energy Storage') {
          if (pCat.includes('battery') || pCat.includes('energy storage') || pCat.includes('bess') || pCat.includes('gigafactory')) return true;
        } else if (selectedGroup === 'Power & Renewable Energy') {
          if (pCat.includes('solar') || pCat.includes('wind') || pCat.includes('renewable') || pCat.includes('hydrogen')) return true;
        } else if (selectedGroup === 'Chemicals & Petrochemicals') {
          if (pCat.includes('chemical') || pCat.includes('petrochemical') || pSum.includes('chemical')) return true;
        } else if (selectedGroup === 'Industrial Manufacturing') {
          if (pCat.includes('manufacturing') || pCat.includes('fab') || pCat.includes('factory')) return true;
        }

        // Check against sectors belonging to this group
        const groupSectors = ALL_SECTORS.filter((s) => s.group === selectedGroup);
        const hasGroupSector = groupSectors.some((gs) => {
          const gsName = gs.sector.toLowerCase();
          return pCat.includes(gsName) || pSum.includes(gsName);
        });
        if (hasGroupSector) return true;

        return false;
      }

      // 5. Region / Country Filter
      if (selectedLocation && selectedLocation !== 'All Regions' && selectedLocation !== 'Worldwide (Global)') {
        const locLower = selectedLocation.toLowerCase();
        const pLoc = `${p.country || ''} ${p.location || ''} ${p.canonical_name || ''} ${p.summary || ''}`.toLowerCase();
        if (!pLoc.includes(locLower)) return false;
      }

      return true;
    });
  }, [projects, statusFilter, searchQuery, selectedSector, selectedGroup, selectedLocation]);

  const isAnyFilterActive = searchQuery || statusFilter || selectedSector || selectedGroup !== 'All Groups' || selectedLocation !== 'All Regions';

  const clearAllFilters = () => {
    setSearchQuery('');
    setSelectedGroup('All Groups');
    setSelectedSector('');
    setSelectedLocation('All Regions');
    setStatusFilter('');
    setSectorSearchTerm('');
  };

  const getStatusColor = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes('construction')) return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
    if (s.includes('announced')) return 'bg-sky-500/10 text-sky-400 border-sky-500/30';
    if (s.includes('planning')) return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30';
    return 'bg-slate-800 text-slate-300 border-slate-700';
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-400 mb-1">
            <Globe className="w-4 h-4" />
            <span>{searchRun ? 'Discovery Run' : 'Verified Web Index'}</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight sm:text-3xl">
            {searchRun ? `"${searchRun.query}"` : 'Project URLs & Status Directory'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Discover verified capital development projects classified against the 462 Industrial Sector Taxonomy.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {searchRun && (
            <button
              onClick={() => navigate('/search')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-300 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Search</span>
            </button>
          )}

          <a
            href={api.getExportCsvUrl(
              selectedSector,
              statusFilter,
              selectedGroup !== 'All Groups' ? selectedGroup : undefined,
              selectedLocation !== 'All Regions' ? selectedLocation : undefined,
              searchQuery || undefined
            )}
            download="valid_project_urls.csv"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-200 transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-sky-400" />
            <span>Export CSV</span>
          </a>
        </div>
      </div>

      {/* Main Filter & 462-Sector Taxonomy Panel */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4 shadow-xl">
        {/* Top Filter Controls: Search, Region, & Status */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          {/* Text Search */}
          <div className="sm:col-span-5 relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search projects by facility title, developer name, URL, or scope..."
              className="w-full pl-9 pr-8 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-sky-500 shadow-inner"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Region / Country Select */}
          <div className="sm:col-span-3">
            <select
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
            >
              <option value="All Regions">All Regions</option>
              {GLOBAL_LOCATIONS.filter(l => l !== 'Worldwide (Global)').map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
          </div>

          {/* Status Select */}
          <div className="sm:col-span-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
            >
              <option value="">All Upcoming Statuses</option>
              <option value="under construction">Under Construction</option>
              <option value="announced">Announced</option>
              <option value="planning">Planning</option>
            </select>
          </div>

          {/* Reset Filters Button */}
          <div className="sm:col-span-1 flex items-center justify-end">
            <button
              onClick={clearAllFilters}
              disabled={!isAnyFilterActive}
              className={`w-full h-full py-2.5 px-3 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                isAnyFilterActive
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-300 hover:bg-rose-500/20'
                  : 'bg-slate-950/40 border-slate-800 text-slate-600 cursor-not-allowed'
              }`}
              title="Reset all filters"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="sm:hidden">Reset</span>
            </button>
          </div>
        </div>

        {/* Taxonomy Section Header */}
        <div className="pt-2 border-t border-slate-800/80">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-sky-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                Industrial Sector Taxonomy
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20 font-mono font-medium">
                462 Primary Sectors • 15 Groups
              </span>
            </div>

            {(selectedGroup !== 'All Groups' || selectedSector) && (
              <button
                onClick={() => {
                  setSelectedGroup('All Groups');
                  setSelectedSector('');
                }}
                className="text-[11px] text-sky-400 hover:text-sky-300 transition-colors flex items-center gap-1 self-start sm:self-auto"
              >
                <span>Clear Sector Filter</span>
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Taxonomy Selectors: 15 Groups Dropdown + 462 Sectors Searchable Dropdown */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* 1. Taxonomy Group Selector */}
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Filter by Taxonomy Group (15 Categories)
              </label>
              <select
                value={selectedGroup}
                onChange={(e) => {
                  setSelectedGroup(e.target.value);
                  setSelectedSector(''); // Reset sector when group changes
                }}
                className="w-full px-3 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
              >
                {taxonomyGroups.map((g) => (
                  <option key={g.group} value={g.group}>
                    {g.group === 'All Groups'
                      ? `All Taxonomy Groups (${g.count} Sectors)`
                      : `${g.group} (${g.count} Sectors)`}
                  </option>
                ))}
              </select>
            </div>

            {/* 2. 462 Primary Sector Selector (Searchable & Grouped) */}
            <div className="relative" ref={sectorDropdownRef}>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Filter by Specific Primary Sector ({sectorsInGroup.length} Available)
              </label>

              <button
                type="button"
                onClick={() => setIsSectorDropdownOpen(!isSectorDropdownOpen)}
                className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-left text-xs text-slate-200 hover:border-slate-600 focus:outline-none focus:border-sky-500 transition-colors shadow-inner"
              >
                <span className="truncate">
                  {selectedSector ? (
                    <span className="font-semibold text-sky-300">{selectedSector}</span>
                  ) : (
                    <span className="text-slate-400">
                      Select or search from {selectedGroup === 'All Groups' ? '462 primary sectors' : `${sectorsInGroup.length} ${selectedGroup} sectors`}...
                    </span>
                  )}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isSectorDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Dropdown Menu */}
              {isSectorDropdownOpen && (
                <div className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
                  <div className="p-2.5 border-b border-slate-800 bg-slate-950/80">
                    <div className="relative">
                      <input
                        type="text"
                        value={sectorSearchTerm}
                        onChange={(e) => setSectorSearchTerm(e.target.value)}
                        placeholder="Type to search 462 sectors (e.g. semiconductor, data center, battery, solar, hydrogen)..."
                        className="w-full pl-8 pr-7 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-sky-500"
                        autoFocus
                      />
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      {sectorSearchTerm && (
                        <button
                          type="button"
                          onClick={() => setSectorSearchTerm('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="max-h-60 overflow-y-auto divide-y divide-slate-800/60 p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSector('');
                        setIsSectorDropdownOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between transition-colors ${
                        !selectedSector
                          ? 'bg-sky-500/10 text-sky-400 font-semibold'
                          : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                      }`}
                    >
                      <span>All Sectors in {selectedGroup}</span>
                      {!selectedSector && <Check className="w-3.5 h-3.5 text-sky-400" />}
                    </button>

                    {sectorsInGroup.map((sec) => (
                      <button
                        key={sec.id}
                        type="button"
                        onClick={() => {
                          setSelectedSector(sec.sector);
                          setIsSectorDropdownOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between transition-colors ${
                          selectedSector === sec.sector
                            ? 'bg-sky-500/10 text-sky-400 font-semibold'
                            : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                        }`}
                      >
                        <div className="truncate pr-2">
                          <p className="truncate font-medium">{sec.sector}</p>
                          <p className="text-[10px] text-slate-500 truncate">{sec.group}</p>
                        </div>
                        {selectedSector === sec.sector && (
                          <Check className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                        )}
                      </button>
                    ))}

                    {sectorsInGroup.length === 0 && (
                      <div className="p-4 text-center text-xs text-slate-400">
                        No sectors matched "{sectorSearchTerm}".
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Active Sector Definition & Keywords Box */}
          {activeSectorItem && (
            <div className="mt-3 p-3.5 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col sm:flex-row sm:items-start justify-between gap-3 text-xs animate-in fade-in">
              <div className="space-y-1.5 max-w-3xl">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/30">
                    {activeSectorItem.group}
                  </span>
                  <span className="font-semibold text-white">
                    {activeSectorItem.sector}
                  </span>
                </div>
                <p className="text-slate-300 text-[11px] leading-relaxed">
                  {activeSectorItem.definition}
                </p>
                {activeSectorItem.keywords && activeSectorItem.keywords.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 pt-1">
                    <span className="text-[10px] text-slate-500 font-medium">Keywords:</span>
                    {activeSectorItem.keywords.slice(0, 8).map((kw) => (
                      <span key={kw} className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
                        #{kw}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={() => setSelectedSector('')}
                className="shrink-0 text-[11px] text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition-colors flex items-center gap-1 self-start"
              >
                <X className="w-3.5 h-3.5" />
                <span>Remove</span>
              </button>
            </div>
          )}
        </div>

        {/* Result Counter & Active Filter Pills */}
        <div className="pt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 border-t border-slate-800/60">
          <div className="flex items-center gap-2">
            <span>
              Showing <strong className="text-white font-semibold">{filteredProjects.length}</strong> of{' '}
              <strong className="text-slate-300">{projects.length}</strong> verified projects
            </span>
            {selectedGroup !== 'All Groups' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 text-[11px]">
                <span>Group: {selectedGroup}</span>
                <button onClick={() => setSelectedGroup('All Groups')} className="hover:text-white">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {selectedLocation !== 'All Regions' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px]">
                <span>Region: {selectedLocation}</span>
                <button onClick={() => setSelectedLocation('All Regions')} className="hover:text-white">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {selectedSector && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px]">
                <span>Sector: {selectedSector}</span>
                <button onClick={() => setSelectedSector('')} className="hover:text-white">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {statusFilter && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[11px]">
                <span>Status: {statusFilter}</span>
                <button onClick={() => setStatusFilter('')} className="hover:text-white">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
          </div>

          <span className="text-[11px] text-slate-500">
            HTTP 200 OK • Non-Operational Only
          </span>
        </div>
      </div>

      {/* Project URLs Table / Cards */}
      {loading ? (
        <div className="py-24 text-center text-slate-400 space-y-2">
          <div className="w-8 h-8 rounded-full border-2 border-sky-500 border-t-transparent animate-spin mx-auto" />
          <p className="text-sm">Fetching verified project URLs...</p>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl space-y-3">
          <Globe className="w-10 h-10 text-slate-500 mx-auto opacity-50" />
          <h3 className="text-base font-semibold text-white">
            {selectedSector
              ? `No Projects Found for '${selectedSector}'`
              : 'No Project URLs Found'}
          </h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            {selectedSector
              ? `No projects in the repository currently match the '${selectedSector}' taxonomy sector. Launch a real-time Discovery Search to discover upcoming projects in this sector.`
              : 'No projects matched your selected taxonomy or status filters. Adjust your filters or launch a new discovery query.'}
          </p>
          <div className="flex items-center justify-center gap-2 pt-2">
            {isAnyFilterActive && (
              <button
                onClick={clearAllFilters}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Clear All Filters</span>
              </button>
            )}
            <button
              onClick={() => {
                const query = selectedSector || selectedGroup !== 'All Groups' ? (selectedSector || selectedGroup) : '';
                navigate(`/search${query ? `?q=${encodeURIComponent(query)}` : ''}`);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition-colors"
            >
              <Search className="w-3.5 h-3.5" />
              <span>
                {selectedSector ? `Discover ${selectedSector} Projects` : 'Launch Discovery Query'}
              </span>
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden shadow-xl">
          <div className="divide-y divide-slate-800">
            {filteredProjects.map((p) => (
              <div
                key={p.id}
                className="p-4 sm:p-5 hover:bg-slate-800/40 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                {/* Left: Title, Sector & Valid URL */}
                <div className="space-y-1.5 max-w-3xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <SectorBadge sectorName={p.category} />
                    {p.country && p.country !== 'Not specified' && (
                      <span className="text-[10px] text-slate-300 font-medium bg-slate-800 border border-slate-700/80 px-2 py-0.5 rounded flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-emerald-400" />
                        <span>{p.country}</span>
                      </span>
                    )}
                    {p.date && formatProjectDate(p.date) ? (
                      <span className="text-[10px] text-slate-300 font-mono bg-slate-800 border border-slate-700/80 px-2 py-0.5 rounded flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-sky-400" />
                        <span>{formatProjectDate(p.date)}</span>
                      </span>
                    ) : null}
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                      HTTP {p.http_status || 200} OK
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {new Date(p.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  <h3 className="text-base font-semibold text-white">
                    {p.canonical_name}
                  </h3>

                  {(p.company || p.developer) && (
                    <div className="flex items-center gap-1.5 text-xs text-sky-300 font-medium">
                      <Building2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      <span>{p.company || p.developer}</span>
                    </div>
                  )}

                  {p.summary && (
                    <p className="text-xs text-slate-400 line-clamp-1">
                      {p.summary}
                    </p>
                  )}

                  {/* Valid Clickable URL */}
                  <div className="flex items-center gap-2 pt-1 font-mono text-xs">
                    <span className="text-slate-500 text-[11px]">URL:</span>
                    <a
                      href={p.project_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sky-400 hover:underline truncate max-w-lg flex items-center gap-1 hover:text-sky-300"
                    >
                      <span className="truncate">{p.project_url}</span>
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    </a>

                    <button
                      onClick={() => copyToClipboard(p.project_url)}
                      className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition-colors shrink-0"
                      title="Copy URL"
                    >
                      {copiedUrl === p.project_url ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Right: Status Badge & Open Button */}
                <div className="flex items-center gap-3 shrink-0 self-start sm:self-center">
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-semibold border ${getStatusColor(
                      p.status
                    )}`}
                  >
                    {p.status}
                  </span>

                  <a
                    href={p.project_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/30 text-sky-300 text-xs font-medium transition-colors"
                  >
                    <span>Visit Site</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
