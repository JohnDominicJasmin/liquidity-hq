/* #1631 B and C: what the Quick and Deep prompts, and the one shared formatter, print for each coin.
 *
 * PROMPT CONSTRUCTION ONLY, as in grokPerpSpot.test.mts: no model is called. Every failure #1631's check 2 found sat upstream of the
 * model: BTC's Coinbase premium and option data handed to an XRP read, "$1" printed for every XRP price, and a minus sign dropped from an
 * outflow. So the prompt text is the thing to check.
 *
 * THE ORACLE IS INDEPENDENT: expected prices are literals written here ($2.3456, $0.00001234), never output of lib/numberFormat.ts. A
 * context field this file does not set prints as <fieldName> (the Proxy from grokPerpSpot.test.mts), so a BTC-only VALUE that leaks into
 * an XRP prompt is found by its marker, on whatever line it lands.
 *
 * WHAT IT CANNOT PROVE: that the model obeys the prompt (that needs a billed run), or what Arena fills each field with in a browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildPrompt, buildCombinedPrompt, buildQuickPrompt } from '../lib/grok.ts';
import type { GrokContext, ChartData } from '../lib/grok.ts';
import { priceDigits, priceText, signedUsd, signOf } from '../lib/numberFormat.ts';
import { formatClustersForPrompt } from '../lib/liqClusters.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const anchor = (src: string, needle: string, label: string) => assert.equal(src.split(needle).length - 1, 1, `${label}: not found exactly once - re-read the current source`);

/** Minimal GrokContext: a field this file does not set prints as <fieldName>. */
function ctx(overrides: Partial<GrokContext>): GrokContext {
  return new Proxy({ ...overrides } as Record<string, unknown>, {
    get: (t, k) => (k in t ? t[k as string] : `<${String(k)}>`),
    has: () => true,
  }) as unknown as GrokContext;
}
const chart = (c: Pick<ChartData, 'lastClose' | 'hi' | 'lo' | 'ema9' | 'sma200'>): ChartData => ({ tf: '1h', rsi: 50, recent20: 'flat', ...c });
const XRP_CHART  = chart({ lastClose: 2.3456, hi: 2.4567, lo: 2.2345, ema9: 2.3401, sma200: 2.1789 });
const PEPE_CHART = chart({ lastClose: 0.00001234, hi: 0.00001301, lo: 0.00001188, ema9: 0.00001229, sma200: 0.00001105 });
const BTC_CHART  = chart({ lastClose: 107250, hi: 108900, lo: 105100, ema9: 107000, sma200: 98000 });
const builders = (c: GrokContext, ch: ChartData) =>
  [['buildPrompt', buildPrompt(c)], ['buildCombinedPrompt', buildCombinedPrompt(c, ch)], ['buildQuickPrompt', buildQuickPrompt(c, ch)]] as const;

/* BTC's own market: the Coinbase BTC premium, Deribit put/call and max pain, and GEX (#1631 B). */
const BTC_ONLY_MARKERS = ['<cbPremium>', '<pcRatio>', '<maxPain>', '<btcGex>'];
/* The premium, not the exchange: the search task names Coinbase among exchanges whose hacks to look for, which is not BTC's data. */
const NAMES_BTC_ONLY = /\bCB premium\b|coinbase (BTC )?premium|\bGEX\b|gamma|put\/call|max pain|deribit/i;
const NOT_GIVEN_LINE = "(BTC's options data, GEX and the Coinbase BTC premium are BTC's own market and are not given for";
/* #1668's precedence list names GEX for BTC by name; it carries no BTC data, so it is the one other line allowed to mention it. */
const SCOPED_TO_BTC = 'for BTC, the GEX regime decides whether a breakout counts.';
const BTC_ONLY_RULES = /WEIGHT GEX HEAVILY|GEX SETS THE REGIME FOR BTC|^11\. OPTIONS|^12\. GEX|^16\. COINBASE PREMIUM/m;

/* ── the formatter ────────────────────────────────────────────────────────── */

test('N1. priceText keeps the decimals a price needs: $107,250 / $2,345.67 / $2.3456 / $0.5123 / $0.00001234 / $0', () => {
  const cases: [number, string][] = [[107250, '$107,250'], [2345.67, '$2,345.67'], [2.3456, '$2.3456'], [0.5123, '$0.5123'], [0.00001234, '$0.00001234'], [0, '$0']];
  for (const [v, want] of cases) assert.equal(priceText(v), want, `priceText(${v})`);
});

test('N1b. below $1 a price keeps four significant digits written out in full: never an exponent, trailing zeros dropped', () => {
  const cases: [number, string][] = [[8.12e-7, '$0.000000812'], [1.5e-9, '$0.0000000015'], [0.0123456, '$0.01235'], [0.5, '$0.5'], [0.99996, '$1']];
  for (const [v, want] of cases) assert.equal(priceText(v), want, `priceText(${v})`);
  assert.equal(priceDigits(0.00001234), '0.00001234', 'priceDigits is the same number without the "$"');
  // CONTROL: the expression this replaced does switch to an exponent below 0.000001 (QA's review of #1665).
  assert.equal(Number((8.12e-7).toPrecision(4)).toString(), '8.12e-7');
});

