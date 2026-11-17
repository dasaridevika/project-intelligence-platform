export interface PrimarySector {
  id: string;
  sector: string;
  group: string;
  definition: string;
  keywords?: string[];
}

export interface SearchRun {
  id: string;
  query: string;
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
}

export interface ProjectSource {
  id: string;
  provider: string;
  source_url: string;
  source_title?: string;
  publication_date?: string;
  discovery_timestamp: string;
  raw_snippet?: string;
}

export interface Project {
  id: string;
  canonical_name: string;
  normalized_name?: string;
  category: string;
  status: string;
  developer?: string;
  location_city?: string;
  location_state?: string;
  location_country?: string;
  investment_value?: number;
  investment_currency?: string;
  capacity_value?: number;
  capacity_unit?: string;
  announced_date?: string;
  estimated_completion_date?: string;
  description?: string;
  metadata?: Record<string, any>;
  sources_count?: number;
  sources?: ProjectSource[];
  created_at: string;
}

export interface SearchResultItem {
  project_id: string;
  canonical_name: string;
  category: string;
  status: string;
  developer?: string;
  location_city?: string;
  location_state?: string;
  location_country?: string;
  investment_value?: number;
  investment_currency?: string;
  capacity_value?: number;
  capacity_unit?: string;
  relevance_score: number;
  ranking_factors: Record<string, any>;
  sources: ProjectSource[];
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
