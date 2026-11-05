/* HYPERLIQUID: PRICE AND CANDLES ONLY. The fourth venue (#1651).
 *
 * Dependency-free dialect and parser, same shape as `lib/okx.ts` - no fetching here, so it is
 * testable without a network and the route owns caching, the breaker and the budget
 * (`lib/exchangeGuard.ts` already knows `hyperliquid`, concurrency 4).
 *
 * ── NOT FUNDING, AND THAT IS A DECISION RATHER THAN AN OMISSION ─────────────────────────────────
 *
 * #1651 step 3 measured the five Binance-only metrics across 5 coins and 30 aligned buckets and
 * found none substitutable as a VALUE - funding disagrees on SIGN between venues. Funding is a
 * per-venue price, not a shared measurement. Price IS the shared quantity: measured 0.9991-0.9997
 * against Binance across btc/eth/sol/link/sand. So this file converts prices and candles and
 * nothing else. A cross-venue funding COMPARISON panel would be a new visible feature and is the
 * owner's call, not a fallback.
 *
 * ── THREE THINGS THIS VENUE DOES DIFFERENTLY FROM THE OTHER THREE ───────────────────────────────
 *
 * All three measured live on 2026-11-05 rather than read from docs, because each one fails
 * silently if assumed.
 *
 *   1. THE 1000x TRAP IS A `k` PREFIX, AND `normaliseBase` IS BLIND TO IT.
 *      That regex matches `/^(1000000|10000|1000)(.+)$/` - digits only. `kPEPE` does not match, so
 *      nothing in the existing pipeline would have caught it. See `HL_MULTIPLIER` below for why
 *      `k` is a hypothesis to verify per name and never a rule to apply.
 *
 *   2. CANDLES ARE OLDEST-FIRST, the opposite of OKX and Bybit, and THERE IS NO `confirm` FLAG.
 *      The forming bar is identified by `T > now` and by nothing else. Measured: a 5m BTC snapshot
 *      came back with `t` ascending and a last bar whose `T` was 267 seconds in the future.
 *
 *   3. ERRORS ARE THE WEAKEST OF THE FOUR VENUES, so `r.ok` is not enough on its own:
 *
 *          unknown coin     -> HTTP 500, body is literally `null`  (parses, yields null)
 *          bad interval     -> HTTP 422, body is PLAIN TEXT        (`JSON.parse` THROWS)
 *          missing fields   -> HTTP 422, plain text
 *
 *      `Failed to deserialize the JSON body into the target type` is not JSON. A caller that does
 *      `await r.json()` without a try/catch gets an exception rather than a refusal, which in a
 *      `cached()` wrapper is the difference between a retry and a stored empty result.
 *
 * ── AND A FOURTH: THE CANDLE CAP TRUNCATES THE OLD END, WHICH IS THE SAFE DIRECTION ─────────────
 *
 * About 5000 candles per request. Measured: 1m over 30 days (43,200 bars asked) returned 5,097,
 * and the returned window ENDED at `endTime` with 635 hours missing from the START. 5m over 30
 * days behaved the same way. Under the cap the full window comes back (1m over 1 day: 1,441).
 *
 * This matters because the other direction would be a silent staleness bug: a caller asking for
 * too wide a window gets the most RECENT bars, not the oldest ones, so an over-wide request
 * degrades to "less history than asked for" rather than "data from three weeks ago presented as
 * current". Not something to rely on, which is why `hlCandleCount` exists - but worth recording,
 * because a future reader checking only the row count would not learn which end went.
 *
 * The consistent `+1` over the expected bar count is the forming bar.
 */

/** POST body endpoint. One URL for every query; the `type` field selects the call. */
export const HL_INFO_URL = 'https://api.hyperliquid.xyz/info';

/* ── INTERVALS: A FOURTH DIALECT, AND THE LIST IS EXACT RATHER THAN A SUPERSET ─────────────────
 *
 * Enumerated by trying each against the live endpoint on 2026-11-05, including plausible ones that
 * do NOT work. `2m` and `6h` are rejected even though Binance has both and they look like they
 * belong - which is the reason this is a verified list and not a pattern. Bybit's `60`, OKX's `4H`
 * and Binance's `1D` are all HTTP 422 here.
 *
 * Case-sensitive: `1M` is a month and `1m` is a minute, and `1D` is an error. */
export const HL_INTERVALS = [
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d', '3d', '1w', '1M',
] as const;

