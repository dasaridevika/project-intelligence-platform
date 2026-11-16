import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Compass,
  Database,
  DollarSign,
  ExternalLink,
  Globe,
  Layers,
  Loader2,
  MapPin,
  ShieldCheck,
  Sparkles,
  Zap
} from 'lucide-react';
import { api } from '../services/api';
import { Project, PrimarySector } from '../types';
import { SectorBadge } from '../components/SectorBadge';
import primarySectorsData from '../data/primary_sectors.json';

export const ProjectDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cloudflare Workers AI edge URL inspection state
  const [aiExtractingUrl, setAiExtractingUrl] = useState<string | null>(null);
  const [aiResults, setAiResults] = useState<Record<string, any>>({});
  const [aiError, setAiError] = useState<Record<string, string>>({});

  const handleAiExtract = async (url: string) => {
    try {
      setAiExtractingUrl(url);
      setAiError((prev) => ({ ...prev, [url]: '' }));
      const res = await api.aiExtractUrl(url, project?.category);
      setAiResults((prev) => ({ ...prev, [url]: res }));
    } catch (err: any) {
      setAiError((prev) => ({
        ...prev,
        [url]: err?.response?.data?.details || err?.message || 'Failed to fetch or extract from URL.',
      }));
    } finally {
      setAiExtractingUrl(null);
    }
  };

  useEffect(() => {
    async function loadProject() {
      if (!id) return;
      try {
        const data = await api.getProject(id);
        setProject(data);
      } catch (err: any) {
        setError(err?.response?.data?.detail || 'Project not found');
      } finally {
        setLoading(false);
      }
    }
    loadProject();
  }, [id]);

  if (loading) {
    return (
      <div className="py-24 text-center text-slate-400 space-y-2">
        <div className="w-8 h-8 rounded-full border-2 border-sky-500 border-t-transparent animate-spin mx-auto" />
        <p className="text-sm">Loading project specifications...</p>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="max-w-3xl mx-auto py-16 text-center space-y-4">
        <h2 className="text-xl font-bold text-white">Project Not Found</h2>
        <p className="text-sm text-slate-400">{error || 'Unable to retrieve project details.'}</p>
        <button
          onClick={() => navigate('/projects')}
          className="px-4 py-2 rounded-lg bg-sky-600 text-white text-xs font-medium"
        >
          Return to Projects Repository
        </button>
      </div>
    );
  }

  const matchedSector = (primarySectorsData as PrimarySector[]).find(
    (s) => s.sector.toLowerCase() === project.category.toLowerCase() || s.id === project.category.toLowerCase()
  );
  const sectorDefinition = project.metadata?.primary_sector_definition || matchedSector?.definition;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Back button */}
      <div>
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back</span>
        </button>
      </div>

      {/* Main Header Card */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="space-y-2 max-w-3xl">
            <div className="flex items-center gap-2">
              <SectorBadge sectorName={project.category} />
              <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700">
                {project.status}
              </span>
              <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                Verified Provenance
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              {project.canonical_name}
            </h1>
            <p className="text-xs text-slate-400 font-mono">
              Normalized Identifier: {project.normalized_name}
            </p>
          </div>

          <div className="text-right sm:border-l sm:border-slate-800 sm:pl-6 shrink-0">
            <span className="text-[11px] uppercase font-bold tracking-wider text-slate-400 block">
              Discovered On
            </span>
            <span className="text-sm font-semibold text-slate-200 font-mono">
              {new Date(project.created_at).toLocaleDateString()}
            </span>
          </div>
        </div>

        {/* Specifications Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 pt-6 border-t border-slate-800 text-xs">
          <div>
            <span className="text-slate-400 block mb-1">Developer / Sponsor</span>
            <span className="text-sm font-semibold text-slate-100">{project.developer || '—'}</span>
          </div>
          <div>
            <span className="text-slate-400 block mb-1">Location</span>
            <span className="text-sm font-semibold text-slate-100">
              {[project.location_city, project.location_state, project.location_country].filter(Boolean).join(', ') || 'Global'}
            </span>
          </div>
          <div>
            <span className="text-slate-400 block mb-1">Capacity</span>
            <span className="text-sm font-semibold text-slate-100">
              {project.capacity_value ? `${project.capacity_value} ${project.capacity_unit}` : '—'}
            </span>
          </div>
          <div>
            <span className="text-slate-400 block mb-1">Estimated Investment</span>
            <span className="text-sm font-semibold text-slate-100">
              {project.investment_value
                ? `${project.investment_currency || '$'}${project.investment_value.toLocaleString()}`
                : '—'}
            </span>
          </div>
        </div>

        {/* Official Sector Definition Card */}
        {sectorDefinition && (
          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-xs space-y-1.5">
            <div className="flex items-center gap-2 text-sky-400 font-semibold text-xs">
              <BookOpen className="w-4 h-4" />
              <span>Official Primary Sector Definition: {matchedSector?.sector || project.category}</span>
            </div>
            <p className="text-slate-300 leading-relaxed italic">
              "{sectorDefinition}"
            </p>
          </div>
        )}
      </div>

      {/* Description & Overview */}
      {project.description && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 space-y-3">
          <h2 className="text-base font-semibold text-white">Project Description & Scope</h2>
          <p className="text-sm text-slate-300 leading-relaxed">{project.description}</p>
        </div>
      )}

      {/* Provenance & Sources Section */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-base font-semibold text-white">Source Provenance & Evidentiary Records</h2>
            <p className="text-xs text-slate-400">
              Original URLs, external providers, publication dates, and raw snippets backing this canonical project
            </p>
          </div>
          <span className="text-xs px-2.5 py-1 rounded bg-slate-800 text-slate-300 font-medium">
            {project.sources?.length || 0} Sources
          </span>
        </div>

        <div className="space-y-4">
          {project.sources && project.sources.length > 0 ? (
            project.sources.map((src, idx) => (
              <div
                key={src.id || idx}
                className="rounded-lg bg-slate-950/70 border border-slate-800/80 p-4 space-y-2 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded font-mono font-bold text-[10px] uppercase bg-sky-500/10 text-sky-400 border border-sky-500/20">
                    Provider: {src.provider}
                  </span>
                  <span className="text-slate-400 font-mono">
                    Discovered: {new Date(src.discovery_timestamp).toLocaleString()}
                  </span>
                </div>

                <a
                  href={src.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-slate-200 hover:text-sky-400 inline-flex items-center gap-1.5 transition-colors"
                >
                  <span>{src.source_title || src.source_url}</span>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                </a>

                {src.raw_snippet && (
                  <p className="text-slate-400 text-xs italic bg-slate-900/40 p-2.5 rounded border border-slate-800/40">
                    "{src.raw_snippet}"
                  </p>
                )}

                {/* AI Worker Webpage Extraction */}
                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => handleAiExtract(src.source_url)}
                    disabled={aiExtractingUrl === src.source_url}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-300 text-xs font-medium transition-colors"
                  >
                    {aiExtractingUrl === src.source_url ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
                        <span>Fetching Live Webpage & Running Workers AI...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                        <span>AI Deep Inspect (Fetch URL & Extract)</span>
                      </>
                    )}
                  </button>

                  {aiResults[src.source_url] && (
                    <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Extracted via {aiResults[src.source_url].engine}
                    </span>
                  )}
                </div>

                {aiError[src.source_url] && (
                  <p className="text-rose-400 text-xs bg-rose-500/10 p-2 rounded border border-rose-500/20">
                    {aiError[src.source_url]}
                  </p>
                )}

                {aiResults[src.source_url] && (
                  <div className="mt-3 p-3.5 rounded-xl bg-sky-950/40 border border-sky-500/30 space-y-2.5 text-xs animate-in fade-in">
                    <div className="flex items-center justify-between border-b border-sky-500/20 pb-2">
                      <span className="font-semibold text-sky-300 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                        Workers AI Output ({aiResults[src.source_url].engine})
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        Page Content: {aiResults[src.source_url].content_length} chars
                      </span>
                    </div>

                    {aiResults[src.source_url].project?.summary && (
                      <p className="text-slate-200 text-xs leading-relaxed italic bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                        "{aiResults[src.source_url].project.summary}"
                      </p>
                    )}

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px] pt-1">
                      <div className="bg-slate-900/40 p-2 rounded border border-slate-800/60">
                        <span className="text-slate-400 block mb-0.5">Project Name</span>
                        <span className="text-slate-100 font-semibold">{aiResults[src.source_url].project?.canonical_name || '—'}</span>
                      </div>
                      <div className="bg-slate-900/40 p-2 rounded border border-slate-800/60">
                        <span className="text-slate-400 block mb-0.5">Developer</span>
                        <span className="text-slate-100 font-semibold">{aiResults[src.source_url].project?.developer || '—'}</span>
                      </div>
                      <div className="bg-slate-900/40 p-2 rounded border border-slate-800/60">
                        <span className="text-slate-400 block mb-0.5">Investment</span>
                        <span className="text-slate-100 font-semibold">
                          {aiResults[src.source_url].project?.investment_value
                            ? `${aiResults[src.source_url].project?.investment_currency || '$'}${Number(aiResults[src.source_url].project.investment_value).toLocaleString()}`
                            : '—'}
                        </span>
                      </div>
                      <div className="bg-slate-900/40 p-2 rounded border border-slate-800/60">
                        <span className="text-slate-400 block mb-0.5">Capacity</span>
                        <span className="text-slate-100 font-semibold">
                          {aiResults[src.source_url].project?.capacity_value
                            ? `${aiResults[src.source_url].project.capacity_value} ${aiResults[src.source_url].project?.capacity_unit || ''}`
                            : '—'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))
          ) : (
            <p className="text-xs text-slate-500 py-4 text-center">No source records linked.</p>
          )}
        </div>
      </div>
    </div>
  );
};
