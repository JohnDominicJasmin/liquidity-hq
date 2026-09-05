import { NextResponse } from 'next/server';
import { withOwner } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { diffLabels, summarise } from '@/lib/labelOverrides';
import defaults from '@/lib/labelDefaults.en.json';

export const dynamic = 'force-dynamic';

/* GET /api/ops/label-overrides — which label keys the database is overriding.
 *
 * #675: a row in `lhq_labels` silently wins over the shipped default, so a
 * label fix can be merged, deployed and verified on staging and still not
 * appear in production. Nothing in the build, the deploy or /api/version
 * reveals it. This is the read that makes it visible.
 *
 * READ ONLY, deliberately. Fixing an override means changing a row, and writes
 * to the shared database go to the owner — see CLAUDE.md. This endpoint tells
 * you which row and what it should say; a human runs the UPDATE.
 *
 * ENGLISH ONLY. `labelDefaults.en.json` is the shipped default set; a
 * translated row is not an override of anything, it is a translation. Comparing
 * `es` rows against English defaults would report the entire Spanish catalogue
 * as overridden, which is the loudest possible way to say nothing.
 */
export const GET = withOwner(async () => {
  const admin = getSupabaseAdmin();

  /* Paged for the same reason /api/labels is: PostgREST clamps to a
     server-side db-max-rows cap (1000 here) that a client .range() cannot
     raise, and this catalogue crossed that during the i18n migration. A single
     unpaged request would silently return the first 1000 rows and every key
     past them would read as `defaultOnly` — a wrong answer that looks like a
     healthy one. */
  const PAGE_SIZE = 1000;
  const rows: { key: string; value: string }[] = [];
  for (let page = 0; ; page++) {
    const from = page * PAGE_SIZE;
    const { data: batch, error } = await admin
      .from(T.labels)
      .select('key, value')
      .eq('locale', 'en')
      .range(from, from + PAGE_SIZE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!batch || batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  const all = diffLabels(rows, defaults as Record<string, string>);
  const counts = summarise(all);

  /* `defaultOnly` is the normal state for most keys and there are thousands of
     them, so it is counted and not listed. The two that need eyes are returned
     in full. */
  return NextResponse.json({
    counts,
    storedRows: rows.length,
    overridden: all.filter(r => r.kind === 'overridden'),
    orphans: all.filter(r => r.kind === 'orphan'),
  });
});
