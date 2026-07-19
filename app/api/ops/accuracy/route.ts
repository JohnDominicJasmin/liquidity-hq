import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

export const dynamic = 'force-dynamic';

// Product-quality signal: how often do the calls actually work out.
//  - alert_fires: outcome_pct_24h is signed by the implied direction, so > 0 = win.
//  - live_signals: EMA-ribbon signals resolved to win/loss with an r_multiple.
export const GET = withAdmin(async () => {
  const admin = getSupabaseAdmin();
  const now = Date.now();

  const [firesRes, sigsRes] = await Promise.all([
    admin.from(T.alert_fires)
      .select('rule_key, outcome_pct_24h')
      .eq('resolved_24h', true)
      .not('outcome_pct_24h', 'is', null)
      .order('fired_at', { ascending: false })
      .limit(2000),
    admin.from(T.live_signals)
      .select('outcome, r_multiple')
      .in('outcome', ['win', 'loss'])
      .limit(3000),
  ]);

  // Alert win-rate, overall + by rule_key.
  type Agg = { n: number; wins: number; sumPct: number };
  const byRuleMap = new Map<string, Agg>();
  const overall: Agg = { n: 0, wins: 0, sumPct: 0 };
  for (const f of firesRes.data ?? []) {
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
  for (const s of sigsRes.data ?? []) {
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
    generatedAt: new Date(now).toISOString(),
  });
});
