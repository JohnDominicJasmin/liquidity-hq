import type { Page, Route, Request as PWRequest } from '@playwright/test';
import { BILLED_CALLS_READY } from './_auth';

/* A FENCE ROUND EVERY PAID AI ROUTE: any request a spec did not stub is aborted and recorded, never passed through.
 *
 * ── THE FAILURE THIS EXISTS FOR, which is invisible without it ──────────────────────────────────────────────────
 *
 * Specs stub the AI routes by glob - `page.route('**-/api/grok', ...)` in ten files today. The glob names the CURRENT path. When
 * `/api/grok` is renamed (#1632: the route path itself publishes the vendor's name, and it is the most visible exit of the six), every
 * one of those globs stops matching. Playwright then does what it does with an unrouted request: it lets it through. The client calls
 * the new path, the real route answers, xAI bills for it, and THE SPEC STILL PASSES - because a stub that never fires is
 * indistinguishable from a stub that was not needed. The evidence arrives days later as an invoice with nothing in any test output to
 * explain it.
 *
 * So the dangerous moment is not the rename. It is the first CI run after the rename, where green means "we paid for this".
 *
 * ── WHY A FENCE AND NOT A GLOB FIX ──────────────────────────────────────────────────────────────────────────────
 *
 * Updating ten globs fixes ten specs against one rename. This fails CLOSED for every paid route, every spec, and every future rename:
 * the fence matches the ROUTE FAMILY rather than one path, so a request to a path nobody has written yet is still refused.
 *
 * ── ORDER MATTERS, AND GETTING IT WRONG SILENTLY DISABLES EVERY STUB ────────────────────────────────────────────
 *
 * Playwright matches the MOST RECENTLY registered handler first. So this must be installed BEFORE a spec registers its own stubs -
 * then the spec's handler wins for the path it stubs, and the fence only sees what nothing else claimed. Install it last and it
 * swallows every stubbed call instead, which looks like the suite working and tests nothing at all.
 *
 * ── WHAT IT ASSERTS, AND WHY ABORTING IS NOT ENOUGH ON ITS OWN ──────────────────────────────────────────────────
 *
 * An aborted request usually leaves the product in an honest error state, and a spec that only checks "the panel is not empty" can
 * still pass. So the abort is recorded, and `assertNoUnstubbedPaidAi(page)` turns the recording into a failure with the path and the
 * spec's own name in the message. Call it in `afterEach` (or at the end of a spec) - an unasserted fence is a fence with a gate.
 *
 * PAID PATHS COME FROM THE ROUTES THAT CALL xAI, enumerated from `app/api/**-/route.ts` for `xaiFetch`/`api.x.ai` on 2026-10-23:
 * grok, grok-chat, briefing, macro-context, dry-powder, onchain, smc-snapshot, strategy-research, thesis-check, token-unlock,
 * pine-script, shadow-account, behavioral-bias, hypotheses/[id]/analyze. Three of those spend on a GET, which is why the fence does
 * not filter by method. */

/** Every path segment under `/api/` whose route calls xAI. Dev owns this list; QA owns the mechanism. */
export const PAID_AI_SEGMENTS = [
  'grok', 'grok-chat', 'briefing', 'macro-context', 'dry-powder', 'onchain',
  'smc-snapshot', 'strategy-research', 'thesis-check', 'token-unlock',
  'pine-script', 'shadow-account', 'behavioral-bias', 'hypotheses',
] as const;

/* Matched on the URL rather than built from the list, so a RENAMED path is still caught: anything under /api/ whose first segment
   starts with one of these, plus the vendor-named family in any spelling it might be renamed into (`ai`, `assistant`, `llm`). The
   point is to fail closed on a path nobody has written yet, not to enumerate today's. */
const PAID = new RegExp(
  `/api/(?:${PAID_AI_SEGMENTS.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}`
  + `|ai|ai-chat|assistant|llm|research|analysis)(?:[/?#]|$)`,
  'i',
);

const violations = new WeakMap<Page, string[]>();

/** Install before any spec-specific `page.route`. Returns the array it records into, for a spec that wants to inspect it directly. */
export async function installPaidAiFence(page: Page): Promise<string[]> {
  /* IDEMPOTENT ON THE RECORD, not on the handler. Installing twice registers a second handler, which is harmless - both abort - but
     a fresh `seen` array would DISCARD what the first one recorded, so a spec that installs the fence before each of its stubs would
     lose the earlier violations and `assertNoUnstubbedPaidAi` would pass on a run that had already escaped. The record is per page
     and survives re-installation. */
  const seen: string[] = violations.get(page) ?? [];
  violations.set(page, seen);

  /* THE POSITIVE DECLARATION IS THE ONE THAT ALREADY EXISTS, reused rather than reinvented: `_auth.ts`'s
     `E2E_ALLOW_BILLED_CALLS=1`. The deliberately-billed specs are already gated on it and already explain themselves in
     `BILLED_CALLS_SKIP_REASON`, so a second opt-in flag would mean two mechanisms disagreeing about whether a call is allowed.
     A spec that says nothing gets the fence; a run that has declared it wants to pay does not. */
  if (BILLED_CALLS_READY) return seen;

  await page.route((url) => PAID.test(url.pathname + url.search), async (route: Route, request: PWRequest) => {
    const where = `${request.method()} ${new URL(request.url()).pathname}`;
    seen.push(where);
    /* `blockedbyclient` rather than `failed`: the app's own error handling reads a network failure, which is the honest shape here,
       and the reason string shows up in a trace so the abort is findable without this file. */
    await route.abort('blockedbyclient');
  });

  return seen;
}

/** Fails the test if any paid AI route was reached without a stub. Call in afterEach. */
export function assertNoUnstubbedPaidAi(page: Page, context?: string): void {
  const seen = violations.get(page) ?? [];
  if (seen.length === 0) return;
  const list = [...new Set(seen)].join(', ');
  throw new Error(
    `UNSTUBBED PAID AI CALL${seen.length > 1 ? 'S' : ''}${context ? ` in ${context}` : ''}: ${list}. `
    + 'The fence aborted it, so nothing was billed - but a spec reached a route that costs money, which means its own stub no longer '
    + 'matches the path the client calls. Fix the stub rather than removing the fence: without it this request would have been passed '
    + 'through to the real route and the spec would still have passed.',
  );
}

/** For a spec that legitimately expects the fence to fire (a negative test). Clears the record so afterEach does not fail. */
export function takeUnstubbedPaidAi(page: Page): string[] {
  const seen = violations.get(page) ?? [];
  const copy = [...seen];
  seen.length = 0;
  return copy;
}