export type HlInterval = (typeof HL_INTERVALS)[number];

const INTERVAL_SET: ReadonlySet<string> = new Set(HL_INTERVALS);

export function isHlInterval(interval: string): interval is HlInterval {
  return INTERVAL_SET.has(interval);
}

const INTERVAL_MS: Readonly<Record<HlInterval, number>> = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '2h': 7_200_000,
  '4h': 14_400_000,
  '8h': 28_800_000,
  '12h': 43_200_000,
  '1d': 86_400_000,
  '3d': 259_200_000,
  '1w': 604_800_000,
  /* A calendar month is not a fixed number of milliseconds. 30 days is the figure used for
     bucket arithmetic only - never for a cache key that must align to a real month boundary.
     Nothing in this file keys a cache off `1M`; the klines route's closed-candle key uses this
     and a month-long bar is not a case it serves. Named here so the approximation is visible
     rather than discovered. */
  '1M': 2_592_000_000,
};

/** Milliseconds per bar, or `null` for a string this venue does not accept. */
export function hlIntervalToMs(interval: string): number | null {
  return isHlInterval(interval) ? INTERVAL_MS[interval] : null;
}

/* Binance's interval spelling -> this venue's. Only the ones BOTH venues have: a Binance interval
   absent here has no Hyperliquid equivalent and the caller must not silently substitute a
   different bar width. `6h` is the live example - Binance has it, Hyperliquid returns 422 - and
   rounding it to `4h` or `8h` would answer a question nobody asked. */
const BINANCE_TO_HL: Readonly<Record<string, HlInterval>> = {
  '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1h', '2h': '2h', '4h': '4h', '8h': '8h', '12h': '12h',
  '1d': '1d', '3d': '3d', '1w': '1w', '1M': '1M',
};

/** The Hyperliquid interval for a Binance one, or `null` when this venue has no equivalent. */
export function hlIntervalForBinanceInterval(interval: string): HlInterval | null {
  return BINANCE_TO_HL[interval] ?? null;
}

/* ── THE MULTIPLIER. READ THIS BEFORE ADDING A NAME ────────────────────────────────────────────
 *
 * `k` LOOKS LIKE 1000 AND IS NOT ALWAYS 1000. Measured against Binance's per-token price on
 * 2026-11-05, implied multiplier = hyperliquid price / binance per-token price:
 *
 *     kBONK    1002.12     kFLOKI   1001.67     kLUNC   1000.73     kNEIRO  1001.17
 *     kPEPE    1001.69     kSHIB    1001.77
 *     kDOGS    4611.41   <- NOT 1000
 *
 * **`kDOGS` is not even a STABLE ratio.** An earlier measurement the same day put it at 4390, and
 * this one at 4611 - a 5% drift over hours. A genuine contract multiplier is a constant, so a
 * moving ratio means these two venues are not quoting the same unit of the same thing, and no
 * single number converts between them. That is a stronger reason to refuse it than "the
 * multiplier is 4611" would be: there is no correct value to hardcode.
 *
 * So the map below is a list of names VERIFIED to be 1000, not a rule derived from the prefix, and
 * `hlMultiplier` REFUSES anything absent from it. A new `k` listing arriving upstream returns
 * `null` and its caller shows "unavailable" rather than a price that is wrong by three orders of
 * magnitude.
 *
 * THE COST OF GETTING THIS WRONG IS ON THE RECORD. `lib/coins.ts` documents the -126% incident:
 * one place read a Bybit price without the factor while another applied it, and the Alert Track
 * Record's average 24h move went to -126%. #1651's OKX step 3 nearly repeated it from the opposite
 * direction - a premise that `ctVal` was a price factor, which measurement showed was a contract
 * size, and building to it would have multiplied PEPE by 10,000,000.
 *
 * TO ADD A NAME: measure its implied multiplier against a second venue's per-token price, twice,
 * hours apart. Add it only if both readings agree with each other and with a round figure. A
 * single reading cannot tell a constant from a drift, which is exactly how `kDOGS` would have got
 * in. */
export const HL_MULTIPLIER: Readonly<Record<string, number>> = {
  kBONK: 1000,
  kFLOKI: 1000,
  kLUNC: 1000,
  kNEIRO: 1000,
  kPEPE: 1000,
  kSHIB: 1000,
};

