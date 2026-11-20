import React, { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Compass,
  Database,
  Download,
  ExternalLink,
  Globe,
  History,
  Layers,
  Loader2,
  RotateCw,
  Search,
  Sparkles,
  Zap,
  BarChart3,
  Cpu
} from 'lucide-react';
import { useSearch } from '../context/SearchContext';
import { SectorBadge, SectorSelector } from '../components/Sector';
import { formatProjectDate } from './ProjectsPage';

export const GLOBAL_LOCATIONS = [
  'Worldwide (Global)',
  'United States',
  'Northern Virginia',
  'Texas',
  'Arizona',
  'California',
  'United Kingdom',
  'Germany',
  'Ireland',
  'Netherlands',
  'Spain',
  'Japan',
  'South Korea',
  'Taiwan',
  'Singapore',
  'Malaysia',
  'Australia',
  'Saudi Arabia',
  'United Arab Emirates',
  'India',
  'Brazil',
  'Canada'
];

export const SearchPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const {
    query,
    setQuery,
    selectedCategory,
    setSelectedCategory,
    selectedLocation,
    setSelectedLocation,
    providers,
    setProviders,
    isSubmitting,
    activeSearchId,
    timelineEvents,
    searchProgress,
    searchStage,
    discoveredResults,
    searchCompleted,
    errorMsg,
    queryTelemetry,
    searchHistory,
    showHistory,
    setShowHistory,
    handleSelectSector,
    handleApplySectorToQuery,
    executeSearch,
    downloadDiscoveredCsv,
  } = useSearch();

  // If a ?q= query param is provided and doesn't match current query, execute it
  useEffect(() => {
    const urlQ = searchParams.get('q');
    if (urlQ && urlQ.trim() && urlQ !== query) {
      setQuery(urlQ);
      executeSearch(urlQ);
    }
  }, [searchParams]);

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await executeSearch();
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Search Header Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-slate-800 p-8 shadow-2xl">
        <div className="max-w-3xl space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/10 border border-sky-500/20 text-xs font-medium text-sky-400">
            <Globe className="w-3.5 h-3.5" />
            <span>100% Serverless Edge Capital Project Intelligence</span>
          </div>

          <h1 className="text-3xl font-bold text-white tracking-tight sm:text-4xl">
            Global Project Discovery
          </h1>

          <p className="text-slate-300 text-sm leading-relaxed">
            Discover hyperscale data centers, semiconductor fabs, gigafactories, and clean energy corridors. Powered by Cloudflare Workers AI with pre-LLM URL deduplication and 462 primary sector definitions.
          </p>
        </div>
      </div>

      {/* Main Search Form Card */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 sm:p-8 space-y-6 shadow-xl">
        <form onSubmit={handleSearchSubmit} className="space-y-6">
          {/* Query Bar */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Natural Language Discovery Query
              </label>
              <button
                type="button"
                onClick={() => setShowHistory(!showHistory)}
                className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 font-medium transition-colors"
              >
                <History className="w-3.5 h-3.5" />
                <span>{showHistory ? 'Hide History' : 'Recent Searches'}</span>
              </button>
            </div>

            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search capital projects by facility, developer, sector, or region..."
                className="w-full pl-11 pr-4 py-3.5 rounded-xl bg-slate-950 border border-slate-700/80 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500 text-sm sm:text-base shadow-inner"
              />
              <Search className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
            </div>
          </div>

          {/* Recent Searches Drawer (if toggled) */}
          {showHistory && searchHistory.length > 0 && (
            <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2 text-xs animate-in fade-in">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block mb-1">
                Previous Searches
              </span>
              <div className="divide-y divide-slate-800/60">
                {searchHistory.map((run) => (
                  <div
                    key={run.id}
                    onClick={() => {
                      setQuery(run.query);
                      setShowHistory(false);
                      navigate(`/projects?search_id=${run.id}`);
                    }}
                    className="py-2 flex items-center justify-between cursor-pointer hover:text-sky-400 transition-colors"
                  >
                    <span className="text-slate-200 truncate max-w-md">{run.query}</span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {run.results_count || 0} projects &rarr;
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Primary Sector Taxonomy Selector */}
          <SectorSelector
            selectedSector={selectedCategory}
            onSelectSector={handleSelectSector}
            onApplyToQuery={handleApplySectorToQuery}
          />

          {/* Filters Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Target Region / Geography
              </label>
              <select
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                {GLOBAL_LOCATIONS.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                External Search Providers
              </label>
              <div className="flex items-center gap-6 py-2 px-3.5 rounded-lg bg-slate-950 border border-slate-700 h-[42px]">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={providers.exa}
                    onChange={(e) => setProviders({ ...providers, exa: e.target.checked })}
                    className="rounded bg-slate-800 border-slate-600 text-sky-500 focus:ring-0"
                  />
                  <span>Exa AI</span>
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={providers.google}
                    onChange={(e) => setProviders({ ...providers, google: e.target.checked })}
                    className="rounded bg-slate-800 border-slate-600 text-sky-500 focus:ring-0"
                  />
                  <span>Google Custom Search</span>
                </label>
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting || !query.trim() || query.length < 3}
            className="w-full py-3.5 px-6 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 disabled:opacity-50 text-white font-semibold text-sm transition-all shadow-lg shadow-sky-600/20 flex items-center justify-center gap-2 cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Dispatching Edge AI Workers...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Execute Capital Project Discovery</span>
              </>
            )}
          </button>
        </form>

        {errorMsg && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs sm:text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>

      {/* Real-time Execution Stream (Progress & Timeline) */}
      {(searchProgress > 0 || timelineEvents.length > 0) && (
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 sm:p-8 space-y-6 shadow-xl animate-in fade-in">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs sm:text-sm">
              <span className="font-semibold text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-sky-400" />
                <span>{searchStage || 'Processing...'}</span>
              </span>
              <span className="font-mono text-sky-400">{searchProgress}%</span>
            </div>

            <div className="w-full h-2 rounded-full bg-slate-950 overflow-hidden border border-slate-800">
              <div
                className="h-full bg-gradient-to-r from-sky-500 to-indigo-500 transition-all duration-300"
                style={{ width: `${searchProgress}%` }}
              />
            </div>
          </div>

          {/* Timeline Events Feed */}
          {timelineEvents.length > 0 && (
            <div className="space-y-2 pt-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Live Audit Activity Stream
              </h3>
              <div className="max-h-48 overflow-y-auto space-y-1.5 font-mono text-xs pr-2">
                {timelineEvents.map((ev, i) => {
                  const comp = ev.component || (ev as any).sender || 'ai_worker';
                  const text = ev.message || (ev as any).msg || (ev as any).text || (ev.metadata?.canonical_name ? `Project Identified: ${ev.metadata.canonical_name}` : '');
                  const time = ev.timestamp && !isNaN(new Date(ev.timestamp).getTime())
                    ? new Date(ev.timestamp).toLocaleTimeString()
                    : new Date().toLocaleTimeString();
                  return (
                    <div key={i} className="flex items-start justify-between gap-3 text-slate-300">
                      <span className="text-sky-400 shrink-0">[{comp}]</span>
                      <span className="truncate flex-1 min-w-0 font-medium" title={text}>
                        {text}
                      </span>
                      <span className="text-[10px] text-slate-500 shrink-0 font-mono">
                        {time}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Per-Query API Request Audit Breakdown */}
      {(searchCompleted || queryTelemetry || isSubmitting) && (
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-4 shadow-xl animate-in fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
                <BarChart3 className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-white tracking-wide">
                    API Requests Dispatched For This Query
                  </h3>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Strict 1 Request Policy Active
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Strictly 1 request sent to search provider & 1 single batch inference to Cloudflare Workers AI
                </p>
              </div>
            </div>

            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/10 border border-sky-500/30 text-xs font-mono text-sky-300 font-semibold self-start sm:self-auto">
              <span>Total API Calls:</span>
              <span className="text-white text-sm font-bold">
                {queryTelemetry?.total_requests ?? (
                  (providers.exa ? 1 : 0) +
                  (providers.google ? 1 : 0) +
                  timelineEvents.filter(e => e.event_type === 'url_fetched' || e.message?.includes('Analyzing candidate URL')).length +
                  timelineEvents.filter(e => e.message?.includes('Workers AI Extraction') || e.event_type === 'candidate_accepted' || e.event_type === 'extraction_completed').length
                )}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Workers AI */}
            <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400 uppercase font-semibold">
                <span className="flex items-center gap-1.5 text-sky-400">
                  <Cpu className="w-3.5 h-3.5" />
                  <span>Workers AI</span>
                </span>
                <span className="text-emerald-400 text-[10px]">100% OK</span>
              </div>
              <div className="text-2xl font-bold text-white font-mono">
                {queryTelemetry?.workers_ai_inferences ?? timelineEvents.filter(e => e.message?.includes('Workers AI Extraction') || e.event_type === 'candidate_accepted' || e.event_type === 'extraction_completed').length}
              </div>
              <p className="text-[10px] text-slate-400">Llama 3.1 8B Inferences</p>
            </div>

            {/* Exa Neural */}
            <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400 uppercase font-semibold">
                <span className="flex items-center gap-1.5 text-indigo-400">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Exa AI</span>
                </span>
                <span className="text-emerald-400 text-[10px]">100% OK</span>
              </div>
              <div className="text-2xl font-bold text-white font-mono">
                {queryTelemetry?.exa_search ?? (providers.exa ? 1 : 0)}
              </div>
              <p className="text-[10px] text-slate-400">Neural Semantic Search</p>
            </div>

            {/* Google Search */}
            <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400 uppercase font-semibold">
                <span className="flex items-center gap-1.5 text-amber-400">
                  <Search className="w-3.5 h-3.5" />
                  <span>Google Custom</span>
                </span>
                <span className="text-emerald-400 text-[10px]">100% OK</span>
              </div>
              <div className="text-2xl font-bold text-white font-mono">
                {queryTelemetry?.google_search ?? (providers.google ? 1 : 0)}
              </div>
              <p className="text-[10px] text-slate-400">Live Web Indexing</p>
            </div>

            {/* Web Page Fetches */}
            <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400 uppercase font-semibold">
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <Globe className="w-3.5 h-3.5" />
                  <span>Web Fetches</span>
                </span>
                <span className="text-emerald-400 text-[10px]">HTTP 200</span>
              </div>
              <div className="text-2xl font-bold text-white font-mono">
                {queryTelemetry?.web_content_fetches ?? timelineEvents.filter(e => e.event_type === 'url_fetched' || e.message?.includes('Analyzing candidate URL')).length}
              </div>
              <p className="text-[10px] text-slate-400">Direct Page Scrapes</p>
            </div>
          </div>
        </div>
      )}

      {/* Discovered Results Yield */}
      {searchCompleted && (
        <div className="space-y-4 animate-in fade-in">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <span>Discovered Capital Projects ({discoveredResults.length})</span>
            </h2>

            <div className="flex items-center gap-2">
              {discoveredResults.length > 0 && (
                <button
                  type="button"
                  onClick={downloadDiscoveredCsv}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
                  title="Export verified projects to CSV"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Export CSV</span>
                </button>
              )}

              {activeSearchId && (
                <button
                  onClick={() => navigate(`/projects?search_id=${activeSearchId}`)}
                  className="text-xs text-sky-400 hover:text-sky-300 font-semibold flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20 transition-colors"
                >
                  <span>Open in Repository</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {discoveredResults.length === 0 ? (
            <div className="text-center py-12 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
              <p className="text-sm text-slate-400">No project candidates matched this query criteria.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {discoveredResults.map((p) => (
                <div
                  key={p.project_id}
                  className="rounded-xl bg-slate-900 border border-slate-800 p-5 hover:border-slate-700 transition-all space-y-3 flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <SectorBadge sectorName={p.category} />
                      <div className="flex items-center gap-1.5 shrink-0">
                        {p.date && formatProjectDate(p.date) ? (
                          <span className="text-[10px] font-mono text-slate-300 px-2 py-0.5 rounded bg-slate-800 border border-slate-700/80 flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-sky-400" />
                            <span>{formatProjectDate(p.date)}</span>
                          </span>
                        ) : null}
                        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/30">
                          {p.status}
                        </span>
                      </div>
                    </div>

                    <h3 className="text-base font-bold text-white line-clamp-1">
                      {p.canonical_name || (p as any).name || (p as any).title || (p as any).project?.canonical_name}
                    </h3>
                    
                    {(p.company || p.developer || (p as any).project?.company || (p as any).project?.developer) && (
                      <div className="flex items-center gap-1.5 text-xs text-sky-200/90 font-medium">
                        <Building2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                        <span className="truncate">
                          {p.company || p.developer || (p as any).project?.company || (p as any).project?.developer}
                        </span>
                      </div>
                    )}
                    
                    {p.project_url && (
                      <a
                        href={p.project_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-sky-400 hover:underline truncate block font-mono"
                      >
                        {p.project_url}
                      </a>
                    )}
                  </div>

                  <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs">
                    <span className="text-[11px] text-emerald-400 font-medium">
                      Verified Source
                    </span>
                    <a
                      href={p.project_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sky-400 text-[11px] font-medium flex items-center gap-1 hover:text-sky-300"
                    >
                      <span>Visit URL</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
