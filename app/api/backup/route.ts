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

/* Chain one `.order()` per key column. A composite primary key ordered on its first column only
   is not deterministic - rows sharing that value can come back in any order between pages, which
   is the drift the ordering exists to stop. `labels` (key, locale) and `muted_alerts`
   (user_id, key) are both composite. */
type Orderable = { order: (c: string, o?: { ascending?: boolean }) => Orderable };
function ordered<T extends Orderable>(q: T, cols: readonly string[]): T {
  return cols.reduce((acc, c) => acc.order(c, { ascending: true }), q as Orderable) as T;
}

/** The identity of a row under a composite key, for the uniqueness assertion. */
function rowKey(row: unknown, cols: readonly string[]): string {
  const r = row as Record<string, unknown>;
  return JSON.stringify(cols.map(c => r[c]));
}

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

  for (const { table, orderBy } of BACKUP_TABLES) {
    const { count, error: countErr } = await admin.from(table).select('*', { count: 'exact', head: true });
    if (countErr) {
      results.push({ table, rows: 0, expected: null, ok: false, note: `count failed: ${countErr.message}` });
      continue;
    }
    const expected = count ?? 0;

    /* VERIFY THE ORDER KEY EXISTS, in both modes. A wrong `orderBy` is silent in the worst way -
       PostgREST rejects an unknown column, but only on a request that actually orders, so an
       export would be the first thing to discover it. `mode=count` therefore does one ordered
       single-row read per table, which makes the cheap mode the one that validates the config. */
    const { error: orderErr } = await ordered(admin.from(table).select('*'), orderBy).range(0, 0);
    if (orderErr) {
      results.push({ table, rows: 0, expected, ok: false, note: `orderBy [${orderBy.join(', ')}] rejected: ${orderErr.message}` });
      continue;
    }

    if (mode === 'count') {
      results.push({ table, rows: expected, expected, ok: true });
      continue;
    }

    /* Paginate, ORDERED. The 1000-row cap is why this is a loop; the `.order()` is why the loop
       is correct. Without a deterministic order Postgres may return the same row on two pages
       and omit another, and the totals still add up - so the count check below would pass over a
       dump holding duplicates and missing records. That is worse than an unchecked backup,
       because the file reports itself sound. Found by the automated security review. */
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await ordered(admin.from(table).select('*'), orderBy).range(from, from + PAGE - 1);
      if (error) {
        results.push({ table, rows: rows.length, expected, ok: false, note: `read failed at ${from}: ${error.message}` });
        break;
      }
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }

    /* TWO CHECKS, because the count alone is the one that was defeatable. The second asserts the
       order key is actually unique across what we fetched - if it is not, paging on it can still
       drift, and a duplicate key is the symptom. */
    const keys = rows.map(r => rowKey(r, orderBy));
    const distinct = new Set(keys).size;
    const countOk = rows.length === expected;
    const uniqueOk = distinct === rows.length;
    const ok = countOk && uniqueOk;
    results.push({
      table, rows: rows.length, expected, ok,
      ...(countOk ? {} : { note: `SHORT READ - fetched ${rows.length} of ${expected}` }),
      ...(countOk && !uniqueOk ? { note: `DUPLICATE KEYS - ${rows.length} rows, ${distinct} distinct [${orderBy.join(', ')}]` } : {}),
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

  /* FAIL CLOSED IF THE BUCKET IS PUBLIC. Everything in this payload is customer or payment data,
     and `push_subscriptions` carries `auth` and `p256dh`, which are credentials. A bucket created
     public by accident would publish all of it at a guessable URL, and nothing downstream would
     notice. Checked on every run rather than assumed at setup, because a bucket's visibility can
     be changed later by someone who is not looking at this file. */
  const { data: bucketInfo, error: bucketErr } = await admin.storage.getBucket(bucket);
  if (bucketErr || !bucketInfo) {
    return NextResponse.json({ ...body, written: false, reason: `bucket unreadable: ${bucketErr?.message ?? 'not found'}`, bytes, sha256 }, { status: 502 });
  }
  if (bucketInfo.public) {
    return NextResponse.json({ ...body, written: false, reason: 'REFUSED - bucket is public', bytes, sha256 }, { status: 500 });
  }

  const name = `backup-${startedAt.replace(/[:.]/g, '-')}.json`;
  const { error: upErr } = await admin.storage.from(bucket).upload(name, payload, {
    contentType: 'application/json', upsert: false,
  });
  if (upErr) {
    return NextResponse.json({ ...body, written: false, reason: `upload failed: ${upErr.message}`, bytes, sha256 }, { status: 502 });
  }

  /* RETENTION, BY DAY **AND** AGE - and counting FILES was a way to destroy every backup.
   *
   * The first version kept the newest 14 files and deleted the rest. If this route ran 15 times
   * in an hour - a retry loop, a misconfigured schedule, someone curling it - the fifteenth run
   * would delete every genuine nightly copy and leave fourteen made in the same hour. **A
   * retention rule that counts files assumes the files are spread over time, and nothing was
   * enforcing that.** Flagged by the automated security review, twice: the first fix added an age
   * floor but still counted files, which narrows the window without closing it.
   *
   * Counting DAYS cannot be fooled that way - a burst occupies one slot however many files it
   * writes. So: keep the newest file per UTC day for the last KEEP_DAYS days, and on top of that
   * a file must also be older than the age floor before it can be removed. The two conditions
   * fail in opposite directions, which is the point: a burst of exports cannot age anything out,
   * and a long quiet period cannot leave zero. */
  const KEEP_DAYS = 14;
  const minAgeMs = 7 * 86_400_000;
  let pruned = 0;

  /* Page the listing. `list` caps at 100 per call, and a cap that hides the OLDEST files is the
     one direction that matters here - those are exactly the ones retention is deciding about. */
  const backups: { name: string; created_at?: string | null }[] = [];
  for (let page = 0; page < 20; page++) {
    const { data } = await admin.storage.from(bucket).list('', {
      limit: 100, offset: page * 100, sortBy: { column: 'name', order: 'desc' },
    });
    const batch = (data ?? []).filter(f => f.name.startsWith('backup-'));
    backups.push(...batch);
    if (!data || data.length < 100) break;
  }

  /* One survivor per day, newest first - the listing is name-descending and the name carries
     the ISO timestamp, so the first file seen for a day is that day's newest. */
  const keptPerDay = new Map<string, string>();
  for (const f of backups) {
    const day = (f.created_at ?? f.name.slice(7, 17)).slice(0, 10);
    if (!keptPerDay.has(day)) keptPerDay.set(day, f.name);
  }
  const protectedDays = [...keptPerDay.keys()].sort().reverse().slice(0, KEEP_DAYS);
  const protectedNames = new Set(protectedDays.map(d => keptPerDay.get(d) as string));

  const stale = backups
    .filter(f => !protectedNames.has(f.name))
    .filter(f => {
      const created = Date.parse(f.created_at ?? '');
      /* Unparseable timestamp means we cannot show it is old enough, so it stays. */
      return Number.isFinite(created) && Date.now() - created > minAgeMs;
    })
    .map(f => f.name);

  if (stale.length) {
    const { error: delErr } = await admin.storage.from(bucket).remove(stale);
    if (!delErr) pruned = stale.length;
  }

  return NextResponse.json({ ...body, written: true, file: name, bytes, sha256, keepDays: KEEP_DAYS, kept: protectedNames.size, listed: backups.length, pruned });
}