/* Names measured and DELIBERATELY REFUSED, kept so a later reader sees that the absence is a
   finding rather than an oversight. A name here is not "unsupported yet" - it is known not to
   convert. */
export const HL_REFUSED: Readonly<Record<string, string>> = {
  kDOGS: 'implied multiplier measured 4390 then 4611 hours apart on 2026-11-05 - a drifting '
    + 'ratio, so the two venues are not quoting the same unit and no constant converts it',
};

/**
 * Divide a Hyperliquid price by this to get a per-token price.
 *
 * Returns 1 for an ordinary name, the verified multiplier for a verified `k` name, and **`null`
 * for a `k` name that has not been verified** - which the caller must treat as a refusal, not as 1.
 * Returning 1 for an unverified `k` name would publish a price 1000x out; returning null makes the
 * gap visible.
 */
export function hlMultiplier(name: string): number | null {
  /* A RECORDED REFUSAL BEATS A MULTIPLIER, AND THE ORDER IS THE WHOLE POINT. QA's catch on #1976.
   *
   * As first written this consulted `HL_MULTIPLIER` first and `HL_REFUSED` not at all - the
   * refusal list was documentation nothing read. So the failure mode was precise and quiet:
   * someone measures `kDOGS` ONCE, gets a number that looks like a constant, adds it to
   * `HL_MULTIPLIER`, and their single reading silently outranks a recorded finding that two
   * readings hours apart disagreed. The comment above `HL_REFUSED` would still be sitting there
   * saying no constant converts it.
   *
   * Checking the refusal FIRST makes the two lists ordered rather than parallel: to start pricing
   * a refused name you have to delete its entry and its reason, which is a deliberate act a
   * reviewer can see, instead of an addition somewhere else that happens to win. */
  if (HL_REFUSED[name] !== undefined) return null;

  const known = HL_MULTIPLIER[name];
  if (known !== undefined) return known;
  if (isKPrefixed(name)) return null; // unverified 1000x candidate: refuse rather than guess
  return 1;
}

/* THE TWO LISTS MUST NOT OVERLAP, and this is checked rather than trusted.
 *
 * An overlap is not ambiguous - the refusal wins by the order above - but it means someone added a
 * multiplier for a name another line says cannot be converted, and silently getting the safe
 * outcome would leave that contradiction in the file for the next reader to resolve. Exported so a
 * test can assert it without importing internals; computed once, so it costs nothing at runtime. */
export const HL_MULTIPLIER_REFUSED_OVERLAP: string[] = Object.keys(HL_MULTIPLIER)
  .filter(n => HL_REFUSED[n] !== undefined);

/* `k` followed by an upper-case letter. Deliberately narrow: `kPEPE` is a 1000x listing while a
   hypothetical `kava`-style lower-case name is an ordinary ticker, and the venue spells its
   multiplied listings with the base in caps. Checked with a real name rather than a regex alone -
   every one of the seven measured above matches this and `BTC`/`ETH`/`SOL` do not. */
function isKPrefixed(name: string): boolean {
  return name.length >= 2 && name[0] === 'k' && name[1] >= 'A' && name[1] <= 'Z';
}

/** True when this name needs a multiplier we do not have - i.e. it must not be priced at all. */
export function hlIsUnpriceable(name: string): boolean {
  return hlMultiplier(name) === null;
}

/* ── ERRORS ────────────────────────────────────────────────────────────────────────────────────── */

export class HlError extends Error {
  readonly status: number;
  readonly bodyKind: 'plain-text' | 'null' | 'not-an-array' | 'empty';
  constructor(message: string, status: number, bodyKind: HlError['bodyKind']) {
    super(message);
    this.name = 'HlError';
    this.status = status;
    this.bodyKind = bodyKind;
  }
}

/* ── REQUEST BODIES ───────────────────────────────────────────────────────────────────────────── */

export interface HlCandleReq {
  type: 'candleSnapshot';
  req: { coin: string; interval: HlInterval; startTime: number; endTime: number };
}

/**
 * The POST body for a candle snapshot.
 *
 * `startTime`/`endTime` are milliseconds and BOTH are required - omitting either is one of the
 * measured 422 cases, not a defaulted request.
 */
export function hlCandleSnapshotBody(
  coin: string,
  interval: string,
  startTime: number,
  endTime: number,
): HlCandleReq {
  if (!isHlInterval(interval)) {
    throw new HlError(`not a Hyperliquid interval: ${interval}`, 0, 'plain-text');
  }
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    throw new HlError(`bad window: ${startTime}..${endTime}`, 0, 'plain-text');
  }
  return { type: 'candleSnapshot', req: { coin, interval, startTime, endTime } };
}

