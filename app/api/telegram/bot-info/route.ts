import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: false, username: null, first_name: null });

  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { cache: 'no-store' });
  const data = await res.json() as {
    ok: boolean;
    result?: { username?: string; first_name?: string };
  };

  return NextResponse.json({
    ok: data.ok,
    username: data.result?.username ?? null,
    first_name: data.result?.first_name ?? null,
  });
}
