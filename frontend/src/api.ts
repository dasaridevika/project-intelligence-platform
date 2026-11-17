import axios from 'axios';
import {
  ActivityEvent,
  PrimarySector,
  Project,
  SearchResultItem,
  SearchRun,
  SystemHealth,
  UsageAnalytics,
  SSEMessage,
} from './types';

const API_BASE = '/api/v1';

export const apiClient = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const errorMsg =
      error?.response?.data?.message ||
      error?.response?.data?.error ||
      error?.response?.data?.detail ||
      error?.message ||
      'Edge AI Worker communication error';
    error.message = errorMsg;
    return Promise.reject(error);
  }
);

// ==============================================================================
// DURABLE PERSISTENCE LAYER (Saves data across code updates & redeploys)
// ==============================================================================

const STORAGE_PROJECTS_KEY = 'pi_persisted_projects_v4';
const STORAGE_SEARCHES_KEY = 'pi_persisted_searches_v4';

function hasNonLatin(str?: string): boolean {
  if (!str) return false;
  return /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff]/.test(str);
}

function isUpcomingStatus(status?: string): boolean {
  if (!status) return true;
  const s = status.toLowerCase();
  return !s.includes('operational') && !s.includes('completed') && !s.includes('commissioned');
}

function getStoredProjects(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_PROJECTS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list)
      ? list.filter(p => p.canonical_name && !p.canonical_name.startsWith('Project from') && !hasNonLatin(p.canonical_name) && !hasNonLatin(p.summary) && isUpcomingStatus(p.status))
      : [];
  } catch {
    return [];
  }
}

function saveStoredProjects(projects: Project[]) {
  try {
    const cleanProjects = projects.filter(p => !hasNonLatin(p.canonical_name) && !hasNonLatin(p.summary) && isUpcomingStatus(p.status));
    const existing = getStoredProjects();
    const map = new Map<string, Project>();
    for (const p of existing) map.set(p.id, p);
    for (const p of cleanProjects) map.set(p.id, p);
    const merged = Array.from(map.values()).slice(-500);
    localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(merged));
  } catch (err) {
    console.warn('LocalStorage save notice:', err);
  }
}