test('N2. a signed amount never loses its minus: -$26.1M, +$527M, and signOf says "-" for any negative', () => {
  assert.equal(signedUsd(-26.1, 'M', 1), '-$26.1M');
  assert.equal(signedUsd(527, 'M', 0), '+$527M');
  assert.equal(signedUsd(-2.43, 'B', 1), '-$2.4B');
  assert.equal(signOf(-0.0001), '-'); assert.equal(signOf(0), '+'); assert.equal(signOf(12), '+');
  // CONTROL: the pattern #1631 C removed really does drop the minus, so the assertions above are not passing on a formatter that never had it.
  const old = (v: number) => (v >= 0 ? '+' : '') + '$' + Math.abs(v).toFixed(1) + 'M';
  assert.equal(old(-26.1), '$26.1M');
});

/* ── B: BTC-only data reaches a BTC read only ─────────────────────────────── */

test('P1. an XRP or PEPE read carries none of BTC\'s own data in any builder, and the only line naming it says it is not given', () => {
  for (const [coin, ch] of [['XRP/USDT', XRP_CHART], ['PEPE/USDT', PEPE_CHART]] as const) {
    for (const [name, p] of builders(ctx({ coin }), ch)) {
      for (const m of BTC_ONLY_MARKERS) assert.ok(!p.includes(m), `${name}, ${coin}: BTC's ${m} reached a ${coin} prompt`);
      assert.doesNotMatch(p, BTC_ONLY_RULES, `${name}, ${coin}: a BTC-only rule reached the prompt`);
      const naming = p.split('\n').filter((l) => NAMES_BTC_ONLY.test(l));
      assert.deepEqual(naming.filter((l) => !l.startsWith(NOT_GIVEN_LINE) && !l.trim().endsWith(SCOPED_TO_BTC)), [], `${name}, ${coin}: a line names BTC's premium, options or GEX`);
    }
  }
});

test('P2. CONTROL: a BTC read keeps all of it, so P1 is not passing on a prompt that never had it', () => {
  for (const [name, p] of builders(ctx({ coin: 'BTC/USDT' }), BTC_CHART)) {
    for (const m of BTC_ONLY_MARKERS) assert.ok(p.includes(m), `${name}: BTC's ${m} is missing from a BTC read`);
    assert.match(p, /GEX SETS THE REGIME FOR BTC, NEVER THE DIRECTION/); assert.match(p, /^11\. OPTIONS/m); assert.match(p, /^12\. GEX/m); assert.match(p, /^16\. COINBASE PREMIUM/m);
    assert.ok(!p.includes(NOT_GIVEN_LINE), `${name}: a BTC read says BTC's own data is not given`);
  }
});

/* ── B: prices by size ────────────────────────────────────────────────────── */

test('P3. the chart section prints each coin\'s prices with their decimals (XRP read "$2" and PEPE "$0" before)', () => {
  for (const build of [buildCombinedPrompt, buildQuickPrompt]) {
    const x = build(ctx({ coin: 'XRP/USDT' }), XRP_CHART);
    assert.match(x, /Last Close: \$2\.3456\n/); assert.match(x, /High \$2\.4567 \/ Low \$2\.2345\n/);
    assert.match(x, /EMA 9: +\$2\.3401\n/); assert.match(x, /SMA 200: \$2\.1789\n/);
    assert.match(x, /ABOVE SMA200 \(\$2\.1789\)/);
    const pepe = build(ctx({ coin: 'PEPE/USDT' }), PEPE_CHART);
    assert.match(pepe, /Last Close: \$0\.00001234\n/); assert.match(pepe, /High \$0\.00001301 \/ Low \$0\.00001188\n/);
    assert.match(build(ctx({ coin: 'BTC/USDT' }), BTC_CHART), /Last Close: \$107,250\n/);
  }
});

test('P4. the cluster lines keep a small coin\'s decimals: a PEPE cluster reads $0.00001234, not $0', () => {
  const line = formatClustersForPrompt([{ coin: 'pepe', price: 0.00001234, total: 1_200_000, longUsd: 1_000_000, shortUsd: 200_000 }], 'pepe');
  assert.equal(line, '$0.00001234 $1.2M longs');
});

test('P4b. the EMA stop and target keep a small coin\'s decimals: PEPE reads SL $0.00001188 · TP $0.00001301, not $0.0000 (STRUCTURE: lib/useEMAStrategy.ts does not load under plain Node, its imports name types as values)', () => {
  anchor(stripTsComments(read('lib/useEMAStrategy.ts')), '? ` · SL ${priceText(sig.sl)} · TP ${priceText(sig.tp)}`', 'strategyToGrokLine printing SL/TP through priceText');
  assert.equal(`SL ${priceText(0.00001188)} · TP ${priceText(0.00001301)}`, 'SL $0.00001188 · TP $0.00001301');
});

