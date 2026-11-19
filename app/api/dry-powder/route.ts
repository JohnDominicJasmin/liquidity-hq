import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { getDryPowderNumbers } from '@/lib/dryPowderSeries';
import { readDryPowderAnalysis, readLatestDryPowderAnalysis } from '@/lib/dryPowderAnalysis';
import { hasProFeatures } from '@/lib/entitlements';
import { getUserCompatForBilledCall } from '@/lib/authUser';

/* THE AI TEXT IS READ, NOT WRITTEN, HERE (PM, 2026-11-19, #1651 L103). The server writes it once a day (lib/dryPowderAnalysis.ts, from the scheduled market ingest), so a Pro visit reads a stored row
 * in about a second and spends nothing: the card used to say "Preparing the AI read" for about 21 s because the first visit of the hour paid for the AI call. The per-visitor usage reservation and refund
 * that went with that call are gone with it. When no text is stored yet (the first deploy, or the day's write has not happened) the answer is 202 `{ pending: true }`: THIS ROUTE NEVER CALLS xAI, only the scheduled ingest does (PM audit); the card
 * keeps its short loading state and asks once more, and the figures (?part=numbers) never wait for it. */
/* SERVER-TIMING (QA L103, #1651: "each answer takes 1.1-5.5 s although the numbers row is stored"): every answer carries `Server-Timing: auth;dur=, plan;dur=, read;dur=, total;dur=` (milliseconds): the token check, the plan check, the stored reads (everything after the plan check) and the whole handler, so the slow step is measured, not guessed. Same-origin, no data in it beyond four durations. */
export async function GET(req: NextRequest) {
  const t0 = performance.now();
  const marks: { auth?: number; plan?: number } = {};
  const res = await handle(req, marks, t0);
  const total = performance.now() - t0, auth = marks.auth ?? total, plan = marks.plan ?? auth;
  const f = (n: number) => Math.round(n * 10) / 10;
  res.headers.set('Server-Timing', `auth;dur=${f(auth)}, plan;dur=${f(plan - auth)}, read;dur=${f(Math.max(0, total - plan))}, total;dur=${f(total)}`);
  return res;
}

async function handle(req: NextRequest, marks: { auth?: number; plan?: number }, t0: number): Promise<NextResponse> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: authData } = await getUserCompatForBilledCall(token);
  marks.auth = performance.now() - t0;
  if (!authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Pro-only. /upgrade sells the one-shot AI tools as a Pro feature (UPGRADE_PRO_FEATURE_TOOL_POOL); this route is one of them. Trial users pass - hasProFeatures covers isTrial.
  const pro = await hasProFeatures(token, authData.user.id);
  marks.plan = performance.now() - t0;
  if (!pro) {
    return NextResponse.json({ error: 'PRO_REQUIRED', message: 'Dry Powder analysis is a Pro feature.' }, { status: 403 });
  }

  try {
    /* ?part=numbers: the supply figures alone, no AI, so the card shows data in about a second (and instantly once the day's series is cached). */
    if (req.nextUrl.searchParams.get('part') === 'numbers') {
      return NextResponse.json(await getDryPowderNumbers());
    }
    const stored = await readDryPowderAnalysis();
    /* Today's text is not written yet (or the day's write is late): the most recent stored text, with the day it was written, so the card shows it dated instead of a gap. Only when nothing was ever stored is the answer "pending". */
    const latest = stored ?? await readLatestDryPowderAnalysis();
    if (!latest) {
      return NextResponse.json({ pending: true }, { status: 202 });
    }
    const { current, prev30, prev90, series } = await getDryPowderNumbers();
    const today = new Date().toISOString().slice(0, 10);
    return NextResponse.json({ current, prev30, prev90, series, analysis: latest.analysis, ...(latest.day !== today ? { from: latest.day } : {}) });
  } catch (e) {
    return apiError('dry-powder', e, 502, 'Request failed');
  }
}
