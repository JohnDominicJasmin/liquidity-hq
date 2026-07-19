import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

export const dynamic = 'force-dynamic';

const H = 3_600_000;

// Cron / infra health. IMPORTANT honesty note: no table is a true "the cron ran"
// heartbeat - alert_fires / live_signals only get rows when something actually
// fires, so a quiet market legitimately produces no rows. Those two are therefore
// LAST-ACTIVITY proxies (labeled as such in the UI). The resolver is the one real
// health signal: if the hourly outcome-resolver stalls, rows that are >24h old
// pile up unresolved - a growing overdue count is an unambiguous red flag.
export const GET = withAdmin(async () => {
  const admin = getSupabaseAdmin();
  const now = Date.now();

  const [af, ls, openLs, overdue24] = await Promise.all([
    admin.from(T.alert_fires).select('fired_at').order('fired_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from(T.live_signals).select('signal_time').order('signal_time', { ascending: false }).limit(1).maybeSingle(),
    admin.from(T.live_signals).select('*', { count: 'exact', head: true }).eq('outcome', 'open'),
    admin.from(T.alert_fires).select('*', { count: 'exact', head: true })
      .lt('fired_at', new Date(now - 25 * H).toISOString())
      .eq('resolved_24h', false),
  ]);

  const ageMs = (iso: string | null | undefined) => (iso ? now - new Date(iso).getTime() : Infinity);
  const proxyStatus = (iso: string | null | undefined) => {
    const ms = ageMs(iso);
    return ms < 12 * H ? 'ok' : ms < 72 * H ? 'warn' : 'bad';
  };

  const overdueCount = overdue24.count ?? 0;

  const crons = [
    {
      key: 'alert_scan',
      name: 'Alert scanner',
      route: '/api/telegram/alert',
      cadence: 'every 5m',
      kind: 'proxy' as const,
      lastActivity: af.data?.fired_at ?? null,
      status: proxyStatus(af.data?.fired_at),
      detail: 'last alert fired',
    },
    {
      key: 'signal_track',
      name: 'Signal tracker',
      route: '/api/signals/track',
      cadence: 'every 15m',
      kind: 'proxy' as const,
      lastActivity: ls.data?.signal_time ?? null,
      status: proxyStatus(ls.data?.signal_time),
      detail: `last signal logged · ${openLs.count ?? 0} open`,
    },
    {
      key: 'resolver',
      name: 'Outcome resolver',
      route: '/api/alert-outcomes/resolve',
      cadence: 'hourly',
      kind: 'health' as const,
      overdue24: overdueCount,
      status: overdueCount === 0 ? 'ok' : overdueCount <= 5 ? 'warn' : 'bad',
      detail: overdueCount === 0 ? 'no overdue outcomes' : `${overdueCount} overdue >24h`,
    },
  ];

  return NextResponse.json({ crons, generatedAt: new Date(now).toISOString() });
});
