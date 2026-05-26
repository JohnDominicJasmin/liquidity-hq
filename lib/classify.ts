export type NewsType = 'red' | 'amber' | 'purple';

const RED_KW = ['war','military','attack','sanction','ban','crash','collapse','default','emergency','invasion','missile','nuclear','tariff','trade war','block','freeze'];
const AMBER_KW = ['fed','federal reserve','powell','fomc','rate hike','rate cut','interest rate','cpi','inflation','gdp','unemployment','recession','jobs report','nonfarm','nfp','sec','regulation','congress','senate','bill','law','executive order','china','russia','iran'];
const PURPLE_KW = ['bitcoin','btc','ethereum','eth','crypto','blockchain','defi','stablecoin','usdt','usdc','binance','coinbase','sec crypto','etf','halving'];

export function classifyNews(text: string): NewsType | null {
  const t = text.toLowerCase();
  for (const kw of RED_KW) if (t.includes(kw)) return 'red';
  for (const kw of AMBER_KW) if (t.includes(kw)) return 'amber';
  for (const kw of PURPLE_KW) if (t.includes(kw)) return 'purple';
  return null;
}

export function tagLabel(type: NewsType): string {
  if (type === 'red') return '🔴 Breaking';
  if (type === 'amber') return '🟡 Macro';
  return '🟣 Crypto';
}

export const GEO_KEYWORDS = [
  { kw: ['powell','fed chair','federal reserve chair','fed speak','yellen','waller','kashkari','daly','fed governor','fed president','fomc member'], tag: 'FED SPEECH', style: 'speech', note: 'Fed official speaking. First market reaction is almost always fake. Watch for reversal after initial spike.' },
  { kw: ['trump','white house','executive order','presidential','tariff','trade war','trade deal','trade policy'], tag: 'TRUMP/TARIFF', style: 'geopolitical', note: 'Trump/White House announcement. Tariff news causes instant crypto volatility — first move usually exaggerated.' },
  { kw: ['war','ceasefire','invasion','military','missile','attack','nato','ukraine','russia','iran','north korea','middle east','israel','gaza','sanctions','nuclear'], tag: 'GEOPOLITICAL', style: 'geopolitical', note: 'Geopolitical event. Uncertainty = risk-off = BTC can dump fast then violently recover. Watch cluster below.' },
  { kw: ['opec','oil production','crude oil cut','energy policy'], tag: 'OPEC', style: 'geopolitical', note: 'OPEC decision impacts USD and risk sentiment. Oil spike = USD strength = crypto pressure.' },
  { kw: ['sec crypto','bitcoin etf','crypto regulation','crypto bill','binance','coinbase sec','crypto ban','crypto law'], tag: 'CRYPTO REG', style: 'speech', note: 'Regulatory news hits crypto directly. Bad news = instant dump. Good news = delayed pump.' },
  { kw: ['g7','g20','imf','world bank','davos','global summit','debt ceiling'], tag: 'MACRO SUMMIT', style: 'geopolitical', note: 'Global leaders meeting. Major policy decisions often leak here before markets react.' },
];

export const ECON_NOTES: Record<string, string> = {
  FOMC: 'Rate decision day. Highest volatility of the month. First reaction is always the fake — wait 15-30min for the real direction.',
  CPI: 'Inflation data. Hot CPI = rate hike fears = crypto dumps. Cool CPI = relief pump. Watch the 5min candle after release.',
  PPI: 'Producer prices — leading indicator for CPI. Market moves, but smaller than CPI reaction.',
  NFP: 'Jobs data. Strong jobs = Fed stays hawkish = risk-off = crypto pressure.',
  PCE: 'Fed\'s preferred inflation gauge. Treated like CPI but slightly less volatile market reaction.',
  GDP: 'GDP print. Weak GDP = recession fears = risk-off dump. Strong GDP = mixed (good economy but keeps Fed hawkish).',
  FED: 'Fed speak. Every word is parsed. Market overreacts to ambiguous language then reverses.',
  OPTIONS: 'BTC options expiry. Price gets pinned to max pain before expiry, then explosive move after.',
  RETAIL: 'Consumer spending data. Weaker than expected = recession worry = slight crypto pressure.',
  MACRO: 'High-impact macro event. Expect elevated volatility and fake moves in both directions.',
};

interface EconEntry {
  name: string;
  type: string;
  impact: string;
}

export function classifyEcon(name: string): EconEntry | null {
  const n = name.toLowerCase();
  if (/fomc|federal open|rate decision|fed decision/.test(n)) return { name, type: 'FOMC', impact: 'high' };
  if (/consumer price|\bcpi\b/.test(n)) return { name, type: 'CPI', impact: 'high' };
  if (/producer price|\bppi\b/.test(n)) return { name, type: 'PPI', impact: 'high' };
  if (/nonfarm|non.farm|payroll/.test(n)) return { name, type: 'NFP', impact: 'high' };
  if (/personal consumption|\bpce\b/.test(n)) return { name, type: 'PCE', impact: 'high' };
  if (/gross domestic|\bgdp\b/.test(n)) return { name, type: 'GDP', impact: 'high' };
  if (/powell|fed chair|fed speak|yellen|fed president/.test(n)) return { name, type: 'FED', impact: 'high' };
  if (/options expir|btc options|crypto options/.test(n)) return { name, type: 'OPTIONS', impact: 'high' };
  if (/retail sales/.test(n)) return { name, type: 'RETAIL', impact: 'med' };
  if (/jobless|unemployment claims/.test(n)) return { name, type: 'NFP', impact: 'med' };
  if (/\binflation\b/.test(n)) return { name, type: 'CPI', impact: 'med' };
  return null;
}
