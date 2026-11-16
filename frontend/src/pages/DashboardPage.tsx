import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock,
  Compass,
  Cpu,
  Database,
  ExternalLink,
  Flame,
  Globe,
  Layers,
  Search,
  Server,
  Sparkles,
  Zap
} from 'lucide-react';
import { api } from '../services/api';
import { SearchRun, UsageAnalytics, SystemHealth } from '../types';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [analytics, setAnalytics] = useState<UsageAnalytics | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [recentSearches, setRecentSearches] = useState<SearchRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [usageData, healthData, searches] = await Promise.all([
          api.getUsageAnalytics(),
          api.getSystemHealth(),
          api.listSearches(undefined, 5),
        ]);
        setAnalytics(usageData);
        setHealth(healthData);
        setRecentSearches(searches);
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const GLOBAL_QUERY_SUGGESTIONS = [
    { title: 'Hyperscale Data Centers in Northern Virginia', category: 'Data Center', location: 'Northern Virginia' },
    { title: 'TSMC & Intel Semiconductor Fabs in Europe and USA', category: 'Semiconductor', location: 'United States' },
    { title: 'Solar Power Mega Projects in Saudi Arabia and India', category: 'Solar Power', location: 'Saudi Arabia' },
    { title: 'Offshore Wind Farm Projects in UK & North Sea', category: 'Renewable Energy', location: 'United Kingdom' },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Hero Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-slate-800 p-8 shadow-2xl">
        <div className="relative z-10 max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/10 border border-sky-500/20 text-xs font-medium text-sky-400 mb-4">
            <Globe className="w-3.5 h-3.5" />
            <span>AI-Powered Global Project Discovery Engine</span>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight sm:text-4xl mb-3">
            Global Project Intelligence Platform
          </h1>
          <p className="text-slate-300 text-sm sm:text-base leading-relaxed mb-6">
            Discover capital projects worldwide across Data Centers, Semiconductors, Solar, Renewable Energy, and Infrastructure. Aggregates Exa and configurable web providers with automated extraction and deduplication.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => navigate('/search')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium text-sm transition-all shadow-lg shadow-sky-600/30"
            >
              <Search className="w-4 h-4" />
              <span>Launch Discovery Search</span>
            </button>
            <button
              onClick={() => navigate('/projects')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm border border-slate-700 transition-all"
            >
              <Database className="w-4 h-4" />
              <span>Browse Repository</span>
            </button>
          </div>
        </div>

        {/* Global Suggestions Pills */}
        <div className="mt-8 pt-6 border-t border-slate-800/80">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-3">
            Popular Global Discovery Queries
          </p>
          <div className="flex flex-wrap gap-2">
            {GLOBAL_QUERY_SUGGESTIONS.map((s, idx) => (
              <button
                key={idx}
                onClick={() => navigate(`/search?q=${encodeURIComponent(s.title)}`)}
                className="text-xs px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 border border-slate-700/60 text-slate-300 flex items-center gap-1.5 transition-colors"
              >
                <span>{s.title}</span>
                <ArrowRight className="w-3 h-3 text-sky-400" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-5">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">
            <span>Discovered Projects</span>
            <Database className="w-4 h-4 text-sky-400" />
          </div>
          <p className="text-3xl font-bold text-white tracking-tight">
            {loading ? '...' : (analytics?.total_projects ?? 0)}
          </p>
          <p className="text-xs text-slate-300 mt-2">Verified in managed PostgreSQL</p>
        </div>

        <div className="rounded-xl bg-slate-900 border border-slate-800 p-5">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">
            <span>Discovery Searches</span>
            <Search className="w-4 h-4 text-indigo-400" />
          </div>
          <p className="text-3xl font-bold text-white tracking-tight">
            {loading ? '...' : (analytics?.total_searches ?? 0)}
          </p>
          <p className="text-xs text-slate-300 mt-2">Executed through Outbox Queue</p>
        </div>

        <div className="rounded-xl bg-slate-900 border border-slate-800 p-5">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">
            <span>Search Providers</span>
            <Layers className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-3xl font-bold text-white tracking-tight">
            {loading ? '...' : (analytics?.providers?.length ?? 2)}
          </p>
          <p className="text-xs text-slate-300 mt-2">Exa + Secondary Web Adapter</p>
        </div>

        <div className="rounded-xl bg-slate-900 border border-slate-800 p-5">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">
            <span>Cluster Status</span>
            <Activity className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
            <span className="text-xl font-bold text-white capitalize">{health?.status || 'Healthy'}</span>
          </div>
          <p className="text-xs text-slate-300 mt-2">DB & Redis Connected</p>
        </div>
      </div>

      {/* Two Column Section: Recent Searches & Providers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Searches (2 cols) */}
        <div className="lg:col-span-2 rounded-xl bg-slate-900 border border-slate-800 p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Recent Discovery Executions</h2>
              <p className="text-xs text-slate-400">Live search runs, statuses, and result yields</p>
            </div>
            <button
              onClick={() => navigate('/history')}
              className="text-xs text-sky-400 hover:text-sky-300 font-medium flex items-center gap-1"
            >
              <span>View All History</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {recentSearches.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Search className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No discovery searches yet.</p>
              <button
                onClick={() => navigate('/search')}
                className="mt-3 text-xs text-sky-400 hover:underline"
              >
                Run your first global project search &rarr;
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/80">
              {recentSearches.map((run) => (
                <div
                  key={run.id}
                  onClick={() => navigate(`/results?search_id=${run.id}`)}
                  className="py-3.5 flex items-center justify-between hover:bg-slate-800/40 px-3 rounded-lg cursor-pointer transition-colors"
                >
                  <div className="space-y-1 max-w-lg">
                    <p className="text-sm font-medium text-slate-200 line-clamp-1">{run.query}</p>
                    <div className="flex items-center gap-3 text-xs text-slate-300">
                      <span>{new Date(run.created_at).toLocaleTimeString()}</span>
                      {run.total_duration_seconds && (
                        <span>• {run.total_duration_seconds}s</span>
                      )}
                      {run.parsed_query?.category && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-medium">
                          {run.parsed_query.category}
                        </span>
                      )}
                      {run.parsed_query?.location && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-sky-400">
                          {run.parsed_query.location}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-slate-300">
                      {run.results_count} results
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider ${
                        run.status === 'completed'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : run.status === 'partially_completed'
                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          : run.status === 'processing'
                          ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20 animate-pulse'
                          : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      }`}
                    >
                      {run.status.replace('_', ' ')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Provider Performance (1 col) */}
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 space-y-4">
          <div className="border-b border-slate-800 pb-4">
            <h2 className="text-lg font-semibold text-white">Provider Performance</h2>
            <p className="text-xs text-slate-400">Real-time latency and reliability metrics</p>
          </div>

          <div className="space-y-4">
            {analytics?.providers && analytics.providers.length > 0 ? (
              analytics.providers.map((p) => (
                <div key={p.provider} className="rounded-lg bg-slate-950/60 border border-slate-800/80 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-white uppercase tracking-wider">{p.provider}</span>
                    <span className="text-xs font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                      {p.success_rate}% success
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                    <div>
                      <span className="text-slate-300 block">Avg Latency</span>
                      <span className="text-slate-200 font-medium">{p.avg_latency_ms} ms</span>
                    </div>
                    <div>
                      <span className="text-slate-300 block">Requests</span>
                      <span className="text-slate-200 font-medium">{p.total_requests}</span>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-xs text-slate-300">
                Provider usage will appear after your first search run.
              </div>
            )}
          </div>

          <div className="pt-2">
            <button
              onClick={() => navigate('/analytics')}
              className="w-full py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 border border-slate-700/60 transition-colors"
            >
              Open Full Analytics &rarr;
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
