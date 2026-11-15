// SERVER ONLY (imports supabase-admin). The label table the /api/labels route serves, with its own cache (#1263, PM: GO 2026-11-16).
//
// WHY THIS EXISTS. A request whose cache entry had expired took 2.5 to 3.1 s (measured 2026-11-16: qa 3.14 s, production 2.55 s; 0.19 s when cached): the route read English AND the locale, about
// 5,000 to 6,000 rows, in pages of 1,000, one page after another, so five or six dependent database round trips in a row. At low traffic almost every visitor paid that miss, and the label
// table is what turns the page from English into the visitor's language. Three changes, all server-side, none visible except sooner:
//   1. PARALLEL PAGES. The first page also returns the row count; the remaining pages are read together. A stable ORDER BY (the table's unique key) is added so pages cannot overlap or skip.
//   2. STALE-WHILE-REVALIDATE. An expired entry is served at once and refreshed in the background (one refresh at a time per locale), so no visitor waits for a miss after the first. A label
//      edit still shows within about one TTL: the next request after the entry expires triggers the refresh, and the request after that reads the new table.
//   3. WARM ON BOOT. instrumentation.ts calls warmLabels() once at server start, so the first visitor after a deploy or a restart finds the table already loaded.
//
// WHAT IT NEVER DOES. It never serves an EMPTY table (the caller falls open to {} only when no good table has EVER been loaded, exactly as before), and never replaces a good table with a failed
// read: a failed refresh keeps the last good table, is retried after the same 10 s backoff the route always had (#1025), and is reported through reportHealth (`labels:read`). A PARTIAL read (any
// page failing, or fewer rows than the count) counts as a failure: the old code kept whatever rows it had when a page errored and cached that for a minute.
//
// ONE STORE ON globalThis, like lib/apiCache.ts (QA, #1634): instrumentation.ts is compiled as a separate module graph from the routes, and each graph would otherwise get its own cache.
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { SUPPORTED_LOCALES, type Locale } from '@/lib/locales';
import { T } from '@/lib/tables';
import { reportHealth, healthError } from '@/lib/apiHealth';

export const LABELS_TTL_MS = 60_000;
const FAILURE_BACKOFF_MS = 10_000;
const PAGE_SIZE = 1000;   // PostgREST's db-max-rows on this project: a client-requested range cannot exceed it

interface Entry { data: Record<string, string>; expires: number }
interface Store { cache: Map<Locale, Entry>; inflight: Map<Locale, Promise<Record<string, string> | null>>; lastFailure: Map<Locale, number> }
const store: Store = ((globalThis as { __lhqLabelsStore?: Store }).__lhqLabelsStore ??= { cache: new Map(), inflight: new Map(), lastFailure: new Map() });

type Row = { key: string; locale: string; value: string };

// Test seam (same idea as lib/aiEngine.ts's __resetEngineCache): lets a test stand in for the database client and clear the store. No production caller.
let adminOf: () => ReturnType<typeof getSupabaseAdmin> = getSupabaseAdmin;
export function __labelsTestSeam(admin?: () => ReturnType<typeof getSupabaseAdmin>): void {
  adminOf = admin ?? getSupabaseAdmin;
  store.cache.clear(); store.inflight.clear(); store.lastFailure.clear();
}

