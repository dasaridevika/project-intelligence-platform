import React, { useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  Key,
  Layers,
  RefreshCw,
  Server,
  Settings,
  ShieldCheck,
  XCircle,
  Zap
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid
} from 'recharts';
import { api } from '../api';
import { ActivityEvent, SystemHealth, UsageAnalytics } from '../types';

export const SystemPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'health' | 'analytics' | 'events' | 'specs'>('health');

  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [analytics, setAnalytics] = useState<UsageAnalytics | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [errors, setErrors] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAllData = async () => {
    try {
      const [h, a, evs, errs, provs] = await Promise.all([
        api.getSystemHealth(),
        api.getUsageAnalytics(),
        api.getMonitoringEvents(50),
        api.getMonitoringErrors(20),
        api.getProviders(),
      ]);
      setHealth(h);
      setAnalytics(a);
      setEvents(evs);
      setErrors(errs);
      setProviders(provs.providers || []);
    } catch (err) {
      console.error('Failed to load system telemetry:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
    const timer = setInterval(loadAllData, 6000);
    return () => clearInterval(timer);
  }, []);

  const chartData = (analytics?.providers || []).map((p) => ({
    name: p.provider,
    latency: p.avg_latency_ms,
    requests: p.total_requests || p.requests_sent || 0,
    successRate: p.success_rate || 100,
  }));

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-400 mb-1">
            <Activity className="w-4 h-4" />
            <span>Infrastructure Telemetry & Edge Operations</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight sm:text-3xl">
            System & Operations Hub
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Real-time status of Cloudflare Workers AI ({health?.workers_ai_model || '@cf/meta/llama-3.2-3b-instruct'}), Edge Discovery Engine, Pre-LLM Cache, and API analytics.
          </p>
        </div>

        <button
          onClick={loadAllData}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-700 hover:bg-slate-800 text-xs text-slate-200 transition-colors self-start sm:self-auto"
        >
          <RefreshCw className="w-3.5 h-3.5 text-sky-400" />
          <span>Refresh Now</span>
        </button>
      </div>

      {/* Tabs Bar */}
      <div className="flex items-center gap-2 border-b border-slate-800/80 pb-1 text-xs">
        <button
          onClick={() => setActiveTab('health')}
          className={`px-3.5 py-2 rounded-lg font-medium transition-all ${
            activeTab === 'health'
              ? 'bg-sky-600/20 text-sky-300 border border-sky-500/30 font-semibold'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          Overview & Node Health
        </button>

        <button
          onClick={() => setActiveTab('analytics')}
          className={`px-3.5 py-2 rounded-lg font-medium transition-all ${
            activeTab === 'analytics'
              ? 'bg-sky-600/20 text-sky-300 border border-sky-500/30 font-semibold'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          API Analytics & Latencies
        </button>

        <button
          onClick={() => setActiveTab('events')}
          className={`px-3.5 py-2 rounded-lg font-medium transition-all ${
            activeTab === 'events'
              ? 'bg-sky-600/20 text-sky-300 border border-sky-500/30 font-semibold'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          Live Audit Feed ({events.length})
        </button>

        <button
          onClick={() => setActiveTab('specs')}
          className={`px-3.5 py-2 rounded-lg font-medium transition-all ${
            activeTab === 'specs'
              ? 'bg-sky-600/20 text-sky-300 border border-sky-500/30 font-semibold'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          Architecture & Edge Specs
        </button>
      </div>

      {/* Tab 1: Node Health */}
      {activeTab === 'health' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl bg-slate-900 border border-slate-800 p-5 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold uppercase text-slate-400">
                <span>Workers AI Engine</span>
                <Cpu className="w-4 h-4 text-sky-400" />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="text-lg font-bold text-white">Llama 3.2 3B</span>
              </div>
              <p className="text-[11px] text-slate-400">Meta Llama 3.2 3B Instruct Edge Node</p>
            </div>

            <div className="rounded-xl bg-slate-900 border border-slate-800 p-5 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold uppercase text-slate-400">
                <span>Pre-LLM Cache & Dedup</span>
                <Server className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="text-lg font-bold text-white">Active</span>
              </div>
              <p className="text-[11px] text-slate-400">Zero duplicates, canonical URL filter</p>
            </div>

            <div className="rounded-xl bg-slate-900 border border-slate-800 p-5 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold uppercase text-slate-400">
                <span>Total Discovered Projects</span>
                <Database className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-white tracking-tight">
                  {health?.total_projects ?? 0}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Indexed in Edge Memory Store</p>
            </div>

            <div className="rounded-xl bg-slate-900 border border-slate-800 p-5 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold uppercase text-slate-400">
                <span>Discovery Searches</span>
                <Zap className="w-4 h-4 text-amber-400" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-white tracking-tight">
                  {health?.total_searches ?? 0}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Total discovery executions</p>
            </div>
          </div>

          {/* Provider Status List */}
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 space-y-4">
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-2">
              <Key className="w-4 h-4 text-indigo-400" />
              <span>Provider & Gateway Statuses</span>
            </h3>

            <div className="space-y-3">
              {providers.map((p, idx) => (
                <div
                  key={idx}
                  className="rounded-lg bg-slate-950/60 border border-slate-800/80 p-3.5 flex items-center justify-between"
                >
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-white block">{p.provider || p.name}</span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {p.endpoint || p.base_url || 'Edge-native Cloudflare binding'}
                    </span>
                  </div>

                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Operational</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Analytics & Latencies */}
      {activeTab === 'analytics' && (
        <div className="space-y-6">
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 space-y-4">
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider">
              Search Provider Latencies (ms)
            </h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                  <YAxis stroke="#94a3b8" fontSize={11} unit="ms" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '12px' }}
                  />
                  <Bar dataKey="latency" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 space-y-4">
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider">
              Request Throughput & Efficiency
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {chartData.map((d, i) => (
                <div key={i} className="p-4 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                  <span className="text-xs text-slate-400 font-medium">{d.name}</span>
                  <p className="text-xl font-bold text-white font-mono">{d.requests} calls</p>
                  <p className="text-[11px] text-emerald-400">Success rate: {d.successRate}%</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Events & Audit */}
      {activeTab === 'events' && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 space-y-4">
          <h3 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center justify-between">
            <span>Real-time Telemetry Audit Log</span>
            <span className="text-xs font-mono text-slate-400">Last 50 events</span>
          </h3>

          <div className="max-h-[500px] overflow-y-auto divide-y divide-slate-800/60 font-mono text-xs">
            {events.length === 0 ? (
              <p className="text-slate-500 py-8 text-center">No telemetry events logged yet.</p>
            ) : (
              events.map((ev, i) => (
                <div key={i} className="py-2.5 flex items-start justify-between gap-4">
                  <div className="space-y-0.5">
                    <span className="text-sky-400 font-semibold">[{ev.component || 'Edge'}]</span>{' '}
                    <span className="text-slate-200">{ev.message}</span>
                  </div>
                  <span className="text-[10px] text-slate-500 shrink-0">
                    {new Date(ev.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Tab 4: Architecture Specs */}
      {activeTab === 'specs' && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 space-y-4">
          <h3 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Architecture & Security Policies</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-400">
            <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
              <span className="text-slate-200 font-semibold block">100% Serverless Edge AI</span>
              <p>Meta Llama 3.2 3B Instruct (@cf/meta/llama-3.2-3b-instruct) executing directly at Cloudflare edge nodes with 0ms cold starts.</p>
            </div>
            <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
              <span className="text-slate-200 font-semibold block">Pre-LLM Deduplication & Cache</span>
              <p>Zero duplicate URLs and duplicate query caching prevent redundant LLM inferences and external search provider calls.</p>
            </div>
            <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
              <span className="text-slate-200 font-semibold block">URL Reputation & Security Filter</span>
              <p>Automatically blocks dictionaries, encyclopedias, social media, non-HTML assets (PDFs, images), and private IP spaces.</p>
            </div>
            <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
              <span className="text-slate-200 font-semibold block">462 Primary Industrial Sectors</span>
              <p>Canonical taxonomy definitions and synonyms mapped directly at the edge without external database latency.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
