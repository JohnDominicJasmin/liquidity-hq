export type NewsType = 'red' | 'amber' | 'purple';

// ── RED: War, geopolitical shock, crash, blockade ────────────────────────────
const RED_KW = [
  // War / military
  'war','military','attack','invasion','missile','nuclear','airstrike','air strike',
  'bomb','explosion','troops','conflict','ceasefire','naval','warship','carrier',
  'troops deploy','deploy troops','ground troops','offensive','combat','battle',
  // Blockades / strait / shipping
  'blockade','strait','hormuz','bab el-mandeb','bab-el-mandeb','suez','shipping lane',
  'tanker seized','seized vessel','tanker attack','oil tanker','drone attack','infrastructure attack',
  'energy infrastructure','pipeline attack','oil pipeline','gas pipeline',
  // Geopolitical actors
  'trump','white house','pentagon','nato','executive order',
  'houthi','hamas','hezbollah','isis','al-qaeda',
  // Economic shock
  'crash','collapse','default','emergency','ban','banned','banning','sanction','sanctions','freeze','seized',
  'emergency declaration','martial law','state of emergency',
  // Cyber
  'cyberattack','cyber attack','hack','hacked','hacker','hackers','hacking','ransomware','infrastructure hack',
];

// ── AMBER: Macro / central banks / regulation ────────────────────────────────
const AMBER_KW = [
  // Fed / central banks
  'fed','federal reserve','powell','fomc','rate hike','rate cut','interest rate',
  'ecb','bank of england','boj','pboc','central bank',
  // Macro data
  'cpi','inflation','gdp','unemployment','recession','jobs report','nonfarm','nfp',
  'pce','ppi','retail sales','consumer confidence','jobless claims',
  // Geopolitical actors (secondary tier)
  'china','russia','iran','israel','ukraine','north korea','taiwan','india',
  // Regulation
  'sec','regulation','congress','senate','bill','law','regulate',
  // Energy / commodities
  'opec','oil','crude','energy','gas prices','oil price','commodity',
  // Trade
  'tariff','trade war','trade deal','trade policy','import duty','export ban',
];

// ── PURPLE: Crypto-specific ──────────────────────────────────────────────────
const PURPLE_KW = [
  'bitcoin','btc','ethereum','eth','solana','sol','xrp','ripple','bnb','binance',
  'crypto','blockchain','defi','stablecoin','usdt','usdc','tether',
  'coinbase','sec crypto','etf','halving','crypto ban','crypto law','crypto regulation',
  'grayscale','microstrategy','blackrock bitcoin','fidelity bitcoin','spot etf',
  'liquidation','funding rate','open interest','perpetual','futures crypto',
  'altcoin','meme coin','memecoin','nft','web3','layer 2','lightning network',
  'near protocol','sui','hyperliquid','hype',
  'litecoin','bitcoin cash','tron','stellar','filecoin',
  'arbitrum','optimism','aptos','injective','celestia',
  'aave','uniswap','lido','thorchain','gmx','curve',
  'stacks','jupiter','worldcoin','render','bittensor','fetch.ai',
  'ondo','pyth','ethena','dydx',
  'sandbox','decentraland','stepn',
];

/* KEYWORDS ARE MATCHED AS WORDS, NOT AS SUBSTRINGS (N1, N2). t.includes('ban') made "bank" and "Urban" Breaking, 'war' matched "award" and "software", 'sec' "second" and "security", 'fed' "federal", 'isis' "crisis", 'pla'
   "plan" and "place", 'daly' "daily": "Bank of England holds rates" was RED = Breaking (2 h on the ticker, a desktop notification and a Telegram Breaking Alert). A SHORT keyword (4 letters or fewer) must be a whole word (an
   optional plural s allowed); a longer one must START a word, so "hacked", "sanctions" and "attacks" still match. Compiled once. */
const kwRegexCache = new Map<string, RegExp>();
function kwRegex(kw: string): RegExp {
  let re = kwRegexCache.get(kw);
  if (!re) {
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = kw.length <= 4 ? new RegExp(`(?<![a-z0-9])${esc}s?(?![a-z0-9])`) : new RegExp(`(?<![a-z0-9])${esc}`);
    kwRegexCache.set(kw, re);
  }
  return re;
}
/** True when `text` (any case) contains `kw` as a word (short keywords) or as the start of a word (longer ones). */
export function hasKeyword(text: string, kw: string): boolean {
  return kwRegex(kw).test(text.toLowerCase());
}
/** True when any keyword of the group is present as above. */
export function hasAnyKeyword(text: string, kws: readonly string[]): boolean {
  const t = text.toLowerCase();
  return kws.some(kw => kwRegex(kw).test(t));
}

