/* The chat's system prompt, built on the SERVER (#1631 E).
 *
 * Before this file the browser wrote the whole system prompt and /api/grok-chat forwarded it to xAI unchanged, so any signed-in caller could
 * run our key with instructions of their own, and the browser decided which coin the prompt was about (on the XRP page it sent BTC). Now the
 * browser sends only DATA - numbers, a few short labels, headline lines - in a bounded shape (parseChatContext), and every instruction is
 * written here.
 *
 * Also fixed on the way through (#1631 B and C, the chat's share of them):
 *   - one signed formatter: ETF and exchange flows printed "$26M" for an outflow of -$26.1M (the minus was dropped);
 *   - price precision by size: an MA of 0.5123 printed "0.51";
 *   - BTC-only option data (put/call ratio, max pain) goes into a BTC chat only, labelled as BTC's;
 *   - the "search the web and X, cite sources" block goes into Live (search) mode only: Fast mode calls the model with no tools, and
 *     the instruction made it claim searches it never ran.
 *   - the follow-up questions come from the SAME answer (a FOLLOW-UPS: block the server splits off), replacing the hidden second call
 *     per message that spent a second chat credit and a second xAI charge. */
import { COINS, type CoinId } from './coins.ts';
import { priceText as fmtPrice, signedUsd } from './numberFormat.ts';

export interface ChatContext {
  coin: CoinId;
  price?: number; change?: number; high?: number; low?: number;
  rsi?: Array<number | null>;                    // 15m, 1h, 4h, 1D
  cvdDivergence?: 'bullish' | 'bearish';
  ma20?: number; volRatio?: number; cvd?: number;
  funding?: string;                              // the funding classification label
  oi?: number; longRatio?: number; shortRatio?: number;
  squeeze?: string;                              // "62/100 - label"
  basisPct?: number;
  bidWalls?: number[];
  fng?: number; fngLabel?: string; btcDom?: number;
  btcPcRatio?: number; btcMaxPain?: number;
  stablecoinSupply?: number; etfNetFlow?: number; ethEtfNetFlow?: number; btcExchangeNetFlow?: number;
  sectorRotation?: string; structure?: string; session?: string;
  headlines?: string[]; geo?: string[];
  selection?: string;                            // describeSelection() of the trader's indicators
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[\u0000-\u001f]+/g, ' ').trim();
  return s ? s.slice(0, max) : undefined;
};
const strs = (v: unknown, n: number, max: number): string[] | undefined =>
  Array.isArray(v) ? v.map((x) => str(x, max)).filter((x): x is string => !!x).slice(0, n) : undefined;

/** The browser's context, reduced to known fields of the right type and size. Null when the coin is not one this app tracks. */
export function parseChatContext(raw: unknown): ChatContext | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const coin = typeof r.coin === 'string' ? r.coin.toLowerCase() : '';
  if (!(COINS as string[]).includes(coin)) return null;
  return {
    coin: coin as CoinId,
    price: num(r.price), change: num(r.change), high: num(r.high), low: num(r.low),
    rsi: Array.isArray(r.rsi) ? r.rsi.slice(0, 4).map((x) => num(x) ?? null) : undefined,
    cvdDivergence: r.cvdDivergence === 'bullish' || r.cvdDivergence === 'bearish' ? r.cvdDivergence : undefined,
    ma20: num(r.ma20), volRatio: num(r.volRatio), cvd: num(r.cvd),
    funding: str(r.funding, 80), oi: num(r.oi), longRatio: num(r.longRatio), shortRatio: num(r.shortRatio),
    squeeze: str(r.squeeze, 80), basisPct: num(r.basisPct),
    bidWalls: Array.isArray(r.bidWalls) ? r.bidWalls.map(num).filter((x): x is number => x !== undefined).slice(0, 5) : undefined,
    fng: num(r.fng), fngLabel: str(r.fngLabel, 40), btcDom: num(r.btcDom),
    btcPcRatio: num(r.btcPcRatio), btcMaxPain: num(r.btcMaxPain),
    stablecoinSupply: num(r.stablecoinSupply), etfNetFlow: num(r.etfNetFlow), ethEtfNetFlow: num(r.ethEtfNetFlow),
    btcExchangeNetFlow: num(r.btcExchangeNetFlow),
    sectorRotation: str(r.sectorRotation, 300), structure: str(r.structure, 300), session: str(r.session, 60),
    headlines: strs(r.headlines, 8, 240), geo: strs(r.geo, 5, 240),
    selection: str(r.selection, 400),
  };
}

const pct = (v: number, digits: number) => (v >= 0 ? '+' : '') + v.toFixed(digits) + '%';
const or = (v: string | undefined) => v ?? '-';

export const FOLLOW_UPS_MARKER = 'FOLLOW-UPS:';

