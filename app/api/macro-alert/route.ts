import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { checkCronAuth } from '@/lib/cronAuth';
import { isFeatureEnabled } from '@/lib/featureFlags';

export const dynamic = 'force-dynamic';

// Impact emoji map
const IMPACT_EMOJI: Record<string, string> = {
  FOMC:   '🏦',
  NFP:    '👷',
  CPI:    '📊',
  PPI:    '🏭',
  PCE:    '💳',
  GDP:    '📈',
  RETAIL: '🛒',
  FED:    '🎙',
  MACRO:  '🌐',
};

// Module-level dedup cache: key → sent timestamp
// Survives within a single server process lifetime - acceptable for cron use.
const SENT: Map<string, number> = new Map();
const SENT_TTL = 4 * 60 * 60 * 1000; // 4h - prune old entries

function dedupKey(type: string, isoDate: string): string {
  return `${type}_${isoDate}`;
}

function alreadySent(key: string): boolean {
  const ts = SENT.get(key);
  if (!ts) return false;
  if (Date.now() - ts > SENT_TTL) { SENT.delete(key); return false; }
  return true;
}

function markSent(key: string) {
  SENT.set(key, Date.now());
}

// UTC, not Manila. These alerts go out to every subscriber (see the Recipient
// list in app/api/telegram/alert/route.ts), so a Philippine wall-clock stamp
// was simply someone else's time for most of them. There is no per-user
// timezone stored anywhere yet; UTC is the one label that is correct for
// everybody rather than for exactly one country.
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: 'UTC',
    hour: '2-digit', minute: '2-digit',
  }) + ' UTC';
}

type CalEvent = {
  name: string; type: string; isoDate: string; impact: string;
  previous?: string; estimate?: string; actual?: string;
};

async function fetchUpcomingEvents(): Promise<CalEvent[]> {
  try {
    /* This app is hosted on Render, so VERCEL_URL used to sit here and never
       resolved. Worse than dead: Vercel sets it as a bare hostname with no
       scheme, so had it ever been present the template below would have built
       `myapp.vercel.app/api/econ-calendar` and thrown on fetch. */
    const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const url = `${base}/api/econ-calendar`;
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const data = await res.json() as { events?: CalEvent[] };
    return data.events ?? [];
  } catch { return []; }
}

async function sendTelegram(token: string, chatId: string, text: string): Promise<boolean> {
  // Same send-only kill switch as app/api/telegram/alert/route.ts's tg() -
  // this cron has its own independent send helper (not shared code), so it
  // needs its own check to stay covered by the same /ops/config switch.
  if (!(await isFeatureEnabled('telegram'))) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
      signal: AbortSignal.timeout(8_000),
    });
    return (await res.json()).ok === true;
  } catch { return false; }
}

export async function GET(req: Request) {
  if (!checkCronAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 503 });

  // Telegram alerts are Pro-only - resolve entitled users (paid Pro OR active
  // trial, matching lib/entitlements.ts) before collecting recipients (same
  // gate as app/api/telegram/alert/route.ts - see that file's comment for why
  // role === 'pro' alone silently drops trial users for the whole 14 days).
  const proUserIds = new Set<string>();
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin.from(T.user_subscriptions).select('user_id, role, trial_ends_at');
    const now = Date.now();
    for (const row of data ?? []) {
      const isPro   = row.role === 'pro';
      const isTrial = row.role !== 'pro' && !!row.trial_ends_at && new Date(row.trial_ends_at as string).getTime() > now;
      if (isPro || isTrial) proUserIds.add(row.user_id as string);
    }
  } catch { /* admin not configured - chatIds falls back to the env var below */ }

  // Collect Pro users' Telegram chat IDs
  const chatIds: string[] = [];
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from(T.user_settings)
      .select('user_id, telegram_chat_id')
      .not('telegram_chat_id', 'is', null)
      .neq('telegram_chat_id', '');
    for (const row of data ?? []) {
      if (!proUserIds.has(row.user_id as string)) continue;
      const id = (row.telegram_chat_id as string)?.trim();
      if (id && !chatIds.includes(id)) chatIds.push(id);
    }
  } catch { /* admin not configured */ }

  const envId = process.env.TELEGRAM_CHAT_ID;
  if (envId && !chatIds.includes(envId)) chatIds.push(envId);

  if (chatIds.length === 0) {
    return NextResponse.json({ skipped: true, reason: 'No Telegram recipients' });
  }

  // Fetch upcoming events
  const events = await fetchUpcomingEvents();
  const now = Date.now();
  const fired: string[] = [];

  for (const event of events) {
    const eventMs = new Date(event.isoDate).getTime();
    const minsAway = (eventMs - now) / 60_000;

    // Only alert for events 55-85 min away (one 30-min cron window)
    if (minsAway < 55 || minsAway > 85) continue;

    const key = dedupKey(event.type, event.isoDate);
    if (alreadySent(key)) continue;

    const emoji = IMPACT_EMOJI[event.type] ?? '📌';
    const minsStr = Math.round(minsAway);

    let msg = `${emoji} <b>Macro Event in ~${minsStr} min</b>\n\n`;
    msg += `<b>${event.name}</b>\n`;
    msg += `🕐 ${fmtTime(event.isoDate)}\n`;
    if (event.estimate) msg += `Estimate: <b>${event.estimate}</b>`;
    if (event.previous) msg += `  |  Prev: ${event.previous}`;
    if (event.estimate || event.previous) msg += '\n';
    msg += `\n⚠️ <i>High-impact event - watch for volatility</i>`;

    let anyOk = false;
    for (const chatId of chatIds) {
      const ok = await sendTelegram(token, chatId, msg);
      if (ok) anyOk = true;
    }

    if (anyOk) {
      markSent(key);
      fired.push(event.name);
    }
  }

  return NextResponse.json({ ok: true, fired, checked: events.length });
}
