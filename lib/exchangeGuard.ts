/* One guard for every server-side call to a crypto exchange's REST API (#1649).
 *
 * WHY. One banned server IP stops a data type for every user at once. Binance has answered this server 418 (#368), and production's
 * GlitchTip shows Bybit answering 403 since 2026-10-16 (15 klines, 9 recent-trade, 1 open-interest). Render's outbound IPs are shared by
 * every service in the region, so the per-IP limits are not only ours to spend. Before this file each route handled a ban on its own
 * (lib/pool.ts stops one fan-out, the klines route fails over to Bybit), and nothing stopped the NEXT route or cron from calling the same
 * exchange a second later - which is exactly what extends a ban.
 *
 * WHAT IT DOES, per exchange, shared by every route and cron in the process (state on globalThis, like lib/apiCache.ts and lib/rateLimit.ts):
 *   1. Breaker. An answer that means "this IP is rate-limited or banned" (any 429, Binance's 418, a 503 with Retry-After, or a 403/451
 *      whose body says rate limit; never a firewall page a caller could provoke, see opensBreaker) stops ALL calls to that exchange for 10
 *      minutes, doubling on a repeat within an hour (at most 6 hours), or longer when Retry-After says so. While it is open, exchangeFetch throws
 *      HttpStatusError(429) without touching the network: the answer every caller already treats as "rate-limited, use the fallback or the
 *      cache" (lib/pool.ts isRateLimitStatus, the klines failover).
 *   2. Concurrency: at most 8 requests in flight per exchange (4 for OKX and Hyperliquid); the rest wait in a bounded queue.
 *   3. Budget. Binance reports the IP's used weight (X-MBX-USED-WEIGHT-1M) on every answer; above half of the 2,400 limit, new calls wait for
 *      the next minute or are refused. Bybit has no such header, so it is held to 250 requests per 5 s, under half of its 600 per IP.
 *   4. Evidence. A ban answer's status and the first 300 characters of its body go to GlitchTip once per trip, so a rate limit ("access too
 *      frequent") can be told from a block (a CloudFront HTML page) - PM's ask on #1649 - and the breaker state is reported to the health
 *      table (lib/apiHealth.ts) as `<exchange>:breaker`.
 * Any other host passes straight through to fetch, untouched. */
import { HttpStatusError } from './pool.ts';

/* The reporters are imported lazily, on a trip only: they pull in Supabase and Sentry, which a caller of this module (and its tests) should
   not load just to make a request. A reporting failure never fails the call. */
async function report(ex: Exchange, ok: boolean, detail: string, glitchtip?: string): Promise<void> {
  try { (await import('./apiHealth.ts')).reportHealth(`${ex}:breaker`, 'market', ok, detail); } catch { /* health table unavailable */ }
  if (glitchtip) { try { (await import('./apiError.ts')).apiError('exchange-guard', new Error(glitchtip)); } catch { /* GlitchTip unavailable */ } }
}

export type Exchange = 'binance' | 'bybit' | 'okx' | 'hyperliquid';

export const COOLDOWN_MIN_MS = 10 * 60_000;
export const COOLDOWN_MAX_MS = 6 * 60 * 60_000;
const STRIKE_MEMORY_MS = 60 * 60_000;
const MAX_IN_FLIGHT: Record<Exchange, number> = { binance: 8, bybit: 8, okx: 4, hyperliquid: 4 };
const MAX_WAITING = 400;
const WAIT_TIMEOUT_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 15_000;
export const BINANCE_WEIGHT_SOFT_LIMIT = 1200;        // half of Binance's 2,400 per minute
export const BYBIT_WINDOW_MS = 5_000;
export const BYBIT_WINDOW_MAX = 250;                   // under half of Bybit's 600 per 5 s per IP
/* The answers that are looked at (body read for the evidence), and the ones that OPEN the breaker. Only an answer that means "this IP is
   being rate-limited or banned" opens it: a 429, Binance's 418, or a 503 with Retry-After. A 403 (or 451) can also be an exchange's web
   firewall refusing ONE odd request - something a caller can provoke - and tripping on it would let anyone switch an exchange off for every
   user (security review, #1649). So a 403/451 opens the breaker only when its body says rate limit ("access too frequent", Binance's
   -1003 "request weight", Bybit retCode 10006/10018); any other refusal page is reported as evidence, at most every 10 minutes, and the
   caller simply gets its 403 as before. */
