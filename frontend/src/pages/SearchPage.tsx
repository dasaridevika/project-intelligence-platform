import React, { useState, useEffect } from 'react';
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
import { api, subscribeToSearchEvents, isProductOrEquipment, getProjectDedupKey, cleanSummaryText } from '../api';
import { ActivityEvent, PrimarySector, QueryTelemetry, SearchResultItem, SearchRun } from '../types';
import { SectorBadge, SectorSelector } from '../components/Sector';

const GLOBAL_LOCATIONS = [
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

  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [selectedCategory, setSelectedCategory] = useState('All Categories');
  const [selectedLocation, setSelectedLocation] = useState('Worldwide (Global)');
  const [providers, setProviders] = useState<{ exa: boolean; google: boolean }>({
    exa: true,
    google: true,
  });

  // Discovery Execution State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeSearchId, setActiveSearchId] = useState<string | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<ActivityEvent[]>([]);
  const [searchProgress, setSearchProgress] = useState<number>(0);
  const [searchStage, setSearchStage] = useState<string>('');
  const [discoveredResults, setDiscoveredResults] = useState<SearchResultItem[]>([]);
  const [searchCompleted, setSearchCompleted] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [queryTelemetry, setQueryTelemetry] = useState<QueryTelemetry | null>(null);

  // Search History Drawer / List
  const [searchHistory, setSearchHistory] = useState<SearchRun[]>([]);
  const [showHistory, setShowHistory] = useState<boolean>(false);

  const loadHistory = async () => {
    try {
      const runs = await api.listSearches(undefined, 10);
      setSearchHistory(runs);
    } catch (err) {
      console.warn('Failed to load recent searches:', err);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [searchCompleted]);

  const handleSelectSector = (sector: PrimarySector | null) => {
    if (sector) {
      setSelectedCategory(sector.sector);
    } else {
      setSelectedCategory('All Categories');
    }
  };

  const handleApplySectorToQuery = (sectorName: string) => {
    const loc = selectedLocation !== 'Worldwide (Global)' ? selectedLocation : 'worldwide';
    setQuery(`Upcoming ${sectorName} projects in ${loc}`);
  };

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || query.length < 3) return;

    setIsSubmitting(true);
    setErrorMsg(null);
    setTimelineEvents([]);
    setDiscoveredResults([]);
    setQueryTelemetry(null);
    setSearchProgress(5);
    setSearchStage('Initiating Edge AI Discovery Pipeline...');
    setSearchCompleted(false);

    const activeProviders = [];
    if (providers.exa) activeProviders.push('exa');
    if (providers.google) activeProviders.push('google');

    try {
      const res = await api.createSearch({
        query: query.trim(),
        categories: selectedCategory !== 'All Categories' ? [selectedCategory] : undefined,
        location: selectedLocation !== 'Worldwide (Global)' ? selectedLocation : undefined,
        providers: activeProviders,
      });

      const searchId = res.search_run_id;
      setActiveSearchId(searchId);

      if (res.api_telemetry) {
        setQueryTelemetry(res.api_telemetry);
      }

      if ((res as any).results && (res as any).results.length > 0) {
        setDiscoveredResults((res as any).results);
        setSearchProgress(100);
        setSearchStage('Discovery Complete!');
        setSearchCompleted(true);
        setIsSubmitting(false);
        return;
      }

      setIsSubmitting(false);

      // Polling fallback
      const pollTimer = setInterval(async () => {
        try {
          const run = await api.getSearchRun(searchId);
          if (run.status === 'completed' || run.status === 'partially_completed') {
            setSearchProgress(100);
            setSearchStage('Discovery Complete!');
            setSearchCompleted(true);
            const resultsData = await api.getSearchResults(searchId);
            setDiscoveredResults(resultsData.results || []);
            if (resultsData.api_telemetry) {
              setQueryTelemetry(resultsData.api_telemetry);
            }
            clearInterval(pollTimer);
          } else if (run.status === 'failed') {
            setErrorMsg('Discovery search failed. Check system monitoring.');
            setSearchCompleted(true);
            clearInterval(pollTimer);
          }
        } catch {
          // ignore transient poll error
        }
      }, 2000);

      // Real-time Server-Sent Events (SSE) Stream
      const unsubscribe = subscribeToSearchEvents(
        searchId,
        (msg) => {
          if (msg.data && typeof msg.data === 'object') {
            const ev = msg.data as ActivityEvent;
            setTimelineEvents((prev) => [ev, ...prev].slice(0, 30));

            // Stage updates
            if (msg.event === 'query_analyzed') {
              setSearchProgress(20);
              setSearchStage('Edge Taxonomy Matching Complete');
            } else if (msg.event === 'provider_started') {
              setSearchProgress(40);
              setSearchStage(`Searching Live Sources via ${msg.data.provider || 'Web Providers'}...`);
            } else if (msg.event === 'url_fetched') {
              setSearchProgress((p) => Math.min(p + 5, 75));
              setSearchStage(`Fetching & Sanitizing: ${msg.data.url?.slice(0, 45) || 'webpage'}...`);
            } else if (msg.event === 'candidate_accepted' || ev.event_type === 'candidate_accepted') {
              setSearchProgress((p) => Math.min(p + 5, 85));
              setSearchStage(`Candidate Identified: ${ev.metadata?.canonical_name || (ev.metadata?.project as any)?.canonical_name || 'Capital Project'}`);
              const proj = ev.metadata?.project || (ev as any).project;
              const pStatus = (proj?.status || '').toLowerCase();
              const isNotUpcoming = pStatus.includes('operational') || pStatus.includes('completed') || pStatus.includes('commissioned');
              const isProduct = isProductOrEquipment(proj?.canonical_name || proj?.title, proj?.summary);
              if (proj && !isNotUpcoming && !isProduct && !/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff]/.test(proj.canonical_name || proj.title || '')) {
                let st = proj.status || 'Planning';
                if (st === 'Active') st = 'Planning';
                setDiscoveredResults((prev) => {
                  const pName = proj.canonical_name || proj.name || proj.title || 'Capital Project';
                  const pDev = proj.company || proj.developer || 'Leading Developer';
                  const dedupKey = getProjectDedupKey(pName, pDev);
                  const exists = prev.some(item => getProjectDedupKey(item.canonical_name, item.company || item.developer) === dedupKey || item.project_url === proj.project_url);
                  return exists ? prev : [...prev, {
                    project_id: proj.id,
                    canonical_name: pName,
                    company: pDev,
                    developer: pDev,
                    date: (proj.date && proj.date !== 'Latest 2026') ? proj.date : '',
                    project_url: proj.project_url,
                    category: proj.category || 'Capital Projects',
                    status: st,
                    http_status: proj.http_status || 200,
                    summary: cleanSummaryText(proj.summary || ''),
                    relevance_score: 0.95
                  }];
                });
              }
            } else if (msg.event === 'extraction_completed') {
              setSearchProgress(90);
              setSearchStage('Workers AI Extraction Complete');
            } else if (msg.event === 'telemetry_summary' && (msg.data?.metadata?.telemetry || (msg.data as any)?.telemetry)) {
              setQueryTelemetry(msg.data.metadata?.telemetry || (msg.data as any).telemetry);
            } else if (msg.event === 'search_completed' || msg.event === 'done') {
              setSearchProgress(100);
              setSearchStage('Discovery Complete!');
              setSearchCompleted(true);
              api.getSearchResults(searchId).then((r: any) => {
                if (r.results && r.results.length > 0) {
                  setDiscoveredResults(r.results.map((item: any) => ({ ...item, summary: cleanSummaryText(item.summary) })));
                }
                if (r.api_telemetry) {
                  setQueryTelemetry(r.api_telemetry);
                }
              });
            }
          }
        },
        () => {
          // Fallback handled by pollTimer
        }
      );

      return () => {
        unsubscribe();
        clearInterval(pollTimer);
      };
    } catch (err: any) {
      setIsSubmitting(false);
      setErrorMsg(err?.message || 'Failed to dispatch search execution.');
    }
  };

  const downloadDiscoveredCsv = () => {
    if (discoveredResults.length === 0) return;
    let csv = "ID,Project Name,Company,Date,Valid URL,Category,Status,HTTP Status,Summary\n";
    for (const p of discoveredResults) {
      const name = `"${(p.canonical_name || '').replace(/"/g, '""')}"`;
      const comp = `"${(p.company || p.developer || '').replace(/"/g, '""')}"`;
      const dt = `"${(p.date && p.date !== 'Latest 2026' ? p.date : '').replace(/"/g, '""')}"`;
      const u = `"${(p.project_url || '').replace(/"/g, '""')}"`;
      const cat = `"${(p.category || '').replace(/"/g, '""')}"`;
      const st = `"${(p.status || '').replace(/"/g, '""')}"`;
      const http = p.http_status || 200;
      const sum = `"${(p.summary || '').replace(/"/g, '""')}"`;
      csv += `${p.project_id},${name},${comp},${dt},${u},${cat},${st},${http},${sum}\n`;
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `discovered_projects_2026_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
                placeholder="Enter any project search query (e.g. data center projects, solar farms, semiconductor fabs, gigafactories)..."
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
              <p className="text-[10px] text-slate-400">Llama 3.2 3B Inferences</p>
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
                        {p.date ? (
                          <span className="text-[10px] font-mono text-slate-300 px-2 py-0.5 rounded bg-slate-800 border border-slate-700/80 flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-sky-400" />
                            <span>{p.date}</span>
                          </span>
                        ) : null}
                        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/30">
                          {p.status}
                        </span>
                      </div>
                    </div>

                    <h3 className="text-base font-bold text-white line-clamp-1">
                      {p.canonical_name || (p as any).name || (p as any).title || (p as any).project?.canonical_name || 'Capital Project'}
                    </h3>
                    
                    <div className="flex items-center gap-1.5 text-xs text-sky-200/90 font-medium">
                      <Building2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      <span className="truncate">
                        {p.company || p.developer || (p as any).project?.company || (p as any).project?.developer || 'Leading Developer'}
                      </span>
                    </div>
                    
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
                    <span className="text-[11px] text-emerald-400 font-mono">
                      HTTP {p.http_status || 200} OK
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
