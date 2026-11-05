import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-auth';
import OPS_LABEL_DEFAULTS from '@/lib/labelDefaults.ops.en.json' with { type: 'json' };

export const dynamic = 'force-dynamic';

/* GET /api/ops/labels - the admin console's copy, for admins only (#1632 item 15).
 *
 * These strings name the AI model, spell out the margin formula and describe the spend caps, so
 * they are not public. They used to be: lib/labelDefaults.en.json carried all of them, and
 * LabelsProvider bundles that file into every visitor's JS. They now live in
 * lib/labelDefaults.ops.en.json, which only server code imports - this route and the /ops layout,
 * which sends the sign-in and gate strings as props and nothing else.
 *
 * WHY A SEPARATE ROUTE, not an admin branch on /api/labels: that route is edge-cached on a URL that
 * carries no identity, so an admin payload there would be served to the next anonymous caller. It
 * filters `OPS_*` unconditionally and must keep doing so. This route is private and never cached.
 *
 * Shipped defaults only, the same as /ops has shown since 2026-10-23: an `OPS_*` row edited in the
 * database does not reach the console until this file is changed and deployed. */
export const GET = withAdmin(async () =>
  NextResponse.json(OPS_LABEL_DEFAULTS, { headers: { 'Cache-Control': 'private, no-store' } }));
