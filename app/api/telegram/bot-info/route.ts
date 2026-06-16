import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: false, username: null, first_name: null, webhook_ok: false });

  const [meRes, webhookRes] = await Promise.all([
    fetch(`https://api.telegram.org/bot${token}/getMe`, { cache: 'no-store', signal: AbortSignal.timeout(7_000) }),
    fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, { cache: 'no-store', signal: AbortSignal.timeout(7_000) }),
  ]);

  const me          = await meRes.json() as { ok: boolean; result?: { username?: string; first_name?: string } };
  const webhookInfo = await webhookRes.json() as { ok: boolean; result?: { url?: string } };

  const host    = req.headers.get('host') ?? '';
  const isLocal = host.includes('localhost') || host.includes('127.0.0.1');

  let webhookOk = true; // assume OK unless we needed to register and it failed

  if (!isLocal) {
    const expectedUrl = `https://${host}/api/telegram/webhook`;
    const currentUrl  = webhookInfo.result?.url ?? '';

    if (currentUrl !== expectedUrl) {
      // Await registration — surface failure to the UI instead of silent drop
      try {
        const setRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: expectedUrl }),
          signal: AbortSignal.timeout(5_000),
        });
        const setData = await setRes.json() as { ok: boolean };
        webhookOk = setData.ok;
      } catch {
        webhookOk = false;
      }
    }
  }

  return NextResponse.json({
    ok: me.ok,
    username:    me.result?.username    ?? null,
    first_name:  me.result?.first_name  ?? null,
    webhook_ok:  webhookOk,
  });
}
