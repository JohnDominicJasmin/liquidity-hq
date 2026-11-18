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
 *   5. Memory across a restart. A trip is saved to app_config (lib/exchangeBreakerStore.ts) and read back at server start, so a deploy
 *      does not forget a ban and call the exchange that just banned this IP (which is what makes Binance extend a 418).
 * Any other host passes straight through to fetch, untouched. */
import { HttpStatusError } from './pool.ts';
import {
  BREAKER_EXCHANGES, COOLDOWN_MAX_MS, ignoreSavedBreaker, mergeBreakerState, supabaseBreakerStore,
  type BreakerSnapshot, type BreakerStore,
} from './exchangeBreakerStore.ts';

/* The reporters are imported lazily, on a trip only: they pull in Supabase and Sentry, which a caller of this module (and its tests) should
   not load just to make a request. A reporting failure never fails the call. */
async function report(ex: Exchange, ok: boolean, detail: string, glitchtip?: string): Promise<void> {
  try { (await import('./apiHealth.ts')).reportHealth(`${ex}:breaker`, 'market', ok, detail); } catch { /* health table unavailable */ }
  if (glitchtip) { try { (await import('./apiError.ts')).apiError('exchange-guard', new Error(glitchtip)); } catch { /* GlitchTip unavailable */ } }
}

export type Exchange = 'binance' | 'bybit' | 'okx' | 'hyperliquid';

export const COOLDOWN_MIN_MS = 10 * 60_000;
export { COOLDOWN_MAX_MS };
const STRIKE_MEMORY_MS = 60 * 60_000;
export const RETRY_AFTER_FLOOR_MS = 5_000;
const MAX_IN_FLIGHT: Record<Exchange, number> = { binance: 8, bybit: 8, okx: 4, hyperliquid: 4 };
const MAX_WAITING = 400;
const WAIT_TIMEOUT_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 15_000;
/** Non-exchange upstreams (Deribit, DefiLlama, alternative.me ...) went straight to fetch with NO timeout, so a slow one held a page's skeleton for as long as the platform allowed (OWNER-RULES 21). A caller that passes its own signal keeps it. */
const NON_EXCHANGE_TIMEOUT_MS = 5_000;
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
  /* WHEN WE LAST TRIED THIS EXCHANGE AT ALL, success or failure. 0 means never.
     `recent` cannot answer this - it is a sliding window that empties, so it says "not lately"
     where the health endpoint needs "not ever". See exchangeDegraded below for why that
     distinction is the whole point. */
  lastCallAt: number;
  openUntil: number; strikes: number; lastTripAt: number;
  inFlight: number; waiters: Array<() => void>;
  recent: number[]; weight: number; weightMinute: number;
  trips: number; refused: number; lastEvidenceAt: number;
  lastTrip: { status: number; at: string; kind: string; body: string } | null;
}
const blank = (): ExchangeState => ({
  lastCallAt: 0, openUntil: 0, strikes: 0, lastTripAt: 0, inFlight: 0, waiters: [], recent: [], weight: 0, weightMinute: 0, trips: 0, refused: 0,
  lastEvidenceAt: 0, lastTrip: null,
});
const g = globalThis as { __lhqExchangeGuard?: Record<Exchange, ExchangeState> };
const state = (g.__lhqExchangeGuard ??= { binance: blank(), bybit: blank(), okx: blank(), hyperliquid: blank() });

/* ── The breaker across a restart (lib/exchangeBreakerStore.ts) ───────────────────────────────────────────────────────────────────────
   Only in a running server (NEXT_RUNTIME is set by Next, not by unit tests or scripts), or when a test installs a store: the existing tests
   stub fetch and count calls, and an app_config read or write they never asked for would land in their count. */
interface BreakerSync {
  hydrated: boolean; hydrating: Promise<void> | null; hydrateToken: object | null; attempts: number; lastAttemptAt: number; firstCallAt: number;
  saving: object | null; savingSince: number; saveAgain: boolean;
}
const blankSync = (): BreakerSync => ({
  hydrated: false, hydrating: null, hydrateToken: null, attempts: 0, lastAttemptAt: 0, firstCallAt: 0, saving: null, savingSince: 0, saveAgain: false,
});
const gs = globalThis as { __lhqExchangeBreakerSync?: BreakerSync; __lhqExchangeBreakerStore?: BreakerStore | null };
let sync = (gs.__lhqExchangeBreakerSync ??= blankSync());
/** How long the FIRST exchange call in a process waits for the saved state before going ahead without it. */
const HYDRATE_WAIT_MS = 2_000;
/** A failed read is retried at most this often, in the background; only the first attempt is ever waited on. A read or a write still
 *  pending after this long is abandoned, so one that never settles cannot block every later read or save (QA review of #2571, F1/F2). */
