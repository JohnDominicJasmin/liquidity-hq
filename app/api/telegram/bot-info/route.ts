import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: false, username: null, first_name: null });

  const [meRes, webhookRes] = await Promise.all([
    fetch(`https://api.telegram.org/bot${token}/getMe`, { cache: 'no-store' }),
    fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, { cache: 'no-store' }),
  ]);

  const me = await meRes.json() as { ok: boolean; result?: { username?: string; first_name?: string } };
  const webhookInfo = await webhookRes.json() as { ok: boolean; result?: { url?: string } };

  // Auto-register webhook on production if not set or pointing to wrong URL
  const host = req.headers.get('host') ?? '';
  const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
  if (!isLocal) {
    const expectedUrl = `https://${host}/api/telegram/webhook`;
    const currentUrl  = webhookInfo.result?.url ?? '';
    if (currentUrl !== expectedUrl) {
      // Fire-and-forget — don't block the response
      fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: expectedUrl }),
      }).catch(() => {});
    }
  }

  return NextResponse.json({
    ok: me.ok,
    username: me.result?.username ?? null,
    first_name: me.result?.first_name ?? null,
  });
}