export function classifyNews(text: string): NewsType | null {
  const t = text.toLowerCase();
  for (const kw of RED_KW)    if (kwRegex(kw).test(t)) return 'red';
  for (const kw of AMBER_KW)  if (kwRegex(kw).test(t)) return 'amber';
  for (const kw of PURPLE_KW) if (kwRegex(kw).test(t)) return 'purple';
  return null;
}

/* THE BREAKING TICKER IS MARKET-MOVING NEWS ONLY (#1185, PM rule 2026-11-17). It carries crypto, macro / markets (Fed, rates, CPI / NFP / GDP, ETF flows, S&P, oil, dollar), regulation / legal about crypto, and exchange / security incidents (hacks, outages, delistings). A politics, war or geopolitics headline is in it ONLY when it also matches a market keyword below; anything else stays in News -> War & Geo (it is still stored and shown there, only the ticker skips it). */
const MARKET_KW = [
  ...PURPLE_KW,
  // macro / markets
  'fed','federal reserve','powell','fomc','rate','rates','rate hike','rate cut','interest rate','cpi','inflation','gdp','nfp','nonfarm','jobs report','pce','ppi','recession','treasury','yield','dollar','dxy','s&p','nasdaq','dow','stocks','oil','crude','opec','gold','tariff','tariffs','trade war','sanction','sanctions',
  // regulation / legal on crypto
  'sec','cftc','court','lawsuit','ruling','regulation','regulator','crypto ban',
  // exchange / security incidents
  'exchange','hack','hacked','exploit','exploited','outage','delist','delisting','halted','withdrawals','insolvency','bankrupt',
];
export function tickerEligible(headline: string): { ok: boolean; reason: string } {
  if (hasAnyKeyword(headline, MARKET_KW)) return { ok: true, reason: 'market keyword' };
  return { ok: false, reason: 'no market keyword (politics / war / geo stays in News -> War & Geo)' };
}

export function tagLabel(type: NewsType): string {
  if (type === 'red')    return 'Breaking';
  if (type === 'amber')  return 'Macro';
  return 'Crypto';
}

// ── Geo keyword groups - drives "War & Geo" tab + impact notes ───────────────
export const GEO_KEYWORDS = [
  {
    kw: ['powell','fed chair','federal reserve chair','fed speak','yellen','waller','kashkari','daly','fed governor','fed president','fomc member'],
    tag: 'FED SPEECH', style: 'speech',
    note: 'Fed official speaking. First market reaction is almost always fake. Watch for reversal after initial spike.',
  },
  {
    kw: ['trump','white house','executive order','presidential','tariff','trade war','trade deal','trade policy'],
    tag: 'TRUMP/TARIFF', style: 'geopolitical',
    note: 'Trump/White House announcement. Tariff news causes instant crypto volatility - first move usually exaggerated.',
  },
  {
    kw: ['war','ceasefire','invasion','military','missile','attack','nato','ukraine','russia','iran','north korea','middle east','israel','gaza','sanctions','nuclear','houthi','hamas','hezbollah'],
    tag: 'GEOPOLITICAL', style: 'geopolitical',
    note: 'Geopolitical event. Uncertainty = risk-off = BTC can dump fast then violently recover. Watch cluster below.',
  },
  {
    kw: ['strait','hormuz','bab el-mandeb','suez','blockade','shipping lane','tanker','seized vessel','naval blockade','oil tanker','cargo ship'],
    tag: 'SHIPPING/BLOCKADE', style: 'geopolitical',
    note: 'Shipping disruption = oil supply shock = USD strength + global risk-off. BTC typically dumps first then recovers.',
  },
  {
    kw: ['pipeline','energy infrastructure','oil infrastructure','gas pipeline','power grid','cyberattack','cyber attack'],
    tag: 'ENERGY/CYBER', style: 'geopolitical',
    note: 'Infrastructure attack = energy supply shock = immediate risk-off across all markets including crypto.',
  },
  {
    kw: ['opec','oil production','crude oil cut','energy policy','oil price'],
    tag: 'OPEC', style: 'geopolitical',
    note: 'OPEC decision impacts USD and risk sentiment. Oil spike = USD strength = crypto pressure.',
  },
  {
    kw: ['sec crypto','bitcoin etf','crypto regulation','crypto bill','binance','coinbase sec','crypto ban','crypto law'],
    tag: 'CRYPTO REG', style: 'speech',
    note: 'Regulatory news hits crypto directly. Bad news = instant dump. Good news = delayed pump.',
  },
  {
    kw: ['g7','g20','imf','world bank','davos','global summit','debt ceiling'],
    tag: 'MACRO SUMMIT', style: 'geopolitical',
    note: 'Global leaders meeting. Major policy decisions often leak here before markets react.',
  },
  {
    kw: ['taiwan','china military','pla navy','pla army','south china sea','china invasion','china blockade'],
    tag: 'TAIWAN/CHINA', style: 'geopolitical',
    note: 'Taiwan/China tension = extreme risk-off. Crypto dumps hard. Watch for extreme volatility.',
  },
];