const HYDRATE_RETRY_MS = 60_000;
/** Every store call is also cut after this long (a real timer; the line above is measured on the clock). */
const STORE_CALL_TIMEOUT_MS = 20_000;

function activeStore(): BreakerStore | null {
  if (gs.__lhqExchangeBreakerStore !== undefined) return gs.__lhqExchangeBreakerStore;
  return process.env.NEXT_RUNTIME === 'nodejs' ? supabaseBreakerStore : null;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error('exchange breaker store: timed out')), ms);
    (t as { unref?: () => void }).unref?.(); // never what keeps a process alive
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

function memorySnapshot(now: number): BreakerSnapshot {
  const out: BreakerSnapshot = {};
  for (const ex of BREAKER_EXCHANGES) {
    const s = state[ex];
    if (s.openUntil > now) out[ex] = { openUntil: s.openUntil, strikes: s.strikes, lastTripAt: s.lastTripAt };
  }
  return out;
}

/** Saved cooldowns into memory. Only ones still running apply, and an openUntil only ever moves LATER (never shortened). Cannot throw on a
 *  bad time: a lastTripAt Date cannot represent falls back to now. */
function applySnapshot(stored: BreakerSnapshot, now: number): void {
  const merged = mergeBreakerState(memorySnapshot(now), stored, now);
  for (const ex of BREAKER_EXCHANGES) {
    const m = merged[ex];
    if (!m) continue;
    const s = state[ex];
    s.openUntil = Math.max(s.openUntil, m.openUntil);
    s.strikes = Math.max(s.strikes, m.strikes);
    s.lastTripAt = Math.max(s.lastTripAt, m.lastTripAt);
    const at = new Date(s.lastTripAt || now);
    // Without a lastTrip the strikes would never reset after an hour of normal answers (see exchangeFetch).
    s.lastTrip ??= {
      status: 0, at: (Number.isNaN(at.getTime()) ? new Date(now) : at).toISOString(), kind: 'restored', body: 'cooldown carried over from before a restart',
    };
  }
}

/** Read the saved breaker state once (server start, instrumentation.ts) and apply it. Never throws; a failed read is retried later.
 *  EXCHANGE_BREAKER_IGNORE_SAVED=1 skips the read entirely (docs/INFRASTRUCTURE.md 2d). */
export function hydrateExchangeBreaker(): Promise<void> {
  const st = activeStore();
  if (!st || sync.hydrated) return Promise.resolve();
  if (ignoreSavedBreaker()) { sync.hydrated = true; return Promise.resolve(); }
  const now = Date.now();
  if (sync.hydrating && now - sync.lastAttemptAt < HYDRATE_RETRY_MS) return sync.hydrating;
  // Either nothing is in flight, or the read in flight has been pending for a minute and is abandoned (its late answer is still applied).
  const own = sync;
  const token = {};
  own.attempts++;
  own.lastAttemptAt = now;
  own.hydrateToken = token;
  const p = (async () => {
    try {
      const stored = await withTimeout(st.load(), STORE_CALL_TIMEOUT_MS);
      if (sync === own) { applySnapshot(stored, Date.now()); own.hydrated = true; }
    } catch { /* unknown, not "nothing banned": retried on a later call */ }
    finally { if (own.hydrateToken === token) { own.hydrating = null; own.hydrateToken = null; } }
  })();
  if (own.hydrateToken === token) own.hydrating = p;
  return p;
}

const waitAtMost = (p: Promise<void>, ms: number) => {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<void>((r) => { t = setTimeout(r, ms); })]).finally(() => clearTimeout(t));
};

/** Called before every exchange call. The calls in the first HYDRATE_WAIT_MS after a process's first exchange call wait (until then at most)
 *  for the saved state, so a fresh process does not fire at a banned exchange before it knows; after that a missing state is fetched in the
 *  background and never waited on. */
async function ensureHydrated(): Promise<void> {
  if (sync.hydrated || !activeStore()) return;
  const now = Date.now();
  sync.firstCallAt ||= now;
  const left = sync.firstCallAt + HYDRATE_WAIT_MS - now;
  if (sync.attempts === 0) { const p = hydrateExchangeBreaker(); if (left > 0) await waitAtMost(p, left); return; }
  if (now - sync.lastAttemptAt >= HYDRATE_RETRY_MS) { void hydrateExchangeBreaker(); return; }
  if (sync.hydrating && sync.attempts === 1 && left > 0) await waitAtMost(sync.hydrating, left);
}

