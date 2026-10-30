#!/usr/bin/env node
/* Generates lib/coinUniverse.generated.ts from what the exchanges actually trade (#1263).
 *
 * WHY THIS EXISTS. The coin list was 50 entries hand-written across five maps - COINS,
 * BINANCE_SYMS, BYBIT_SYMS, COIN_DEC, COIN_LABELS - and every new coin meant five edits in
 * agreement with each other. The owner has asked twice for "as many coins as possible". A list
 * that has to be typed is a list that stays at 50.
 *
 * THE SELECTION RULE: an instrument we can serve is one BOTH exchanges trade as a USDT
 * perpetual, right now. Bybit is the default source and Binance is the failover
 * (lib/klinesFailover.ts), so a coin on only one venue has no second source - the intersection
 * is not caution, it is the failover guarantee expressed as a list.
 *
 * SINGLE-VENUE EXCEPTIONS ARE EXPLICIT AND SMALL. Three instruments we already serve exist on
 * one venue only and are kept deliberately, because dropping them would remove a product
 * feature to satisfy a rule: `xau` and `spx` are Bybit-only synthetics (gold and the S&P), and
 * `fet` is Binance-only. They carry `oneVenue: true` so a caller can tell that a failover is
 * not available for them, rather than discovering it during an outage.
 *
 * THE 1000x TRAP, which this generator exists partly to stop recurring. Bybit quotes low-value
 * memecoins per 1000 tokens - `1000PEPEUSDT`, `1000BONKUSDT` - so every price read from those
 * symbols is 1000x the per-token price. That was an inline ternary in two places and MISSED in
 * a third, which recorded PEPE and BONK alert outcomes at plus or minus 100,000% and dragged
 * the whole Alert Track Record to -126%. Here the multiplier is DERIVED from the symbol the
 * exchange actually returned and written into the generated row, so a new 1000x listing cannot
 * arrive without its factor.
 *
 * Run: node scripts/generate-coins.mjs          (writes the file)
 *      node scripts/generate-coins.mjs --check  (exits 1 if the file is stale; no write)
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'coinUniverse.generated.ts');
const CHECK = process.argv.includes('--check');

/** Kept although only one venue lists them - see the header. */
const ONE_VENUE_KEEP = new Set(['xau', 'spx', 'fet']);

const j = async (url) => {
  const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
};

/**
 * `1000PEPE` -> { id: 'pepe', mult: 0.001 }. The multiplier converts that venue's quote to the
 * per-token price the app uses.
 *
 * ONLY THE PREFIXES A VENUE ACTUALLY QUOTES IN. The first version took any leading digits, and
 * **a leading digit in a quantity and a leading digit in a NAME are not distinguishable by
 * `/^(\d+)(.+)$/`.** Three real instruments are named with one:
 *
 *   0G    -> mult = 1/0 = Infinity   every price for that coin becomes Infinity
 *   2Z    -> mult = 0.5              every price halved
 *   1INCH -> id 'inch'               renders as INCH, charts as INCH/USDT
 *
 * `0G` also slipped the `dec !== null` filter, because `-log10(Infinity)` clamps to 0 instead of
 * producing NaN - so it shipped as a selectable coin with an infinite price. Found by QA's step-0
 * fixtures. It is the exact trap this file's header warns about, one function away from the
 * warning, which is the second time that has happened in this generator.
 *
 * Checked against all 463 rows: pepe, bonk, floki, mog, sats, rats, xec, cat, lunc, toshi, tag
 * and turbo are unchanged by the narrowing.
 */
function normaliseBase(base) {
  const m = /^(1000000|10000|1000)(.+)$/.exec(base);
  if (!m) return { id: base.toLowerCase(), mult: 1 };
  return { id: m[2].toLowerCase(), mult: 1 / Number(m[1]) };
}

/**
 * Decimals for the PER-TOKEN price, from the exchange's own tick size.
 *
 * THE MULTIPLIER HAS TO BE APPLIED HERE TOO, and the first version of this function did not -
 * which is the 1000x trap described in the header, reappearing one field away from the comment
 * warning about it. `1000PEPEUSDT` has a tick of 0.000001, so six decimals describe the price
 * of a THOUSAND tokens. The app displays one token, which needs three more. Caught by diffing
 * the generated values against the hand table: pepe and bonk came out at 6 where the hand
 * table said 8, and the hand table was right.
 *
 * Capped at 8 to match what the hand table shipped - the extra digit is below what any of
 * these venues quotes anyway.
 */
function decimalsFromTick(tick, mult = 1) {
  if (!(tick > 0)) return null;
  const perToken = tick * mult;
  const d = Math.round(-Math.log10(perToken));
  return Math.min(8, Math.max(0, d));
}

const [byInst, byTick, bnInfo, bnTick] = await Promise.all([
  j('https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000'),
  j('https://api.bybit.com/v5/market/tickers?category=linear'),
  j('https://fapi.binance.com/fapi/v1/exchangeInfo'),
  j('https://fapi.binance.com/fapi/v1/ticker/24hr'),
]);

