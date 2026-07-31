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
  xau: 'XAU', spx: 'SPX',
};
