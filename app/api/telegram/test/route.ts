import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return NextResponse.json({ configured: false, error: 'Missing env vars' });
  }

  const now = new Date().toLocaleString('en-PH', {
    timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit',
    day: 'numeric', month: 'short',
  });

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      parse_mode: 'HTML',
      text:
        `✅ <b>LiquidityHQ is connected!</b>\n\n` +
        `Your Telegram alerts are working. You'll receive push alerts for:\n` +
        `• Funding rate extremes (longs overcrowded / short squeeze setups)\n` +
        `• More conditions coming soon\n\n` +
        `<i>⏰ ${now} PHT</i>`,
    }),
  });

  const data = await res.json();
  if (!data.ok) {
    return NextResponse.json({ configured: true, ok: false, error: data.description });
  }
  return NextResponse.json({ configured: true, ok: true });
}
