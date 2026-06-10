import { NextResponse } from 'next/server';
import { getRecentFires } from '@/lib/alertHistory';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ fires: getRecentFires() });
}
