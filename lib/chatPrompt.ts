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
import { INDICATOR_SETTINGS_RULE, INDICATOR_SETTINGS_SHAPE } from './indicatorSettingsText.ts';
import { ratioNote } from './crowding.ts';

export interface ChatContext {
  coin: CoinId;
  price?: number; change?: number; high?: number; low?: number;
  rsi?: Array<number | null>;                    // 15m, 1h, 4h, 1D
  cvdDivergence?: 'bullish' | 'bearish';
  ma20?: number; volRatio?: number; cvd?: number;
  funding?: string;                              // the funding classification label
  oi?: number; longRatio?: number; shortRatio?: number;
  /** Which venue the long/short account ratio comes from (lib/accountRatioVenue.ts): the chat says it, the same as the Arena read. */
  ratioVenue?: 'Binance' | 'Bybit';
  squeeze?: string;                              // "62/100 - label"
  basisPct?: number;
  bidWalls?: number[];
  fng?: number; fngLabel?: string; btcDom?: number;
  btcPcRatio?: number; btcMaxPain?: number;
  stablecoinSupply?: number; stablecoinChg30d?: number; etfNetFlow?: number; ethEtfNetFlow?: number; btcExchangeNetFlow?: number;
  /** The settled US session (YYYY-MM-DD) each ETF figure belongs to; a figure without its day is not sent (#1651 L117). */
  etfFlowDate?: string; ethEtfFlowDate?: string;
  sectorRotation?: string; structure?: string; session?: string;
  headlines?: string[]; geo?: string[];
  selection?: string;                            // describeSelection() of the trader's indicators
  indicatorSettings?: string;                    // lib/indicatorSettingsText describeIndicatorSettings(): the trader's RSI / EMA settings that differ from the defaults
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[\u0000-\u001f]+/g, ' ').trim();
  return s ? s.slice(0, max) : undefined;
};
const strs = (v: unknown, n: number, max: number): string[] | undefined =>
  Array.isArray(v) ? v.map((x) => str(x, max)).filter((x): x is string => !!x).slice(0, n) : undefined;

/** The trader's settings line, only in the exact shape the app builds (lib/indicatorSettingsText.ts); free text is dropped (QA R7b). */
const shapedSettings = (s: string | undefined): string | undefined => (s && INDICATOR_SETTINGS_SHAPE.test(s) ? s : undefined);

/** A settled-session day as the proxy writes it, or undefined (the value is printed into the prompt, so only the exact shape passes). */
const flowDay = (v: unknown): string | undefined => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

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
    funding: str(r.funding, 80), oi: num(r.oi), longRatio: num(r.longRatio), shortRatio: num(r.shortRatio), ratioVenue: r.ratioVenue === 'Binance' || r.ratioVenue === 'Bybit' ? r.ratioVenue : undefined,
    squeeze: str(r.squeeze, 80), basisPct: num(r.basisPct),
    bidWalls: Array.isArray(r.bidWalls) ? r.bidWalls.map(num).filter((x): x is number => x !== undefined).slice(0, 5) : undefined,
    fng: num(r.fng), fngLabel: str(r.fngLabel, 40), btcDom: num(r.btcDom),
    btcPcRatio: num(r.btcPcRatio), btcMaxPain: num(r.btcMaxPain),
    stablecoinSupply: num(r.stablecoinSupply), stablecoinChg30d: num(r.stablecoinChg30d), etfNetFlow: num(r.etfNetFlow), ethEtfNetFlow: num(r.ethEtfNetFlow),
    etfFlowDate: flowDay(r.etfFlowDate), ethEtfFlowDate: flowDay(r.ethEtfFlowDate),
    btcExchangeNetFlow: num(r.btcExchangeNetFlow),
    sectorRotation: str(r.sectorRotation, 300), structure: str(r.structure, 300), session: str(r.session, 60),
    headlines: strs(r.headlines, 8, 240), geo: strs(r.geo, 5, 240),
    selection: str(r.selection, 400),
    indicatorSettings: shapedSettings(str(r.indicatorSettings, 200)),
  };
}

const pct = (v: number, digits: number) => (v >= 0 ? '+' : '') + v.toFixed(digits) + '%';
const or = (v: string | undefined) => v ?? '-';

export const FOLLOW_UPS_MARKER = 'FOLLOW-UPS:';

/* DESCRIBE, DO NOT FORECAST (#1651, owner sweep 2026-11-18). The chat used to carry the Arena's EMA filter rules (EMA50 slope, ATR(14)
   buffer, EMA9/20 spread, WaveTrend), but the chat's data has none of those values, so the model was told to apply rules it could not
   check; and "it will reverse" was a forecast. Both are gone. One missing-value rule: "-" means no reading. */
