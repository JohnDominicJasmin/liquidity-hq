// SERVER ONLY. How full the database is, for /api/health (#1632).
//
// Read from the database project's own metrics page with the service key, so it needs no function in the database. The figure is cached:
// the page is large (about 450 KB) and the size moves slowly. A read that fails is UNKNOWN (null), never 0.

/** The free plan's database limit. */
export const DB_CAP_MB = 500;

export type DbSize = { size_mb: number; cap_mb: number; percent: number };

const FRESH_MS = 60 * 60_000;
/** After a failed read, the next one waits this long. */
const RETRY_MS = 10 * 60_000;
/** A value older than this is no longer reported. */
const KEEP_MS = 24 * 60 * 60_000;
const READ_TIMEOUT_MS = 8_000;
/** How long the first caller of a process waits; later callers never wait. */
const FIRST_WAIT_MS = 2_500;

let value: { at: number; size: DbSize } | null = null;
let lastTry = 0;
let reading: Promise<void> | null = null;

/** `pg_database_size_mb{...} 40.1` in the metrics text, or null when it is not there. */
export function parseDbSizeMb(text: string): number | null {
  const m = /^pg_database_size_mb(?:\{[^}]*\})?\s+([0-9.eE+-]+)\s*$/m.exec(text);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function read(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/customer/v1/privileged/metrics`, {
      headers: { Authorization: `Basic ${Buffer.from(`service_role:${key}`).toString('base64')}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    if (!res.ok) { console.warn(`[dbSize] metrics answered ${res.status}`); return; }
    const mb = parseDbSizeMb(await res.text());
    if (mb === null) { console.warn('[dbSize] metrics carried no database size'); return; }
    value = { at: Date.now(), size: { size_mb: Math.round(mb * 10) / 10, cap_mb: DB_CAP_MB, percent: Math.round((mb / DB_CAP_MB) * 1000) / 10 } };
  } catch (e) {
    console.warn('[dbSize] read failed:', e instanceof Error ? e.name : 'error');
  }
}

export async function databaseSize(now: number = Date.now()): Promise<DbSize | null> {
  const due = (!value || now - value.at >= FRESH_MS) && now - lastTry >= RETRY_MS;
  if (due && !reading) {
    lastTry = now;
    reading = read().finally(() => { reading = null; });
  }
  if (!value && reading) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([reading, new Promise<void>((r) => { timer = setTimeout(r, FIRST_WAIT_MS); })]);
    clearTimeout(timer);
  }
  return value && Date.now() - value.at < KEEP_MS ? value.size : null;
}
