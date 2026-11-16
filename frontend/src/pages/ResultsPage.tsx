import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle2,
  Compass,
  DollarSign,
  ExternalLink,
  Filter,
  Globe,
  Layers,
  MapPin,
  Search,
  SlidersHorizontal,
  Sparkles,
  Zap
} from 'lucide-react';
import { api } from '../services/api';
import { SearchResultItem, SearchRun } from '../types';
import { SectorBadge } from '../components/SectorBadge';

export const ResultsPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const searchId = searchParams.get('search_id');

  const [searchRun, setSearchRun] = useState<SearchRun | null>(null);
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [minScore, setMinScore] = useState<number>(0);

  useEffect(() => {
    async function loadResults() {
      setLoading(true);
      try {
        if (!searchId) {
          // Load latest search
          const searches = await api.listSearches(undefined, 1);
          if (searches.length > 0) {
            navigate(`/results?search_id=${searches[0].id}`, { replace: true });
            return;
          } else {
            setLoading(false);
            return;
          }
        }

        const [run, resultsData] = await Promise.all([
          api.getSearchRun(searchId),
          api.getSearchResults(searchId),
        ]);
        setSearchRun(run);
        setResults(resultsData.results);
      } catch (err) {
        console.error('Failed to load results:', err);
      } finally {
        setLoading(false);
      }
    }
    loadResults();
  }, [searchId, navigate]);

  const filteredResults = results.filter((r) => {
    if (categoryFilter && !r.category.toLowerCase().includes(categoryFilter.toLowerCase())) return false;
    if (statusFilter && !r.status.toLowerCase().includes(statusFilter.toLowerCase())) return false;
    if (r.relevance_score < minScore) return false;
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Top Navigation & Query Summary */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <button
            onClick={() => navigate('/search')}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 mb-2 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Discovery Query</span>
          </button>
          <h1 className="text-2xl font-bold text-white tracking-tight sm:text-3xl">
            {searchRun ? `"${searchRun.query}"` : 'Discovery Results'}
          </h1>
          {searchRun && (
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 mt-2 font-mono">
              <span>Run ID: {searchRun.id.slice(0, 8)}...</span>
              <span>• Status: {searchRun.status}</span>
              {searchRun.total_duration_seconds && <span>• Duration: {searchRun.total_duration_seconds}s</span>}
              <span>• Total Yield: {results.length} projects</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => window.open(api.getExportCsvUrl(), '_blank')}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 transition-colors"
          >
            Export All CSV
          </button>
        </div>
      </div>

      {/* Filter Ribbon */}
      <div className="flex flex-wrap items-center gap-4 p-4 rounded-xl bg-slate-900 border border-slate-800">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
          <Filter className="w-3.5 h-3.5 text-sky-400" />
          <span>Filter Results:</span>
        </div>

        <input
          type="text"
          placeholder="Filter by category..."
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-500"
        />

        <input
          type="text"
          placeholder="Filter by status..."
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-500"
        />

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>Min Score:</span>
          <select
            value={minScore}
            onChange={(e) => setMinScore(parseFloat(e.target.value))}
            className="px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-200"
          >
            <option value={0}>Any Score</option>
            <option value={0.5}>&gt; 50%</option>
            <option value={0.75}>&gt; 75%</option>
            <option value={0.85}>&gt; 85%</option>
          </select>
        </div>

        <span className="text-xs text-slate-500 ml-auto font-mono">
          Showing {filteredResults.length} of {results.length}
        </span>
      </div>

      {/* Results List */}
      {loading ? (
        <div className="py-20 text-center text-slate-400 space-y-2">
          <div className="w-8 h-8 rounded-full border-2 border-sky-500 border-t-transparent animate-spin mx-auto" />
          <p className="text-sm">Loading discovery results...</p>
        </div>
      ) : filteredResults.length === 0 ? (
        <div className="py-20 text-center text-slate-400 space-y-3 rounded-xl border border-dashed border-slate-800">
          <Search className="w-10 h-10 mx-auto opacity-30" />
          <p className="text-base font-medium text-slate-300">No projects match the current query or filters.</p>
          <button
            onClick={() => navigate('/search')}
            className="text-xs text-sky-400 hover:underline"
          >
            Try a different search query &rarr;
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredResults.map((item) => (
            <div
              key={item.project_id}
              className="rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 p-6 transition-all shadow-md space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <SectorBadge sectorName={item.category} />
                    <span className="px-2.5 py-0.5 rounded-md text-[11px] font-semibold uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700">
                      {item.status}
                    </span>
                  </div>
                  <h3
                    onClick={() => navigate(`/projects/${item.project_id}`)}
                    className="text-lg font-semibold text-white hover:text-sky-400 cursor-pointer transition-colors"
                  >
                    {item.canonical_name}
                  </h3>
                </div>

                {/* Score Pill */}
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">
                      Relevance Score
                    </span>
                    <span className="text-xl font-bold text-sky-400 font-mono">
                      {(item.relevance_score * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Attributes Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2 border-t border-slate-800/80 text-xs">
                <div>
                  <span className="text-slate-400 block text-[11px]">Developer / Sponsor</span>
                  <span className="font-medium text-slate-200">{item.developer || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Location / Geography</span>
                  <span className="font-medium text-slate-200">
                    {[item.location_city, item.location_state, item.location_country].filter(Boolean).join(', ') || 'Global'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Project Capacity</span>
                  <span className="font-medium text-slate-200">
                    {item.capacity_value ? `${item.capacity_value} ${item.capacity_unit}` : '—'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Estimated Investment</span>
                  <span className="font-medium text-slate-200">
                    {item.investment_value
                      ? `${item.investment_currency || '$'}${item.investment_value.toLocaleString()}`
                      : '—'}
                  </span>
                </div>
              </div>

              {/* Ranking Factors Breakdown */}
              {item.ranking_factors && (
                <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 flex flex-wrap items-center gap-4 text-xs text-slate-400 font-mono">
                  <span className="text-slate-300 font-sans font-medium text-[11px]">Ranking Factors:</span>
                  <span>Keyword: {item.ranking_factors.query_keyword_match ?? '—'}</span>
                  <span>Location: {item.ranking_factors.location_match ?? '—'}</span>
                  <span>Category: {item.ranking_factors.category_match ?? '—'}</span>
                  <span>Completeness: {item.ranking_factors.information_completeness ?? '—'}</span>
                  <span>Sources: {item.ranking_factors.source_count ?? item.sources?.length ?? 1}</span>
                </div>
              )}

              {/* Source Provenance Links */}
              {item.sources && item.sources.length > 0 && (
                <div className="pt-2 border-t border-slate-800/60 flex flex-wrap items-center gap-3">
                  <span className="text-xs text-slate-400">Verified Sources:</span>
                  {item.sources.map((s, idx) => (
                    <a
                      key={s.id || idx}
                      href={s.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 hover:text-white border border-slate-700/80 transition-colors"
                    >
                      <span className="uppercase text-[10px] font-bold text-sky-400">{s.provider}</span>
                      <span className="max-w-xs truncate">{s.source_title || s.source_url}</span>
                      <ExternalLink className="w-3 h-3 text-slate-400 shrink-0" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