/** Save the running cooldowns (best effort, never awaited by a request, never throws). Writes are coalesced: a trip while a save is in flight
 *  queues ONE more save, so a burst of banned answers costs at most two writes. Read-merge-write, so a saved longer ban is kept. A save
 *  pending for a minute is abandoned so it cannot stop every later one. */
function persistBreaker(): void {
  const st = activeStore();
  if (!st) return;
  const now = Date.now();
  if (sync.saving && now - sync.savingSince < HYDRATE_RETRY_MS) { sync.saveAgain = true; return; }
  const own = sync;
  const token = {};
  own.saving = token;
  own.savingSince = now;
  const mine = () => sync === own && own.saving === token;
  void (async () => {
    try {
      do {
        own.saveAgain = false;
        if (!ignoreSavedBreaker()) {
          try { const stored = await withTimeout(st.load(), STORE_CALL_TIMEOUT_MS); if (mine()) applySnapshot(stored, Date.now()); }
          catch { /* unread: save what this process knows */ }
        }
        if (!mine()) return; // reset (tests) or abandoned while in flight: nothing of it to save
        await withTimeout(st.save(memorySnapshot(Date.now())), STORE_CALL_TIMEOUT_MS);
      } while (own.saveAgain && mine());
    } catch { /* best effort: the next trip saves again */ }
    finally { if (own.saving === token) own.saving = null; }
  })();
}

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
  /* A 429 that SAYS how long to wait is taken at its word (owner sweep 2026-11-18): Binance and Bybit send Retry-After in seconds,
     usually well under a minute, and stopping every call for the 10-minute minimum instead turned one busy second into ten minutes
     of empty cells. Floor of 5 s so a Retry-After of 0/1 cannot hammer. A ban (Binance 418) and a 429 without Retry-After keep the
     escalating cooldown. */
  const ms = r.status === 429 && retryAfterMs > 0
    ? Math.min(COOLDOWN_MAX_MS, Math.max(RETRY_AFTER_FLOOR_MS, retryAfterMs))
    : Math.min(COOLDOWN_MAX_MS, Math.max(COOLDOWN_MIN_MS * 2 ** (s.strikes - 1), retryAfterMs));
  // Several requests in flight can come back banned together: the breaker opens once, and only the first one reports.
  const alreadyOpen = now < s.openUntil;
  const before = s.openUntil;
  // Math.max: a later, shorter answer (a 429 with a small Retry-After) never shortens a longer stop already running, restored ones included.
  s.openUntil = Math.max(s.openUntil, now + ms);
  if (alreadyOpen) { if (s.openUntil > before) persistBreaker(); return; }
  persistBreaker();
  s.trips++;
  s.lastTrip = { status: r.status, at: new Date(now).toISOString(), kind, body };
  const detail = `HTTP ${r.status} (${kind}); every ${ex} call stopped for ${Math.round(ms / 60_000)} min, strike ${s.strikes}`;
  void report(ex, false, detail, `[${ex}] ${detail}. Body: ${body || '(empty)'}`);
}

/* THE COOLDOWN MESSAGE HAS NO TIMESTAMP (P1, GlitchTip over its free limit): a message that carried the cool-down end time was a different issue every time, so one cool-down
   became hundreds of events. The end time is in _exchangeGuardStats and the api_health row; the error says only what happened, so repeats group into one issue. */
/** fetch() for an exchange URL, behind the shared breaker, concurrency cap and budget above. Same arguments and Response as fetch; throws
 *  HttpStatusError(429) without a network call while that exchange is cooling down. Non-exchange URLs go straight to fetch. */
