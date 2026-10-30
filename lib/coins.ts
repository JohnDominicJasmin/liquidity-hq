export type CoinId =
  | 'btc' | 'eth' | 'sol' | 'xrp' | 'bnb' | 'hype' | 'near' | 'sui'
  | 'doge' | 'avax' | 'link' | 'ada' | 'dot' | 'atom' | 'wif' | 'pepe' | 'bonk'
  | 'ltc' | 'bch' | 'trx' | 'xlm' | 'etc' | 'fil'
  | 'arb' | 'op' | 'apt' | 'sei' | 'inj' | 'tia'
  | 'aave' | 'uni' | 'ldo' | 'rune' | 'gmx' | 'crv'
  | 'stx' | 'jup' | 'wld' | 'render' | 'tao' | 'fet'
  | 'ondo' | 'pyth' | 'ena' | 'dydx'
  | 'sand' | 'mana' | 'gmt'
  | 'xau' | 'spx';

export const COINS: CoinId[] = [
  'btc', 'eth', 'sol', 'xrp', 'bnb', 'hype', 'near', 'sui',
  'doge', 'avax', 'link', 'ada', 'dot', 'atom', 'wif', 'pepe', 'bonk',
  'ltc', 'bch', 'trx', 'xlm', 'etc', 'fil',
  'arb', 'op', 'apt', 'sei', 'inj', 'tia',
  'aave', 'uni', 'ldo', 'rune', 'gmx', 'crv',
  'stx', 'jup', 'wld', 'render', 'tao', 'fet',
  'ondo', 'pyth', 'ena', 'dydx',
  'sand', 'mana', 'gmt',
  'xau', 'spx',
];

// Binance perp futures symbols - pepe/bonk/hype/xau/spx excluded (Bybit-only)
export const BINANCE_SYMS: Record<string, string> = {
  btc: 'BTCUSDT', eth: 'ETHUSDT', sol: 'SOLUSDT',
  xrp: 'XRPUSDT', bnb: 'BNBUSDT', near: 'NEARUSDT', sui: 'SUIUSDT',
  doge: 'DOGEUSDT', avax: 'AVAXUSDT', link: 'LINKUSDT',
  ada: 'ADAUSDT', dot: 'DOTUSDT', atom: 'ATOMUSDT', wif: 'WIFUSDT',
  ltc: 'LTCUSDT', bch: 'BCHUSDT', trx: 'TRXUSDT', xlm: 'XLMUSDT',
  etc: 'ETCUSDT', fil: 'FILUSDT',
  arb: 'ARBUSDT', op: 'OPUSDT', apt: 'APTUSDT', sei: 'SEIUSDT',
  inj: 'INJUSDT', tia: 'TIAUSDT',
  aave: 'AAVEUSDT', uni: 'UNIUSDT', ldo: 'LDOUSDT', rune: 'RUNEUSDT',
  gmx: 'GMXUSDT', crv: 'CRVUSDT',
  stx: 'STXUSDT', jup: 'JUPUSDT', wld: 'WLDUSDT', render: 'RENDERUSDT',
  tao: 'TAOUSDT', fet: 'FETUSDT',
  ondo: 'ONDOUSDT', pyth: 'PYTHUSDT', ena: 'ENAUSDT', dydx: 'DYDXUSDT',
  sand: 'SANDUSDT', mana: 'MANAUSDT', gmt: 'GMTUSDT',
  // pepe/bonk: Binance uses 1000x denomination - kept Bybit-only to avoid display confusion
  // hype/xau/spx: Bybit-only perps
};

/* The Arena chart deliberately plots PEPE and BONK in Bybit's own 1000-token
   denomination, unlike everywhere else in the app.
 *
 * Not a preference - klinecharts cannot render them per-token. At ~0.0000027 a
 * candle spans about 2e-8 and the library's axis degenerates: it produces a
 * range roughly 150x too wide, centred on zero, complete with negative price
 * ticks, and the candles collapse to a flat line. Raising pricePrecision to 10
 * was tried and changed only the tick LABELS, not the range, so the cause is
 * inside klinecharts' scale handling rather than our precision setting.
 *
 * So the chart keeps the raw contract price and SAYS so - hence the 1000 prefix
 * in the label. Everything else in the app (ticker, alerts, outcome tracking,
 * EMA Signal card, Market Structure card, Confluence Score) is per-token.
 *
 * Nothing leaks out of the chart at this scale: its two internal consumers of
 * the last close are a pixel conversion and a percentage distance to S/R, both
 * scale-invariant. Revisit if klinecharts fixes small-value axes - the fix is
 * to delete this and re-apply bybitSymbolPriceFactor in the chart's fetches. */
