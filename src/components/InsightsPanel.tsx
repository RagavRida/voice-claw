import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp,
  AlertTriangle,
  HelpCircle,
  Sparkles,
  Check,
  X,
  BarChart3,
  Globe,
  Zap,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';

interface AnalyticsOverview {
  total_sessions: number;
  total_turns: number;
  avg_quality_score: number;
  top_languages: { lang: string; count: number }[];
  tool_usage: { tool: string; count: number }[];
  knowledge_gaps_count: number;
  score_trend: { date: string; score: number | null }[];
}

interface Insight {
  id: string;
  type: 'knowledge_gap' | 'faq_pattern' | 'prompt_suggestion' | 'failure_pattern';
  content: Record<string, any>;
  frequency: number;
  last_seen: string | null;
  resolved: boolean;
}

interface InsightsPanelProps {
  agentId: string;
}

const LANG_NAMES: Record<string, string> = {
  'en-IN': 'English', 'hi-IN': 'Hindi', 'te-IN': 'Telugu', 'ta-IN': 'Tamil',
  'kn-IN': 'Kannada', 'ml-IN': 'Malayalam', 'bn-IN': 'Bengali', 'mr-IN': 'Marathi',
  'gu-IN': 'Gujarati', 'pa-IN': 'Punjabi', 'ur-IN': 'Urdu',
};

