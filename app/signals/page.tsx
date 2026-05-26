'use client';
import { useState, useEffect, useCallback } from 'react';
import { getSupabase, Signal } from '@/lib/supabase';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function SignalsPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) {
      setError('Supabase not configured — add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local');
      setLoading(false);
      return;
    }
    const { data, error: err } = await sb
      .from('signals')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (err) { setError(err.message); setLoading(false); return; }
    setSignals(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function markResult(id: number, result: string) {
    const sb = getSupabase();
    if (!sb) return;
    // Optimistic update first
    setSignals(prev => prev.map(s => s.id === id ? { ...s, result } : s));
    await sb.from('signals').update({ result }).eq('id', id);
  }

  /* ── Stats ── */
  const total    = signals.length;
  const longs    = signals.filter(s => s.signal === 'LONG').length;
  const shorts   = signals.filter(s => s.signal === 'SHORT').length;
  const flats    = signals.filter(s => s.signal === 'FLAT').length;
  const avgConf  = total > 0 ? Math.round(signals.reduce((a, s) => a + s.confidence, 0) / total) : 0;
  const wins     = signals.filter(s => s.result === 'win').length;
  const losses   = signals.filter(s => s.result === 'loss').length;
  const decided  = wins + losses;
  const winRate  = decided > 0 ? Math.round((wins / decided) * 100) : null;

  return (
    <div>
      <div style={{ padding: '1rem 0 0.5rem' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#e8e8e8', marginBottom: 2 }}>Signal History</div>
        <div style={{ fontSize: 12, color: '#606060', marginBottom: 14 }}>
          AI Arena trade log — tap a signal to mark it WIN or LOSS and track Grok&apos;s accuracy
        </div>
      </div>

      {/* ── Stats row ── */}
      <div className="sig-stats-row">
        {([
          { label: 'Total',    val: total,                              color: '#e8e8e8' },
          { label: 'Longs',    val: longs,                              color: '#7de0a4' },
          { label: 'Shorts',   val: shorts,                             color: '#ff9a92' },
          { label: 'Flat',     val: flats,                              color: '#606060' },
          { label: 'Avg Conf', val: avgConf > 0 ? `${avgConf}%` : '—', color: '#b8aeff' },
          {
            label: 'Win Rate',
            val: winRate != null ? `${winRate}%` : '—',
            color: winRate != null ? (winRate >= 50 ? '#7de0a4' : '#ff9a92') : '#606060',
          },
        ] as { label: string; val: string | number; color: string }[]).map(s => (
          <div key={s.label} className="sig-stat-card">
            <div className="sig-stat-num" style={{ color: s.color }}>{s.val}</div>
            <div className="sig-stat-lbl">{s.label}</div>
          </div>
        ))}
      </div>

      {/* W/L summary pill */}
      {decided > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 20, background: '#152b1e', color: '#7de0a4', border: '0.5px solid #266038' }}>
            ✓ {wins} wins
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 20, background: '#2e1515', color: '#ff9a92', border: '0.5px solid #662222' }}>
            ✗ {losses} losses
          </span>
          <span style={{ fontSize: 11, color: '#606060', padding: '4px 0' }}>
            {total - decided} pending
          </span>
        </div>
      )}

      {loading && <div className="empty" style={{ padding: '2rem 0' }}>Loading signals…</div>}

      {error && <div className="arena-err">⚠ {error}</div>}

      {!loading && !error && signals.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🤖</div>
          <div style={{ fontSize: 14, color: '#e8e8e8', fontWeight: 600, marginBottom: 4 }}>No signals yet</div>
          <div style={{ fontSize: 12, color: '#606060', lineHeight: 1.5 }}>
            Run AI Arena to generate and log your first Grok signal
          </div>
        </div>
      )}

      {/* ── Signal list ── */}
      {signals.map(sig => {
        const isOpen  = expanded === sig.id;
        const pending = !sig.result || sig.result === 'pending';

        return (
          <div
            key={sig.id}
            className={`sig-item${sig.result === 'win' ? ' sig-res-win' : sig.result === 'loss' ? ' sig-res-loss' : ''}`}
          >
            {/* Top row — clickable to expand */}
            <div
              className="sig-item-top"
              onClick={() => setExpanded(isOpen ? null : (sig.id ?? null))}
            >
              <div className="sig-item-left">
                <span className="sig-coin-badge">
                  {sig.coin.replace('/USDT', '').toUpperCase()}
                </span>
                <span className={`sig-dir-badge${
                  sig.signal === 'LONG' ? ' sig-badge-long'
                  : sig.signal === 'SHORT' ? ' sig-badge-short'
                  : ' sig-badge-flat'
                }`}>
                  {sig.signal === 'LONG' ? '▲ LONG' : sig.signal === 'SHORT' ? '▼ SHORT' : '— FLAT'}
                </span>
                <span className="sig-conf">{sig.confidence}%</span>
              </div>
              <div className="sig-item-right">
                {sig.result === 'win'  && <span className="sig-result-badge sig-win-badge">WIN</span>}
                {sig.result === 'loss' && <span className="sig-result-badge sig-loss-badge">LOSS</span>}
                {pending && <span style={{ fontSize: 10, color: '#444' }}>—</span>}
                <span className="sig-chevron">{isOpen ? '▲' : '▼'}</span>
              </div>
            </div>

            {/* Meta row */}
            <div className="sig-item-meta">
              <span>Entry: <strong style={{ color: '#a0a0a0' }}>{sig.entry_zone || '—'}</strong></span>
              {sig.session && <span>{sig.session}</span>}
              {sig.created_at && <span style={{ marginLeft: 'auto' }}>{timeAgo(sig.created_at)}</span>}
            </div>

            {/* Expanded: reasoning + mark buttons */}
            {isOpen && (
              <div className="sig-expanded">
                {sig.reasoning && (
                  <div className="sig-reasoning-text">{sig.reasoning}</div>
                )}
                <div className="sig-btn-row">
                  {pending && sig.id != null && (
                    <>
                      <button
                        className="sig-result-btn sig-win-btn"
                        onClick={e => { e.stopPropagation(); markResult(sig.id!, 'win'); }}
                      >
                        ✓ WIN
                      </button>
                      <button
                        className="sig-result-btn sig-loss-btn"
                        onClick={e => { e.stopPropagation(); markResult(sig.id!, 'loss'); }}
                      >
                        ✗ LOSS
                      </button>
                    </>
                  )}
                  {!pending && sig.id != null && (
                    <button
                      className="sig-result-btn sig-undo-btn"
                      onClick={e => { e.stopPropagation(); markResult(sig.id!, 'pending'); }}
                    >
                      ↺ Undo
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
