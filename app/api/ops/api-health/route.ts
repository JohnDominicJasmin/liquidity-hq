import { NextResponse } from 'next/server';
import { deriveHealthStatus, knownBlockedReason, STATUS_RANK } from '@/lib/apiHealthStatus';
import { withAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

export const dynamic = 'force-dynamic';

// Unlike /api/ops/crons - which is honest about being a last-activity PROXY,
// since a quiet market legitimately produces no rows - this is a real health
// signal. Every row here was written by a job that actually called the
// dependency and judged whether the response carried usable data.
//
// Rows are written by the ingest crons (see lib/apiHealth.ts). A source that
// has stopped being written at all is itself a signal: it means the job that
// reports it is no longer running.
const STALE_MS = 30 * 60_000;

interface Row {
  source: string;
  category: string;
  ok: boolean;
  detail: string | null;
  items: number | null;
  last_ok_at: string | null;
  last_fail_at: string | null;
  consecutive_failures: number;
  recent: boolean[];
  updated_at: string;
}

export const GET = withAdmin(async () => {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from(T.api_health)
    .select('source, category, ok, detail, items, last_ok_at, last_fail_at, consecutive_failures, recent, updated_at')
    .order('source');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = Date.now();
  const rows = (data ?? []) as Row[];

  const sources = rows.map(r => {
    const samples = r.recent?.length ?? 0;
    const successes = r.recent?.filter(Boolean).length ?? 0;
    const rate = samples > 0 ? (successes / samples) * 100 : null;
    const stale = now - new Date(r.updated_at).getTime() > STALE_MS;

    /* Status derivation and the known-blocked registry live in
       lib/apiHealthStatus.ts so both are testable without a database, and so
       the REASON a source is expected to fail sits next to the list rather
       than in a code comment three files away. See #176. */
    const status = deriveHealthStatus({
      source: r.source,
      ok: r.ok,
      consecutiveFailures: r.consecutive_failures,
      stale,
      successRate: rate,
    });
    const knownReason = knownBlockedReason(r.source);

    return {
      source: r.source,
      category: r.category,
      status,
      ok: r.ok,
      detail: stale ? `no report in ${Math.round((now - new Date(r.updated_at).getTime()) / 60000)}m` : r.detail,
      /* Sent for every known source, not only failing ones - a known-blocked
         feed that starts succeeding means their WAF changed, and the reader
         needs the context to recognise that as news. */
      knownReason,
      items: r.items,
      lastOkAt: r.last_ok_at,
      lastFailAt: r.last_fail_at,
      consecutiveFailures: r.consecutive_failures,
      successRate: rate,
      samples,
      updatedAt: r.updated_at,
    };
  });

  // Worst first - the point of opening this card is to see what is broken,
  // not to scroll a healthy list looking for the one red row.
  /* `known` sorts between warn and ok: visible, but never above something
     that might need action. Before this, CryptoSlate's 14,234 failures held
     the top row permanently and anything that broke today appeared beneath
     it (#176). */
  sources.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.source.localeCompare(b.source));

  return NextResponse.json({
    sources,
    summary: {
      total: sources.length,
      down: sources.filter(s => s.status === 'down').length,
      warn: sources.filter(s => s.status === 'warn').length,
      known: sources.filter(s => s.status === 'known').length,
      ok: sources.filter(s => s.status === 'ok').length,
    },
    generatedAt: new Date(now).toISOString(),
  });
});
