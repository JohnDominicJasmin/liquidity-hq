/* THE PROMPT THE BROWSER SENDS, assembled by the app's own builder - not a hand-written string.
 *
 * WHY THIS FILE EXISTS, and it is the most expensive lesson of 2026-10-23. `/api/grok` does NOT build the prompt. The browser does:
 * `app/api/grok/route.ts:110` says so in as many words - "The prompt is assembled in the browser (lib/grok.ts) and sent whole" - and
 * line 227 hands the request body straight to xAI as `input`. The real text comes from `buildCombinedPrompt(ctx, chartData)` at
 * `app/arena/page.tsx:1594`, and nothing on the server adds to it (`lib/xai.ts` contains no SIGNAL and no CONFIDENCE at all).
 *
 * So a QA tool that posts `{ prompt: 'Deep read on BTC 4h', type: 'deep' }` asks the model a question THE APP NEVER ASKS: no SIGNAL
 * line requested, no CONFIDENCE line, no field list, no plain-text rule. Four billed Deep calls were spent that way and every one came
 * back as markdown prose with no verdict - which is the correct answer to that question, and was read as the paid feature being broken.
 * The instrument has to send what the product sends or its result is about the instrument.
 *
 * WHAT IS FIXTURE AND WHAT IS REAL. The builder is the real one, imported from `lib/grok.ts`, so every instruction, field and ordering
 * change in the app arrives here for free - including where the output contract sits, which is the thing under test. Only the market
 * DATA is fixture: plausible numbers, in the shapes the real context uses, with 'unavailable' where the app would also say so. The
 * verdict contract does not depend on the numbers being today's, and a frozen fixture makes two runs comparable.
 *
 * THE GUARD THAT MATTERS. `assembleDeepPrompt` refuses to return a prompt that contains the string "undefined" or that is missing the
 * SIGNAL/CONFIDENCE instruction. A field added to `GrokContext` and not added here would otherwise render as "undefined" inside a
 * billed call - type stripping does not type-check, so nothing else would catch it. */
import { buildCombinedPrompt } from '../../../lib/grok.ts';

/** Every GrokContext field, in the interface's own order (lib/grok.ts:201-299). Shapes match what the app puts there. */
const CTX = {
  coin: 'BTC',
  price: '82,410',
  change24h: '-1.2',
  fundingRate: '0.0041%',
  openInterest: '$18.4B',
  fearGreed: '44 (Fear)',
  btcDominance: '58.1%',
  session: 'ny',
  clusters: 'unavailable',
  news: 'unavailable',
  rsi14: '48.2',
  ma20: '83,050',
  priceVsMA: '-0.8% below MA20',
  volRatio: '0.92',
  longShortRatio: '1.04',
  oilPrice: '$71.40',
  bonds10y: '4.18%',
  real10y: '1.92%',
  etfFlows: 'unavailable',
  ethEtfFlows: 'unavailable',
  upcomingEvents: 'unavailable',
  rsi1h: '51.0',
  rsi4h: '48.2',
  rsiDaily: '45.6',
  cvd: 'unavailable',
  cvdDivergence: 'None',
  basis: 'unavailable',
  fibNearest: '0.618 at 81,900',
  orderWalls: 'unavailable',
  squeezeScore: 'unavailable',
  pcRatio: 'unavailable',
  maxPain: 'unavailable',
  btcGex: 'unavailable',
  exchangeNetFlow: 'unavailable',
  stablecoinFlow: 'unavailable',
  cascadeLine: 'unavailable',
  whaleFlow: 'unavailable',
  liqLevels: 'unavailable',
  btcDomTrend: 'unavailable',
  sectorRotation: 'unavailable',
  structureBreak: 'unavailable',
  pocLine: 'unavailable',
  dxyLine: 'unavailable',
  spxLine: 'unavailable',
  goldLine: 'unavailable',
  takerRatio: 'unavailable',
  cbPremium: 'unavailable',
  vwap: 'unavailable',
  oiTrend: 'unavailable',
  crossExchangeFunding: 'unavailable',
  setupScan: 'unavailable',
  distribution: 'unavailable',
  oi1hChange: 'unavailable',
  marketStructure: 'unavailable',
  absorptionScore: 'unavailable',
  yenWatch: 'unavailable',
  perpSpot: 'unavailable',
  emaStrategy: 'unavailable',
  emaATR: 'unavailable',
  ema50Slope: 'unavailable',
  waveTrend: 'unavailable',
};

/** ChartData (lib/grok.ts:669). Numbers, not strings, and consistent with CTX's price. */
const CHART = {
  tf: '4h',
  ema9: 82_760,
  sma200: 79_480,
  rsi: 48.2,
  recent20: '83,900 83,420 82,980 83,110 82,640 82,410',
  hi: 84_900,
  lo: 80_900,
  lastClose: 82_410,
};

/** The two lines the Deep answer is graded on. Used by the guard below AND reported, so a prompt that lost them is never billed. */
const CONTRACT_MARKERS = ['SIGNAL:', 'CONFIDENCE:'];

export function assembleDeepPrompt({ coin = 'BTC', tf = '4h', session = 'ny' } = {}) {
  const prompt = buildCombinedPrompt({ ...CTX, coin, session }, { ...CHART, tf });

  if (prompt.includes('undefined')) {
    throw new Error(
      'the assembled prompt contains "undefined" - a GrokContext or ChartData field exists in lib/grok.ts and not in this fixture. ' +
      'Add it here before spending a call; type stripping does not type-check, so nothing else catches this.'
    );
  }
  const absent = CONTRACT_MARKERS.filter((m) => !prompt.includes(m));
  if (absent.length) {
    throw new Error(`the assembled prompt does not ask for ${absent.join(' and ')} - refusing to bill a call that cannot be graded`);
  }

  /* Where the contract SITS is what #1725 changed, so it is reported rather than asserted: a tool that demanded "contract on line 1"
     would fail against the old prompt it is meant to compare with. */
  const lines = prompt.split('\n');
  const firstSignalLine = lines.findIndex((l) => l.includes('SIGNAL:')) + 1;

  return { prompt, chars: prompt.length, lines: lines.length, firstSignalLine, head: lines.slice(0, 3).join(' | ').slice(0, 200) };
}
