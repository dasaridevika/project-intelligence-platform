import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Compass,
  Database,
  DollarSign,
  Download,
  ExternalLink,
  Filter,
  Globe,
  Layers,
  Loader2,
  MapPin,
  Search,
  Sparkles,
  X
} from 'lucide-react';
import { api } from '../api';
import { Project, PrimarySector, SearchRun, SearchResultItem } from '../types';
import { SectorBadge } from '../components/Sector';
import primarySectorsData from '../data/primary_sectors.json';

export const ProjectsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { id: paramProjectId } = useParams<{ id?: string }>();

  const searchId = searchParams.get('search_id');

  const [projects, setProjects] = useState<Project[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [searchRun, setSearchRun] = useState<SearchRun | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Workers AI Edge URL Inspector State
  const [aiExtractingUrl, setAiExtractingUrl] = useState<string | null>(null);
  const [aiResults, setAiResults] = useState<Record<string, any>>({});
  const [aiError, setAiError] = useState<Record<string, string>>({});

  const handleAiExtract = async (url: string) => {
    try {
      setAiExtractingUrl(url);
      setAiError((prev) => ({ ...prev, [url]: '' }));
      const res = await api.aiExtractUrl(url, selectedProject?.category);
      setAiResults((prev) => ({ ...prev, [url]: res }));
    } catch (err: any) {
      setAiError((prev) => ({
        ...prev,
        [url]: err?.response?.data?.details || err?.message || 'Failed to fetch or extract from URL.',
      }));
    } finally {
      setAiExtractingUrl(null);
    }
  };

  // Load data
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        if (paramProjectId) {
          const p = await api.getProject(paramProjectId);
          setSelectedProject(p);
        } else if (searchId) {
          const [run, res] = await Promise.all([
            api.getSearchRun(searchId),
            api.getSearchResults(searchId),
          ]);
          setSearchRun(run);
          // Map SearchResultItems to Projects
          const mappedProjects: Project[] = (res.results || []).map((r) => ({
            id: r.project_id,
            canonical_name: r.canonical_name,
            category: r.category,
            status: r.status,
            developer: r.developer,
            location_city: r.location_city,
            location_state: r.location_state,
            location_country: r.location_country,
            investment_value: r.investment_value,
            investment_currency: r.investment_currency,
            capacity_value: r.capacity_value,
            capacity_unit: r.capacity_unit,
            sources: r.sources,
            created_at: new Date().toISOString(),
          }));
          setProjects(mappedProjects);
          setTotalCount(res.total_results || mappedProjects.length);
        } else {
          const res = await api.listProjects({
            search: searchQuery || undefined,
            category: categoryFilter || undefined,
            status: statusFilter || undefined,
          });
          setProjects(res.projects || []);
          setTotalCount(res.total || (res.projects || []).length);
        }
      } catch (err) {
        console.error('Failed to load project records:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [searchId, paramProjectId, categoryFilter, statusFilter]);

  const filteredProjects = projects.filter((p) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.canonical_name.toLowerCase().includes(q) ||
      (p.developer && p.developer.toLowerCase().includes(q)) ||
      (p.location_country && p.location_country.toLowerCase().includes(q))
    );
  });

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-400 mb-1">
            <Database className="w-4 h-4" />
            <span>{searchRun ? 'Discovery Run Results' : 'Global Capital Project Repository'}</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight sm:text-3xl">
            {searchRun ? `"${searchRun.query}"` : 'Capital Projects Catalog'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            {searchRun
              ? `Displaying ${totalCount} verified projects discovered from live web search and edge extraction.`
              : 'Indexed capital projects with verified developers, financial valuations, capacities, and evidentiary provenance.'}
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
            href={api.getExportCsvUrl(categoryFilter, statusFilter)}
            download="capital_projects.csv"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-200 transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-sky-400" />
            <span>Export CSV</span>
          </a>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-900/60 border border-slate-800 p-3 rounded-xl">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search projects by name, developer, or country..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-sky-500"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        </div>

        <div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-sky-500"
          >
            <option value="">All Categories</option>
            <option value="Data Center">Data Center</option>
            <option value="Semiconductor">Semiconductor</option>
            <option value="Solar Power">Solar Power</option>
            <option value="Renewable Energy">Renewable Energy</option>
            <option value="EV & Battery">EV & Battery</option>
            <option value="Hydrogen">Hydrogen</option>
            <option value="Infrastructure">Infrastructure</option>
          </select>
        </div>

        <div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-sky-500"
          >
            <option value="">All Lifecycle Statuses</option>
            <option value="announced">Announced</option>
            <option value="under construction">Under Construction</option>
            <option value="operational">Operational</option>
            <option value="planned">Planned</option>
          </select>
        </div>
      </div>

      {/* Projects Grid / Table */}
      {loading ? (
        <div className="py-24 text-center text-slate-400 space-y-2">
          <div className="w-8 h-8 rounded-full border-2 border-sky-500 border-t-transparent animate-spin mx-auto" />
          <p className="text-sm">Loading capital projects...</p>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl space-y-3">
          <Database className="w-10 h-10 text-slate-500 mx-auto opacity-50" />
          <h3 className="text-base font-semibold text-white">No Projects Found</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            No capital projects matched your current filters. Try running a natural language query in the discovery search bar.
          </p>
          <button
            onClick={() => navigate('/search')}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition-colors"
          >
            <Search className="w-3.5 h-3.5" />
            <span>Launch Discovery Query</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map((p) => (
            <div
              key={p.id}
              onClick={() => setSelectedProject(p)}
              className="rounded-xl bg-slate-900 border border-slate-800 p-5 hover:border-slate-700 hover:bg-slate-900/90 cursor-pointer transition-all space-y-3.5 flex flex-col justify-between"
            >
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <SectorBadge sectorName={p.category} />
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                    {p.status}
                  </span>
                </div>

                <h3 className="text-base font-bold text-white line-clamp-1 hover:text-sky-400 transition-colors">
                  {p.canonical_name}
                </h3>

                {p.developer && (
                  <p className="text-xs text-slate-400 flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-slate-300">{p.developer}</span>
                  </p>
                )}

                {p.location_country && (
                  <p className="text-xs text-slate-400 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    <span>
                      {[p.location_city, p.location_state, p.location_country].filter(Boolean).join(', ')}
                    </span>
                  </p>
                )}
              </div>

              <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <div>
                  {p.investment_value ? (
                    <span className="font-semibold text-emerald-400 font-mono">
                      ${(p.investment_value / 1e9).toFixed(1)}B {p.investment_currency || 'USD'}
                    </span>
                  ) : p.capacity_value ? (
                    <span className="font-semibold text-sky-400 font-mono">
                      {p.capacity_value} {p.capacity_unit || ''}
                    </span>
                  ) : (
                    <span className="text-slate-500 font-mono text-[11px]">Metrics Verified</span>
                  )}
                </div>

                <span className="text-[11px] text-sky-400 hover:text-sky-300 flex items-center gap-1 font-medium">
                  <span>View Details</span>
                  <ExternalLink className="w-3 h-3" />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Project Detail Modal */}
      {selectedProject && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full p-6 sm:p-8 space-y-6 max-h-[90vh] overflow-y-auto shadow-2xl animate-in fade-in zoom-in-95">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <SectorBadge sectorName={selectedProject.category} />
                  <span className="text-xs font-mono uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                    {selectedProject.status}
                  </span>
                </div>
                <h2 className="text-xl sm:text-2xl font-bold text-white pt-1">
                  {selectedProject.canonical_name}
                </h2>
              </div>
              <button
                onClick={() => setSelectedProject(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="bg-slate-950/60 border border-slate-800 p-3 rounded-lg">
                <span className="text-slate-400 block mb-1">Developer</span>
                <span className="font-semibold text-white">{selectedProject.developer || 'Unconfirmed'}</span>
              </div>
              <div className="bg-slate-950/60 border border-slate-800 p-3 rounded-lg">
                <span className="text-slate-400 block mb-1">Investment Value</span>
                <span className="font-semibold text-emerald-400 font-mono">
                  {selectedProject.investment_value
                    ? `$${(selectedProject.investment_value / 1e9).toFixed(2)}B ${selectedProject.investment_currency || 'USD'}`
                    : 'N/A'}
                </span>
              </div>
              <div className="bg-slate-950/60 border border-slate-800 p-3 rounded-lg">
                <span className="text-slate-400 block mb-1">Capacity</span>
                <span className="font-semibold text-sky-400 font-mono">
                  {selectedProject.capacity_value
                    ? `${selectedProject.capacity_value} ${selectedProject.capacity_unit || ''}`
                    : 'N/A'}
                </span>
              </div>
              <div className="bg-slate-950/60 border border-slate-800 p-3 rounded-lg">
                <span className="text-slate-400 block mb-1">Location</span>
                <span className="font-semibold text-white">
                  {[selectedProject.location_city, selectedProject.location_country].filter(Boolean).join(', ') || 'Global'}
                </span>
              </div>
            </div>

            {/* Description & Metadata */}
            {selectedProject.description && (
              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Project Overview</h4>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed bg-slate-950/40 p-3.5 rounded-xl border border-slate-800">
                  {selectedProject.description}
                </p>
              </div>
            )}

            {/* Evidentiary Sources & Live AI URL Inspector */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                <span>Verified Sources & Provenance</span>
                <span className="text-[10px] text-sky-400 font-mono">Workers AI Live Extractor</span>
              </h4>

              {(!selectedProject.sources || selectedProject.sources.length === 0) ? (
                <p className="text-xs text-slate-500 italic">No source URLs linked to this record.</p>
              ) : (
                <div className="space-y-2">
                  {selectedProject.sources.map((s, idx) => (
                    <div key={idx} className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <a
                          href={s.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sky-400 hover:underline truncate max-w-md font-mono text-[11px] flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3 shrink-0" />
                          <span>{s.source_url}</span>
                        </a>

                        <button
                          onClick={() => handleAiExtract(s.source_url)}
                          disabled={aiExtractingUrl === s.source_url}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/40 text-[10px] font-medium transition-colors shrink-0"
                        >
                          {aiExtractingUrl === s.source_url ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Sparkles className="w-3 h-3" />
                          )}
                          <span>AI Inspect</span>
                        </button>
                      </div>

                      {s.raw_snippet && (
                        <p className="text-slate-400 italic text-[11px] border-l-2 border-slate-700 pl-2">
                          "{s.raw_snippet}"
                        </p>
                      )}

                      {/* Display AI Live Extraction result */}
                      {aiResults[s.source_url] && (
                        <div className="mt-2 p-2.5 rounded bg-indigo-950/40 border border-indigo-800/60 text-[11px] space-y-1">
                          <span className="font-semibold text-indigo-300 block">Workers AI Live Extraction Result:</span>
                          <p className="text-slate-200">{aiResults[s.source_url].summary || JSON.stringify(aiResults[s.source_url].extracted_data || {})}</p>
                        </div>
                      )}

                      {aiError[s.source_url] && (
                        <p className="text-rose-400 text-[11px]">{aiError[s.source_url]}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedProject(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-white transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