/** Bars a window spans, so a caller can see it is over the cap BEFORE spending a request. */
export function hlCandleCount(interval: string, startTime: number, endTime: number): number | null {
  const ms = hlIntervalToMs(interval);
  if (ms == null || endTime <= startTime) return null;
  return Math.ceil((endTime - startTime) / ms);
}

/**
 * Candles per request, measured rather than documented.
 *
 * Observed 5,097 returned for a 43,200-bar ask and 5,020 for an 8,640-bar ask, so the real limit
 * sits at about 5,000 and the exact cut is not a round number. Treated as 5,000 so a caller that
 * paginates to it is inside the cap rather than on it.
 */
export const HL_MAX_CANDLES = 5_000;

/* ── PARSING ──────────────────────────────────────────────────────────────────────────────────── */

export interface HlCandle {
  t: number; // open time, ms
  T: number; // close time, ms - the forming bar is the one whose T is in the future
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  n: number; // trade count
}

/* THE SAME GUARD `lib/okx.ts` NEEDED, AND FOR THE SAME REASON IT WAS WRONG THERE FIRST.
 *
 * `Number('')` is 0 and `Number.isFinite(0)` is true, so an empty string sails through a naive
 * finite check and becomes a real-looking zero. In `lib/okx.ts` that exact hole survived a comment
 * claiming to prevent it, and was only found by replaying a live response with a planted `high: ''`
 * - the parser kept it as `high: 0`. A zero high is not a missing high; it is a price.
 *
 * So: parse, reject non-finite, and let the CALLER decide the sign rule, because prices and volume
 * go opposite ways - a price must be > 0 while a volume of 0 is an ordinary quiet bar. */
function hlNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v !== 'string') return NaN;
  const s = v.trim();
  if (s === '') return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export interface ParseHlCandlesOptions {
  /** Drop the forming bar - the one whose `T` is still in the future. */
  closedOnly?: boolean;
  /** Injected for tests; defaults to `Date.now()`. */
  now?: number;
  /** Divide every price by this. Pass what `hlMultiplier` returned, never a literal. */
  multiplier?: number;
}

/**
 * Parse a `candleSnapshot` response.
 *
 * **Order is preserved as the venue sends it: OLDEST FIRST.** No reversal, unlike the OKX and Bybit
 * parsers, and that asymmetry is the single most likely thing to be "tidied up" by someone who has
 * just read one of those files. A reversal here silently inverts every series built from it.
 *
 * Throws `HlError` for the three measured failure shapes. Rows that are individually unusable are
 * dropped, and a response whose rows are ALL unusable throws rather than returning `[]`, because an
 * empty array reads as "no candles in this window", which is a legitimate answer and not this one.
 */
