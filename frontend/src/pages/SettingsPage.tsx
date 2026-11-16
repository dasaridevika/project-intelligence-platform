import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Database,
  Globe,
  Key,
  Layers,
  Lock,
  Server,
  Settings,
  XCircle
} from 'lucide-react';
import { api } from '../services/api';

export const SettingsPage: React.FC = () => {
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSettings() {
      try {
        const data = await api.getProviders();
        setProviders(data.providers);
      } catch (err) {
        console.error('Failed to load provider configurations:', err);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="border-b border-slate-800 pb-6">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-400 mb-1">
          <Settings className="w-4 h-4" />
          <span>System & Provider Configuration</span>
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight sm:text-3xl">
          Platform Settings
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Review external provider configuration statuses and security boundaries.
        </p>
      </div>

      {/* Provider Status Card */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 space-y-6">
        <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
          <div className="w-10 h-10 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <Key className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">Search Provider Configuration Status</h2>
            <p className="text-xs text-slate-400">
              Secrets are stored strictly in backend container environment variables and never exposed to the browser.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {providers.map((p) => (
            <div
              key={p.name}
              className="rounded-lg bg-slate-950/60 border border-slate-800/80 p-4 flex items-center justify-between"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{p.label}</span>
                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                    ID: {p.name}
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-mono">
                  Endpoint: {p.base_url} (Timeout: {p.timeout_seconds}s)
                </p>
              </div>

              <div>
                {p.configured ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Configured & Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    <XCircle className="w-3.5 h-3.5" />
                    Key Not Provided (.env)
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Deployment & Architecture Specs */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 space-y-4">
        <h2 className="text-base font-semibold text-white">Architecture & Security Policies</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-400">
          <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
            <span className="text-slate-200 font-semibold block mb-1">Queue & At-Least-Once Delivery</span>
            <p>Cloudflare Queues + Python Pull Consumer with deduplication via processed_messages.</p>
          </div>
          <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
            <span className="text-slate-200 font-semibold block mb-1">Transactional Outbox</span>
            <p>Search run creation and outbox publishing are committed atomically in PostgreSQL.</p>
          </div>
          <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
            <span className="text-slate-200 font-semibold block mb-1">Live Telemetry & SSE</span>
            <p>Server-Sent Events with last-event-id replay and keepalive streams.</p>
          </div>
          <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
            <span className="text-slate-200 font-semibold block mb-1">Global Scope</span>
            <p>International capital projects across North America, Europe, Asia-Pacific & Middle East.</p>
          </div>
        </div>
      </div>
    </div>
  );
};
