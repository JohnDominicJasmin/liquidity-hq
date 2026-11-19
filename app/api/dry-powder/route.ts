import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { getDryPowderNumbers } from '@/lib/dryPowderSeries';
import { readDryPowderAnalysis } from '@/lib/dryPowderAnalysis';
import { hasProFeatures } from '@/lib/entitlements';
import { getUserCompatForBilledCall } from '@/lib/authUser';

/* THE AI TEXT IS READ, NOT WRITTEN, HERE (PM, 2026-11-19, #1651 L103). The server writes it once a day (lib/dryPowderAnalysis.ts, from the scheduled market ingest), so a Pro visit reads a stored row
 * in about a second and spends nothing: the card used to say "Preparing the AI read" for about 21 s because the first visit of the hour paid for the AI call. The per-visitor usage reservation and refund
 * that went with that call are gone with it. When no text is stored yet (the first deploy, or the day's write has not happened) the answer is 202 `{ pending: true }`: THIS ROUTE NEVER CALLS xAI, only the scheduled ingest does (PM audit); the card
 * keeps its short loading state and asks once more, and the figures (?part=numbers) never wait for it. */
export async function GET(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: authData } = await getUserCompatForBilledCall(token);
  if (!authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Pro-only. /upgrade sells the one-shot AI tools as a Pro feature (UPGRADE_PRO_FEATURE_TOOL_POOL); this route is one of them. Trial users pass - hasProFeatures covers isTrial.
  if (!(await hasProFeatures(token, authData.user.id))) {
    return NextResponse.json({ error: 'PRO_REQUIRED', message: 'Dry Powder analysis is a Pro feature.' }, { status: 403 });
  }

  try {
    /* ?part=numbers: the supply figures alone, no AI, so the card shows data in about a second (and instantly once the day's series is cached). */
    if (req.nextUrl.searchParams.get('part') === 'numbers') {
      return NextResponse.json(await getDryPowderNumbers());
    }
    const stored = await readDryPowderAnalysis();
    if (!stored) {
      return NextResponse.json({ pending: true }, { status: 202 });
    }
    const { current, prev30, prev90, series } = await getDryPowderNumbers();
    return NextResponse.json({ current, prev30, prev90, series, analysis: stored.analysis });
  } catch (e) {
    return apiError('dry-powder', e, 502, 'Request failed');
  }
}
