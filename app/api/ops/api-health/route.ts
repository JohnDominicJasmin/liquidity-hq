import { NextResponse } from 'next/server';
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

    // Three consecutive failures is the "this is not a blip" line - a single
    // timeout on a flaky feed should not read the same as a retired endpoint.
    // Staleness outranks the last outcome: a source whose last write was a
    // success but which stopped being reported half an hour ago is not
    // healthy, it is unmonitored.
    const status: 'ok' | 'warn' | 'down' =
      stale                        ? 'warn'
      : r.consecutive_failures >= 3 ? 'down'
      : !r.ok                       ? 'warn'
      : rate != null && rate < 80   ? 'warn'
      :                               'ok';

    return {
      source: r.source,
      category: r.category,
      status,
      ok: r.ok,
      detail: stale ? `no report in ${Math.round((now - new Date(r.updated_at).getTime()) / 60000)}m` : r.detail,
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
  const rank = { down: 0, warn: 1, ok: 2 } as const;
  sources.sort((a, b) => rank[a.status] - rank[b.status] || a.source.localeCompare(b.source));

  return NextResponse.json({
    sources,
    summary: {
      total: sources.length,
      down: sources.filter(s => s.status === 'down').length,
      warn: sources.filter(s => s.status === 'warn').length,
      ok: sources.filter(s => s.status === 'ok').length,
    },
    generatedAt: new Date(now).toISOString(),
  });
});
