/* OKX candles: the dialect and the normalisation, as pure functions (#1651, step 2 of OKX).
 *
 * DEPENDENCY-FREE AND IN `lib/`, the same split as `lib/venueFallback.ts` and `lib/econCoverage.ts`:
 * the decisions below should not need a route, a request or a live exchange to exercise. Everything
 * here is a function of its arguments, so every trap it guards can be a unit cell with a mutation.
 *
 * ── THE FIVE WAYS AN OKX CANDLE FETCH RETURNS THE WRONG WINDOW ─────────────────────────────────
 *
 * All five were measured against the live API before this file was written, not read from docs.
 * Each one is silent: none produces an error, and four of them produce a plausible-looking array.
 *
 *   1. NEWEST-FIRST. `data[0]` is the most recent bar. Bybit is the same and `lib/useEMAStrategy.ts`
 *      reverses it; Binance is oldest-first and does not. A caller that forgets gets a chart drawn
 *      backwards, which reads as a market that moved the other way.
 *
 *   2. THE FORMING BAR COMES BACK, flagged `confirm: '0'` in the last column. Its close is "the
 *      price right now", so an indicator computed over it changes value every poll and a signal
 *      can fire and un-fire. The Bybit path passes `closed=1` upstream for the same reason.
 *
 *   3. `limit` CAPS SILENTLY AT 300. Asking for 500 returns 300 rows with `code: '0'` and no
 *      message. So a caller that needs 500 candles for a 200-period average gets 300 and a
 *      confidently wrong answer rather than an error. **This is the one with no upstream signal at
 *      all** - the only defence is refusing the request on our side.
 *
 *   4. `bar` IS CASE-SENSITIVE. `4H` works; `4h` returns `code: '51000' Parameter bar error`. The
 *      minute bars are lowercase (`15m`) and the hour, day and week bars are uppercase (`4H`, `1D`,
 *      `1W`), so a single `.toLowerCase()` or `.toUpperCase()` anywhere in the chain breaks half the
 *      timeframes and leaves the other half working.
 *
 *   5. ERRORS ARRIVE ON HTTP 200, with the code in the body. An unknown instrument is
 *      `{ code: '51001', msg: "Instrument ID ... doesn't exist", data: [] }` and the HTTP status is
 *      200. So `r.ok` sees nothing wrong and `data: []` reads as "this instrument has no candles",
 *      which is indistinguishable from a real empty window. `lib/bybitKlines.ts` has the same
 *      lesson written on it about our own route's 502s: a refusal parsed as zero rows is the
 *      conflation that makes an outage silent.
 *
 * NO PRICE MULTIPLIER, and that is a guarantee rather than an omission. OKX quotes these per token -
 * measured on PEPE, BONK, SHIB and FLOKI against both other venues at ratios of 1.000 - and lists no
 * `1000X` instrument at all. `scripts/generate-coins.mjs` re-measures every venue pair on every
 * generation and REFUSES to write the file if OKX ever disagrees by more than 2x, so a future 1000x
 * listing cannot arrive unnoticed. That is a stronger promise than the `startsWith('1000')` symbol
 * heuristic the Bybit and Binance paths use, which only works while the venue keeps naming it that way.
 */

/** OKX's hard cap on `limit` for `/market/candles`. Asking for more returns this many, silently. */
export const OKX_MAX_LIMIT = 300;

/** The `bar` values this app uses, in OKX's own spelling. Case matters - see trap 4.
 *
 *  Deliberately NOT a translation table from another venue's dialect. `app/api/market/klines/route.ts`
 *  says it about its own two: *"Deliberately not translated between them - each caller already knows
 *  which dialect it wants, and silently rewriting an interval is how a chart ends up showing a
 *  timeframe nobody asked for."* Same rule here. */
export const OKX_BARS = [
  '1m', '3m', '5m', '15m', '30m',
  '1H', '2H', '4H', '6H', '12H',
  '1D', '1W', '1M',
] as const;

export type OkxBar = (typeof OKX_BARS)[number];

const BAR_SET: ReadonlySet<string> = new Set(OKX_BARS);

/** Is this exactly an OKX bar, case included? A near-miss must fail here rather than at OKX. */
export function isOkxBar(bar: string): bar is OkxBar {
  return BAR_SET.has(bar);
}

/** An OKX instrument id for a USDT-settled perpetual - `BTC-USDT-SWAP`.
 *
 *  Shape-checked, never CONSTRUCTED from a coin id. The id comes from the `okx` column of
 *  `lib/coinUniverse.generated.ts`, which is written from OKX's own instruments endpoint, because
 *  three tickers name a different asset on OKX than on Bybit and Binance (`bb`, `qnt`) or on
 *  Binance than on the other two (`on`). Deriving `<ID>-USDT-SWAP` would have shipped all three. */
export function isOkxInstId(instId: string): boolean {
  return /^[A-Z0-9]+(?:-[A-Z0-9]+)*-USDT-SWAP$/.test(instId);
}

/** One normalised candle. The same six fields every existing kline caller reads positionally. */
export interface OkxCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OkxCandlesBody {
  code?: unknown;
  msg?: unknown;
  data?: unknown;
}

