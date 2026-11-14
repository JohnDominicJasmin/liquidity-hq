import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

export const dynamic = 'force-dynamic';

// Product-quality signal: how often do the calls actually work out.
//  - alert_fires: outcome_pct_24h is signed by the implied direction, so > 0 = win.
//  - live_signals: EMA-ribbon signals resolved to win/loss with an r_multiple.
/* EVERY ROW, NOT THE FIRST 1,000 (#1651): PostgREST caps a plain select at its max-rows (1,000 here), so the old .limit(2000) / .limit(3000) silently
   meant 1,000 and the win rate covered an unstated window. Pages of 1,000 in a stable order until a short page, with a hard ceiling so a runaway table
   cannot hold the route; the response says how far back it read and whether the ceiling cut it. */
const PAGE = 1000;
const MAX_PAGES = 20;
async function readAll<R>(page: (from: number, to: number) => PromiseLike<{ data: R[] | null }>): Promise<{ rows: R[]; capped: boolean }> {
  const rows: R[] = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data } = await page(p * PAGE, p * PAGE + PAGE - 1);
    const got = data ?? [];
    rows.push(...got);
    if (got.length < PAGE) return { rows, capped: false };
  }
  return { rows, capped: true };
}

export const GET = withAdmin(async () => {
  const admin = getSupabaseAdmin();
  const now = Date.now();

  const [firesRes, sigsRes] = await Promise.all([
    readAll<{ rule_key: string | null; outcome_pct_24h: number | string | null; fired_at: string }>((from, to) =>
      admin.from(T.alert_fires)
        .select('rule_key, outcome_pct_24h, fired_at')
        .eq('resolved_24h', true)
        .not('outcome_pct_24h', 'is', null)
        .order('fired_at', { ascending: false })
        .range(from, to)),
    readAll<{ outcome: string; r_multiple: number | string | null; signal_time: string }>((from, to) =>
      admin.from(T.live_signals)
        .select('outcome, r_multiple, signal_time')
        .in('outcome', ['win', 'loss'])
        .order('signal_time', { ascending: false })
        .range(from, to)),
  ]);

  // Alert win-rate, overall + by rule_key.
  type Agg = { n: number; wins: number; sumPct: number };
  const byRuleMap = new Map<string, Agg>();
  const overall: Agg = { n: 0, wins: 0, sumPct: 0 };
  for (const f of firesRes.rows) {
    const pct = Number(f.outcome_pct_24h);
    if (Number.isNaN(pct)) continue;
    const rule = f.rule_key ?? 'unknown';
    const a = byRuleMap.get(rule) ?? { n: 0, wins: 0, sumPct: 0 };
    a.n++; a.sumPct += pct; if (pct > 0) a.wins++;
    byRuleMap.set(rule, a);
    overall.n++; overall.sumPct += pct; if (pct > 0) overall.wins++;
  }
  const pctRate = (a: Agg) => (a.n ? (a.wins / a.n) * 100 : null);
  const byRule = [...byRuleMap.entries()]
    .map(([rule, a]) => ({ rule, n: a.n, winRate: pctRate(a), avgPct: a.n ? a.sumPct / a.n : null }))
    .sort((a, b) => b.n - a.n);

  // Live-signal win-rate + average R.
  let ln = 0, lwins = 0, sumR = 0;
  for (const s of sigsRes.rows) {
    ln++;
    if (s.outcome === 'win') lwins++;
    const r = Number(s.r_multiple);
    if (!Number.isNaN(r)) sumR += r;
  }

  return NextResponse.json({
    alerts: {
      overall: { n: overall.n, winRate: pctRate(overall), avgPct: overall.n ? overall.sumPct / overall.n : null },
      byRule,
    },
    liveSignals: { n: ln, winRate: ln ? (lwins / ln) * 100 : null, avgR: ln ? sumR / ln : null },
    /* The window each figure covers (newest-first, so the last row is the oldest). */
    window: {
      alertsSince: firesRes.rows.length ? firesRes.rows[firesRes.rows.length - 1].fired_at : null,
      liveSignalsSince: sigsRes.rows.length ? sigsRes.rows[sigsRes.rows.length - 1].signal_time : null,
      truncated: firesRes.capped || sigsRes.capped,
    },
    generatedAt: new Date(now).toISOString(),
  });
});