export function chartDisplaySymbol(coin: string): string {
  const prefix = BYBIT_SYMS[coin]?.startsWith('1000') && !BINANCE_SYMS[coin] ? '1000' : '';
  return `${prefix}${coin.toUpperCase()}/USDT`;
}

/* Bybit quotes the low-unit-price meme perps per 1000 tokens - 1000PEPEUSDT,
   1000BONKUSDT - so ANY price read from those symbols is 1000x the per-token
   price every other part of this app uses. Multiply by this factor to convert.

   This existed as an inline `sym.startsWith('1000') ? 0.001 : 1` in two places
   and was missed in a third: app/api/alert-outcomes/resolve recorded price_24h
   straight from Bybit while price_at_fire was already normalised, giving PEPE
   and BONK outcomes of ±100,000%. That dragged the Alert Track Record's average
   24h move to -126% when the real median across 6,201 fires is +0.28%.

   Any new code reading a price, kline or level from BYBIT_SYMS must apply this.
   The failure is silent and only shows up on two coins. */
export function bybitPriceFactor(coin: string): number {
  return BYBIT_SYMS[coin]?.startsWith('1000') ? 0.001 : 1;
}

/** Same conversion when only the symbol is in hand, not the coin id. */
export function bybitSymbolPriceFactor(symbol: string): number {
  return symbol.startsWith('1000') ? 0.001 : 1;
}

// Bybit linear perp symbols - includes all coins + 1000x meme coins + synthetics
export const BYBIT_SYMS: Record<string, string> = {
  btc: 'BTCUSDT', eth: 'ETHUSDT', sol: 'SOLUSDT',
  xrp: 'XRPUSDT', bnb: 'BNBUSDT', hype: 'HYPEUSDT', near: 'NEARUSDT', sui: 'SUIUSDT',
  doge: 'DOGEUSDT', avax: 'AVAXUSDT', link: 'LINKUSDT',
  ada: 'ADAUSDT', dot: 'DOTUSDT', atom: 'ATOMUSDT', wif: 'WIFUSDT',
  pepe: '1000PEPEUSDT', bonk: '1000BONKUSDT',
  ltc: 'LTCUSDT', bch: 'BCHUSDT', trx: 'TRXUSDT', xlm: 'XLMUSDT',
  etc: 'ETCUSDT', fil: 'FILUSDT',
  arb: 'ARBUSDT', op: 'OPUSDT', apt: 'APTUSDT', sei: 'SEIUSDT',
  inj: 'INJUSDT', tia: 'TIAUSDT',
  aave: 'AAVEUSDT', uni: 'UNIUSDT', ldo: 'LDOUSDT', rune: 'RUNEUSDT',
  gmx: 'GMXUSDT', crv: 'CRVUSDT',
  stx: 'STXUSDT', jup: 'JUPUSDT', wld: 'WLDUSDT', render: 'RENDERUSDT',
  tao: 'TAOUSDT',
  // fet: Binance-only - Bybit does not list FETUSDT as a linear perp
  ondo: 'ONDOUSDT', pyth: 'PYTHUSDT', ena: 'ENAUSDT', dydx: 'DYDXUSDT',
  sand: 'SANDUSDT', mana: 'MANAUSDT', gmt: 'GMTUSDT',
  xau: 'XAUUSDT', spx: 'SPXUSDT',
};

/* Reverse of BINANCE_SYMS - given a Binance symbol, which coin it is. Shared
 * across every #1077 server-side failover route that fans out over
 * BINANCE_SYMS and needs to find that coin's Bybit equivalent (or discover
 * there isn't one, e.g. fet - "Bybit does not list FETUSDT as a linear
 * perp", above). app/api/market/klines/route.ts still keeps its own local
 * copy rather than importing this - out of scope here, not overlooked. */
export const BINANCE_SYM_TO_COIN: Record<string, string> = Object.fromEntries(
  Object.entries(BINANCE_SYMS).map(([coin, sym]) => [sym, coin]),
);

