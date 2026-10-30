import { NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cronAuth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { BACKUP_TABLES, EXCLUDED_TABLES, unclassifiedTables } from '@/lib/backupTables';

export const dynamic = 'force-dynamic';

/* A nightly export of the data that cannot be recreated (#1413).
 *
 * ── WHY, AND WHY IT DID NOT NEED A PAID PLAN ───────────────────────────────
 *
 * Production has no backups. `CONTRIBUTING.md` says that if a destructive migration ships there
 * is no recovery path, and that is accurate today. `docs/OWNER-BLOCKERS.md` recorded backups as
 * deferred to a ~$25/month Supabase upgrade, which has been read ever since as "backups are
 * impossible until he pays". **The database is 32 MB.** A nightly dump of the irreplaceable
 * tables is a few megabytes and costs nothing. The deferral was about point-in-time recovery,
 * which is a different product from "a copy of the rows exists somewhere else".
 *
 * ── READ-ONLY, AND STRUCTURALLY SO ─────────────────────────────────────────
 *
 * This route issues SELECT only. No DDL, no delete, no upsert, nothing that writes to the shared
 * database. The only write it can perform is to the backup destination.
 *
 * ── THE 1000-ROW TRAP, which would have made this worse than useless ───────
 *
 * PostgREST caps a plain `.select()` at 1000 rows. A backup that silently returns the first 1000
 * of a 56,941-row table is not a partial backup - it is a file that LOOKS like a backup, restores
 * cleanly, and loses everything after row 1000. This project has already been bitten by that cap
 * producing truncated sums. So every read here is paginated with `.range()` and **each table's
 * count is checked against the number of rows actually fetched**; a mismatch fails the whole run
 * rather than writing a short file.
 *
 * ── MODES ──────────────────────────────────────────────────────────────────
 *
 *   ?mode=count   (default)  row counts only. Nothing is read into memory, nothing leaves the
 *                            database, nothing is written. This is the mode to run first and the
 *                            mode that answers "what would a backup contain".
 *   ?mode=export             builds the dump and writes it to the destination.
 *
 * Default is `count` on purpose: a route that exports customer data by default is one wrong curl
 * away from putting that data somewhere nobody intended.
 *
 * ── DESTINATION ────────────────────────────────────────────────────────────
 *
 * Supabase Storage, private bucket, named by BACKUP_BUCKET. If that variable is unset the export
 * returns its manifest and checksum WITHOUT writing anywhere, so the route is safe to deploy
 * before the destination exists.
 *
 * It is the same vendor as the database, and that limitation is stated rather than hidden: this
 * protects against OUR mistakes - a destructive migration, a bad delete, a dropped column - which
 * is the failure this project has actually been close to. It does NOT protect against losing the
 * Supabase account itself. A second vendor would, and the free plan's two-project cap is already
 * spent on dev and prod, so that needs either the owner's money or a different provider. Named
 * here so nobody reads this route as more protection than it is.
 */

/** PostgREST's page size. Kept below the 1000 cap so a page is never silently clipped. */
const PAGE = 900;

interface TableResult {
  table: string;
  rows: number;
  expected: number | null;
  ok: boolean;
  note?: string;
}

export async function GET(req: Request) {
  /* headerOnly, like the purge route: this one reads payment and customer rows, so the secret
     must not be allowed to travel in a query string where it lands in logs and referrers. */
  if (!checkCronAuth(req, { headerOnly: true })) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const mode = new URL(req.url).searchParams.get('mode') ?? 'count';
  if (mode !== 'count' && mode !== 'export') {
    return NextResponse.json({ error: 'mode must be count or export' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const startedAt = new Date().toISOString();
  const results: TableResult[] = [];
  const dump: Record<string, unknown[]> = {};

  for (const { table } of BACKUP_TABLES) {
    const { count, error: countErr } = await admin.from(table).select('*', { count: 'exact', head: true });
    if (countErr) {
      results.push({ table, rows: 0, expected: null, ok: false, note: `count failed: ${countErr.message}` });
      continue;
    }
    const expected = count ?? 0;

    if (mode === 'count') {
      results.push({ table, rows: expected, expected, ok: true });
      continue;
    }

    /* Paginate. The cap is the reason this is a loop and not a single select. */
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin.from(table).select('*').range(from, from + PAGE - 1);
      if (error) {
        results.push({ table, rows: rows.length, expected, ok: false, note: `read failed at ${from}: ${error.message}` });
        break;
      }
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }

    /* THE CHECK THAT MAKES THIS A BACKUP RATHER THAN A FILE. A short read is the silent failure
       mode, so the count and the fetch must agree or the run is not ok. */
    const ok = rows.length === expected;
    results.push({
      table, rows: rows.length, expected, ok,
      ...(ok ? {} : { note: `SHORT READ - fetched ${rows.length} of ${expected}` }),
    });
    dump[table] = rows;
  }

  const allOk = results.every(r => r.ok);
  const totalRows = results.reduce((a, r) => a + r.rows, 0);

  const body: Record<string, unknown> = {
    mode,
    startedAt,
    finishedAt: new Date().toISOString(),
    ok: allOk,
    tables: results,
    totalRows,
    excluded: EXCLUDED_TABLES.map(t => t.table),
    unclassified: unclassifiedTables(),
  };

  if (mode === 'count') return NextResponse.json(body);

  if (!allOk) {
    /* Never write a dump that is known to be short. */
    return NextResponse.json({ ...body, written: false, reason: 'short_read' }, { status: 500 });
  }

  const payload = JSON.stringify({ takenAt: startedAt, tables: dump });
  const bytes = Buffer.byteLength(payload);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  const sha256 = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');

  const bucket = process.env.BACKUP_BUCKET;
  if (!bucket) {
    /* Deployable before the destination exists: prove the read, report the size, write nothing. */
    return NextResponse.json({ ...body, written: false, reason: 'BACKUP_BUCKET not set', bytes, sha256 });
  }

  const name = `backup-${startedAt.replace(/[:.]/g, '-')}.json`;
  const { error: upErr } = await admin.storage.from(bucket).upload(name, payload, {
    contentType: 'application/json', upsert: false,
  });
  if (upErr) {
    return NextResponse.json({ ...body, written: false, reason: `upload failed: ${upErr.message}`, bytes, sha256 }, { status: 502 });
  }

  /* Retention on the backups themselves, so this does not grow without bound. Keep the newest
     KEEP files and remove the rest - listed newest-first and sliced, rather than by age, so a
     gap in the schedule can never leave zero backups. */
  const KEEP = 14;
  let pruned = 0;
  const { data: listed } = await admin.storage.from(bucket).list('', { limit: 100, sortBy: { column: 'name', order: 'desc' } });
  const stale = (listed ?? []).filter(f => f.name.startsWith('backup-')).slice(KEEP).map(f => f.name);
  if (stale.length) {
    const { error: delErr } = await admin.storage.from(bucket).remove(stale);
    if (!delErr) pruned = stale.length;
  }

  return NextResponse.json({ ...body, written: true, file: name, bytes, sha256, keep: KEEP, pruned });
}