// ── Econ event notes - drives Events tab ────────────────────────────────────
export const ECON_NOTES: Record<string, string> = {
  FOMC:    'Rate decision day. Highest volatility of the month. First reaction is always the fake - wait 15-30min for the real direction.',
  CPI:     'Inflation data. Hot CPI = rate hike fears = crypto dumps. Cool CPI = relief pump. Watch the 5min candle after release.',
  PPI:     'Producer prices - leading indicator for CPI. Market moves, but smaller than CPI reaction.',
  NFP:     'Jobs data. Strong jobs = Fed stays hawkish = risk-off = crypto pressure.',
  PCE:     'Fed\'s preferred inflation gauge. Treated like CPI but slightly less volatile market reaction.',
  GDP:     'GDP print. Weak GDP = recession fears = risk-off dump. Strong GDP = mixed (good economy but keeps Fed hawkish).',
  FED:     'Fed speak. Every word is parsed. Market overreacts to ambiguous language then reverses.',
  OPTIONS: 'BTC options expiry. Price gets pinned to max pain before expiry, then explosive move after.',
  RETAIL:  'Consumer spending data. Weaker than expected = recession worry = slight crypto pressure.',
  MACRO:   'High-impact macro event. Expect elevated volatility and fake moves in both directions.',
};

// ── Coin mention detection ────────────────────────────────────────────────────
const COIN_PATTERNS: { symbol: string; re: RegExp }[] = [
  { symbol: 'BTC',    re: /\b(bitcoin|btc)\b/i },
  { symbol: 'ETH',    re: /\b(ethereum|eth)\b/i },
  { symbol: 'SOL',    re: /\b(solana|sol)\b/i },
  { symbol: 'XRP',    re: /\b(xrp|ripple)\b/i },
  { symbol: 'BNB',    re: /\bbnb\b|\bbinance coin\b/i },
  { symbol: 'HYPE',   re: /\bhyperliquid\b/i },
  { symbol: 'NEAR',   re: /\bnear protocol\b/i },
  { symbol: 'SUI',    re: /\bsui\b/i },
  { symbol: 'DOGE',   re: /\b(dogecoin|doge)\b/i },
  { symbol: 'AVAX',   re: /\b(avalanche|avax)\b/i },
  { symbol: 'LINK',   re: /\bchainlink\b/i },
  { symbol: 'ADA',    re: /\bcardano\b/i },
  { symbol: 'DOT',    re: /\bpolkadot\b/i },
  { symbol: 'ATOM',   re: /\bcosmos\b/i },
  { symbol: 'WIF',    re: /\bdogwifhat\b/i },
  { symbol: 'PEPE',   re: /\bpepe\b/i },
  { symbol: 'BONK',   re: /\bbonk\b/i },
  { symbol: 'LTC',    re: /\blitecoin\b/i },
  { symbol: 'BCH',    re: /\bbitcoin cash\b/i },
  { symbol: 'TRX',    re: /\b(tron|trx)\b/i },
  { symbol: 'XLM',    re: /\b(stellar|xlm)\b/i },
  { symbol: 'ETC',    re: /\bethereum classic\b/i },
  { symbol: 'FIL',    re: /\bfilecoin\b/i },
  { symbol: 'ARB',    re: /\barbitrum\b/i },
  { symbol: 'OP',     re: /\boptimism\b/i },
  { symbol: 'APT',    re: /\baptos\b/i },
  { symbol: 'SEI',    re: /\bsei\b/i },
  { symbol: 'INJ',    re: /\binjective\b/i },
  { symbol: 'TIA',    re: /\bcelestia\b/i },
  { symbol: 'AAVE',   re: /\baave\b/i },
  { symbol: 'UNI',    re: /\buniswap\b/i },
  { symbol: 'LDO',    re: /\blido\b/i },
  { symbol: 'RUNE',   re: /\b(thorchain|rune)\b/i },
  { symbol: 'GMX',    re: /\bgmx\b/i },
  { symbol: 'CRV',    re: /\b(curve|crv)\b/i },
  { symbol: 'STX',    re: /\b(stacks|stx)\b/i },
  { symbol: 'JUP',    re: /\bjupiter\b/i },
  { symbol: 'WLD',    re: /\bworldcoin\b/i },
  { symbol: 'RENDER', re: /\brender\b/i },
  { symbol: 'TAO',    re: /\bbittensor\b/i },
  { symbol: 'FET',    re: /\bfetch\.?ai\b/i },
  { symbol: 'ONDO',   re: /\bondo\b/i },
  { symbol: 'PYTH',   re: /\bpyth\b/i },
  { symbol: 'ENA',    re: /\bethena\b/i },
  { symbol: 'DYDX',   re: /\bdydx\b/i },
  { symbol: 'SAND',   re: /\bsandbox\b/i },
  { symbol: 'MANA',   re: /\bdecentraland\b/i },
  { symbol: 'GMT',    re: /\bstepn\b/i },
  { symbol: 'XAU',    re: /\bgold (perp|future|futures)\b/i },
  /* SPX is SPX6900, a memecoin - NOT the S&P 500, which this app carries separately as
     store.macro.spx from Yahoo ^GSPC. The pattern here used to be s&p 500 (perp|futures),
     so a headline about index futures tagged the memecoin. It was narrow and fired rarely,
     which made it harder to notice rather than safer. Matched on its own name instead. */
  { symbol: 'SPX',    re: /\bspx ?6900\b/i },
];

