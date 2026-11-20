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

const STORAGE_PROJECTS_KEY = 'pi_persisted_projects_v6';
const STORAGE_SEARCHES_KEY = 'pi_persisted_searches_v6';

export function hasNonLatin(str?: string): boolean {
  if (!str) return false;
  return /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff]/.test(str);
}

export function isUpcomingStatus(status?: string): boolean {
  if (!status) return false;
  const s = status.toLowerCase().trim();
  return s === 'announced' || s === 'planning' || s === 'under construction';
}

export function isValidCompany(name?: string): boolean {
  if (!name || typeof name !== 'string') return false;
  const n = name.trim();
  return n.length >= 2 && !/^(?:none|null|n\/a|various|multiple|unknown|tbd|undefined|capital project)\b/i.test(n);
}

export function isNewsPublisher(name?: string): boolean {
  if (!name || typeof name !== 'string') return false;
  return /\b(?:reuters|bloomberg|constructconnect|datacenterdynamics|dcn|associated press|prnewswire|businesswire|globenewswire|forbes|statista|wood mackenzie|rystad energy|s&p global|eia)\b/i.test(name.trim());
}

export function isCompletedOrOperational(url?: string, name?: string, summary?: string): boolean {
  const combined = `${url || ''} ${name || ''} ${summary || ''}`.toLowerCase();
  return /\b(?:came online|just came online|go fully operational|goes fully operational|went fully operational|is now operational|is now open|has opened)\b/i.test(combined);
}

export function isNonProjectOrReport(url?: string, name?: string, company?: string, summary?: string): boolean {
  return false;
}

export function isProductOrEquipment(name?: string, summary?: string): boolean {
  if (!name && !summary) return false;
  const combined = `${name || ''} ${summary || ''}`.toLowerCase();
  return /\b(?:dicing system|wafer dicing|plasma system|inspection tool|single-crystal diamond|diamond wafer|fab equipment spending)\b/i.test(combined);
}

export function cleanProjectTitle(rawName?: string, developer?: string): string {
  if (!rawName || typeof rawName !== 'string') return '';
  return rawName.trim().replace(/^\[[^\]]+\]\s*/i, '');
}

export function inferCategoryClient(projectName?: string, summary?: string, hintCategory?: string): string {
  return hintCategory || 'Capital Infrastructure';
}

export function formatProjectDate(rawDate?: string): string {
  return (rawDate || '').trim();
}

export function validateAndSanitizeProject(p: any): Project | null {
  if (!p || typeof p !== 'object') return null;

  const rawName = p.canonical_name || p.name || p.title || '';
  if (!rawName || rawName.length < 2) return null;
  const rawCompany = (p.company || p.developer || '').trim();
  const rawUrl = p.project_url || p.url || '';
  const summary = p.summary || p.text || '';
  const rawDate = p.date || '';

  // 1. Company entity validation: reject if website domain / TLD or generic
  if (/\.(?:online|com|org|net|io|co|info|gov|edu|ai|app|tech|dev|biz|tv|me|us|uk|de|in|cn|jp|fr|es|eu|nl)\b/i.test(rawCompany)) {
    return null;
  }
  if (/^(?:various|multiple|several|diverse|undisclosed|unspecified|anonymous|unknown|tbd|undefined|capital project)\b/i.test(rawCompany)) {
    return null;
  }

  // Check if company matches website domain
  try {
    if (rawUrl) {
      const u = new URL(rawUrl);
      const host = u.hostname.toLowerCase().replace(/^(?:www\d*|m|amp|news|blog|press|media|articles)\./i, '');
      const rootDomain = host.split('.')[0] || '';
      const compClean = rawCompany.toLowerCase().replace(/[^a-z0-9]/g, '');
      const rootClean = rootDomain.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (compClean && rootClean && (compClean === rootClean || rootClean.includes(compClean) || (compClean.length >= 4 && compClean.includes(rootClean)))) {
        return null;
      }
    }
  } catch (_) {}

  // 2. Reject listicles, directories, rankings
  if (
    /\b(?:directory|largest\s+solar|largest\s+wind|largest\s+projects\s+directory|top\s+\d+|largest\s+\d+|in\s+the\s+us)\b/i.test(rawName) ||
    /\b(?:the\s+article\s+lists|the\s+article\s+provides\s+a\s+directory|provides\s+a\s+directory|lists\s+the\s+largest)\b/i.test(summary)
  ) {
    return null;
  }

  // 3. Reject already operating facilities
  if (
    /\b(?:now\s+powers|currently\s+powers|it\s+now\s+powers|powers\s+\d+|is\s+powering|now\s+generates|currently\s+generates|now\s+supplies|supplies\s+power\s+to|reducing\s+co2\s+emissions\s+by|reduces\s+co2\s+emissions\s+by|cuts\s+\d+[\d,.]*\s+tonnes\s+of\s+co|turned\s+a\s+.*into\s+a\s+solar|signs?\s+25-year\s+floating\s+solar\s+supply\s+agreement)\b/i.test(summary)
  ) {
    return null;
  }

  // Status sanitization
  let status = p.status || 'Planning';
  const stLower = status.toLowerCase().trim();
  if (stLower === 'under construction') {
    status = 'Under Construction';
  } else if (stLower === 'announced') {
    status = 'Announced';
  } else {
    status = 'Planning';
  }

  // Location & country sanitization
  let loc = (p.location || '').trim();
  if (/^(?:none|null|undefined|n\/a)$/i.test(loc)) loc = '';
  let ctry = (p.country || '').trim();
  if (/^(?:none|null|undefined|n\/a)$/i.test(ctry)) ctry = '';

  return {
    id: p.id || p.project_id || `proj_${Math.random().toString(36).slice(2, 9)}`,
    canonical_name: rawName.trim(),
    company: rawCompany,
    developer: rawCompany,
    project_url: rawUrl,
    status,
    category: p.category || 'Capital Infrastructure',
    country: ctry || (loc && loc.includes(',') ? loc.split(',').pop()?.trim() : loc) || 'Not specified',
    location: loc || ctry || 'Not specified',
    date: rawDate,
    http_status: p.http_status || 200,
    summary: cleanSummaryText(summary),
    created_at: p.created_at || new Date().toISOString(),
  };
}

