import { NextResponse } from 'next/server';

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
 * token. Nothing environment-shaped goes in here: no variable names, no
 * versions, no dependency list. If that ever needs to grow, gate it behind
 * checkCronAuth rather than widening what is open.
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
    },
    // Must never be cached: a stale answer here would report the previous
    // build as current, which is precisely the failure it exists to catch.
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
