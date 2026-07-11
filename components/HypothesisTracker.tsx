'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthProvider';
import { getSupabase } from '@/lib/supabase';

interface Hypothesis {
  id: string;
  title: string;
  hypothesis: string;
  acceptance_criteria: string[];
  status: 'active' | 'confirmed' | 'disconfirmed' | 'expired';
  grok_verdict: string | null;
  grok_reasoning: string | null;
  grok_evidence_assessment: string | null;
  grok_confidence: string | null;
  grok_next_check: string | null;
  grok_last_run: string | null;
  target_date: string | null;
  created_at: string;
}

interface Evidence {
  id: string;
  hypothesis_id: string;
  type: 'supporting' | 'against' | 'neutral';
  content: string;
  source: string | null;
  created_at: string;
}

const STATUS_META: Record<string, { label: string; col: string; bg: string }> = {
  active:        { label: 'Active',         col: '#5a6aff', bg: 'rgba(90,106,255,0.12)' },
  confirmed:     { label: 'Confirmed',      col: '#34d399', bg: 'rgba(52,211,153,0.12)' },
  disconfirmed:  { label: 'Disconfirmed',   col: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  expired:       { label: 'Expired',        col: '#94a3b8', bg: 'rgba(148,163,184,0.10)' },
};

const VERDICT_META: Record<string, { col: string }> = {
  CONFIRMED:    { col: '#34d399' },
  DISCONFIRMED: { col: '#f87171' },
  UNCLEAR:      { col: '#fbbf24' },
};

const EV_META: Record<string, { icon: string; col: string }> = {
  supporting: { icon: '↑', col: '#34d399' },
  against:    { icon: '↓', col: '#f87171' },
  neutral:    { icon: '→', col: '#94a3b8' },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
}

async function getToken(): Promise<string> {
  const sb = getSupabase();
  if (!sb) return '';
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? '';
}

async function apiFetch(path: string, opts?: RequestInit) {
  const token = await getToken();
  return fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts?.headers ?? {}) },
  });
}

