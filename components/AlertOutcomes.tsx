'use client';
// Tier 2 #10 - honest track record for the directional alert types (squeeze,
// EMA cross, distribution, RSI, whales). Reads T.alert_fires directly with
// the anon client (public SELECT policy, same pattern as live-tracking's read
// of lhq_live_signals) - writes only ever happen server-side via the alert cron.
import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { T } from '@/lib/tables';
import { StatRow } from '@/components/BacktestStatsUI';
import Tip from '@/components/Tip';
import EmptyState from '@/components/EmptyState';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';

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

const RULE_ORDER = ['squeeze', 'ema_cross', 'distribution', 'rsi', 'whales'];

function fmtPct(n: number): string { return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'; }

function ruleLabel(t: (key: any) => string, key: string): string {
  switch (key) {
    case 'squeeze':      return t('ALERT_OUTCOMES_RULE_SQUEEZE');
    case 'ema_cross':    return t('ALERT_OUTCOMES_RULE_EMA_CROSS');
    case 'distribution': return t('ALERT_OUTCOMES_RULE_DISTRIBUTION');
    case 'rsi':           return t('ALERT_OUTCOMES_RULE_RSI');
    case 'whales':        return t('ALERT_OUTCOMES_RULE_WHALES');
    default:               return key;
  }
}

export default function AlertOutcomes() {
  const [rows, setRows]       = useState<FireRow[] | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const { t } = useLabels();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sb = getSupabase();
      if (!sb) { setError('Not configured'); return; }
      /* T.alert_fires, not the literal 'lhq_alert_fires' this used to hardcode.
         That literal is the PRODUCTION table name, so this component queried
         prod's table name against whatever project it was pointed at - which
         works on prod by coincidence and 404s everywhere else. It is the only
         place in the codebase that bypassed lib/tables; the other six consumers
         of this table all use T.alert_fires.
         Consequence while it stood: the panel has never rendered on dev or
         staging, so every QA pass over /alerts was passing over a feature that
         could not load. Found while verifying the signed-out /alerts page for
         an unrelated 401 change.
         Note this does NOT make the panel work on dev by itself - see the
         alert_fires table drift below. It stops the code lying about which
         environment it is in, which is the part that is a code defect. */
      const { data, error: err } = await sb
        .from(T.alert_fires)
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
        <div className="lbl">{t('ALERT_OUTCOMES_TITLE')}</div>
        <div style={{ padding: '4px 0' }}>
          <SkeletonBar width="60%" height={13} style={{ marginBottom: 8 }} />
          <SkeletonBar width="40%" height={13} />
          <span className="sr-only">{t('ALERT_OUTCOMES_LOADING_SR')}</span>
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
    return { key, label: ruleLabel(t, key), count: rr.length, winRate, avgPct };
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="lbl" style={{ margin: 0 }}>
          <Tip width={260} text={t('ALERT_OUTCOMES_TOOLTIP')}>{t('ALERT_OUTCOMES_TITLE')}</Tip>
        </div>
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('ALERT_OUTCOMES_SUBTITLE')}</span>
      </div>

      {byRule.length === 0 ? (
        <EmptyState
          title={t('ALERT_OUTCOMES_EMPTY_TITLE')}
          sub={t('ALERT_OUTCOMES_EMPTY_SUB')}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '2px 24px', marginBottom: 12 }}>
          {byRule.map(r => (
            <StatRow
              key={r.key}
              label={`${r.label} (${r.count})`}
              value={`${(r.winRate * 100).toFixed(0)}% · ${fmtPct(r.avgPct)}`}
              color={r.winRate >= 0.5 ? 'var(--green-2)' : 'var(--red)'}
            />
          ))}
        </div>
      )}

      {/* The per-fire "Recent Fires" list that used to sit here has been removed.
          It was the second of two near-identical lists on this page (the other,
          the app-wide "Recently Fired" buffer, went on 2026-08-03) and it still
          read as a feed of individual events on a page whose job is the user's
          own alerts. The win-rate summary above is what actually makes this card
          worth showing - it is the honest track record, aggregated, and it does
          not invite the reader to mistake app-wide signals for their own. */}
    </div>
  );
}
