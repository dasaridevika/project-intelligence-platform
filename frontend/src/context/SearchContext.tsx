import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { api, subscribeToSearchEvents, isProductOrEquipment, getProjectDedupKey, cleanSummaryText, validateAndSanitizeProject } from '../api';
import { ActivityEvent, PrimarySector, QueryTelemetry, SearchResultItem, SearchRun } from '../types';
import { formatProjectDate } from '../pages/ProjectsPage';

interface SearchContextType {
  query: string;
  setQuery: (q: string) => void;
  selectedCategory: string;
  setSelectedCategory: (c: string) => void;
  selectedLocation: string;
  setSelectedLocation: (l: string) => void;
  providers: { exa: boolean; google: boolean };
  setProviders: React.Dispatch<React.SetStateAction<{ exa: boolean; google: boolean }>>;

  isSubmitting: boolean;
  activeSearchId: string | null;
  timelineEvents: ActivityEvent[];
  searchProgress: number;
  searchStage: string;
  discoveredResults: SearchResultItem[];
  searchCompleted: boolean;
  errorMsg: string | null;
  queryTelemetry: QueryTelemetry | null;

  searchHistory: SearchRun[];
  showHistory: boolean;
  setShowHistory: (show: boolean | ((prev: boolean) => boolean)) => void;
  loadHistory: () => Promise<void>;

  handleSelectSector: (sector: PrimarySector | null) => void;
  handleApplySectorToQuery: (sectorName: string) => void;
  executeSearch: (overrideQuery?: string) => Promise<void>;
  downloadDiscoveredCsv: () => void;
  resetSearch: () => void;
}

const SearchContext = createContext<SearchContextType | undefined>(undefined);

export const SearchProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [query, setQuery] = useState(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.get('q') || sessionStorage.getItem('pi_last_query') || '';
    } catch {
      return '';
    }
  });

  const [selectedCategory, setSelectedCategory] = useState('All Categories');
  const [selectedLocation, setSelectedLocation] = useState('Worldwide (Global)');
  const [providers, setProviders] = useState<{ exa: boolean; google: boolean }>({
    exa: true,
    google: true,
  });

  // Discovery Execution State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeSearchId, setActiveSearchId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('pi_last_search_id') || null;
    } catch {
      return null;
    }
  });

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

  const pollTimerRef = useRef<any>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const cleanupPollingAndSse = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
  };

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

  // Clean up timers on full app unmount
  useEffect(() => {
    return () => {
      cleanupPollingAndSse();
    };
  }, []);

  const handleSelectSector = (sector: PrimarySector | null) => {
    if (sector) {
      setSelectedCategory(sector.sector);
    } else {
      setSelectedCategory('All Categories');
    }
  };

  const handleApplySectorToQuery = (sectorName: string) => {
    const loc = selectedLocation !== 'Worldwide (Global)' ? selectedLocation : 'worldwide';
    const newQuery = `Upcoming ${sectorName} projects in ${loc}`;
    setQuery(newQuery);
    try {
      sessionStorage.setItem('pi_last_query', newQuery);
    } catch (_) {}
  };

  const resetSearch = () => {
    cleanupPollingAndSse();
    setIsSubmitting(false);
    setActiveSearchId(null);
    setTimelineEvents([]);
    setSearchProgress(0);
    setSearchStage('');
    setDiscoveredResults([]);
    setSearchCompleted(false);
    setErrorMsg(null);
    setQueryTelemetry(null);
    try {
      sessionStorage.removeItem('pi_last_search_id');
    } catch (_) {}
  };

  const executeSearch = async (overrideQuery?: string) => {
    const queryText = (overrideQuery ?? query).trim();
    if (!queryText || queryText.length < 3) return;

    if (overrideQuery && overrideQuery !== query) {
      setQuery(overrideQuery);
    }

    try {
      sessionStorage.setItem('pi_last_query', queryText);
    } catch (_) {}

    cleanupPollingAndSse();

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
        query: queryText,
        categories: selectedCategory !== 'All Categories' ? [selectedCategory] : undefined,
        location: selectedLocation !== 'Worldwide (Global)' ? selectedLocation : undefined,
        providers: activeProviders,
      });

      const searchId = res.search_run_id;
      setActiveSearchId(searchId);
      try {
        sessionStorage.setItem('pi_last_search_id', searchId);
      } catch (_) {}

      if (res.api_telemetry) {
        setQueryTelemetry(res.api_telemetry);
      }

      if (res.status === 'completed' || Array.isArray((res as any).results)) {
        const found = (res as any).results || [];
        setDiscoveredResults(found.map((item: any) => ({ ...item, summary: cleanSummaryText(item.summary) })));
        setSearchProgress(100);
        setSearchStage('Discovery Complete!');
        setSearchCompleted(true);
        setIsSubmitting(false);
        return;
      }

      setIsSubmitting(false);

      // Polling fallback
      pollTimerRef.current = setInterval(async () => {
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
            cleanupPollingAndSse();
          } else if (run.status === 'failed') {
            setErrorMsg('Discovery search failed. Check system monitoring.');
            setSearchCompleted(true);
            cleanupPollingAndSse();
          }
        } catch {
          // ignore transient poll error
        }
      }, 2000);

      // Real-time Server-Sent Events (SSE) Stream
      unsubscribeRef.current = subscribeToSearchEvents(
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
              setSearchStage(`Candidate Identified: ${ev.metadata?.canonical_name || (ev.metadata?.project as any)?.canonical_name || 'Project'}`);
              const proj = ev.metadata?.project || (ev as any).project;
              const validated = validateAndSanitizeProject(proj);
              if (validated && !isProductOrEquipment(validated.canonical_name, validated.summary) && !/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff]/.test(validated.canonical_name)) {
                setDiscoveredResults((prev) => {
                  const pName = validated.canonical_name;
                  const pDev = validated.company || validated.developer || '';
                  if (!pName) return prev;
                  const dedupKey = getProjectDedupKey(pName, pDev);
                  const exists = prev.some(item => getProjectDedupKey(item.canonical_name, item.company || item.developer) === dedupKey || item.project_url === validated.project_url);
                  return exists ? prev : [...prev, {
                    project_id: validated.id,
                    canonical_name: pName,
                    company: pDev,
                    developer: pDev,
                    country: validated.country || 'Not specified',
                    location: validated.location || validated.country || 'Not specified',
                    date: formatProjectDate(validated.date),
                    project_url: validated.project_url,
                    category: validated.category || 'Capital Projects',
                    status: validated.status,
                    http_status: validated.http_status || 200,
                    summary: cleanSummaryText(validated.summary || ''),
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
              cleanupPollingAndSse();
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
    } catch (err: any) {
      setIsSubmitting(false);
      cleanupPollingAndSse();
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
      const pid = p.project_id || (p as any).id || '';
      csv += `${pid},${name},${comp},${dt},${u},${cat},${st},${http},${sum}\n`;
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
    <SearchContext.Provider
      value={{
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
        loadHistory,
        handleSelectSector,
        handleApplySectorToQuery,
        executeSearch,
        downloadDiscoveredCsv,
        resetSearch,
      }}
    >
      {children}
    </SearchContext.Provider>
  );
};

export const useSearch = () => {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error('useSearch must be used within a SearchProvider');
  }
  return context;
};