function getStoredSearches(): SearchRun[] {
  try {
    const raw = localStorage.getItem(STORAGE_SEARCHES_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter(s => !hasNonLatin(s.query)) : [];
  } catch {
    return [];
  }
}

function saveStoredSearches(searches: SearchRun[]) {
  try {
    const existing = getStoredSearches();
    const map = new Map<string, SearchRun>();
    for (const s of existing) map.set(s.id, s);
    for (const s of searches) map.set(s.id, s);
    const merged = Array.from(map.values()).slice(-100);
    localStorage.setItem(STORAGE_SEARCHES_KEY, JSON.stringify(merged));
  } catch (err) {
    console.warn('LocalStorage save notice:', err);
  }
}

export const api = {
  // Search
  createSearch: async (data: {
    query: string;
    categories?: string[];
    location?: string;
    providers?: string[];
  }): Promise<{ search_run_id: string; status: string; query: string; api_telemetry?: any; results?: SearchResultItem[] }> => {
    const res = await apiClient.post('/search', data);
    return res.data;
  },

  listSearches: async (status?: string, limit = 50, offset = 0): Promise<SearchRun[]> => {
    try {
      const params: Record<string, any> = { limit, offset };
      if (status) params.status = status;
      const res = await apiClient.get('/search', { params });
      const serverRuns = res.data || [];
      if (Array.isArray(serverRuns) && serverRuns.length > 0) {
        saveStoredSearches(serverRuns);
      }
      const stored = getStoredSearches();
      // If server store is fresh/empty after a redeploy, sync stored searches back to server!
      if (serverRuns.length === 0 && stored.length > 0) {
        apiClient.post('/sync', { searches: stored }).catch(() => {});
        return stored;
      }
      return serverRuns;
    } catch (err) {
      const stored = getStoredSearches();
      if (stored.length > 0) return stored;
      throw err;
    }
  },

  getSearchRun: async (id: string): Promise<SearchRun> => {
    try {
      const res = await apiClient.get(`/search/${id}`);
      return res.data;
    } catch (err) {
      const stored = getStoredSearches().find(s => s.id === id);
      if (stored) return stored;
      throw err;
    }
  },

  getSearchResults: async (
    id: string
  ): Promise<{ search_run_id: string; query: string; status: string; total_results: number; results: SearchResultItem[]; api_telemetry?: any }> => {
    const res = await apiClient.get(`/search/${id}/results`);
    if (res.data?.results) {
      const mapped: Project[] = res.data.results
        .filter((r: any) => !hasNonLatin(r.canonical_name) && !hasNonLatin(r.title) && !hasNonLatin(r.summary) && isUpcomingStatus(r.status))
        .map((r: any) => {
          let st = r.status || 'Planning';
          if (st === 'Active') st = 'Planning';
          return {
            id: r.project_id || r.id,
            canonical_name: r.canonical_name || r.name || r.title || r.project?.canonical_name || 'Capital Project',
            company: r.company || r.developer || r.project?.company || r.project?.developer || 'Leading Developer',
            developer: r.developer || r.company || r.project?.developer || r.project?.company || 'Leading Developer',
            project_url: r.project_url || r.project?.project_url || (r.sources && r.sources[0]?.source_url) || '',
            category: r.category || 'Capital Projects',
            status: st,
            date: r.date || r.project?.date || 'Latest 2026',
            http_status: r.http_status || 200,
            summary: r.summary || '',
            created_at: new Date().toISOString(),
          };
        });
      saveStoredProjects(mapped);
      return {
        ...res.data,
        results: mapped as any,
        total_results: mapped.length,
        api_telemetry: res.data?.api_telemetry,
      };
    }
    return res.data;
  },

  // Projects
  listProjects: async (params?: {
    category?: string;
    location?: string;
    status?: string;
    developer?: string;
    search?: string;
    page?: number;
    page_size?: number;
    sort_by?: string;
    sort_order?: string;
  }): Promise<{ total: number; page: number; page_size: number; projects: Project[] }> => {
    try {
      const res = await apiClient.get('/projects', { params });
      const serverProjects = res.data?.projects || [];
      if (serverProjects.length > 0) {
        saveStoredProjects(serverProjects);
      }
      const stored = getStoredProjects();
      // If server store is fresh/empty after a redeploy, sync stored projects back to server!
      if (serverProjects.length === 0 && stored.length > 0) {
        apiClient.post('/sync', { projects: stored }).catch(() => {});
        return {
          total: stored.length,
          page: 1,
          page_size: stored.length,
          projects: stored,
        };
      }
      return res.data;
    } catch (err) {
      const stored = getStoredProjects();
      if (stored.length > 0) {
        return {
          total: stored.length,
          page: 1,
          page_size: stored.length,
          projects: stored,
        };
      }
      throw err;
    }
  },

  getProject: async (id: string): Promise<Project> => {
    try {
      const res = await apiClient.get(`/projects/${id}`);
      return res.data;
    } catch (err) {
      const stored = getStoredProjects().find(p => p.id === id);
      if (stored) return stored;
      throw err;
    }
  },

  getExportCsvUrl: (category?: string, status?: string): string => {
    const q = new URLSearchParams();
    if (category) q.set('category', category);
    if (status) q.set('status', status);
    return `/api/v1/projects/export?${q.toString()}`;
  },

  // Analytics & Health
  getUsageAnalytics: async (): Promise<UsageAnalytics> => {
    const res = await apiClient.get('/analytics/usage');
    return res.data;
  },

  getProviders: async (): Promise<{ providers: any[] }> => {
    const res = await apiClient.get('/analytics/providers');
    return res.data;
  },

  getSearchPerformance: async (): Promise<any> => {
    const res = await apiClient.get('/analytics/search-performance');
    return res.data;
  },

  getSystemHealth: async (): Promise<SystemHealth> => {
    const res = await apiClient.get('/analytics/system-health');
    return res.data;
  },

  // Monitoring
  getMonitoringEvents: async (limit = 50): Promise<ActivityEvent[]> => {
    const res = await apiClient.get('/monitoring/events', { params: { limit } });
    return res.data;
  },

  getMonitoringErrors: async (limit = 50): Promise<any[]> => {
    const res = await apiClient.get('/monitoring/errors', { params: { limit } });
    return res.data;
  },

  // Primary Sectors Taxonomy
  listSectors: async (params?: { q?: string; group?: string; limit?: number }): Promise<{ total: number; groups: string[]; sectors: PrimarySector[] }> => {
    const res = await apiClient.get('/sectors', { params });
    return res.data;
  },

  getSectorGroups: async (): Promise<{ group: string; count: number }[]> => {
    const res = await apiClient.get('/sectors/groups');
    return res.data;
  },

  // Cloudflare Workers AI edge extraction
  aiExtractUrl: async (url: string, category?: string): Promise<any> => {
    const res = await apiClient.post('/ai/extract', { url, category });
    return res.data;
  },

  aiBatchExtract: async (urls: string[], category?: string): Promise<any> => {
    const res = await apiClient.post('/ai/batch-extract', { urls, category });
    return res.data;
  },
};

// Real-time Server-Sent Events (SSE) subscriber
export function subscribeToSearchEvents(
  searchRunId: string,
  onEvent: (msg: SSEMessage) => void,
  onError?: (err: any) => void
): () => void {
  const url = `/api/v1/search/${searchRunId}/events`;
  const eventSource = new EventSource(url);

  eventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      onEvent({ id: e.lastEventId, event: 'message', data });
    } catch {
      onEvent({ id: e.lastEventId, event: 'message', data: e.data });
    }
  };

  const knownEvents = [
    'search_created',
    'query_analyzed',
    'job_published',
    'provider_started',
    'provider_completed',
    'provider_failed',
    'provider_fallback',
    'url_fetched',
    'candidate_accepted',
    'candidate_rejected',
    'extraction_started',
    'extraction_completed',
    'deduplication_completed',
    'ranking_evaluated',
    'projects_saved',
    'search_completed',
    'search_failed',
    'done'
  ];

  for (const evName of knownEvents) {
    eventSource.addEventListener(evName, (e: any) => {
      try {
        const data = JSON.parse(e.data);
        onEvent({ id: e.lastEventId, event: evName, data });
      } catch {
        onEvent({ id: e.lastEventId, event: evName, data: e.data });
      }
    });
  }

  eventSource.onerror = (err) => {
    if (onError) onError(err);
  };

  return () => {
    eventSource.close();
  };
}