export function InsightsPanel({ agentId }: InsightsPanelProps) {
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'gaps' | 'suggestions'>('overview');
  const [tuning, setTuning] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [overviewRes, insightsRes] = await Promise.all([
        fetch(`http://localhost:8000/api/agent/${agentId}/analytics/overview`),
        fetch(`http://localhost:8000/api/agent/${agentId}/analytics/insights`),
      ]);
      if (overviewRes.ok) setOverview(await overviewRes.json());
      if (insightsRes.ok) {
        const data = await insightsRes.json();
        setInsights(data.insights || []);
      }
    } catch (e) {
      console.error('Failed to fetch analytics:', e);
    }
    setLoading(false);
  }, [agentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDismiss = async (insightId: string) => {
    await fetch(`http://localhost:8000/api/agent/${agentId}/analytics/insights/${insightId}/dismiss`, { method: 'POST' });
    setInsights(prev => prev.filter(i => i.id !== insightId));
  };

  const handleApply = async (insightId: string) => {
    await fetch(`http://localhost:8000/api/agent/${agentId}/analytics/insights/${insightId}/apply`, { method: 'POST' });
    setInsights(prev => prev.filter(i => i.id !== insightId));
  };

  const handleTuneNow = async () => {
    setTuning(true);
    try {
      await fetch(`http://localhost:8000/api/agent/${agentId}/analytics/tune`, { method: 'POST' });
      await fetchData();
    } catch (e) { console.error(e); }
    setTuning(false);
  };

  const knowledgeGaps = insights.filter(i => i.type === 'knowledge_gap');
  const faqPatterns = insights.filter(i => i.type === 'faq_pattern');
  const promptSuggestions = insights.filter(i => i.type === 'prompt_suggestion');

  const getScoreColor = (score: number) => {
    if (score >= 8) return 'text-emerald-500';
    if (score >= 5) return 'text-amber-500';
    return 'text-red-500';
  };

  const getScoreBg = (score: number) => {
    if (score >= 8) return 'bg-emerald-500';
    if (score >= 5) return 'bg-amber-500';
    return 'bg-red-500';
  };

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 flex items-center justify-center min-h-[300px]">
        <RefreshCw className="w-5 h-5 text-slate-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center">
              <TrendingUp className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">Agent Intelligence</h3>
              <p className="text-[10px] text-white/60 font-medium uppercase tracking-wider mt-0.5">Self-improving over time</p>
            </div>
          </div>
          <button
            onClick={handleTuneNow}
            disabled={tuning}
            className="px-3 py-1.5 text-[10px] font-bold bg-white/15 hover:bg-white/25 text-white rounded-lg transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
          >
            {tuning ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            {tuning ? 'Analyzing...' : 'Tune Now'}
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex border-b border-slate-100">
        {([
          ['overview', 'Overview', BarChart3],
          ['gaps', `Gaps (${knowledgeGaps.length})`, AlertTriangle],
          ['suggestions', `Improve (${promptSuggestions.length})`, Sparkles],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key as any)}
            className={`flex-1 px-4 py-3 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer border-b-2 ${
              activeTab === key
                ? 'text-violet-600 border-violet-500 bg-violet-50/50'
                : 'text-slate-400 border-transparent hover:text-slate-600'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="p-5 max-h-[500px] overflow-y-auto">
        {/* ── Overview Tab ──────────────────────────────────────────── */}
        {activeTab === 'overview' && overview && (
          <div className="space-y-5">
            {/* Quality Score */}
            <div className="flex items-center gap-4">
              <div className={`w-16 h-16 rounded-2xl ${getScoreBg(overview.avg_quality_score)} bg-opacity-10 flex items-center justify-center`}>
                <span className={`text-2xl font-black ${getScoreColor(overview.avg_quality_score)}`}>
                  {overview.avg_quality_score}
                </span>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">Quality Score</p>
                <p className="text-[11px] text-slate-400">
                  {overview.total_sessions} sessions · {overview.total_turns} turns · last 7 days
                </p>
              </div>
            </div>

            {/* Sparkline */}
            {overview.score_trend.length > 0 && (
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-2">Daily Trend</p>
                <div className="flex items-end gap-1 h-12">
                  {overview.score_trend.map((d, i) => {
                    const h = d.score ? (d.score / 10) * 100 : 5;
                    return (
                      <div
                        key={i}
                        className={`flex-1 rounded-t transition-all ${
                          d.score ? (d.score >= 7 ? 'bg-emerald-400' : d.score >= 4 ? 'bg-amber-400' : 'bg-red-400') : 'bg-slate-200'
                        }`}
                        style={{ height: `${h}%` }}
                        title={`${d.date}: ${d.score ?? 'N/A'}`}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Languages */}
            {overview.top_languages.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-2">Top Languages</p>
                <div className="flex flex-wrap gap-2">
                  {overview.top_languages.map((l, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 text-[11px] font-medium text-slate-600">
                      <Globe className="w-3 h-3 text-slate-400" />
                      {LANG_NAMES[l.lang] || l.lang}
                      <span className="text-slate-400">({l.count})</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Tool Usage */}
            {overview.tool_usage.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-2">Tool Usage</p>
                <div className="space-y-1.5">
                  {overview.tool_usage.map((t, i) => (
                    <div key={i} className="flex items-center justify-between text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-2">
                      <span className="flex items-center gap-1.5">
                        <Zap className="w-3 h-3 text-violet-400" />
                        {t.tool}
                      </span>
                      <span className="font-bold text-slate-800">{t.count}×</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {overview.total_sessions === 0 && (
              <div className="text-center py-8 text-slate-400">
                <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-xs font-medium">No conversations yet</p>
                <p className="text-[10px] mt-1">Analytics will appear once customers start talking to your agent</p>
              </div>
            )}
          </div>
        )}

        {/* ── Knowledge Gaps Tab ────────────────────────────────────── */}
        {activeTab === 'gaps' && (
          <div className="space-y-3">
            {knowledgeGaps.length === 0 && faqPatterns.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <HelpCircle className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-xs font-medium">No knowledge gaps detected</p>
                <p className="text-[10px] mt-1">Your agent is handling all questions well!</p>
              </div>
            ) : (
              <>
                {knowledgeGaps.map((gap) => (
                  <div key={gap.id} className="border border-amber-200 bg-amber-50/30 rounded-xl p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          <span className="text-[10px] font-bold uppercase tracking-widest text-amber-600">Knowledge Gap</span>
                          <span className="text-[10px] text-amber-400 ml-auto">{gap.frequency}× asked</span>
                        </div>
                        <p className="text-xs text-slate-700 font-medium leading-relaxed">
                          "{gap.content.question}"
                        </p>
                      </div>
                      <button
                        onClick={() => handleDismiss(gap.id)}
                        className="shrink-0 w-6 h-6 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-all cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}

                {faqPatterns.length > 0 && (
                  <>
                    <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mt-4 mb-1">Frequent Questions</p>
                    {faqPatterns.map((faq) => (
                      <div key={faq.id} className="border border-blue-200 bg-blue-50/30 rounded-xl p-3.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-1.5 mb-1">
                              <HelpCircle className="w-3.5 h-3.5 text-blue-500" />
                              <span className="text-[10px] font-bold uppercase tracking-widest text-blue-600">FAQ Pattern</span>
                              <span className="text-[10px] text-blue-400 ml-auto">{faq.frequency}× asked</span>
                            </div>
                            <p className="text-xs text-slate-700 font-medium">"{faq.content.question}"</p>
                          </div>
                          <button
                            onClick={() => handleDismiss(faq.id)}
                            className="shrink-0 w-6 h-6 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-400 cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Prompt Suggestions Tab ────────────────────────────────── */}
        {activeTab === 'suggestions' && (
          <div className="space-y-3">
            {promptSuggestions.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-xs font-medium">No suggestions yet</p>
                <p className="text-[10px] mt-1">Click "Tune Now" to analyze recent conversations</p>
              </div>
            ) : (
              promptSuggestions.map((suggestion) => (
                <div key={suggestion.id} className="border border-violet-200 bg-violet-50/20 rounded-xl p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Sparkles className="w-3.5 h-3.5 text-violet-500" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-violet-600">Prompt Improvement</span>
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed mb-3">
                    {suggestion.content.analysis}
                  </p>
                  {suggestion.content.changes && (
                    <div className="space-y-1.5 mb-3">
                      {(suggestion.content.changes as any[]).map((change: any, i: number) => (
                        <div key={i} className="flex items-start gap-2 text-[11px] text-slate-600">
                          <ChevronRight className="w-3 h-3 text-violet-400 shrink-0 mt-0.5" />
                          <span>{change.description}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2 pt-2 border-t border-violet-100">
                    <button
                      onClick={() => handleApply(suggestion.id)}
                      className="flex-1 py-2 text-[11px] font-semibold bg-violet-500 text-white rounded-lg hover:bg-violet-600 transition-colors cursor-pointer flex items-center justify-center gap-1"
                    >
                      <Check className="w-3 h-3" /> Apply
                    </button>
                    <button
                      onClick={() => handleDismiss(suggestion.id)}
                      className="flex-1 py-2 text-[11px] font-semibold bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