const HEAD = [
  'You are an elite crypto derivatives trader and analyst assistant embedded in Liquidity Hunter HQ.',
  'The trader asks short, direct questions. Give concise, bullet-pointed, actionable answers.',
  'Flag when data is missing. Never invent numbers. Be honest about uncertainty.',
];

const EMA_FILTERS = [
  '=== EMA SIGNAL QUALITY FILTERS (apply before accepting any EMA cross signal) ===',
  'Before calling LONG or SHORT based on an EMA cross, ALL THREE of these filters must pass:',
  '1. EMA50 Slope: EMA50 must be trending in the signal direction over the last 5 bars (≥ 0.1% slope). Flat EMA50 = price is ranging = EMA cross is noise. Call FREEZE/FLAT instead.',
  '2. ATR Buffer: Price must close beyond EMA50 by at least 35% of ATR(14). A marginal 1-tick graze of EMA50 is not a confirmation - it will reverse. Only a meaningful body close clearing the buffer is valid.',
  '3. Ribbon Spread: EMA9 and EMA20 must be at least 0.3% of price apart. If the two lines are visually overlapping (tight spread), the ribbon is tangled = chop zone = the cross is noise. Call FREEZE/FLAT instead.',
  'If any filter fails → downgrade the signal: LONG → LEAN LONG, SHORT → LEAN SHORT, or FLAT if all fail.',
  'WaveTrend Confirming (Cipher B momentum, separate confirming layer - NOT a 4th mandatory filter): checks for a bullish/bearish divergence between price and the WaveTrend oscillator, or a recent cross from oversold/overbought agreeing with the signal direction. If it confirms, mention it as added confidence. If it does not confirm, do not auto-downgrade the signal - just note the momentum oscillator has not caught up yet, since it lags slightly behind the EMA cross by design.',
];

const SEARCH_INSTRUCTIONS = [
  '=== SEARCH INSTRUCTIONS ===',
  'Use web_search and x_search proactively:',
  '1. WHY is the market moving right now - search for why this coin and crypto are moving today',
  '2. Latest war/conflict/sanctions news affecting risk assets',
  '3. Fed, CPI, FOMC, Treasury statements (last 48h)',
  '4. Trump/White House crypto or tariff posts on X',
  '5. Exchange hacks, large liquidations, whale moves on X',
  'Always cite source and timestamp for significant findings.',
];

const NO_TOOLS = 'You have NO web or X search in this mode: answer from the data below only, and say so if the question needs fresh news.';

const FOLLOW_UPS_INSTRUCTION =
  `After your answer, write a line containing only "${FOLLOW_UPS_MARKER}" and then exactly 3 short follow-up questions the trader might ask next, `
  + '4-8 words each, one per line, no numbering.';