export async function exchangeFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const ex = exchangeOf(input);
  if (!ex) return fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(NON_EXCHANGE_TIMEOUT_MS) });
  if (!sync.hydrated && activeStore()) await ensureHydrated();
  const s = state[ex];
  const cool = exchangeCoolingDown(ex);
  if (cool) { s.refused++; throw new HttpStatusError(429, `${ex}: cooling down`); }

  await acquire(ex, s);
  try {
    await respectBudget(ex, s);
    // Re-checked after any wait: the breaker may have opened while this request was queued.
    const cool2 = exchangeCoolingDown(ex);
    if (cool2) { s.refused++; throw new HttpStatusError(429, `${ex}: cooling down`); }
    /* Recorded BEFORE the call, not after: a request that times out or is refused at the network
       was still an attempt, and the question this answers is "have we ever tried", not "has it
       ever worked". Setting it after would leave an exchange we cannot reach at all looking
       exactly like one nobody has called - the confusion this field exists to remove. */
    s.lastCallAt = Date.now();
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
      /* #1649: the window the strikes are counted in travels WITH the count. "4 strikes" means nothing without "in 60 minutes", and
         the distinction between four in an hour and four across a day is what told us today's cooldown was not a one-off. */
      strikes_window_ms: STRIKE_MEMORY_MS,
      inFlight: s.inFlight, waiting: s.waiters.length, trips: s.trips, refused: s.refused,
      /* NULL, never `undefined`, for the exchange a counter does not apply to. `JSON.stringify` DROPS an undefined value, so the key
         vanished from the payload entirely - and an absent key cannot be told apart from a healthy one by a test. Same lesson as
         `NaN != null` in a different costume: absence must not be readable as a value. Not the string "undefined" either. */
      binanceWeight: ex === 'binance' ? s.weight : null,
      bybitLast5s: ex === 'bybit' ? s.recent.filter((t) => now - t < BYBIT_WINDOW_MS).length : null,
      lastTrip: s.lastTrip,
    };
  }
  return out;
}

/** The public, coarse view: which upstreams are degraded right now, and nothing about timing, counts or statuses.
 *
 *  Split from the detailed stats on purpose - /api/health is UNAUTHENTICATED, and `strikes` + `cooling_until` + `last_strike_status`
 *  together publish how close this server is to being rate-limited and how long it stays down when it is. Nobody has an incentive to
 *  care at our size, which is a reason to decide it rather than a reason not to notice it. PM's call, #1649.
 *
 *  Every configured exchange is named every time, healthy or not: the degenerate case is the one that ships broken, because nobody
 *  looks at a response that says nothing is wrong. */
/**
 * Per-exchange health for `/api/health`.
 *
 * THREE STATES, NOT TWO, AND THE THIRD IS WHY THIS COMMENT EXISTS. `degraded` answers one question:
 * is the breaker open right now. For an exchange nobody has ever called it is `false` - the breaker
 * has never opened because nothing has ever happened - and the endpoint was therefore asserting that
 * `okx` and `hyperliquid` were **fine**, when the truth was that they had never been tried.
 * `lib/exchangeGuard.ts` has reserved a slot for both since #1649 and nothing fetches either one.
 *
 * "Never tried" rendering as "fine" is the same shape as a liquidation panel rendering an empty
 * section under a header that says liquidations already happened, and as a zero that measures the
 * instrument - an absence of evidence drawn as evidence of absence. It matters more here than in
 * most places, because a health endpoint is what someone consults when deciding whether a fallback
 * works.
 *
 * `attempted` IS ADDED, NEVER A RESHAPE. `degraded` keeps its exact meaning and its exact type, so
 * every existing consumer is unaffected; a caller that wants the distinction reads one more field.
 * Same convention as the `ts` field on the account-ratio parser (#1404).
 *
 * SCOPE, STATED BECAUSE IT IS EASY TO OVERREAD: this state lives on `globalThis`, so `attempted` is
 * per process. After a restart - and the non-prod services are on a free plan that spins down - every
 * exchange reads `attempted: false` until something calls it. **That is the honest answer rather than
 * a bug**: a fresh process genuinely has no evidence about any exchange. It is not a durable record
 * of whether the integration has ever worked, and nothing should read it as one.
 */
export function exchangeDegraded(now: number = Date.now()): Record<Exchange, { degraded: boolean; attempted: boolean }> {
  const out = {} as Record<Exchange, { degraded: boolean; attempted: boolean }>;
  for (const ex of Object.keys(state) as Exchange[]) {
    out[ex] = { degraded: now < state[ex].openUntil, attempted: state[ex].lastCallAt > 0 };
  }
  return out;
}

/** Tests only: forget every exchange's state - what a restart does to memory. The saved row (the store) is untouched, and the next exchange
 *  call reads it again, exactly as a fresh process would. */
export function _resetExchangeGuard(): void {
  for (const ex of Object.keys(state) as Exchange[]) {
    for (const w of state[ex].waiters) w();
    state[ex] = blank();
  }
  sync = gs.__lhqExchangeBreakerSync = blankSync();
}

/** Tests only: where the breaker is saved. A store object turns saving and reading on (outside a running server too); null turns it off;
 *  undefined goes back to the default (app_config, in a running server only). */
export function _setExchangeBreakerStore(store: BreakerStore | null | undefined): void {
  if (store === undefined) delete gs.__lhqExchangeBreakerStore;
  else gs.__lhqExchangeBreakerStore = store;
}
