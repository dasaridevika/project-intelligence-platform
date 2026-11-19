export interface PrimarySector {
  id: string;
  sector: string;
  group: string;
  definition: string;
  keywords?: string[];
}

export interface QueryTelemetry {
  exa_search: number;
  google_search: number;
  fallback_search: number;
  web_content_fetches: number;
  workers_ai_inferences: number;
  total_requests: number;
}

export interface SearchRun {
  id: string;
  query: string;
  location?: string;
  category?: string;
  parsed_query?: {
    category?: string;
    location?: string;
    status?: string;
    keywords?: string[];
  };
  status: 'queued' | 'processing' | 'completed' | 'partially_completed' | 'failed' | 'cancelled';
  results_count: number;
  total_duration_seconds?: number;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  api_telemetry?: QueryTelemetry;
}

export interface Project {
  id: string;
  canonical_name: string;
  company?: string;
  developer?: string;
  project_url: string;
  status: string;
  category: string;
  country?: string;
  location?: string;
  date?: string;
  http_status?: number;
  summary?: string;
  created_at: string;
}

export interface SearchResultItem {
  project_id: string;
  canonical_name: string;
  company?: string;
  developer?: string;
  project_url: string;
  category: string;
  status: string;
  country?: string;
  location?: string;
  date?: string;
  http_status?: number;
  summary?: string;
  relevance_score?: number;
}

export interface ActivityEvent {
  id?: string;
  event_id?: string;
  search_run_id: string;
  event_type: string;
  component: string;
  message: string;
  metadata: Record<string, any>;
  timestamp: string;
}

export interface ProviderUsageStat {
  provider: string;
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  success_rate: number;
  avg_latency_ms: number;
  min_latency_ms?: number;
  max_latency_ms?: number;
  total_units_consumed: number;
  endpoint?: string;
  requests_sent?: number;
  success_count?: number;
  failed_count?: number;
  units_consumed?: number;
  status_note?: string;
}

export interface UsageAnalytics {
  total_searches?: number;
  total_projects?: number;
  total_requests?: number;
  total_units?: number;
  providers: ProviderUsageStat[];
  recent_activity_count?: number;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded';
  uptime_seconds?: number;
  database?: string;
  database_status?: string;
  edge_worker?: string;
  workers_ai_model?: string;
  total_projects?: number;
  total_searches?: number;
  active_search_jobs: number;
  unprocessed_outbox_events?: number;
  recent_errors_count?: number;
  redis?: {
    status: string;
    provider: string;
    live_connected: boolean;
  };
}

export interface SSEMessage {
  id?: string;
  event: string;
  data: any;
}
