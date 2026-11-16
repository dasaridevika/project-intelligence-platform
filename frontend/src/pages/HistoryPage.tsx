import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Clock,
  ExternalLink,
  History,
  Layers,
  RotateCw,
  Search,
  Zap
} from 'lucide-react';
import { api } from '../services/api';
import { SearchRun } from '../types';

export const HistoryPage: React.FC = () => {
  const navigate = useNavigate();
  const [searches, setSearches] = useState<SearchRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');

  const loadHistory = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listSearches(statusFilter || undefined, 50);
      setSearches(data);
    } catch (err: any) {
      console.error('Failed to load search history:', err);
      setError('Unable to retrieve search history. The service may be warming up.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [statusFilter]);

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-400 mb-1">
            <History className="w-4 h-4" />
            <span>Audit Trail & Runs</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight sm:text-3xl">
            Search History
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Browse all previous discovery searches, review yield metrics, or reopen previous results.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-500"
          >
            <option value="">All Statuses</option>
            <option value="completed">Completed</option>
            <option value="partially_completed">Partially Completed</option>
            <option value="processing">Processing</option>
            <option value="failed">Failed</option>
          </select>

          <button
            onClick={loadHistory}
            className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 transition-colors"
          >
            <RotateCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* History Table */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden shadow-xl">
        {loading ? (
          <div className="py-20 text-center text-slate-400 space-y-2">
            <div className="w-8 h-8 rounded-full border-2 border-sky-500 border-t-transparent animate-spin mx-auto" />
            <p className="text-sm">Loading search history...</p>
          </div>
        ) : error ? (
          <div className="py-16 text-center text-slate-400 space-y-3">
            <p className="text-sm text-rose-400 font-medium">{error}</p>
            <button
              onClick={loadHistory}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition-colors"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        ) : searches.length === 0 ? (
          <div className="py-20 text-center text-slate-400 space-y-2">
            <Search className="w-8 h-8 mx-auto opacity-40" />
            <p className="text-sm">No searches recorded yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                <tr>
                  <th className="py-3.5 px-6">Discovery Query</th>
                  <th className="py-3.5 px-4">Category</th>
                  <th className="py-3.5 px-4">Location</th>
                  <th className="py-3.5 px-4">Execution Status</th>
                  <th className="py-3.5 px-4">Discovered Projects</th>
                  <th className="py-3.5 px-4">Duration</th>
                  <th className="py-3.5 px-4">Timestamp</th>
                  <th className="py-3.5 px-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {searches.map((run) => (
                  <tr
                    key={run.id}
                    className="hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-3.5 px-6 font-medium text-slate-200 max-w-sm truncate">
                      {run.query}
                    </td>
                    <td className="py-3.5 px-4 text-slate-300">
                      {run.parsed_query?.category || '—'}
                    </td>
                    <td className="py-3.5 px-4 text-slate-300">
                      {run.parsed_query?.location || 'Global'}
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
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
                    </td>
                    <td className="py-3.5 px-4 font-mono font-semibold text-slate-200">
                      {run.results_count}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-400">
                      {run.total_duration_seconds ? `${run.total_duration_seconds}s` : '—'}
                    </td>
                    <td className="py-3.5 px-4 text-slate-400 font-mono">
                      {new Date(run.created_at).toLocaleString()}
                    </td>
                    <td className="py-3.5 px-6 text-right">
                      <button
                        onClick={() => navigate(`/results?search_id=${run.id}`)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-sky-600 hover:text-white text-slate-300 text-xs font-medium border border-slate-700/80 transition-colors"
                      >
                        <span>Open</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
