'use client';
// Tier 2 #10 - honest track record for the directional alert types (squeeze,
// EMA cross, distribution, RSI, whales). Reads lhq_alert_fires directly with
// the anon client (public SELECT policy, same pattern as live-tracking's read
// of lhq_live_signals) - writes only ever happen server-side via the alert cron.
import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { COIN_LABELS, type CoinId } from '@/lib/marketStore';
import { StatRow } from '@/components/BacktestStatsUI';
import Tip from '@/components/Tip';
import EmptyState from '@/components/EmptyState';
import { SkeletonBar } from '@/components/Skeleton';

interface FireRow {
  rule_key: string;
  coin: string;
  dir: 'long' | 'short';
  label: string;
  fired_at: string;
  outcome_pct_24h: number | null;
  resolved_24h: boolean;
  outcome_pct_48h: number | null;
  resolved_48h: boolean;
}

const RULE_LABELS: Record<string, string> = {
  squeeze: 'Squeeze / Flush', ema_cross: '200 EMA Cross', distribution: 'Distribution',
  rsi: 'RSI Overbought/Oversold', whales: 'Whale Trades',
};
const RULE_ORDER = ['squeeze', 'ema_cross', 'distribution', 'rsi', 'whales'];

function fmtPct(n: number): string { return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'; }
function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function AlertOutcomes() {
  const [rows, setRows]       = useState<FireRow[] | null>(null);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sb = getSupabase();
      if (!sb) { setError('Not configured'); return; }
      const { data, error: err } = await sb
        .from('lhq_alert_fires')
        .select('rule_key, coin, dir, label, fired_at, outcome_pct_24h, resolved_24h, outcome_pct_48h, resolved_48h')
        .order('fired_at', { ascending: false })
        .limit(500);
      if (cancelled) return;
      if (err) setError(err.message);
      else setRows(data as FireRow[]);
    })();
    return () => { cancelled = true; };
  }, []);

  if (error) return null; // silent - this is a supplementary trust surface, not core functionality
  if (rows === null) {
    return (
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="lbl">Alert Track Record</div>
        <div style={{ padding: '4px 0' }}>
          <SkeletonBar width="60%" height={13} style={{ marginBottom: 8 }} />
          <SkeletonBar width="40%" height={13} />
          <span className="sr-only">Loading…</span>
        </div>
      </div>
    );
  }

  const resolved = rows.filter(r => r.resolved_24h && r.outcome_pct_24h != null);
  const byRule = RULE_ORDER.map(key => {
    const rr = resolved.filter(r => r.rule_key === key);
    if (rr.length === 0) return null;
    const favorable = rr.filter(r => r.outcome_pct_24h! > 0).length;
    const winRate   = favorable / rr.length;
    const avgPct    = rr.reduce((s, r) => s + r.outcome_pct_24h!, 0) / rr.length;
    return { key, label: RULE_LABELS[key], count: rr.length, winRate, avgPct };
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  const recent = rows.slice(0, 12);

  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="lbl" style={{ margin: 0 }}>
          <Tip width={260} text="How this app's own directional alerts actually performed: the signed price move by 24h after each alert fired, misses included - not a backtest, the real record. Only alert types with a clear implied direction are scored (squeeze, EMA cross, distribution, RSI, whale trades).">Alert Track Record</Tip>
        </div>
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>24h outcome · misses included</span>
      </div>

      {byRule.length === 0 ? (
        <EmptyState
          title="No resolved outcomes yet"
          sub="Outcomes fill in ~24h after each squeeze, EMA cross, distribution, RSI, or whale alert fires."
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '2px 24px', marginBottom: 12 }}>
          {byRule.map(r => (
            <StatRow
              key={r.key}
              label={`${r.label} (${r.count})`}
              value={`${(r.winRate * 100).toFixed(0)}% · ${fmtPct(r.avgPct)}`}
              color={r.winRate >= 0.5 ? '#34d399' : '#f87171'}
            />
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <div style={{ borderTop: '0.5px solid var(--bdr)', paddingTop: 10 }}>
          <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--txt3)', marginBottom: 6 }}>
            Recent Fires
          </div>
          {recent.map((r, i) => {
            const pending = !r.resolved_24h;
            const pct = r.outcome_pct_24h;
            const col = pending ? 'var(--txt3)' : (pct ?? 0) >= 0 ? '#34d399' : '#f87171';
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 'var(--fs-caption)' }}>
                <span style={{ fontWeight: 700, color: 'var(--txt)', minWidth: 40 }}>{COIN_LABELS[r.coin as CoinId] ?? r.coin.toUpperCase()}</span>
                <span style={{ color: 'var(--txt3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                <span style={{ color: 'var(--txt3)' }}>{timeAgo(r.fired_at)}</span>
                <span style={{ color: col, fontWeight: 700, minWidth: 56, textAlign: 'right' }}>
                  {pending ? 'pending' : fmtPct(pct!)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
