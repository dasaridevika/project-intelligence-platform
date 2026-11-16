import axios from 'axios';
import {
  ActivityEvent,
  PrimarySector,
  Project,
  SearchResultItem,
  SearchRun,
  SystemHealth,
  UsageAnalytics,
  User,
} from '../types';

const API_BASE = '/api/v1';

export const apiClient = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach JWT access token if present
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auto-retry cold start errors (502, 503, 504) with exponential backoff
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config as any;
    const status = error.response?.status;
    const isColdStart = !error.response || (status && [502, 503, 504].includes(status));

    if (config && isColdStart && (config.__retryCount || 0) < 3) {
      config.__retryCount = (config.__retryCount || 0) + 1;
      const delayMs = config.__retryCount * 2500;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return apiClient(config);
    }

    if (error.response && [502, 503, 504].includes(error.response.status)) {
      error.message =
        'Backend service is waking up from idle state (Render Free Tier cold start takes ~45s). Please wait a few seconds and try again.';
    }

    return Promise.reject(error);
  }
);

export const api = {
  // Search
  createSearch: async (data: {
    query: string;
    categories?: string[];
    location?: string;
    providers?: string[];
  }): Promise<{ search_run_id: string; status: string; query: string }> => {
    const res = await apiClient.post('/search', data);
    return res.data;
  },

  listSearches: async (status?: string, limit = 20, offset = 0): Promise<SearchRun[]> => {
    const params: Record<string, any> = { limit, offset };
    if (status) params.status = status;
    const res = await apiClient.get('/search', { params });
    return res.data;
  },

  getSearchRun: async (id: string): Promise<SearchRun> => {
    const res = await apiClient.get(`/search/${id}`);
    return res.data;
  },

  executeSearchNow: async (id: string): Promise<any> => {
    const res = await apiClient.post(`/search/${id}/execute`);
    return res.data;
  },

  getSearchResults: async (
    id: string
  ): Promise<{ search_run_id: string; query: string; status: string; total_results: number; results: SearchResultItem[] }> => {
    const res = await apiClient.get(`/search/${id}/results`);
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
    const res = await apiClient.get('/projects', { params });
    return res.data;
  },

  getProject: async (id: string): Promise<Project> => {
    const res = await apiClient.get(`/projects/${id}`);
    return res.data;
  },

  getExportCsvUrl: (category?: string, status?: string): string => {
    const q = new URLSearchParams();
    if (category) q.set('category', category);
    if (status) q.set('status', status);
    return `/api/v1/projects/export?${q.toString()}`;
  },

  // Analytics
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

  // Primary Sectors Taxonomy (462 Sectors & Definitions)
  listSectors: async (params?: { q?: string; group?: string; limit?: number }): Promise<{ total: number; groups: string[]; sectors: PrimarySector[] }> => {
    const res = await apiClient.get('/sectors', { params });
    return res.data;
  },

  getSectorGroups: async (): Promise<{ group: string; count: number }[]> => {
    const res = await apiClient.get('/sectors/groups');
    return res.data;
  },

  getSectorDetail: async (id: string): Promise<PrimarySector> => {
    const res = await apiClient.get(`/sectors/${id}`);
    return res.data;
  },
};