/** The system prompt for one chat turn. `search` = Live mode (the model has web and X search); `minimal` = an educational question. */
export function buildChatSystemPrompt(ctx: ChatContext, opts: { search: boolean; minimal: boolean }): string {
  const c = ctx.coin.toUpperCase();
  const ln = (k: string, v: string) => `${k}: ${v}`;
  const watching = ctx.selection
    ? ['', `The trader is currently weighing these indicators: ${ctx.selection}. Give them more weight in your answer, and say plainly if they disagree with what the rest of the data shows.`]
    : [];
  if (opts.minimal && !opts.search) {
    return [
      'You are an elite crypto trading analyst assistant embedded in Liquidity Hunter HQ.',
      'Answer concisely and directly. Flag uncertainty.',
      `Coin: ${c}/USDT` + (ctx.price != null ? ` · Price: ${fmtPrice(ctx.price)}` : ''),
      NO_TOOLS,
      ...watching,
      '',
      FOLLOW_UPS_INSTRUCTION,
    ].join('\n');
  }
  const rsi = ctx.rsi ?? [];
  const isBtc = ctx.coin === 'btc';
  return [
    ...HEAD,
    opts.search ? '' : NO_TOOLS,
    '',
    `=== LIVE DATA - ${c}/USDT ===`,
    ln('Price', ctx.price != null ? fmtPrice(ctx.price) : '-'),
    ln('24h Change', ctx.change != null ? pct(ctx.change, 2) : '-'),
    ln('High/Low', ctx.high != null && ctx.low != null ? `${fmtPrice(ctx.high)} / ${fmtPrice(ctx.low)}` : '-'),
    ln('RSI 15m/1h/4h/1D', [0, 1, 2, 3].map((i) => (rsi[i] != null ? (rsi[i] as number).toFixed(0) : '-')).join(' / ')),
    ln('CVD Divergence', ctx.cvdDivergence === 'bullish' ? 'BULLISH - price falling but net buying rising (smart money accumulating)'
      : ctx.cvdDivergence === 'bearish' ? 'BEARISH - price rising but net selling rising (distribution)' : 'None'),
    ln('MA20 (15m)', ctx.ma20 != null ? fmtPrice(ctx.ma20) : '-'),
    ln('Vol ratio', ctx.volRatio != null ? ctx.volRatio.toFixed(2) + 'x' : '-'),
    ln('CVD (200)', ctx.cvd != null ? (ctx.cvd >= 0 ? '+' : '-') + (Math.abs(ctx.cvd) / 1000).toFixed(1) + 'K' : '-'),
    ln('Funding', or(ctx.funding)),
    ln('Open Interest', ctx.oi != null ? '$' + (ctx.oi / 1e9).toFixed(2) + 'B' : '-'),
    ln('Long/Short %', ctx.longRatio != null ? (ctx.longRatio * 100).toFixed(1) + '% / ' + ((ctx.shortRatio ?? 0) * 100).toFixed(1) + '%' : '-'),
    ln('Squeeze score', or(ctx.squeeze)),
    ln('Basis', ctx.basisPct != null ? ctx.basisPct.toFixed(4) + '%' : '-'),
    '',
    ...EMA_FILTERS,
    ln('Order book', ctx.bidWalls?.length ? 'Bids: ' + ctx.bidWalls.map(fmtPrice).join(', ') : '-'),
    '',
    '=== MACRO ===',
    ln('Fear & Greed', ctx.fng != null ? `${ctx.fng} (${or(ctx.fngLabel)})` : '-'),
    ln('BTC Dominance', ctx.btcDom != null ? ctx.btcDom.toFixed(2) + '%' : '-'),
    // BTC's option market says nothing direct about another coin's: only a BTC chat gets it (#1631 B).
    ...(isBtc ? [
      ln('BTC options put/call ratio', ctx.btcPcRatio != null ? ctx.btcPcRatio.toFixed(2) : '-'),
      ln('BTC options max pain', ctx.btcMaxPain != null ? fmtPrice(ctx.btcMaxPain) : '-'),
    ] : []),
    ln('Stablecoin supply', ctx.stablecoinSupply != null ? '$' + ctx.stablecoinSupply.toFixed(1) + 'B' : '-'),
    ln('BTC ETF flow', ctx.etfNetFlow != null ? signedUsd(ctx.etfNetFlow, 'M', 0) : '-'),
    ln('ETH ETF flow', ctx.ethEtfNetFlow != null ? signedUsd(ctx.ethEtfNetFlow, 'M', 0) : '-'),
    ln('BTC exchange net flow', ctx.btcExchangeNetFlow != null ? signedUsd(ctx.btcExchangeNetFlow, 'M', 1) : '-'),
    ln('Sector rotation', or(ctx.sectorRotation)),
    ln('Structure break (1h)', or(ctx.structure)),
    ln('Session', or(ctx.session)),
    '',
    '=== LIVE NEWS FEED ===',
    ctx.headlines?.length ? ctx.headlines.map((h, i) => `${i + 1}. ${h}`).join('\n') : (opts.search ? 'No alerts yet - use live search tools.' : 'No alerts loaded.'),
    '',
    '=== GEOPOLITICAL EVENTS (last 12h) ===',
    ctx.geo?.length ? ctx.geo.join('\n') : (opts.search ? 'None detected - search X and web.' : 'None loaded.'),
    ...(opts.search ? ['', ...SEARCH_INSTRUCTIONS] : []),
    ...watching,
    '',
    FOLLOW_UPS_INSTRUCTION,
  ].join('\n');
}

/** Splits the FOLLOW-UPS block off the model's answer. A model that does not write one simply gets no chips. */
export function splitFollowUps(raw: string): { text: string; followUps: string[] } {
  const i = raw.lastIndexOf(FOLLOW_UPS_MARKER);
  if (i < 0) return { text: raw.trim(), followUps: [] };
  const followUps = raw.slice(i + FOLLOW_UPS_MARKER.length).split('\n')
    .map((q) => q.trim().replace(/^\d+[.)]\s*/, '').replace(/^[-•*]\s*/, ''))
    .filter((q) => q.length > 5 && q.length < 100)
    .slice(0, 3);
  return { text: raw.slice(0, i).trim(), followUps };
}

/** The conversation as the browser sent it, reduced to user/assistant turns of bounded size (the last 8). A `system` turn is never taken. */
export function parseChatHistory(raw: unknown): Array<{ role: 'user' | 'assistant'; content: string }> | null {
  if (!Array.isArray(raw)) return null;
  const out = raw
    .filter((m): m is { role: string; content: string } => typeof m === 'object' && m !== null && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content.slice(0, 4000) }))
    .slice(-8);
  return out.length && out[out.length - 1].role === 'user' ? out : null;
}