/* NAMES THAT ARE ALSO ORDINARY WORDS (N10): "yield curve" tagged CRV, "optimism about rates" OP, "regulatory sandbox" SAND, and likewise cosmos, jupiter, render, stacks, rune, tron, stellar. These symbols are tagged only when the headline
   is plainly about crypto (a crypto context word) or carries the exact upper-case ticker. */
const AMBIGUOUS_COIN_TICKERS: Record<string, string | null> = {
  ATOM: null, OP: null, RUNE: 'RUNE', CRV: 'CRV', STX: 'STX', JUP: null, RENDER: 'RENDER', SAND: null, TRX: 'TRX', XLM: 'XLM',
};
const CRYPTO_CONTEXT = /\b(?:crypto(?:currenc\w*)?|token|tokens|coin|coins|blockchain|defi|dex|airdrop|protocol|staking|nft|web3|altcoin|on-?chain|layer ?[12]|stablecoin|wallet|exchange)\b/i;

export function getCoinsInHeadline(headline: string): string[] {
  const found: string[] = [];
  const crypto = CRYPTO_CONTEXT.test(headline);
  for (const p of COIN_PATTERNS) {
    if (!p.re.test(headline)) continue;
    if (p.symbol in AMBIGUOUS_COIN_TICKERS && !crypto) {
      const ticker = AMBIGUOUS_COIN_TICKERS[p.symbol];
      if (!(ticker && new RegExp('\\b' + ticker + '\\b').test(headline))) continue;
    }
    found.push(p.symbol);
  }
  return found;
}

interface EconEntry { name: string; type: string; impact: string; }

/* Producers here emit lowercase 'high' / 'med'; app/api/econ-calendar emits
   lowercase 'high' too, and filters everything else out upstream. Both UI
   consumers (components/EconCalendarWidget, app/econ-calendar) keyed their
   colour maps on 'HIGH' / 'MEDIUM' / 'LOW', so every lookup missed and every
   row fell through to the LOW grey - FOMC, CPI and NFP rendered identically to
   a filler event, which is the entire point of the impact column. Found while
   measuring contrast: the grey it fell back to was also failing AA at 3.77:1.
   Normalising lives next to the values it normalises so the two can't drift
   apart again. 'med' is deliberate - that is the literal the classifier emits,
   not 'medium'. */
export type EconImpact = 'HIGH' | 'MEDIUM' | 'LOW';

export function econImpactKey(raw: string | null | undefined): EconImpact {
  const s = String(raw ?? '').trim().toUpperCase();
  if (s === 'HIGH') return 'HIGH';
  if (s === 'MED' || s === 'MEDIUM') return 'MEDIUM';
  return 'LOW';
}

export function classifyEcon(name: string): EconEntry | null {
  const n = name.toLowerCase();
  if (/fomc|federal open|rate decision|fed decision|federal funds rate/.test(n)) return { name, type: 'FOMC', impact: 'high' };
  if (/consumer price|\bcpi\b/.test(n))                               return { name, type: 'CPI',     impact: 'high' };
  if (/producer price|\bppi\b/.test(n))                               return { name, type: 'PPI',     impact: 'high' };
  if (/nonfarm|non.farm|payroll/.test(n))                             return { name, type: 'NFP',     impact: 'high' };
  if (/personal consumption|\bpce\b/.test(n))                         return { name, type: 'PCE',     impact: 'high' };
  if (/gross domestic|\bgdp\b/.test(n))                               return { name, type: 'GDP',     impact: 'high' };
  if (/powell|fed chair|fed speak|yellen|fed president/.test(n))      return { name, type: 'FED',     impact: 'high' };
  if (/options expir|btc options|crypto options/.test(n))             return { name, type: 'OPTIONS', impact: 'high' };
  if (/retail sales/.test(n))                                         return { name, type: 'RETAIL',  impact: 'med'  };
  if (/jobless|unemployment claims/.test(n))                          return { name, type: 'NFP',     impact: 'med'  };
  if (/\binflation\b/.test(n))                                        return { name, type: 'CPI',     impact: 'med'  };
  return null;
}