export default function HypothesisTracker() {
  const { user } = useAuth();
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [evidenceMap, setEvidenceMap] = useState<Record<string, Evidence[]>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);

  // Create form state
  const [cfTitle, setCfTitle] = useState('');
  const [cfHypothesis, setCfHypothesis] = useState('');
  const [cfCriteria, setCfCriteria] = useState(['', '', '']);
  const [cfTargetDate, setCfTargetDate] = useState('');
  const [cfSaving, setCfSaving] = useState(false);
  const [cfError, setCfError] = useState('');

  // Evidence form state
  const [evType, setEvType] = useState<'supporting' | 'against' | 'neutral'>('supporting');
  const [evContent, setEvContent] = useState('');
  const [evSource, setEvSource] = useState('');
  const [evSaving, setEvSaving] = useState(false);

  const fetchHypotheses = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await apiFetch('/api/hypotheses');
      const json = await res.json() as { hypotheses?: Hypothesis[]; error?: string };
      setHypotheses(json.hypotheses ?? []);
    } catch {
      // silently keep existing list on network error
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchHypotheses(); }, [fetchHypotheses]);

  const fetchEvidence = useCallback(async (id: string) => {
    const res = await apiFetch(`/api/hypotheses/${id}/evidence`);
    const json = await res.json() as { evidence?: Evidence[] };
    setEvidenceMap(prev => ({ ...prev, [id]: json.evidence ?? [] }));
  }, []);

  const toggleExpand = useCallback(async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    setEvContent('');
    setEvSource('');
    if (!evidenceMap[id]) await fetchEvidence(id);
  }, [expandedId, evidenceMap, fetchEvidence]);

  const createHypothesis = async () => {
    if (!cfTitle.trim() || !cfHypothesis.trim()) return;
    setCfSaving(true);
    setCfError('');
    try {
      const res = await apiFetch('/api/hypotheses', {
        method: 'POST',
        body: JSON.stringify({
          title: cfTitle,
          hypothesis: cfHypothesis,
          acceptance_criteria: cfCriteria.filter(c => c.trim()),
          target_date: cfTargetDate || undefined,
        }),
      });
      if (res.ok) {
        setCfTitle(''); setCfHypothesis(''); setCfCriteria(['', '', '']); setCfTargetDate('');
        setShowCreate(false);
        await fetchHypotheses();
      } else {
        const e = await res.json().catch(() => ({})) as { error?: string };
        setCfError(e.error ?? 'Failed to save hypothesis');
      }
    } catch {
      setCfError('Network error — please try again');
    } finally { setCfSaving(false); }
  };

  const deleteHypothesis = async (id: string) => {
    if (!confirm('Delete this hypothesis and all its evidence?')) return;
    const res = await apiFetch(`/api/hypotheses/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setHypotheses(prev => prev.filter(h => h.id !== id));
      if (expandedId === id) setExpandedId(null);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    const res = await apiFetch(`/api/hypotheses/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      setHypotheses(prev => prev.map(h => h.id === id ? { ...h, status: status as Hypothesis['status'] } : h));
    }
  };

  const addEvidence = async (hypothesisId: string) => {
    if (!evContent.trim()) return;
    setEvSaving(true);
    try {
      const res = await apiFetch(`/api/hypotheses/${hypothesisId}/evidence`, {
        method: 'POST',
        body: JSON.stringify({ type: evType, content: evContent, source: evSource || undefined }),
      });
      if (res.ok) {
        setEvContent(''); setEvSource('');
        await fetchEvidence(hypothesisId);
      }
    } finally { setEvSaving(false); }
  };

  const deleteEvidence = async (hypothesisId: string, evidenceId: string) => {
    const res = await apiFetch(`/api/hypotheses/${hypothesisId}/evidence?evidenceId=${evidenceId}`, { method: 'DELETE' });
    if (res.ok) {
      setEvidenceMap(prev => ({
        ...prev,
        [hypothesisId]: (prev[hypothesisId] ?? []).filter(e => e.id !== evidenceId),
      }));
    }
  };

  const runAnalysis = async (id: string) => {
    setAnalyzingId(id);
    try {
      const res = await apiFetch(`/api/hypotheses/${id}/analyze`, { method: 'POST' });
      const json = await res.json() as { verdict?: string; status?: string };
      if (json.verdict) {
        await fetchHypotheses();
        // re-fetch evidence so the expanded card reflects any DB changes
        await fetchEvidence(id);
      }
    } finally { setAnalyzingId(null); }
  };

  if (!user) {
    return (
      <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--txt3)', fontSize: 13 }}>
        Sign in to use the Research Hypothesis Tracker.
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--txt)', letterSpacing: '-0.2px' }}>
            Research Hypotheses
          </div>
          <div style={{ fontSize: 12, color: 'var(--txt3)', marginTop: 2 }}>
            Track structured market theses with measurable criteria and evidence
          </div>
        </div>
        <button
          onClick={() => setShowCreate(v => !v)}
          style={{
            background: showCreate ? 'var(--bg2)' : 'rgba(90,106,255,0.2)',
            border: '0.5px solid rgba(90,106,255,0.4)',
            borderRadius: 7,
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--accent)',
            cursor: 'pointer',
          }}
        >
          {showCreate ? '✕ Cancel' : '+ New Hypothesis'}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div style={{
          background: 'var(--bg2)',
          border: '0.5px solid rgba(90,106,255,0.3)',
          borderRadius: 10,
          padding: '14px',
          marginBottom: 14,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginBottom: 12 }}>New Hypothesis</div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 4, fontWeight: 600 }}>Title</div>
            <input
              value={cfTitle}
              onChange={e => setCfTitle(e.target.value)}
              placeholder="e.g. BTC enters accumulation phase below $60k"
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 4, fontWeight: 600 }}>
              Thesis — What do you believe and why?
            </div>
            <textarea
              value={cfHypothesis}
              onChange={e => setCfHypothesis(e.target.value)}
              placeholder="Describe your hypothesis in detail. Include your reasoning, the market context that supports it, and what price action or on-chain data you expect to see."
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
            />
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 4, fontWeight: 600 }}>
              Acceptance Criteria — When is this confirmed?
            </div>
            {cfCriteria.map((c, i) => (
              <input
                key={i}
                value={c}
                onChange={e => setCfCriteria(prev => prev.map((x, j) => j === i ? e.target.value : x))}
                placeholder={`Criterion ${i + 1} — e.g. "BTC closes above $72k on weekly"`}
                style={{ ...inputStyle, marginBottom: 6 }}
              />
            ))}
            <button
              onClick={() => setCfCriteria(prev => [...prev, ''])}
              style={ghostBtnStyle}
            >
              + Add criterion
            </button>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 4, fontWeight: 600 }}>
              Target Date (optional)
            </div>
            <input
              type="date"
              value={cfTargetDate}
              onChange={e => setCfTargetDate(e.target.value)}
              style={{ ...inputStyle, width: 'auto' }}
            />
          </div>

          {cfError && (
            <div style={{ fontSize: 11, color: '#f87171', marginBottom: 8 }}>{cfError}</div>
          )}
          <button
            onClick={createHypothesis}
            disabled={cfSaving || !cfTitle.trim() || !cfHypothesis.trim()}
            style={primaryBtnStyle(cfSaving || !cfTitle.trim() || !cfHypothesis.trim())}
          >
            {cfSaving ? 'Saving…' : 'Save Hypothesis'}
          </button>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ color: 'var(--txt3)', fontSize: 12, padding: '16px 0' }}>Loading…</div>
      ) : hypotheses.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '32px 16px', color: 'var(--txt3)',
          fontSize: 13, border: '0.5px dashed var(--bdr)', borderRadius: 10,
        }}>
          No hypotheses yet. Click &ldquo;New Hypothesis&rdquo; to track your first market thesis.
        </div>
      ) : (
        hypotheses.map(h => {
          const sm = STATUS_META[h.status] ?? STATUS_META.active;
          const vm = h.grok_verdict ? VERDICT_META[h.grok_verdict] : null;
          const isExpanded = expandedId === h.id;
          const evList = evidenceMap[h.id] ?? [];
          const isAnalyzing = analyzingId === h.id;

          return (
            <div
              key={h.id}
              style={{
                background: 'var(--bg2)',
                border: '0.5px solid var(--bdr)',
                borderRadius: 10,
                marginBottom: 8,
                overflow: 'hidden',
              }}
            >
              {/* Card header */}
              <div
                onClick={() => toggleExpand(h.id)}
                style={{
                  padding: '11px 14px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt)' }}>{h.title}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                      background: sm.bg, color: sm.col,
                    }}>{sm.label}</span>
                    {vm && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: vm.col }}>
                        ● {h.grok_verdict}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--txt3)', lineHeight: 1.4 }}>
                    {h.hypothesis.length > 120 ? h.hypothesis.slice(0, 120) + '…' : h.hypothesis}
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 5, fontSize: 10, color: 'var(--txt3)' }}>
                    <span>{fmtDate(h.created_at)}</span>
                    {h.target_date && <span>Target: {h.target_date}</span>}
                    {h.grok_last_run && <span>Last analysis: {fmtDate(h.grok_last_run)}</span>}
                  </div>
                </div>
                <span style={{ color: 'var(--txt3)', fontSize: 12, flexShrink: 0, marginTop: 2 }}>
                  {isExpanded ? '▲' : '▼'}
                </span>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div style={{ borderTop: '0.5px solid var(--bdr)', padding: '14px' }}>
                  {/* Full hypothesis */}
                  <div style={{ fontSize: 12, color: 'var(--txt)', lineHeight: 1.6, marginBottom: 12 }}>
                    {h.hypothesis}
                  </div>

                  {/* Acceptance criteria */}
                  {h.acceptance_criteria?.length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Acceptance Criteria
                      </div>
                      {h.acceptance_criteria.map((c, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 11, color: 'var(--txt3)', flexShrink: 0 }}>{i + 1}.</span>
                          <span style={{ fontSize: 12, color: 'var(--txt)', lineHeight: 1.5 }}>{c}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Grok analysis result */}
                  {h.grok_verdict && (
                    <div style={{
                      marginBottom: 14,
                      padding: '10px 12px',
                      background: 'rgba(255,255,255,0.03)',
                      borderRadius: 8,
                      border: `0.5px solid ${VERDICT_META[h.grok_verdict]?.col ?? 'var(--bdr)'}30`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{
                          fontSize: 11, fontWeight: 800,
                          color: VERDICT_META[h.grok_verdict]?.col ?? 'var(--txt)',
                          letterSpacing: '0.05em',
                        }}>
                          GROK: {h.grok_verdict}
                        </span>
                        {h.grok_confidence && (
                          <span style={{ fontSize: 11, color: 'var(--txt3)' }}>· {h.grok_confidence}</span>
                        )}
                      </div>
                      {h.grok_reasoning && (
                        <div style={{ fontSize: 11, color: 'var(--txt3)', lineHeight: 1.55, marginBottom: 6 }}>
                          {h.grok_reasoning}
                        </div>
                      )}
                      {h.grok_next_check && (
                        <div style={{ fontSize: 11, color: 'var(--accent)', borderTop: '0.5px solid var(--bdr)', paddingTop: 6, marginTop: 4 }}>
                          <span style={{ fontWeight: 700 }}>Next check: </span>{h.grok_next_check}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Grok analysis button */}
                  <button
                    onClick={() => runAnalysis(h.id)}
                    disabled={isAnalyzing}
                    style={{
                      ...ghostBtnStyle,
                      color: isAnalyzing ? 'var(--txt3)' : 'var(--accent)',
                      borderColor: 'rgba(90,106,255,0.3)',
                      marginBottom: 14,
                      width: '100%',
                    }}
                  >
                    {isAnalyzing ? 'Grok is analyzing evidence…' : h.grok_verdict ? '↻ Re-run Grok Analysis' : 'Run Grok Analysis'}
                  </button>

                  {/* Evidence log */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Evidence ({evList.length})
                    </div>
                    {evList.length === 0 ? (
                      <div style={{ fontSize: 11, color: 'var(--txt3)', fontStyle: 'italic' }}>
                        No evidence logged yet. Add observations below.
                      </div>
                    ) : (
                      evList.map(ev => {
                        const em = EV_META[ev.type];
                        return (
                          <div key={ev.id} style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 8,
                            marginBottom: 8,
                            padding: '8px 10px',
                            background: 'rgba(255,255,255,0.02)',
                            borderRadius: 6,
                            border: '0.5px solid var(--bdr)',
                          }}>
                            <span style={{ fontSize: 13, color: em.col, flexShrink: 0, fontWeight: 700 }}>{em.icon}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, color: 'var(--txt)', lineHeight: 1.5 }}>{ev.content}</div>
                              <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>
                                {fmtDate(ev.created_at)}{ev.source ? ` · ${ev.source}` : ''}
                              </div>
                            </div>
                            <button
                              onClick={() => deleteEvidence(h.id, ev.id)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--txt3)', fontSize: 14, padding: 0, opacity: 0.5, flexShrink: 0 }}
                              title="Delete evidence"
                            >×</button>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Add evidence form */}
                  <div style={{
                    background: 'rgba(255,255,255,0.02)',
                    borderRadius: 8,
                    border: '0.5px solid var(--bdr)',
                    padding: '10px 12px',
                    marginBottom: 12,
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Add Evidence
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                      {(['supporting', 'against', 'neutral'] as const).map(t => (
                        <button
                          key={t}
                          onClick={() => setEvType(t)}
                          style={{
                            background: evType === t ? `${EV_META[t].col}22` : 'transparent',
                            border: `0.5px solid ${evType === t ? EV_META[t].col : 'var(--bdr)'}`,
                            borderRadius: 5,
                            padding: '4px 10px',
                            fontSize: 11,
                            fontWeight: evType === t ? 700 : 400,
                            color: evType === t ? EV_META[t].col : 'var(--txt3)',
                            cursor: 'pointer',
                            textTransform: 'capitalize',
                          }}
                        >{EV_META[t].icon} {t}</button>
                      ))}
                    </div>
                    <textarea
                      value={evContent}
                      onChange={e => setEvContent(e.target.value)}
                      placeholder="Describe the evidence or observation…"
                      rows={2}
                      style={{ ...inputStyle, resize: 'vertical', marginBottom: 6 }}
                    />
                    <input
                      value={evSource}
                      onChange={e => setEvSource(e.target.value)}
                      placeholder="Source (optional — e.g. Glassnode, X/Twitter, price action)"
                      style={{ ...inputStyle, marginBottom: 8 }}
                    />
                    <button
                      onClick={() => addEvidence(h.id)}
                      disabled={evSaving || !evContent.trim()}
                      style={primaryBtnStyle(evSaving || !evContent.trim())}
                    >
                      {evSaving ? 'Saving…' : 'Add Evidence'}
                    </button>
                  </div>

                  {/* Status controls + delete */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--txt3)' }}>Status:</span>
                    {(['active','confirmed','disconfirmed','expired'] as const).map(s => (
                      <button
                        key={s}
                        onClick={() => updateStatus(h.id, s)}
                        style={{
                          background: h.status === s ? `${STATUS_META[s].col}22` : 'transparent',
                          border: `0.5px solid ${h.status === s ? STATUS_META[s].col : 'var(--bdr)'}`,
                          borderRadius: 5,
                          padding: '3px 8px',
                          fontSize: 10,
                          fontWeight: h.status === s ? 700 : 400,
                          color: h.status === s ? STATUS_META[s].col : 'var(--txt3)',
                          cursor: 'pointer',
                          textTransform: 'capitalize',
                        }}
                      >{s}</button>
                    ))}
                    <button
                      onClick={() => deleteHypothesis(h.id)}
                      style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#f87171', fontSize: 11, opacity: 0.6, padding: '3px 0' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

/* ── Shared inline styles ── */
const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.04)',
  border: '0.5px solid var(--bdr)',
  borderRadius: 6,
  padding: '7px 10px',
  fontSize: 12,
  color: 'var(--txt)',
  outline: 'none',
  boxSizing: 'border-box',
};

const ghostBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '0.5px solid var(--bdr)',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 11,
  color: 'var(--txt3)',
  cursor: 'pointer',
  display: 'block',
};

const primaryBtnStyle = (disabled: boolean): React.CSSProperties => ({
  background: disabled ? 'rgba(90,106,255,0.1)' : 'rgba(90,106,255,0.2)',
  border: '0.5px solid rgba(90,106,255,0.4)',
  borderRadius: 6,
  padding: '6px 14px',
  fontSize: 12,
  fontWeight: 700,
  color: disabled ? 'var(--txt3)' : 'var(--accent)',
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.6 : 1,
});
