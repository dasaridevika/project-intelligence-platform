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
  Layers,
  Loader2,
  Search,
  Sparkles,
  Zap
} from 'lucide-react';
import { api } from '../services/api';
import { subscribeToSearchEvents, SSEMessage } from '../services/sse';
import { ActivityEvent, PrimarySector, ProviderUsageStat, SearchResultItem } from '../types';
import { SectorBadge } from '../components/SectorBadge';
import { SectorSelector } from '../components/SectorSelector';

const CATEGORIES = [
  'All Categories',
  'Data Center',
  'Semiconductor',
  'Solar Power',
  'Renewable Energy',
  'Infrastructure',
  'EV & Battery',
  'Hydrogen'
];

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
  const [usageStats, setUsageStats] = useState<ProviderUsageStat[]>([]);

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

  const fetchUsageStats = async () => {
    try {
      const data = await api.getUsageAnalytics();
      setUsageStats(data.providers || []);
    } catch (err) {
      console.warn('Unable to load provider usage analytics:', err);
    }
  };

  useEffect(() => {
    fetchUsageStats();
  }, []);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeSearchId, setActiveSearchId] = useState<string | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<ActivityEvent[]>([]);
  const [searchProgress, setSearchProgress] = useState<number>(0);
  const [searchStage, setSearchStage] = useState<string>('');
  const [discoveredResults, setDiscoveredResults] = useState<SearchResultItem[]>([]);
  const [searchCompleted, setSearchCompleted] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Auto trigger if query param present
  useEffect(() => {
    const initialQuery = searchParams.get('q');
    if (initialQuery && !activeSearchId) {
      setQuery(initialQuery);
    }
  }, [searchParams]);

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || query.length < 3) return;

    setIsSubmitting(true);
    setErrorMsg(null);
    setTimelineEvents([]);
    setDiscoveredResults([]);
    setSearchProgress(5);
    setSearchStage('Initiating Outbox Queue...');
    setSearchCompleted(false);

    const activeProviders = [];
    if (providers.exa) activeProviders.push('exa');
    if (providers.google) activeProviders.push('google');

    try {
      // POST 202 Accepted
      const res = await api.createSearch({
        query: query.trim(),
        categories: selectedCategory !== 'All Categories' ? [selectedCategory] : undefined,
        location: selectedLocation !== 'Worldwide (Global)' ? selectedLocation : undefined,
        providers: activeProviders,
      });

      const searchId = res.search_run_id;
      setActiveSearchId(searchId);
      setIsSubmitting(false);

      // Connect to SSE Stream
      const unsubscribe = subscribeToSearchEvents(
        searchId,
        async (msg: SSEMessage) => {
          if (msg.event === 'done') {
            setSearchProgress(100);
            setSearchCompleted(true);
            unsubscribe();
            fetchUsageStats();
            // Fetch completed results
            try {
              const resData = await api.getSearchResults(searchId);
              setDiscoveredResults(resData.results);
            } catch (err) {
              console.error('Failed to fetch search results:', err);
            }
          } else if (msg.data && typeof msg.data === 'object' && msg.data.event_type) {
            setTimelineEvents((prev) => {
              if (prev.some((e) => e.event_id === msg.data.event_id)) return prev;
              return [...prev, msg.data];
            });

            // Update progress percentages based on event types
            switch (msg.data.event_type) {
              case 'search_created':
                setSearchProgress(10);
                setSearchStage('Search Enqueued');
                break;
              case 'query_analyzed':
                setSearchProgress(20);
                setSearchStage('Query NLP Analyzed');
                break;
              case 'provider_started':
                setSearchProgress(35);
                setSearchStage('Executing External Providers');
                break;
              case 'provider_completed':
                setSearchProgress(50);
                setSearchStage('Provider Results Received');
                break;
              case 'extraction_started':
                setSearchProgress(65);
                setSearchStage('Extracting Structured Capital Projects');
                break;
              case 'extraction_completed':
                setSearchProgress(75);
                setSearchStage('Data Extraction Completed');
                break;
              case 'deduplication_completed':
                setSearchProgress(85);
                setSearchStage('Deduplication & Entity Matching');
                break;
              case 'search_completed':
                setSearchProgress(100);
                setSearchStage('Search Complete');
                setSearchCompleted(true);
                break;
              case 'search_failed':
                setSearchProgress(100);
                setSearchStage('Execution Failed');
                setSearchCompleted(true);
                break;
            }
          }
        },
        (err) => {
          console.warn('SSE stream error/closed:', err);
        }
      );
    } catch (err: any) {
      setIsSubmitting(false);
      const errorDetail =
        err?.response?.data?.detail ||
        err?.response?.data?.message ||
        err?.message ||
        'Failed to connect to backend service.';
      setErrorMsg(errorDetail);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Search Header */}
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-400 mb-1">
          <Globe className="w-4 h-4" />
          <span>Global Intelligence Query Builder</span>
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight sm:text-3xl">
          Project Discovery Search
        </h1>
        <p className="text-sm text-slate-300 mt-1">
          Enter an international query to discover hyperscale data centers, semiconductor fabs, renewable parks, and infrastructure globally.
        </p>
      </div>

      {/* Main Search Form Card */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 shadow-xl">
        {/* Quota Exhaustion Alert Banner */}
        {usageStats.some((p) => p.quota_exhausted) && (
          <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-start gap-3 shadow-lg">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-rose-200">API Free Credits / Quota Depleted</p>
              {usageStats
                .filter((p) => p.quota_exhausted)
                .map((p) => (
                  <p key={p.provider} className="text-xs text-rose-300/90">
                    <span className="font-semibold uppercase tracking-wider">{p.provider === 'google' ? 'Google Search' : p.provider.toUpperCase()}:</span>{' '}
                    {p.last_error_message || 'Free credits finished or quota limit reached (HTTP 402/429). Please top up your API balance.'}
                  </p>
                ))}
            </div>
          </div>
        )}

        {/* Live Requests Sent Counter Bar */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs">
          <div className="flex items-center gap-2 text-slate-300 font-medium">
            <Zap className="w-4 h-4 text-sky-400" />
            <span>API Requests Sent Till Now:</span>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            {usageStats.map((p) => (
              <div key={p.provider} className="flex items-center gap-2">
                <span className="font-bold text-slate-300 uppercase tracking-wider">
                  {p.provider === 'google' ? 'Google Search' : p.provider.toUpperCase()}:
                </span>
                <span className="px-2.5 py-0.5 rounded-md bg-slate-800 text-white font-mono font-semibold">
                  {p.total_requests} requests
                </span>
                {p.quota_exhausted ? (
                  <span className="px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[10px] font-bold uppercase tracking-wider">
                    ⚠️ Credits Finished
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-medium uppercase tracking-wider">
                    Active
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={handleSearchSubmit} className="space-y-6">
          {/* Query Bar */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2">
              Natural Language Discovery Query
            </label>
            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. Upcoming hyperscale data center projects in Northern Virginia, TSMC semiconductor fabs in Germany, or Solar projects in Saudi Arabia"
                className="w-full pl-11 pr-4 py-3.5 rounded-xl bg-slate-950 border border-slate-700/80 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500 text-sm sm:text-base shadow-inner"
              />
              <Search className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
            </div>
          </div>

          {/* Primary Sector Taxonomy Selector (462 Sectors & Definitions) */}
          <SectorSelector
            selectedSector={selectedCategory}
            onSelectSector={handleSelectSector}
            onApplyToQuery={handleApplySectorToQuery}
          />

          {/* Filters Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Target Region / Geography
              </label>
              <select
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
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
              <div className="flex items-center gap-4 py-2 px-3 rounded-lg bg-slate-950 border border-slate-700">
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
                  <span>Google Search</span>
                </label>
              </div>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
              {errorMsg}
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-slate-300">
              Asynchronous execution: returns HTTP 202 and streams progress live via SSE.
            </span>
            <button
              type="submit"
              disabled={isSubmitting || !query.trim()}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium text-sm transition-all shadow-lg shadow-sky-600/30"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Enqueuing...</span>
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  <span>Submit Discovery Search</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Live Search Execution Box */}
      {activeSearchId && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
                <Activity className="w-4 h-4 animate-pulse" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">Live Execution Timeline</h3>
                <p className="text-xs text-slate-400 font-mono">Job ID: {activeSearchId}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-sky-400">{searchStage || 'Processing'}</span>
              <span className="text-xs text-slate-400 font-mono">({searchProgress}%)</span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
            <div
              className="bg-gradient-to-r from-sky-500 to-indigo-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${searchProgress}%` }}
            />
          </div>

          {/* Activity Events Timeline */}
          <div className="space-y-3 max-h-64 overflow-y-auto pr-2">
            {timelineEvents.map((ev, i) => (
              <div key={ev.event_id || i} className="flex items-start gap-3 text-xs">
                <div className="mt-0.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-slate-200">{ev.message}</p>
                  <p className="text-[11px] text-slate-300 font-mono">
                    [{ev.component}] {new Date(ev.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {searchCompleted && (
            <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
              <span className="text-xs font-medium text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                Discovery complete. {discoveredResults.length} canonical projects extracted.
              </span>
              <button
                onClick={() => navigate(`/results?search_id=${activeSearchId}`)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition-colors"
              >
                <span>View Full Results Explorer</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Discovered Projects Preview Table */}
      {discoveredResults.length > 0 && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-base font-semibold text-white">Discovered Capital Projects</h3>
              <p className="text-xs text-slate-400">Normalized records deduplicated from external search providers</p>
            </div>
            <span className="text-xs px-2.5 py-1 rounded bg-slate-800 text-slate-300 font-medium">
              {discoveredResults.length} Projects
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Project Name</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Developer</th>
                  <th className="py-3 px-4">Location</th>
                  <th className="py-3 px-4">Capacity / Investment</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Relevance</th>
                  <th className="py-3 px-4">Sources</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {discoveredResults.map((item) => (
                  <tr
                    key={item.project_id}
                    onClick={() => navigate(`/projects/${item.project_id}`)}
                    className="hover:bg-slate-800/40 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4 font-medium text-slate-200 max-w-xs truncate">
                      {item.canonical_name}
                    </td>
                    <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                      <SectorBadge sectorName={item.category} />
                    </td>
                    <td className="py-3 px-4 text-slate-300">{item.developer || '—'}</td>
                    <td className="py-3 px-4 text-slate-300">
                      {[item.location_city, item.location_state, item.location_country].filter(Boolean).join(', ') || 'Global'}
                    </td>
                    <td className="py-3 px-4 text-slate-300">
                      {item.capacity_value ? `${item.capacity_value} ${item.capacity_unit}` : ''}
                      {item.investment_value ? ` • ${item.investment_currency || '$'}${item.investment_value.toLocaleString()}` : ''}
                      {!item.capacity_value && !item.investment_value ? '—' : ''}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                        {item.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold text-sky-400">
                      {(item.relevance_score * 100).toFixed(1)}%
                    </td>
                    <td className="py-3 px-4 text-slate-400 font-mono">
                      {item.sources?.length || 1} URL(s)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
