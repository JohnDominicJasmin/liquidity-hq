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

// Binance perp futures symbols — pepe/bonk/hype/xau/spx excluded (Bybit-only)
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
  // pepe/bonk: Binance uses 1000x denomination — kept Bybit-only to avoid display confusion
  // hype/xau/spx: Bybit-only perps
};

// Bybit linear perp symbols — includes all coins + 1000x meme coins + synthetics
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
  tao: 'TAOUSDT', fet: 'FETUSDT',
  ondo: 'ONDOUSDT', pyth: 'PYTHUSDT', ena: 'ENAUSDT', dydx: 'DYDXUSDT',
  sand: 'SANDUSDT', mana: 'MANAUSDT', gmt: 'GMTUSDT',
  xau: 'XAUUSDT', spx: 'SPXUSDT',
};

export const COIN_DEC: Record<CoinId, number> = {
  btc: 2, eth: 2, sol: 3, xrp: 4, bnb: 2, hype: 3, near: 4, sui: 4,
  doge: 5, avax: 3, link: 3, ada: 4, dot: 3, atom: 3, wif: 4,
  pepe: 8, bonk: 8,
  ltc: 2, bch: 2, trx: 5, xlm: 5, etc: 3, fil: 3,
  arb: 4, op: 4, apt: 3, sei: 5, inj: 3, tia: 3,
  aave: 2, uni: 3, ldo: 4, rune: 3, gmx: 2, crv: 5,
  stx: 4, jup: 4, wld: 4, render: 3, tao: 2, fet: 4,
  ondo: 4, pyth: 5, ena: 4, dydx: 4,
  sand: 4, mana: 4, gmt: 5,
  xau: 2, spx: 0,
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