export const COIN_DEC: Record<CoinId, number> = {
  btc: 2, eth: 2, sol: 3, xrp: 4, bnb: 2, hype: 3, near: 4, sui: 4,
  doge: 5, avax: 3, link: 3, ada: 4, dot: 3, atom: 3, wif: 4,
  pepe: 8, bonk: 8,
  ltc: 2, bch: 2, trx: 4, xlm: 4, etc: 3, fil: 4,
  arb: 5, op: 5, apt: 4, sei: 5, inj: 3, tia: 4,
  aave: 2, uni: 3, ldo: 4, rune: 4, gmx: 3, crv: 4,
  stx: 4, jup: 4, wld: 4, render: 3, tao: 2, fet: 4,
  ondo: 4, pyth: 5, ena: 5, dydx: 4,
  sand: 5, mana: 5, gmt: 5,
  xau: 2, spx: 4,
};

export const COIN_LABELS: Record<CoinId, string> = {
  btc: 'BTC', eth: 'ETH', sol: 'SOL', xrp: 'XRP',
  bnb: 'BNB', hype: 'HYPE', near: 'NEAR', sui: 'SUI',
  doge: 'DOGE', avax: 'AVAX', link: 'LINK', ada: 'ADA',
  dot: 'DOT', atom: 'ATOM', wif: 'WIF', pepe: 'PEPE', bonk: 'BONK',
  ltc: 'LTC', bch: 'BCH', trx: 'TRX', xlm: 'XLM', etc: 'ETC', fil: 'FIL',
  arb: 'ARB', op: 'OP', apt: 'APT', sei: 'SEI', inj: 'INJ', tia: 'TIA',
  aave: 'AAVE', uni: 'UNI', ldo: 'LDO', rune: 'RUNE', gmx: 'GMX', crv: 'CRV',
  stx: 'STX', jup: 'JUP', wld: 'WLD', render: 'RENDER', tao: 'TAO', fet: 'FET',
  ondo: 'ONDO', pyth: 'PYTH', ena: 'ENA', dydx: 'DYDX',
  sand: 'SAND', mana: 'MANA', gmt: 'GMT',
  xau: 'XAU',
  /* SPXUSDT IS SPX6900, A MEMECOIN - NOT THE S&P 500, which this app carries separately as
     store.macro.spx from Yahoo ^GSPC and labels SPX in the macro strip. Checked against both
     venues' instrument metadata rather than assumed: Bybit baseCoin=SPX at $0.3622, Binance
     baseAsset=SPX at $0.3628, 0.17% apart, same asset. The S&P 500 is around 6,800. The control
     that makes that readable is XAUUSDT on the same venue at $3,886 - real gold - so the venue
     does list genuine synthetics and $0.36 is not a quoting artefact.
     Rendered as `SPX` beside `XAU` it asserts "this is the S&P 500" to anyone reading the two
     together, on the most public page in the product. */
  spx: 'SPX6900',
};

/* THE ONE WAY TO RENDER A COIN'S NAME. Use this, never `id.toUpperCase()`.
 *
 * WHY A HELPER FOR A ONE-LINE LOOKUP. The label is EDITORIAL for at least one coin - `spx` is
 * SPX6900, above - and a renderer that upper-cases the id silently ignores that. Measured
 * tonight: 26 files in app/ and components/ upper-case a coin id and never import COIN_LABELS,
 * 8 do. So the rename reached 8 surfaces and missed 26, including `components/LandingTicker.tsx`
 * - the landing page. A visitor who knows what SPX means read a ticker claiming we track the
 * S&P 500.
 *
 * **Shipping a rename on 8 of 34 surfaces is worse than not shipping it**, because it turns "we
 * know this is wrong everywhere" into "we believe this is fixed", and that is where the next
 * reader stops looking.
 *
 * THIRD TIME TONIGHT for the same shape: `binancePriceFactor` with zero call sites, the universe
 * price pass missing the multiplier, and now a label override 26 renderers bypass. **A fix that
 * exists and is not applied everywhere is indistinguishable from no fix.** One function is what
 * makes the fourth instance impossible rather than merely unlikely.
 *
 * Falls back to the uppercased id, so an unknown or generated coin renders sensibly instead of
 * `undefined` - the fallback is the reason this is safe to use at every call site, including the
 * ones reading ids that are not in the curated map. */
export function coinLabel(coin: string): string {
  /* Widened on purpose: the parameter is `string` so EVERY call site can use this, including
     the ones holding an id that is not in the curated union - a generated coin, a value off a
     feed, a URL parameter. Narrowing it to CoinId would send those call sites back to
     `.toUpperCase()`, which is the bypass this function exists to remove. */
  return (COIN_LABELS as Record<string, string>)[coin] ?? coin.toUpperCase();
}
