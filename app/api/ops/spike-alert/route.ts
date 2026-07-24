import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { checkCronAuth } from '@/lib/cronAuth';
import { sendSpikeAlertEmail } from '@/lib/email';

// Cron-only: emails the owner (fixed recipient list, see lib/email.ts's
// SPIKE_ALERT_RECIPIENTS) once today's xAI usage crosses 80% of
// AI_GLOBAL_DAILY_MAX. Same 0.8 threshold and lhq_global_ai_usage source as
// /ops's own spikeAlert flag (app/api/ops/ai-cost/route.ts) - one definition
// of "spike", not two; /ops itself also surfaces this as a dashboard banner
// (app/ops/page.tsx's SpikeBanner) so the same trip is visible in-app, not
// just by email. spike_alerted on the day's row is the dedup: without it
// this would re-fire every tick once tripped, since the counter only resets
// at midnight. Was Telegram - switched to email, owner doesn't want
// Telegram for this. See pendings/SECURITY_AUDIT.md.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!checkCronAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rawMax  = Number(process.env.AI_GLOBAL_DAILY_MAX);
  const capCalls = Number.isFinite(rawMax) && rawMax > 0 ? rawMax : null;
  if (capCalls == null) return NextResponse.json({ ok: true, note: 'Global cap disabled - nothing to watch' });

  try {
    const admin = getSupabaseAdmin();
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await admin
      .from(T.global_ai_usage)
      .select('xai_call_count, spike_alerted')
      .eq('date', today)
      .maybeSingle();

    const todayCalls     = (data?.xai_call_count as number | undefined) ?? 0;
    const alreadyAlerted = (data?.spike_alerted as boolean | undefined) ?? false;
    const spikeAlert     = todayCalls >= capCalls * 0.8;

    if (!spikeAlert || alreadyAlerted) {
      return NextResponse.json({ ok: true, todayCalls, capCalls, spikeAlert, alreadyAlerted });
    }

    const pct = Math.round((todayCalls / capCalls) * 100);
    const emailed = await sendSpikeAlertEmail({ todayCalls, capCalls, pct });

    // Best-effort dedup flag - if this update fails, worst case is one extra
    // email next tick, never a missed one.
    await admin.from(T.global_ai_usage).update({ spike_alerted: true }).eq('date', today);

    return NextResponse.json({ ok: true, alerted: true, emailed, todayCalls, capCalls, pct });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