export function parseHlCandles(
  body: unknown,
  opts: ParseHlCandlesOptions = {},
): HlCandle[] {
  if (body === null || body === undefined) {
    /* The measured unknown-coin response: HTTP 500 with the body literally `null`. It PARSES, so a
       status-only check lets it through as a falsy value and a `?? []` turns it into "no candles". */
    throw new HlError('Hyperliquid returned null (unknown coin?)', 500, 'null');
  }
  if (typeof body === 'string') {
    /* Plain text reached the parser, which means the caller did not try/catch `JSON.parse`. The
       measured 422 body is `Failed to deserialize the JSON body into the target type`. */
    throw new HlError(`Hyperliquid returned plain text: ${body.slice(0, 120)}`, 422, 'plain-text');
  }
  if (!Array.isArray(body)) {
    throw new HlError('Hyperliquid candle body is not an array', 0, 'not-an-array');
  }

  const now = opts.now ?? Date.now();
  const mult = opts.multiplier ?? 1;
  if (!Number.isFinite(mult) || mult <= 0) {
    /* Catches `hlMultiplier`'s null being passed through as a number by accident. A refusal must
       not become a division by zero or a NaN series. */
    throw new HlError(`bad multiplier: ${String(opts.multiplier)}`, 0, 'not-an-array');
  }

  const out: HlCandle[] = [];
  for (const row of body) {
    if (row === null || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;

    const t = hlNum(r.t);
    const T = hlNum(r.T);
    const o = hlNum(r.o);
    const h = hlNum(r.h);
    const l = hlNum(r.l);
    const c = hlNum(r.c);
    const v = hlNum(r.v);
    const n = hlNum(r.n);

    // Timestamps must be real and ordered. T <= t would make the forming-bar test meaningless.
    if (!Number.isFinite(t) || !Number.isFinite(T) || T <= t) continue;
    // Prices: all four must be present and POSITIVE. Zero is not a price.
    if (!(o > 0) || !(h > 0) || !(l > 0) || !(c > 0)) continue;
    // Volume and trade count: zero is legitimate, negative is not.
    if (!(v >= 0) || !(n >= 0)) continue;
    // The forming bar is the one whose close time has not arrived. No `confirm` field exists.
    if (opts.closedOnly && T > now) continue;

    out.push({ t, T, o: o / mult, h: h / mult, l: l / mult, c: c / mult, v, n });
  }

  if (out.length === 0 && body.length > 0) {
    throw new HlError(
      `all ${body.length} Hyperliquid candles were unusable`, 0, 'empty',
    );
  }
  return out;
}

/**
 * To the bare `[openTime, open, high, low, close, volume, closeTime]` array the klines route's
 * other sources already emit, so the route's consumers need no new shape.
 *
 * Oldest-first is preserved here too.
 */
export function hlCandlesToBareArray(
  candles: readonly HlCandle[],
): Array<[number, string, string, string, string, string, number]> {
  return candles.map(k => [
    k.t, String(k.o), String(k.h), String(k.l), String(k.c), String(k.v), k.T,
  ]);
}

/* ── PRICES ───────────────────────────────────────────────────────────────────────────────────── */

export interface HlAssetCtx {
  name: string;
  /** Per-token, already divided by the multiplier. */
  price: number;
}

/**
 * Parse `metaAndAssetCtxs` into per-token prices.
 *
 * **A name whose multiplier is unverified is OMITTED, not priced at 1.** That is the whole point of
 * `hlMultiplier` returning null - see its comment. `refused` names it so a caller or a health check
 * can report "this venue lists it and we will not quote it" rather than the coin looking absent.
 *
 * `markPx` first, then `midPx`, then `oraclePx` - measured field order on the live response.
 */
export function parseHlAssetCtxs(body: unknown): { prices: HlAssetCtx[]; refused: string[] } {
  if (body === null || body === undefined) {
    throw new HlError('Hyperliquid returned null for metaAndAssetCtxs', 500, 'null');
  }
  if (typeof body === 'string') {
    throw new HlError(`Hyperliquid returned plain text: ${body.slice(0, 120)}`, 422, 'plain-text');
  }
  if (!Array.isArray(body) || body.length < 2) {
    throw new HlError('metaAndAssetCtxs is not a [meta, ctxs] pair', 0, 'not-an-array');
  }

  const meta = body[0] as { universe?: unknown };
  const ctxs = body[1];
  if (!Array.isArray(meta?.universe) || !Array.isArray(ctxs)) {
    throw new HlError('metaAndAssetCtxs is missing universe or ctxs', 0, 'not-an-array');
  }

  const prices: HlAssetCtx[] = [];
  const refused: string[] = [];

  /* Positional pairing: ctxs[i] describes universe[i]. The venue does not repeat the name in the
     ctx, so a length mismatch would silently shift every price onto the wrong asset - which is the
     same failure class as the ticker collision that paired two different assets in #1651 step 1,
     and it is why this bails instead of zipping what it has. */
  const n = Math.min(meta.universe.length, ctxs.length);
  if (meta.universe.length !== ctxs.length) {
    throw new HlError(
      `universe (${meta.universe.length}) and ctxs (${ctxs.length}) lengths differ, so positional `
      + 'pairing would attribute prices to the wrong assets', 0, 'not-an-array',
    );
  }

  for (let i = 0; i < n; i++) {
    const u = meta.universe[i] as { name?: unknown };
    const ctx = ctxs[i] as Record<string, unknown>;
    if (typeof u?.name !== 'string' || u.name === '') continue;

    const mult = hlMultiplier(u.name);
    if (mult === null) { refused.push(u.name); continue; }

    const px = hlNum(ctx?.markPx ?? ctx?.midPx ?? ctx?.oraclePx);
    if (!(px > 0)) continue;

    prices.push({ name: u.name, price: px / mult });
  }

  return { prices, refused };
}