const LOOKED_AT = new Set([403, 418, 429, 451, 503]);
const RATE_LIMIT_BODY = /access too frequent|too many (visits|requests)|rate limit|request weight|"code"\s*:\s*-1003|"retCode"\s*:\s*100(06|18)/i;
const EVIDENCE_EVERY_MS = 10 * 60_000;
function opensBreaker(ex: Exchange, status: number, body: string, retryAfter: boolean): boolean {
  if (status === 429) return true;
  if (ex === 'binance' && status === 418) return true;
  if (status === 503 && retryAfter) return true;
  return (status === 403 || status === 451) && RATE_LIMIT_BODY.test(body);
}

interface ExchangeState {
  openUntil: number; strikes: number; lastTripAt: number;
  inFlight: number; waiters: Array<() => void>;
  recent: number[]; weight: number; weightMinute: number;
  trips: number; refused: number; lastEvidenceAt: number;
  lastTrip: { status: number; at: string; kind: string; body: string } | null;
}
const blank = (): ExchangeState => ({
  openUntil: 0, strikes: 0, lastTripAt: 0, inFlight: 0, waiters: [], recent: [], weight: 0, weightMinute: 0, trips: 0, refused: 0,
  lastEvidenceAt: 0, lastTrip: null,
});
const g = globalThis as { __lhqExchangeGuard?: Record<Exchange, ExchangeState> };
const state = (g.__lhqExchangeGuard ??= { binance: blank(), bybit: blank(), okx: blank(), hyperliquid: blank() });

/** Which exchange a URL belongs to, or null for any other host. */
export function exchangeOf(input: string | URL): Exchange | null {
  let host: string;
  try { host = (typeof input === 'string' ? new URL(input) : input).hostname.toLowerCase(); } catch { return null; }
  if (host === 'binance.com' || host.endsWith('.binance.com') || host.endsWith('.binance.vision')) return 'binance';
  if (host === 'bybit.com' || host.endsWith('.bybit.com')) return 'bybit';
  if (host === 'okx.com' || host.endsWith('.okx.com')) return 'okx';
  if (host === 'hyperliquid.xyz' || host.endsWith('.hyperliquid.xyz')) return 'hyperliquid';
  return null;
}

/** Whether calls to this exchange are stopped right now, and until when. */
export function exchangeCoolingDown(ex: Exchange, now: number = Date.now()): { until: number } | null {
  const s = state[ex];
  return now < s.openUntil ? { until: s.openUntil } : null;
}

const minuteOf = (ms: number) => Math.floor(ms / 60_000);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function respectBudget(ex: Exchange, s: ExchangeState): Promise<void> {
  const now = Date.now();
  if (ex === 'binance' && s.weightMinute === minuteOf(now) && s.weight >= BINANCE_WEIGHT_SOFT_LIMIT) {
    const wait = (minuteOf(now) + 1) * 60_000 - now + 250;
    if (wait > WAIT_TIMEOUT_MS) { s.refused++; throw new HttpStatusError(429, `binance: request budget spent this minute (used weight ${s.weight})`); }
    await sleep(wait);
  }
  if (ex === 'bybit') {
    for (;;) {
      const t = Date.now();
      while (s.recent.length && t - s.recent[0] >= BYBIT_WINDOW_MS) s.recent.shift();
      if (s.recent.length < BYBIT_WINDOW_MAX) { s.recent.push(t); return; }
      await sleep(BYBIT_WINDOW_MS - (t - s.recent[0]) + 5);
    }
  }
}

async function acquire(ex: Exchange, s: ExchangeState): Promise<void> {
  if (s.inFlight < MAX_IN_FLIGHT[ex]) { s.inFlight++; return; }
  if (s.waiters.length >= MAX_WAITING) { s.refused++; throw new HttpStatusError(429, `${ex}: too many requests queued`); }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      const i = s.waiters.indexOf(go);
      if (i >= 0) s.waiters.splice(i, 1);
      s.refused++;
      reject(new HttpStatusError(429, `${ex}: waited ${WAIT_TIMEOUT_MS / 1000} s for a free slot`));
    }, WAIT_TIMEOUT_MS);
    // The slot is handed over by release(): inFlight is NOT decremented and incremented again, so no newcomer can jump the queue.
    const go = () => { clearTimeout(timer); resolve(); };
    s.waiters.push(go);
  });
}

function release(s: ExchangeState): void {
  const next = s.waiters.shift();
  if (next) next();
  else s.inFlight = Math.max(0, s.inFlight - 1);
}

/** A refusal-shaped answer: read its body (first 300 characters), then either open the breaker (a rate limit or ban, see opensBreaker) or
 *  only report it as evidence. The caller gets the same Response either way. */