const byTurnover = new Map((byTick.result?.list ?? []).map(t => [t.symbol, Number(t.turnover24h) || 0]));
const bybit = new Map();
for (const i of byInst.result?.list ?? []) {
  if (i.quoteCoin !== 'USDT' || i.status !== 'Trading' || i.contractType !== 'LinearPerpetual') continue;
  const { id, mult } = normaliseBase(i.baseCoin);
  bybit.set(id, {
    symbol: i.symbol,
    mult,
    tick: Number(i.priceFilter?.tickSize) || 0,
    turnover: byTurnover.get(i.symbol) ?? 0,
  });
}

const bnVolume = new Map(bnTick.map(t => [t.symbol, Number(t.quoteVolume) || 0]));
const binance = new Map();
for (const s of bnInfo.symbols ?? []) {
  if (s.quoteAsset !== 'USDT' || s.status !== 'TRADING' || s.contractType !== 'PERPETUAL') continue;
  const { id, mult } = normaliseBase(s.baseAsset);
  const tick = Number((s.filters ?? []).find(f => f.filterType === 'PRICE_FILTER')?.tickSize) || 0;
  binance.set(id, { symbol: s.symbol, mult, tick, volume: bnVolume.get(s.symbol) ?? 0 });
}

const ids = new Set([...bybit.keys()].filter(id => binance.has(id)));
for (const id of ONE_VENUE_KEEP) if (bybit.has(id) || binance.has(id)) ids.add(id);

const rows = [...ids].map(id => {
  const b = bybit.get(id);
  const n = binance.get(id);
  const oneVenue = !b || !n;
  /* Rank on the THINNER venue: a coin is only as tradable as its weaker side, and that is the
     side a failover read lands on. A single-venue instrument ranks on the venue it has. */
  const liq = oneVenue ? (b?.turnover ?? n?.volume ?? 0) : Math.min(b.turnover, n.volume);
  /* ONE MULTIPLIER PER VENUE, because the two venues do not always agree.
     `sats` is quoted as 10000SATS on Bybit and 1000SATS on Binance, so a single `mult` describes
     one of them and is out by 10x on the other. A failover read - the entire reason both venues
     are required - would then return a wrong price at exactly the moment the primary fails.
     `toshi`, `tag` and `turbo` differ the same way and were safe only because of which direction
     the conversion happens to run in. That is luck, not design, and a price wrong by 10x to
     1000x is wrong data rather than sparse data. */
  return {
    id,
    bybit: b?.symbol ?? null,
    binance: n?.symbol ?? null,
    bybitMult: b?.mult ?? 1,
    binanceMult: n?.mult ?? 1,
    /* Decimals follow Bybit, the default price source, falling back to Binance when that is the
       only venue. */
    dec: b ? decimalsFromTick(b.tick, b.mult) : decimalsFromTick(n.tick, n.mult),
    oneVenue,
    liq,
  };
}).filter(r => r.dec !== null)
  .sort((a, b) => b.liq - a.liq);

const body = `/* GENERATED by scripts/generate-coins.mjs - DO NOT EDIT BY HAND.
 *
 * Every instrument both Bybit and Binance trade as a USDT perpetual, ranked by 24h turnover on
 * the THINNER of the two venues, plus the explicit single-venue instruments listed in the
 * generator. Regenerate with: node scripts/generate-coins.mjs
 *
 * \`mult\` converts an exchange price to the per-token price the app uses - 0.001 for the 1000x
 * memecoin listings. \`dec\` comes from the exchange tick size. \`oneVenue\` marks an instrument
 * with no failover.
 *
 * Generated: ${new Date().toISOString()}
 * Instruments: ${rows.length} (${rows.filter(r => r.oneVenue).length} single-venue)
 */

export interface CoinRow {
  readonly id: string;
  readonly bybit: string | null;
  readonly binance: string | null;
  /** Converts a BYBIT quote to the per-token price. */
  readonly bybitMult: number;
  /** Converts a BINANCE quote to the per-token price. The two differ on sats, toshi, tag, turbo. */
  readonly binanceMult: number;
  readonly dec: number;
  readonly oneVenue: boolean;
}

export const COIN_UNIVERSE: readonly CoinRow[] = [
${rows.map(r => `  { id: '${r.id}', bybit: ${r.bybit ? `'${r.bybit}'` : 'null'}, binance: ${r.binance ? `'${r.binance}'` : 'null'}, bybitMult: ${r.bybitMult}, binanceMult: ${r.binanceMult}, dec: ${r.dec}, oneVenue: ${r.oneVenue} },`).join('\n')}
];
`;

if (CHECK) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  const strip = s => s.replace(/^ \* Generated: .*$/m, '');
  if (strip(current) === strip(body)) { console.log(`up to date: ${rows.length} instruments`); process.exit(0); }
  console.error(`STALE: regenerate lib/coinUniverse.generated.ts (would be ${rows.length} instruments)`);
  process.exit(1);
}

writeFileSync(OUT, body);
console.log(`wrote ${rows.length} instruments (${rows.filter(r => r.oneVenue).length} single-venue) to lib/coinUniverse.generated.ts`);
