/* A memory line in the server log every 10 minutes (#1397).
 *
 * Prod's memory rose from ~360 MB to ~448 MB of a 512 MB limit over about a day with little traffic, and the dashboard shows only the total. This
 * logs the total next to the things this process holds that can grow - the shared API response cache (entry count, bytes, the largest keys) and the
 * rate-limit buckets - so the next rise names its cause instead of being guessed at. Numbers only: no values from the cache, no user data, keys are
 * the cache keys (route + params), which are already in the access logs.
 *
 * unref'd so it never keeps a process alive (tests, `next build`). Started once, from instrumentation.ts, on the node runtime only. */
import { _cacheStats } from './apiCache.ts';
import { _bucketCount } from './rateLimit.ts';

const EVERY_MS = 10 * 60_000;
let started = false;
const mb = (n: number) => Math.round(n / 1048576);

export function memLine(): string {
  const m = process.memoryUsage();
  const c = _cacheStats(3);
  return `[mem] rss=${mb(m.rss)}MB heapUsed=${mb(m.heapUsed)}MB heapTotal=${mb(m.heapTotal)}MB external=${mb(m.external)}MB arrayBuffers=${mb(m.arrayBuffers)}MB ` +
    `apiCache=${c.entries}entries/${(c.bytes / 1048576).toFixed(1)}MB rateBuckets=${_bucketCount()} ` +
    `biggest=${c.biggest.map(b => `${b.key}:${Math.round(b.bytes / 1024)}KB`).join(',')}`;
}

export function startMemWatch(): void {
  if (started) return;
  started = true;
  const timer = setInterval(() => { try { console.log(memLine()); } catch { /* a log line must never throw */ } }, EVERY_MS);
  (timer as { unref?: () => void }).unref?.();
}
