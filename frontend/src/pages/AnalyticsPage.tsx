import React, { useEffect, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell
} from 'recharts';
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Clock,
  DollarSign,
  Layers,
  Server,
  Zap
} from 'lucide-react';
import { api } from '../services/api';
import { UsageAnalytics } from '../types';

export const AnalyticsPage: React.FC = () => {
  const [analytics, setAnalytics] = useState<UsageAnalytics | null>(null);
  const [performance, setPerformance] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [usageData, perfData] = await Promise.all([
          api.getUsageAnalytics(),
          api.getSearchPerformance(),
        ]);
        setAnalytics(usageData);
        setPerformance(perfData);
      } catch (err) {
        console.error('Failed to load analytics:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const chartData = (analytics?.providers || []).map((p) => ({
    name: p.provider.toUpperCase(),
    latency: p.avg_latency_ms,
    requests: p.total_requests,
    successRate: p.success_rate,
  }));

  const COLORS = ['#0284c7', '#6366f1', '#10b981', '#f59e0b'];

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="border-b border-slate-800 pb-6">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-400 mb-1">
          <BarChart3 className="w-4 h-4" />
          <span>API & Provider Telemetry</span>
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight sm:text-3xl">
          API Usage & Latency Analytics
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Detailed metrics tracking provider calls, latencies, success rates, and search performance.
        </p>
      </div>

      {/* Top Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-5">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">
            Avg Search Duration
          </span>
          <p className="text-3xl font-bold text-white tracking-tight">
            {loading ? '...' : `${performance?.avg_search_duration_seconds || 0}s`}
          </p>
          <span className="text-xs text-slate-500 mt-2 block">P95: {performance?.p95_search_duration_seconds || 0}s</span>
        </div>

        <div className="rounded-xl bg-slate-900 border border-slate-800 p-5">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">
            Total Provider Calls
          </span>
          <p className="text-3xl font-bold text-white tracking-tight">
            {loading ? '...' : (analytics?.providers?.reduce((acc, p) => acc + p.total_requests, 0) || 0)}
          </p>
          <span className="text-xs text-slate-500 mt-2 block">Tracked across Exa & Secondary adapters</span>
        </div>

        <div className="rounded-xl bg-slate-900 border border-slate-800 p-5">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">
            Completed Searches
          </span>
          <p className="text-3xl font-bold text-emerald-400 tracking-tight">
            {loading ? '...' : (performance?.total_completed_searches || 0)}
          </p>
          <span className="text-xs text-slate-500 mt-2 block">
            Failed: {performance?.total_failed_searches || 0} • Partial: {performance?.total_partially_completed || 0}
          </span>
        </div>
      </div>

      {/* Latency Visualization Chart */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Average Provider Latency (ms)</h2>
          <p className="text-xs text-slate-400">Response time comparisons measured from the Python consumer</p>
        </div>

        <div className="h-64 w-full pt-4">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="name" stroke="#64748b" textAnchor="middle" />
                <YAxis stroke="#64748b" unit="ms" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                  itemStyle={{ color: '#38bdf8' }}
                />
                <Bar dataKey="latency" name="Avg Latency (ms)" radius={[6, 6, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-slate-500">
              No latency telemetry recorded yet.
            </div>
          )}
        </div>
      </div>

      {/* Detailed Provider Breakdown Table */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 space-y-4 shadow-xl">
        <div className="border-b border-slate-800 pb-4">
          <h2 className="text-lg font-semibold text-white">Provider Performance Breakdown</h2>
          <p className="text-xs text-slate-400">Granular audit metrics per integrated search provider</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Provider</th>
                <th className="py-3 px-4">Total Requests</th>
                <th className="py-3 px-4">Success</th>
                <th className="py-3 px-4">Failed</th>
                <th className="py-3 px-4">Success Rate</th>
                <th className="py-3 px-4">Avg Latency</th>
                <th className="py-3 px-4">Min Latency</th>
                <th className="py-3 px-4">Max Latency</th>
                <th className="py-3 px-4">Units</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {analytics?.providers && analytics.providers.length > 0 ? (
                analytics.providers.map((p) => (
                  <tr key={p.provider} className="hover:bg-slate-800/40">
                    <td className="py-3 px-4 font-semibold text-white uppercase tracking-wider">{p.provider}</td>
                    <td className="py-3 px-4 font-mono text-slate-200">{p.total_requests}</td>
                    <td className="py-3 px-4 font-mono text-emerald-400">{p.successful_requests}</td>
                    <td className="py-3 px-4 font-mono text-rose-400">{p.failed_requests}</td>
                    <td className="py-3 px-4 font-mono font-semibold text-sky-400">{p.success_rate}%</td>
                    <td className="py-3 px-4 font-mono text-slate-300">{p.avg_latency_ms} ms</td>
                    <td className="py-3 px-4 font-mono text-slate-400">{p.min_latency_ms} ms</td>
                    <td className="py-3 px-4 font-mono text-slate-400">{p.max_latency_ms} ms</td>
                    <td className="py-3 px-4 font-mono text-slate-300">{p.total_units_consumed}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-500">
                    No provider telemetry records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
