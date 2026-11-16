import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  Layers,
  RefreshCw,
  Server,
  ShieldAlert,
  Zap
} from 'lucide-react';
import { api } from '../services/api';
import { ActivityEvent, SystemHealth } from '../types';

export const SystemMonitoringPage: React.FC = () => {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [errors, setErrors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const [h, evs, errs] = await Promise.all([
        api.getSystemHealth(),
        api.getMonitoringEvents(30),
        api.getMonitoringErrors(20),
      ]);
      setHealth(h);
      setEvents(evs);
      setErrors(errs);
    } catch (err) {
      console.error('Failed to load system monitoring data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000); // 5s polling for monitoring
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-400 mb-1">
            <Activity className="w-4 h-4" />
            <span>Infrastructure Health & Operations</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight sm:text-3xl">
            Live System Monitoring
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Real-time status of Cloudflare Queues, Python Pull Consumer, PostgreSQL Outbox, and error traces.
          </p>
        </div>

        <button
          onClick={loadData}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 text-xs text-slate-200 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Telemetry</span>
        </button>
      </div>

      {/* Cluster Node Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-5 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold uppercase text-slate-400">
            <span>PostgreSQL Database</span>
            <Database className="w-4 h-4 text-sky-400" />
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                health?.database === 'connected' ? 'bg-emerald-500' : 'bg-rose-500'
              }`}
            />
            <span className="text-lg font-bold text-white capitalize">
              {health?.database || 'Connected'}
            </span>
          </div>
          <p className="text-[11px] text-slate-500">Source of truth for all projects</p>
        </div>

        <div className="rounded-xl bg-slate-900 border border-slate-800 p-5 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold uppercase text-slate-400">
            <span>Cache & Coordination</span>
            <Server className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span className="text-lg font-bold text-white capitalize">
              {health?.redis?.status === 'ok' ? 'Operational' : 'Active'}
            </span>
          </div>
          <p className="text-[11px] text-slate-500">Provider: {health?.redis?.provider || 'Redis / Fallback'}</p>
        </div>

        <div className="rounded-xl bg-slate-900 border border-slate-800 p-5 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold uppercase text-slate-400">
            <span>Active Search Jobs</span>
            <Zap className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-3xl font-bold text-white tracking-tight">
              {health?.active_search_jobs ?? 0}
            </span>
          </div>
          <p className="text-[11px] text-slate-500">Jobs in queued or processing state</p>
        </div>

        <div className="rounded-xl bg-slate-900 border border-slate-800 p-5 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold uppercase text-slate-400">
            <span>Pending Outbox Queue</span>
            <Layers className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-3xl font-bold text-white tracking-tight">
              {health?.unprocessed_outbox_events ?? 0}
            </span>
          </div>
          <p className="text-[11px] text-slate-500">Unclaimed / In-flight events</p>
        </div>
      </div>

      {/* Two Column Layout: Activity Events & Error Diagnostics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Real-time Activity Timeline */}
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 space-y-4">
          <div className="border-b border-slate-800 pb-4">
            <h2 className="text-lg font-semibold text-white">System Activity Feed</h2>
            <p className="text-xs text-slate-400">Live operational events logged by workers and orchestrator</p>
          </div>

          <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
            {events.length === 0 ? (
              <p className="text-xs text-slate-500 py-8 text-center">No recent activity events logged.</p>
            ) : (
              events.map((ev) => (
                <div
                  key={ev.id}
                  className="rounded-lg bg-slate-950/60 border border-slate-800/80 p-3 space-y-1 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sky-400 uppercase tracking-wider text-[10px] bg-sky-500/10 px-1.5 py-0.5 rounded border border-sky-500/20">
                      {ev.event_type}
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-slate-200 font-medium">{ev.message}</p>
                  <p className="text-[11px] text-slate-500 font-mono">
                    Component: {ev.component} • Run: {ev.search_run_id?.slice(0, 8)}...
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Diagnostic Errors */}
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 space-y-4">
          <div className="border-b border-slate-800 pb-4">
            <h2 className="text-lg font-semibold text-white">Diagnostic & Error Log</h2>
            <p className="text-xs text-slate-400">Captured exceptions, provider timeouts, and dead-letter records</p>
          </div>

          <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
            {errors.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-xs">
                <CheckCircle2 className="w-8 h-8 text-emerald-400/50 mx-auto mb-2" />
                <span>Zero system errors reported. Cluster healthy.</span>
              </div>
            ) : (
              errors.map((err) => (
                <div
                  key={err.id}
                  className="rounded-lg bg-rose-500/5 border border-rose-500/20 p-3 space-y-1 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-rose-400 uppercase tracking-wider text-[10px] bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">
                      {err.error_code}
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      {new Date(err.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-rose-200 font-medium">{err.message}</p>
                  <p className="text-[11px] text-slate-500 font-mono">Component: {err.component}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
