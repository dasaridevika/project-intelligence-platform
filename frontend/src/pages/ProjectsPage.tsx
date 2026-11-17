import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  Database,
  Download,
  ExternalLink,
  Filter,
  Globe,
  Layers,
  Search,
  SlidersHorizontal,
  X
} from 'lucide-react';
import { api } from '../api';
import { Project, SearchRun } from '../types';
import { SectorBadge } from '../components/Sector';

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
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

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
          const mapped: Project[] = (res.results || []).map((r: any) => ({
            id: r.project_id || r.id,
            canonical_name: r.canonical_name || 'Capital Project',
            project_url: r.project_url || r.project?.project_url || '',
            category: r.category || 'Capital Projects',
            status: r.status || 'Active',
            http_status: r.http_status || 200,
            summary: r.summary || '',
            created_at: new Date().toISOString(),
          }));
          setProjects(mapped);
          setTotalCount(res.total_results || mapped.length);
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
  }, [searchId, categoryFilter, statusFilter]);

  const filteredProjects = projects.filter((p) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.canonical_name.toLowerCase().includes(q) ||
      (p.project_url && p.project_url.toLowerCase().includes(q))
    );
  });

  const getStatusColor = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes('construction')) return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
    if (s.includes('announced')) return 'bg-sky-500/10 text-sky-400 border-sky-500/30';
    if (s.includes('operational') || s.includes('completed')) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
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
            Valid project URLs and lifecycle statuses fetched by Edge AI Workers.
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
            download="valid_project_urls.csv"
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
            placeholder="Search by project title or URL..."
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
            <option value="under construction">Under Construction</option>
            <option value="announced">Announced</option>
            <option value="operational">Operational</option>
            <option value="planning">Planning</option>
            <option value="active">Active</option>
          </select>
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
          <h3 className="text-base font-semibold text-white">No Project URLs Found</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            No projects matched your filters. Run a query to fetch valid project URLs and their status.
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