/** One full read of the table for a locale (English layered under it); THROWS when ANY part of it failed, so a partial table can never be returned. */
async function readTable(locale: Locale): Promise<Record<string, string>> {
  const admin = adminOf();
  const locales = locale === 'en' ? ['en'] : ['en', locale];
  const page = (from: number) => admin.from(T.labels)
    .select('key, locale, value', { count: 'exact' })
    .in('locale', locales)
    .order('locale').order('key')   // the unique key: a stable order, so parallel pages cannot overlap or skip a row
    .range(from, from + PAGE_SIZE - 1);
  const first = await page(0);
  if (first.error) { console.error('/api/labels query error:', first.error.message); throw new Error(first.error.message); }
  const rows: Row[] = [...((first.data ?? []) as Row[])];
  const total = typeof first.count === 'number' ? first.count : null;
  if (total === null) {
    // No count from the server: fall back to reading pages one after another until a short page, as the route always did.
    for (let from = PAGE_SIZE; rows.length >= from; from += PAGE_SIZE) {
      const next = await page(from);
      if (next.error) throw new Error(next.error.message);
      rows.push(...((next.data ?? []) as Row[]));
      if ((next.data?.length ?? 0) < PAGE_SIZE) break;
    }
  } else if (total > PAGE_SIZE) {
    const pages = Math.ceil(total / PAGE_SIZE);
    const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => page((i + 1) * PAGE_SIZE)));
    for (const r of rest) {
      if (r.error) throw new Error(r.error.message);
      rows.push(...((r.data ?? []) as Row[]));
    }
    if (rows.length < total) throw new Error(`short read: ${rows.length} of ${total} label rows`);
  }
  // English first, then the requested locale layered on top per key: a key not yet translated in the target locale still resolves to English.
  const merged = new Map<string, string>();
  for (const row of rows) if (row.locale === 'en') merged.set(row.key, row.value);
  for (const row of rows) if (row.locale === locale) merged.set(row.key, row.value);
  /* #1632 item 15: the admin console's copy (`OPS_*`) is not UI copy for this public, unauthenticated route: serving it published the model name, the margin formula and the existence of a daily spend
     cap. It is dropped HERE, before anything is cached, so no cache (this one or the edge's) can ever hold the unfiltered table. /ops takes its copy from lib/labelDefaults.ops.en.json instead. */
  const data = Object.fromEntries([...merged].filter(([key]) => !key.startsWith('OPS_')));
  // An empty table is never a real answer (every locale has thousands of rows): a failure, not a result.
  if (Object.keys(data).length === 0) throw new Error('empty label table');
  return data;
}

/** Refresh one locale, one at a time (concurrent callers share the same read). Resolves to the new table, or null when the read failed (the cache is left exactly as it was). */
function refresh(locale: Locale): Promise<Record<string, string> | null> {
  const running = store.inflight.get(locale);
  if (running) return running;
  const p = readTable(locale).then(
    (data) => {
      store.cache.set(locale, { data, expires: Date.now() + LABELS_TTL_MS });
      store.lastFailure.delete(locale);
      reportHealth('labels:read', 'other', true, 'ok');
      return data;
    },
    (e: unknown) => {
      store.lastFailure.set(locale, Date.now());
      reportHealth('labels:read', 'other', false, healthError(e));
      return null;
    },
  ).finally(() => { store.inflight.delete(locale); });
  store.inflight.set(locale, p);
  return p;
}

export type LabelsState = 'fresh' | 'stale' | 'miss' | 'failed';

/** The label table for a locale and how it was obtained. `failed` carries {} and means NO good table has ever been loaded for it. */
export async function getLabels(locale: Locale): Promise<{ data: Record<string, string>; state: LabelsState }> {
  const now = Date.now();
  const entry = store.cache.get(locale);
  const failedAt = store.lastFailure.get(locale);
  const backingOff = failedAt != null && now - failedAt < FAILURE_BACKOFF_MS;
  if (entry && entry.expires > now) return { data: entry.data, state: 'fresh' };
  if (entry) {
    // Expired, but a good table is held: serve it now and refresh behind the response (never wait, never serve nothing).
    if (!backingOff) void refresh(locale);
    return { data: entry.data, state: 'stale' };
  }
  if (backingOff) return { data: {}, state: 'failed' };   // inside the backoff after a failed first read: do not hammer a service known to be down
  const data = await refresh(locale);
  return data ? { data, state: 'miss' } : { data: {}, state: 'failed' };
}

/** Load every locale once, at server start (instrumentation.ts), one after another. Never throws: a failed warm leaves the cache cold and the first request pays the read as before. */
export function warmLabels(): void {
  void (async () => {
    for (const locale of ['en', ...SUPPORTED_LOCALES] as Locale[]) {
      try { await refresh(locale); } catch { /* refresh never rejects; belt and braces */ }
    }
  })();
}
