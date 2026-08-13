import { NextResponse } from 'next/server';
import { configuredFlags } from '@/lib/configured';

export const dynamic = 'force-dynamic';

/*
 * What build is this host actually serving?
 *
 * Two things needed this and neither could answer it:
 *
 *   1. "Merging to main is not the deploy." Every service is autoDeploy: no, so
 *      main can move and production keeps serving the old build indefinitely.
 *      Nothing detected that. `.github/workflows/release-signals.yml` compares
 *      this against origin/main and raises an issue when they diverge.
 *   2. QA repeatedly needed to know which build a host was serving, and the
 *      only answer was the Render dashboard - which QA reads far less often
 *      than the site itself.
 *
 * RENDER_GIT_COMMIT and RENDER_GIT_BRANCH are injected by Render at build time.
 * Locally they are absent, so this reports 'unknown' rather than pretending.
 *
 * PUBLIC ON PURPOSE, and only this much. A short commit SHA and a branch name
 * are not credentials and reveal nothing without access to a private repo -
 * they are the minimum a drift check can run on without handing CI a Render API
 * token.
 *
 * ── THIS COMMENT USED TO FORBID THE `configured` BLOCK BELOW ────────────────
 *
 * It read: "Nothing environment-shaped goes in here: no variable names, no
 * versions, no dependency list. If that ever needs to grow, gate it behind
 * checkCronAuth rather than widening what is open." Owner-approved reversal on
 * 2026-08-11 (#282), recorded rather than quietly deleted.
 *
 * What changed the answer: `staging` was created missing most of its
 * integrations, that reduced what QA could verify before a release, and
 * NOBODY NOTICED FOR ELEVEN DAYS. Silence was the defect. A dashboard answers
 * this only for someone with access; a bundle grep answers it unreliably (it is
 * sound for a positive and weak for a negative - a tighter pattern reported
 * production as having no Sentry until a looser one disproved it); a table in a
 * doc goes stale. An endpoint the environment computes about itself cannot.
 *
 * WHAT KEEPS IT SAFE IS THE SHAPE, NOT THE GATE. Booleans only - never a value,
 * a prefix, a length or a variable name that is not already public. "Is a key
 * set" is what an operator already reads off a dashboard, and every
 * NEXT_PUBLIC_* answer is in the client bundle by definition.
 *
 * The one real exposure is that production tells an unauthenticated caller
 * which protections are absent. It is small: `cronSecret: false` means those
 * routes reject EVERYTHING (lib/cronAuth.ts fails closed), so a false is not an
 * open door, and the rest are capability flags inferable by probing anyway. If
 * that trade ever stops looking right, gate this block - not the whole route,
 * which the drift check needs unauthenticated.
 *
 * EACH FLAG IS DERIVED FROM THE SAME READ THE APP GATES ON, not a parallel list.
 * A boolean computed differently from the thing it describes is worse than no
 * boolean - it would report health while the feature was broken.
 */
export async function GET() {
  const commit = process.env.RENDER_GIT_COMMIT ?? '';
  return NextResponse.json(
    {
      commit: commit ? commit.slice(0, 7) : 'unknown',
      branch: process.env.RENDER_GIT_BRANCH ?? 'unknown',
      // Which table set this host is reading - the switch that has silently
      // pointed a test environment at production data before now.
      appEnv: process.env.NEXT_PUBLIC_APP_ENV ?? 'unset',

      /* Which integrations this HOST actually has (#282). Booleans only - see
         lib/configured.ts for why each flag is derived the way it is. */
      configured: configuredFlags(process.env as Record<string, string | undefined>),
    },
    // Must never be cached: a stale answer here would report the previous
    // build as current, which is precisely the failure it exists to catch.
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
