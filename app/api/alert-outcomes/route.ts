import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

export const dynamic = 'force-dynamic';

/* The alert track record, read on the server. Only rows whose 24 h outcome is resolved are returned: a row is resolved 24 h after it fired, so none is fresher than that, and the panel only ever
   counted resolved rows. Newest 500, the same window the panel always read. Public: a stat, no user data. */
export async function GET() {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from(T.alert_fires)
      .select('rule_key, coin, dir, label, fired_at, outcome_pct_24h, resolved_24h, outcome_pct_48h, resolved_48h')
      .eq('resolved_24h', true)
      .order('fired_at', { ascending: false })
      .limit(500);
    if (error) return NextResponse.json({ error: 'unavailable' }, { status: 502 });
    return NextResponse.json({ rows: data ?? [] }, { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' } });
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 502 });
  }
}
