import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { isFeatureEnabled } from '@/lib/featureFlags';

export const dynamic = 'force-dynamic';

// This route has no auth gate - the app itself calls it unauthenticated for
// dashboard-triggered alerts (CVD divergence, liquidation cascades, Arena
// liquidity-raid alerts), and TELEGRAM_CHAT_ID is a single global destination
// (the owner's own chat), not per-user. Rate limit + length cap bound spam
// volume, but neither stops arbitrary HTML: the message is sent with
// parse_mode:HTML, and one caller (the Arena raid alert) embeds short
// AI-generated fields, which could in principle reproduce injected markup
// from prompt/search-influenced content. sanitizeTelegramHtml() closes that
// off at the one place all three callers funnel through, regardless of
// whether every call site remembers to escape its own inputs: every `<`/`>`
// is escaped, then only the exact tags the app's own templates actually use
// (<b> <i>) are unescaped back. Anything else - <a href>, onmouseover
// attributes, whatever - stays inert text.
const MAX_MESSAGE_LEN = 1000;
const ALLOWED_TAGS = ['b', '/b', 'i', '/i'];

function sanitizeTelegramHtml(raw: string): string {
  const escaped = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(/&lt;(\/?\w+)&gt;/g, (whole, tag) =>
    ALLOWED_TAGS.includes(tag) ? `<${tag}>` : whole);
}

export async function POST(req: NextRequest) {
  if (!rateLimit(`telegram-send:${getClientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return NextResponse.json(
      { error: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set in environment' },
      { status: 503 },
    );
  }
  if (!(await isFeatureEnabled('telegram'))) {
    return NextResponse.json({ error: 'Telegram alerts are temporarily unavailable.', code: 'FEATURE_DISABLED' }, { status: 503 });
  }

  let body: { message: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.message?.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }
  if (body.message.length > MAX_MESSAGE_LEN) {
    return NextResponse.json({ error: 'message too long' }, { status: 400 });
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: sanitizeTelegramHtml(body.message),
      parse_mode: 'HTML',
    }),
  });

  const data = await res.json();
  if (!data.ok) {
    return NextResponse.json({ error: data.description }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
