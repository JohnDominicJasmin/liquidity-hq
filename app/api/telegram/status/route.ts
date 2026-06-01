import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const configured = !!(
    process.env.TELEGRAM_BOT_TOKEN &&
    process.env.TELEGRAM_CHAT_ID
  );
  return NextResponse.json({ configured });
}