test('P4c. Arena\'s candle rows and the absorption levels print through the shared formatter, never fixed decimals (STRUCTURE ONLY: both sit inside components)', () => {
  const arena = stripTsComments(read('app/arena/page.tsx'));
  assert.match(arena, /const recent20 = vis\.slice\(-15\)\.map\(c => `O:\$\{priceDigits\(c\.o\)\} H:\$\{priceDigits\(c\.h\)\} L:\$\{priceDigits\(c\.l\)\} C:\$\{priceDigits\(c\.c\)\}/,
    'the candle rows no longer print o/h/l/c through priceDigits (PEPE read O:0.0000 before)');
  assert.doesNotMatch(arena, /toFixed\(pDec\)/);
  const abs = stripTsComments(read('components/AbsorptionDetector.tsx'));
  assert.match(abs, /\$\{priceText\(w\.price\)\} \$\{side\} wall/, 'the wall level no longer prints through priceText (XRP read "at $2 bid wall" before)');
  assert.match(abs, /fib \(\$\{priceText\(near\.price\)\}\)/);
  assert.doesNotMatch(abs, /\$\$\{(?:w|near)\.price\.toLocaleString/);
});

/* ── B: no raid without cluster data ──────────────────────────────────────── */

test('P5. with no cluster data the prompt orders RAID_SETUP: NONE; with clusters it does not', () => {
  const none = buildCombinedPrompt(ctx({ coin: 'XRP/USDT', liqLevels: 'Not available' }), XRP_CHART);
  assert.match(none, /a raid cannot be judged: write RAID_SETUP: NONE, RAID_TARGET: N\/A, RAID_TRIGGER: N\/A/);
  const some = buildCombinedPrompt(ctx({ coin: 'XRP/USDT', liqLevels: '$2.31 $1.2M longs' }), XRP_CHART);
  assert.doesNotMatch(some, /a raid cannot be judged/);
});

/* ── C: labels say what is sent ───────────────────────────────────────────── */

test('P6. "Last 15 candles" is what Arena sends: the label says 15 and Arena slices 15', () => {
  const p = buildCombinedPrompt(ctx({ coin: 'XRP/USDT' }), XRP_CHART);
  assert.match(p, /^Last 15 candles \(OHLC\): flat$/m); assert.doesNotMatch(p, /Last 20 candles/);
  assert.match(stripTsComments(read('app/arena/page.tsx')), /const recent20 = vis\.slice\(-15\)/, 'Arena no longer slices 15 candles: the label and the data disagree');
});

test('P7. the macro block names both 10-year yields, and rule 14 never calls a shrinking or unknown supply dry powder', () => {
  const p = buildPrompt(ctx({ coin: 'BTC/USDT' }));
  assert.match(p, /^US 10Y Treasury yield \(nominal\): <bonds10y>$/m);
  assert.match(p, /^US 10Y TIPS \(real\) yield \(FRED DFII10\): <real10y>$/m);
  assert.doesNotMatch(p, /US 10Y Bond Yield/);
  assert.match(p, /^14\. STABLECOIN FLOWS: judge by the 7d\/30d change given, never by the level\..*never call a shrinking or unknown supply dry powder/m);
});

/* ── C: the minus-sign class, swept ───────────────────────────────────────── */

const SIGN_THEN_ABS = /\?\s*'\+'\s*:\s*''[^\n]{0,40}Math\.abs\(/;

test('S1. no surface builds a sign and then prints Math.abs of the value (it drops every minus): 7 such lines before #1631 C, none now', () => {
  // CONTROL: the pattern finds both shapes #1631 C removed, so a clean sweep below means something.
  assert.match("(store.btcExchangeNetFlow >= 0 ? '+' : '') + '$' + Math.abs(store.btcExchangeNetFlow).toFixed(1) + 'M'", SIGN_THEN_ABS);
  assert.match("{netFlow >= 0 ? '+' : ''}{fmtUSD(Math.abs(netFlow))}", SIGN_THEN_ABS);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
    }
  };
  for (const d of ['app', 'components', 'lib']) walk(d);
  assert.ok(files.length > 200, `precondition: only ${files.length} source files found`);
  const hits = files.flatMap((f) => stripTsComments(read(f)).split('\n').filter((l) => SIGN_THEN_ABS.test(l)).map((l) => `${f}: ${l.trim()}`));
  assert.deepEqual(hits, [], 'a sign is built and the value printed through Math.abs: a negative prints as positive');
});

test('S2. a stablecoin read missing USDT\'s or USDC\'s current value leaves the supply and both changes unknown, never a partial sum (STRUCTURE ONLY: MarketProvider is a component)', () => {
  const mp = stripTsComments(read('components/MarketProvider.tsx'));
  assert.match(mp, /if \(!answered\.has\('USDT'\) \|\| !answered\.has\('USDC'\)\) \{\s*setStore\(s => \(\{ \.\.\.s, stablecoinSupply: null, stablecoinChg7d: null, stablecoinChg30d: null \}\)\);\s*return;/,
    'a read missing one coin\'s current value no longer leaves the supply unknown');
  assert.doesNotMatch(mp, /total \+= circulating\?\.peggedUSD \?\? 0/, 'a missing current value counts as 0 again (USDC\'s ~$75B would vanish and read SHRINKING)');
});