export class OkxError extends Error {
  readonly code: string;
  constructor(code: string, msg: string) {
    super(`OKX ${code}${msg ? `: ${msg}` : ''}`);
    this.name = 'OkxError';
    this.code = code;
  }
}

/** The query string for `https://www.okx.com/api/v5/market/candles`.
 *
 *  REFUSES a limit above the cap instead of sending it, because OKX answers an over-limit request
 *  with `code: '0'` and fewer rows (trap 3). A caller that needs more than 300 bars needs to page
 *  with `before`/`after`, and should find that out here rather than from a short array. */
export function okxCandlesParams(instId: string, bar: string, limit: number): URLSearchParams {
  if (!isOkxInstId(instId)) throw new Error(`not an OKX USDT-swap instrument id: ${JSON.stringify(instId)}`);
  if (!isOkxBar(bar)) {
    throw new Error(
      `not an OKX bar: ${JSON.stringify(bar)}. Case matters - 4H not 4h. Valid: ${OKX_BARS.join(', ')}`,
    );
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > OKX_MAX_LIMIT) {
    throw new Error(
      `limit ${limit} is outside 1..${OKX_MAX_LIMIT}. OKX silently returns ${OKX_MAX_LIMIT} rows for a`
      + ' larger limit with code 0, so asking for more would yield a short window and no error.',
    );
  }
  return new URLSearchParams({ instId, bar, limit: String(limit) });
}

/** A number from an OKX field, or NaN - and `''` must be NaN, not 0.
 *
 *  `Number('')` IS 0 AND `Number.isFinite(0)` IS TRUE, so a field OKX sent empty sails through a
 *  finite check as a perfectly plausible zero. This function existed as a comment claiming the
 *  check was there before it existed as code: the first version of `parseOkxCandles` mapped with
 *  `Number()` and filtered with `Number.isFinite`, and a planted row carrying `high: ''` was kept
 *  with `high: 0` while the comment above it said a missing price could not become a zero.
 *
 *  Found by running the module against the live API with a planted bad row rather than by reading
 *  it - the same shape as `parseInt(x ?? '50')` putting a FLAT reading on a failed feed, and the
 *  reason `isNaN` is never enough on its own. */
function okxNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v !== 'string') return NaN;
  const s = v.trim();
  if (s === '') return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export interface ParseOkxCandlesOptions {
  /** Keep the forming bar (`confirm: '0'`). Off by default - see trap 2. */
  includeForming?: boolean;
}

/** Turns an OKX candles body into oldest-first closed candles, or throws.
 *
 *  THROWS ON A NON-ZERO `code` EVEN THOUGH THE HTTP STATUS WAS 200 (trap 5). An empty `data` with
 *  `code: '0'` is returned as `[]` - a real empty window - and that distinction is the whole point:
 *  the caller can tell "OKX refused" from "this instrument has no candles here", which is exactly
 *  the conflation `lib/bybitKlines.ts` was written to stop for our own route.
 *
 *  A ROW THAT DOES NOT PARSE IS DROPPED AND COUNTED, not silently skipped: `dropped` is returned so
 *  a caller can refuse a window that arrived half-broken rather than compute an indicator over it. */
export function parseOkxCandles(
  body: OkxCandlesBody,
  opts: ParseOkxCandlesOptions = {},
): { candles: OkxCandle[]; dropped: number; forming: number } {
  const code = typeof body?.code === 'string' ? body.code : String(body?.code ?? '');
  if (code !== '0') {
    throw new OkxError(code || '(missing)', typeof body?.msg === 'string' ? body.msg : '');
  }
  const rows = Array.isArray(body?.data) ? body.data : [];

  let dropped = 0;
  let forming = 0;
  const out: OkxCandle[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) { dropped++; continue; }
    /* `confirm` is the LAST column and its index has moved between API versions, so it is read from
       the end rather than at a fixed 8. A row too short to carry it is dropped above. */
    const confirm = row.length >= 9 ? String(row[8]) : String(row[row.length - 1]);
    const isForming = confirm !== '1';
    if (isForming) {
      forming++;
      if (!opts.includeForming) continue;
    }
    const time = okxNum(row[0]);
    const open = okxNum(row[1]);
    const high = okxNum(row[2]);
    const low = okxNum(row[3]);
    const close = okxNum(row[4]);
    const volume = okxNum(row[5]);
    /* EVERY FIELD CHECKED, through `okxNum` and not `Number` - see its comment for why that
       distinction is the whole guard rather than a style choice.
       THE FOUR PRICES MUST BE POSITIVE, volume merely non-negative: a candle priced at 0 is not a
       candle, while a bar that genuinely traded nothing has a volume of 0. Treating them the same
       would either admit a zero-priced bar or drop every quiet bar. */
    if (![time, open, high, low, close, volume].every(Number.isFinite)) { dropped++; continue; }
    if (time <= 0 || open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0) { dropped++; continue; }
    out.push({ time, open, high, low, close, volume });
  }

  /* OLDEST-FIRST (trap 1). Sorted rather than reversed: `reverse()` assumes the response really is
     newest-first, and a sort is correct whichever order it arrives in. The cost is nothing at 300
     rows, and the failure it prevents - a chart drawn backwards - is silent. */
  out.sort((a, b) => a.time - b.time);
  return { candles: out, dropped, forming };
}