const HEAD = [
  'You are a crypto derivatives data assistant embedded in Liquidity Hunter HQ.',
  'The trader asks short, direct questions. Give concise, bullet-pointed answers that describe what the data shows. Do not predict prices or tell the trader to buy or sell.',
  'A value of "-" means no reading: say it is missing, never estimate it. Never invent numbers. Be honest about uncertainty.',
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

/** THE INDICATORS A PLAN MAY NAME TO THE MODEL, SERVER SIDE. `selection` is the browser's description ("SMA, MACD, Bollinger Bands"), which a hand-made request can fill with anything the Free plan does not
 *  include. When the server's own plan read says NOT ENTITLED, only the first named indicator is kept (Free is one at a time, lib/strategyRegistry `selectionForPlan`); any other answer (entitled, unknown,
 *  failed read) leaves it as sent, so a paying user is never cut on a failed read (#1119). */
export function capChatSelection(selection: string | undefined, notEntitled: boolean): string | undefined {
  if (!selection || !notEntitled) return selection;
  const first = selection.split(', ')[0].trim();
  return first || undefined;
}

/** The system prompt for one chat turn. `search` = Live mode (the model has web and X search); `minimal` = an educational question. */
export function buildChatSystemPrompt(ctx: ChatContext, opts: { search: boolean; minimal: boolean }): string {
  const c = ctx.coin.toUpperCase();
  const ln = (k: string, v: string) => `${k}: ${v}`;
  const watching = [
    ...(ctx.selection
      ? ['', `The trader is currently weighing these indicators: ${ctx.selection}. Give them more weight in your answer, and say plainly if they disagree with what the rest of the data shows.`]
      : []),
    // The trader's own RSI / EMA settings (#1651): the Arena read already gets them; the chat did not.
    ...(ctx.indicatorSettings ? ['', `The trader's chart settings: ${ctx.indicatorSettings}.`, INDICATOR_SETTINGS_RULE] : []),
  ];
  if (opts.minimal && !opts.search) {
    return [
      'You are a crypto data assistant embedded in Liquidity Hunter HQ.',
      'Answer concisely and directly. Do not predict prices or tell the trader to buy or sell. Flag uncertainty.',
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
    ln('CVD Divergence', ctx.cvdDivergence === 'bullish' ? 'BULLISH - price falling but net buying rising'
      : ctx.cvdDivergence === 'bearish' ? 'BEARISH - price rising but net selling rising (distribution)' : 'None'),
    ln('MA20 (15m)', ctx.ma20 != null ? fmtPrice(ctx.ma20) : '-'),
    ln('Vol ratio', ctx.volRatio != null ? ctx.volRatio.toFixed(2) + 'x' : '-'),
    ln('CVD (200)', ctx.cvd != null ? (ctx.cvd >= 0 ? '+' : '-') + (Math.abs(ctx.cvd) / 1000).toFixed(1) + 'K' : '-'),
    ln('Funding', or(ctx.funding)),
    ln('Open Interest', ctx.oi != null ? '$' + (ctx.oi / 1e9).toFixed(2) + 'B' : '-'),
    ln(ctx.ratioVenue ? `Long/Short % (${ctx.ratioVenue}, accounts, 1h)` : 'Long/Short %', ctx.longRatio != null ? (ctx.longRatio * 100).toFixed(1) + '% / ' + ((ctx.shortRatio ?? 0) * 100).toFixed(1) + '%' + ratioNote(ctx.longRatio, ctx.shortRatio ?? 0) : '-'),
    ln('Squeeze score', or(ctx.squeeze)),
    ln('Basis', ctx.basisPct != null ? ctx.basisPct.toFixed(4) + '%' : '-'),
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
    ln('Stablecoin supply', ctx.stablecoinSupply != null
      ? '$' + ctx.stablecoinSupply.toFixed(1) + 'B' + (ctx.stablecoinChg30d != null
        ? ` (30d ${signedUsd(ctx.stablecoinChg30d, 'B', 1)}${ctx.stablecoinChg30d <= -0.5 ? ' - shrinking, not dry powder' : ''})` : '')
      : '-'),
    /* NEVER AN UNDATED FIGURE (#1651 L117): the flow is the latest SETTLED US session, so it is printed with its day and left out when the day is unknown. */
    ln('BTC ETF flow', ctx.etfNetFlow != null && ctx.etfFlowDate ? `${signedUsd(ctx.etfNetFlow, 'M', 0)} (settled session ${ctx.etfFlowDate})` : '-'),
    ln('ETH ETF flow', ctx.ethEtfNetFlow != null && ctx.ethEtfFlowDate ? `${signedUsd(ctx.ethEtfNetFlow, 'M', 0)} (settled session ${ctx.ethEtfFlowDate})` : '-'),
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
  /* PM audit of #1665: the model sometimes bolds the marker (**FOLLOW-UPS:**) or writes it in another case. Matched loosely, the last one
     wins, and the bold markers go with it - they used to stay behind as a stray "**" at the end of the answer. */
  let last: RegExpExecArray | null = null;
  for (const m of raw.matchAll(/\*{0,2}[ \t]*follow-ups[ \t]*:[ \t]*\*{0,2}/gi)) last = m as RegExpExecArray;
  if (!last) return { text: raw.trim(), followUps: [] };
  const followUps = raw.slice(last.index + last[0].length).split('\n')
    .map((q) => q.trim().replace(/^\d+[.)]\s*/, '').replace(/^\*\*|\*\*$/g, '').replace(/^[-•*]\s*/, '').replace(/^\*\*|\*\*$/g, '').trim())
    .filter((q) => q.length > 5 && q.length < 100)
    .slice(0, 3);
  return { text: raw.slice(0, last.index).trim(), followUps };
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
