import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { checkCronAuth } from '@/lib/cronAuth';

// Cron-only: Telegrams the app owner (TELEGRAM_CHAT_ID, the legacy single-
// recipient env var - never the per-user recipients list) once today's xAI
// usage crosses 80% of AI_GLOBAL_DAILY_MAX. Same 0.8 threshold and
// lhq_global_ai_usage source as /ops's own spikeAlert flag (app/api/ops/ai-
// cost/route.ts) - one definition of "spike", not two. spike_alerted on the
// day's row is the dedup: without it this would re-fire every tick once
// tripped, since the counter only resets at midnight. See
// pendings/SECURITY_AUDIT.md - this was the one remaining open item there.
export const dynamic = 'force-dynamic';

async function tg(token: string, chatId: string, text: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch { /* best-effort - a failed send here shouldn't fail the cron tick */ }
}

export async function GET(req: NextRequest) {
  if (!checkCronAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return NextResponse.json({ ok: true, note: 'Telegram not configured' });

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
    await tg(token, chatId,
      `⚠️ <b>AI Usage Spike Warning</b>\n\n` +
      `Today's xAI calls: <b>${todayCalls}</b> / ${capCalls} (${pct}%)\n` +
      `Getting close to the daily cap - check /ops for the breakdown.`
    );

    // Best-effort dedup flag - if this update fails, worst case is one extra
    // Telegram message next tick, never a missed one.
    await admin.from(T.global_ai_usage).update({ spike_alerted: true }).eq('date', today);

    return NextResponse.json({ ok: true, alerted: true, todayCalls, capCalls, pct });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