export function getProjectDedupKey(name?: string, developer?: string): string {
  const STOPWORDS_REGEX = /\b(?:the|a|an|platforms|platform|technologies|technology|energy|resources|resource|holdings|services|solutions|group|corp|corporation|inc|llc|ltd|limited|co|company|asset|assets|management|capital|investments|investment|partners|partnership|ventures|venture|and|ai|artificial\s*intelligence|hyperscale|data\s*center|data\s*centre|megafab|gigafactory|project|campus|facility|plant|center|centre|park|farm|bess|battery|solar|wind|energy\s*storage|storage|phase\s*\d+|expansion|site|hub|solarpark|windpark|kraftwerk|solaranlage|photovoltaikanlage|photovoltaik|buergersolarpark|bürgersolarpark|windfarm|datacenter|datacentre|pv|solar-plus-storage)\b/gi;

  let cleanName = (name || '')
    .toLowerCase()
    .replace(/^(?:solarpark|windpark|kraftwerk|buergersolarpark)\s+/i, '');

  const combined = `${developer || ''} ${cleanName}`
    .toLowerCase()
    .replace(/['’]s\b/gi, '')
    .replace(STOPWORDS_REGEX, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Extract unique distinctive entity tokens sorted alphabetically
  const tokens = Array.from(new Set(combined.split(/\s+/).filter(t => t.length >= 3)));
  tokens.sort();

  return tokens.join('_') || `${(developer || '').toLowerCase()}_${(name || '').toLowerCase()}`;
}

export function cleanSummaryText(raw?: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let clean = raw
    // 1. Strip fenced code blocks and inline backtick code snippets
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]+`/g, ' ')
    // 2. Strip scripts, styles, code, and pre tags with inner content
    .replace(/<(?:script|style|code|pre|noscript|svg)\b[^<]*(?:(?!<\/(?:script|style|code|pre|noscript|svg)>)<[^<]*)*<\/(?:script|style|code|pre|noscript|svg)>/gi, ' ')
    // 3. Strip function signatures, curly bracket blocks, and JSON objects
    .replace(/\bfunction(?:\s+[a-zA-Z0-9_$]+)?\s*\([^)]*\)\s*\{[^}]*\}/g, ' ')
    .replace(/\{[^{}]*\}/g, ' ')
    // 4. Strip programming syntax and script statements
    .replace(/\b(?:function\b|const\b|var\b|let\b|class\b|import\b|export\b|return\b|console\.\w+\s*\(|curl\s+-[a-zA-Z]|npm\s+(?:run|install))\b/g, ' ')
    // 5. Strip unparsed markdown link syntax: [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // 6. Strip markdown headers, bold, italics, bullets
    .replace(/^#+\s+/gm, '')
    .replace(/\s+#+\s+/g, ' ')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/^\s*[-•*]\s+/gm, '')
    // 7. Strip HTML tags and entities
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:quot|amp|lt|gt|nbsp|apos|#39);/gi, ' ')
    // 8. Strip common directory / boilerplate / byline phrases
    .replace(/\b(?:find a data center|search \d+[\d,]* data centers?|click here to read more|read full report|share this article|photo by|written by|author:?)\b/gi, '')
    // 9. Strip trailing ellipsis and multiple dots
    .replace(/\.{2,}/g, '.')
    // 10. Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();

  // If text is excessively long or truncated, neatly end at sentence boundary
  if (clean.length > 280) {
    const lastPeriod = clean.lastIndexOf('.', 280);
    if (lastPeriod > 100) {
      clean = clean.slice(0, lastPeriod + 1);
    } else {
      clean = clean.slice(0, 275).replace(/\s+\S*$/, '') + '.';
    }
  }

  if (clean && !/[.!?]$/.test(clean)) {
    clean += '.';
  }

  return clean;
}

function getStoredProjects(): Project[] {
  try {
    // Purge legacy contaminated storage keys so old bad data cannot resurface
    localStorage.removeItem('pi_persisted_projects_v5');
    localStorage.removeItem('pi_persisted_projects');
    localStorage.removeItem('pi_persisted_searches_v5');

    const raw = localStorage.getItem(STORAGE_PROJECTS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list)
      ? list.map(validateAndSanitizeProject).filter((p: Project | null): p is Project => p !== null)
      : [];
  } catch {
    return [];
  }
}

function saveStoredProjects(projects: Project[]) {
  try {
    const cleanProjects = projects
      .map(validateAndSanitizeProject)
      .filter((p: Project | null): p is Project => p !== null);
    const existing = getStoredProjects();
    const map = new Map<string, Project>();
    for (const p of existing) {
      const key = getProjectDedupKey(p.canonical_name, p.company || p.developer);
      map.set(key, p);
    }
    for (const p of cleanProjects) {
      const key = getProjectDedupKey(p.canonical_name, p.company || p.developer);
      map.set(key, p);
    }
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
      return serverRuns;
    } catch (err) {
      console.warn('Failed to fetch searches:', err);
      return [];
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
        .map((r: any) => validateAndSanitizeProject(r.project || r))
        .filter((p: Project | null): p is Project => p !== null);
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
    group?: string;
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
      const serverProjects = (res.data?.projects || [])
        .map((p: any) => validateAndSanitizeProject(p))
        .filter((p: Project | null): p is Project => p !== null);
      if (serverProjects.length > 0) {
        saveStoredProjects(serverProjects);
      }
      return {
        ...res.data,
        total: res.data?.total !== undefined ? res.data.total : serverProjects.length,
        projects: serverProjects,
      };
    } catch (err) {
      console.warn('Failed to fetch projects:', err);
      return { total: 0, page: 1, page_size: 50, projects: [] };
    }
  },

  getProject: async (id: string): Promise<Project> => {
    try {
      const res = await apiClient.get(`/projects/${id}`);
      const validated = validateAndSanitizeProject(res.data);
      if (validated) return validated;
      const stored = getStoredProjects().find(p => p.id === id);
      if (stored) return stored;
      throw new Error('Project not found or invalid');
    } catch (err) {
      const stored = getStoredProjects().find(p => p.id === id);
      if (stored) return stored;
      throw err;
    }
  },

  getExportCsvUrl: (category?: string, status?: string, group?: string, location?: string, search?: string): string => {
    const q = new URLSearchParams();
    if (category && category !== 'All Categories' && category !== 'all') q.set('category', category);
    if (status && status !== 'All Statuses' && status !== 'All Upcoming Statuses') q.set('status', status);
    if (group && group !== 'All Groups' && group !== 'all') q.set('group', group);
    if (location && location !== 'All Regions' && location !== 'Worldwide (Global)' && location !== 'all') q.set('location', location);
    if (search && search.trim()) q.set('search', search.trim());
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
