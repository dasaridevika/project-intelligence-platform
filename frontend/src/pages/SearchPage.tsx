import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Compass,
  Database,
  ExternalLink,
  Globe,
  History,
  Layers,
  Loader2,
  RotateCw,
  Search,
  Sparkles,
  Zap
} from 'lucide-react';
import { api, subscribeToSearchEvents } from '../api';
import { ActivityEvent, PrimarySector, SearchResultItem, SearchRun } from '../types';
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
            } else if (msg.event === 'candidate_accepted') {
              setSearchProgress((p) => Math.min(p + 5, 85));
              setSearchStage(`Candidate Identified: ${msg.data.title || 'Capital Project'}`);
            } else if (msg.event === 'extraction_completed') {
              setSearchProgress(90);
              setSearchStage('Workers AI Extraction Complete');
            } else if (msg.event === 'search_completed' || msg.event === 'done') {
              setSearchProgress(100);
              setSearchStage('Discovery Complete!');
              setSearchCompleted(true);
              api.getSearchResults(searchId).then((r) => setDiscoveredResults(r.results || []));
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
                placeholder="Enter search query..."
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
                {timelineEvents.map((ev, i) => (
                  <div key={i} className="flex items-start justify-between gap-3 text-slate-300">
                    <span className="text-sky-400 shrink-0">[{ev.component || 'Edge'}]</span>
                    <span className="truncate flex-1">{ev.message}</span>
                    <span className="text-[10px] text-slate-500 shrink-0">
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
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

            {activeSearchId && (
              <button
                onClick={() => navigate(`/projects?search_id=${activeSearchId}`)}
                className="text-xs text-sky-400 hover:text-sky-300 font-semibold flex items-center gap-1"
              >
                <span>Open in Repository</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
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
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/30">
                        {p.status}
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-white line-clamp-1">{p.canonical_name}</h3>
                    
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