async function onRefusal(ex: Exchange, s: ExchangeState, r: Response): Promise<void> {
  const now = Date.now();
  let body = '';
  try { body = (await r.clone().text()).replace(/\s+/g, ' ').trim().slice(0, 300); } catch { /* body unreadable: status alone */ }
  const retryAfterS = Number(r.headers.get('retry-after'));
  const retryAfterMs = Number.isFinite(retryAfterS) && retryAfterS > 0 ? retryAfterS * 1000 : 0;
  const kind = RATE_LIMIT_BODY.test(body) ? 'rate-limit' : /<html|cloudfront|forbidden/i.test(body) ? 'blocked-page' : 'other';

  if (!opensBreaker(ex, r.status, body, retryAfterMs > 0)) {
    // Evidence only (a firewall page, a 451 without a rate-limit body, a 503 without Retry-After): throttled, because a caller can provoke it.
    if (now - s.lastEvidenceAt < EVIDENCE_EVERY_MS) return;
    s.lastEvidenceAt = now;
    void report(ex, true, `HTTP ${r.status} (${kind}) not treated as a ban`, `[${ex}] HTTP ${r.status} (${kind}), breaker NOT opened. Body: ${body || '(empty)'}`);
    return;
  }

  s.strikes = now - s.lastTripAt < STRIKE_MEMORY_MS ? s.strikes + 1 : 1;
  s.lastTripAt = now;
  const ms = Math.min(COOLDOWN_MAX_MS, Math.max(COOLDOWN_MIN_MS * 2 ** (s.strikes - 1), retryAfterMs));
  // Several requests in flight can come back banned together: the breaker opens once, and only the first one reports.
  const alreadyOpen = now < s.openUntil;
  s.openUntil = Math.max(s.openUntil, now + ms);
  if (alreadyOpen) return;
  s.trips++;
  s.lastTrip = { status: r.status, at: new Date(now).toISOString(), kind, body };
  const detail = `HTTP ${r.status} (${kind}); every ${ex} call stopped for ${Math.round(ms / 60_000)} min, strike ${s.strikes}`;
  void report(ex, false, detail, `[${ex}] ${detail}. Body: ${body || '(empty)'}`);
}

/** fetch() for an exchange URL, behind the shared breaker, concurrency cap and budget above. Same arguments and Response as fetch; throws
 *  HttpStatusError(429) without a network call while that exchange is cooling down. Non-exchange URLs go straight to fetch. */
export async function exchangeFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const ex = exchangeOf(input);
  if (!ex) return fetch(input, init);
  const s = state[ex];
  const cool = exchangeCoolingDown(ex);
  if (cool) { s.refused++; throw new HttpStatusError(429, `${ex}: cooling down until ${new Date(cool.until).toISOString()}`); }

  await acquire(ex, s);
  try {
    await respectBudget(ex, s);
    // Re-checked after any wait: the breaker may have opened while this request was queued.
    const cool2 = exchangeCoolingDown(ex);
    if (cool2) { s.refused++; throw new HttpStatusError(429, `${ex}: cooling down until ${new Date(cool2.until).toISOString()}`); }
    const r = await fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
    if (ex === 'binance') {
      const w = Number(r.headers.get('x-mbx-used-weight-1m'));
      if (Number.isFinite(w) && w > 0) { s.weight = w; s.weightMinute = minuteOf(Date.now()); }
    }
    if (LOOKED_AT.has(r.status)) await onRefusal(ex, s, r);
    else if (r.ok && s.lastTrip && Date.now() >= s.openUntil && s.strikes > 0 && Date.now() - s.lastTripAt >= STRIKE_MEMORY_MS) {
      s.strikes = 0;
      void report(ex, true, 'calls answered normally for an hour after the last stop');
    }
    return r;
  } finally {
    release(s);
  }
}

/** Per-exchange state for /api/health and tests: open or not, until when, strikes, queue, budget, counters and the last ban answer. */
export function _exchangeGuardStats(now: number = Date.now()) {
  const out: Record<string, unknown> = {};
  for (const ex of Object.keys(state) as Exchange[]) {
    const s = state[ex];
    out[ex] = {
      open: now < s.openUntil, openUntil: s.openUntil ? new Date(s.openUntil).toISOString() : null, strikes: s.strikes,
      inFlight: s.inFlight, waiting: s.waiters.length, trips: s.trips, refused: s.refused,
      binanceWeight: ex === 'binance' ? s.weight : undefined, bybitLast5s: ex === 'bybit' ? s.recent.filter((t) => now - t < BYBIT_WINDOW_MS).length : undefined,
      lastTrip: s.lastTrip,
    };
  }
  return out;
}

/** Tests only: forget every exchange's state. */
export function _resetExchangeGuard(): void {
  for (const ex of Object.keys(state) as Exchange[]) {
    for (const w of state[ex].waiters) w();
    state[ex] = blank();
  }
}
