/* QA: PR #2659, the Dashboard selected-coin card takes its OI word from the same 1h samples as the OI cards (ONE surface, ONE answer).
 * Source: lib/oiTrend1h.ts (the rule), components/DashboardTerminal.tsx, components/LandingTerminal.tsx. No browser, no network.
 *   D1  the shared mapping oiTrend1h, table-tested against the rule written in its own header (OI up + price up = new buyers, OI up + price down = new sellers,
 *       OI down + price up = short covering, both down = long exits; OI >= 0.3% AND price >= 0.2%; unknown is unknown, never "flat")
 *   D2  the card's word table: each trend key reads its own label, and the shipped words are the four the PR names ("Long exits" for weak_down)
 *   D3  the decision the three surfaces run (selected-coin card, OI trend card in TEdgeSignals, landing row) is EXTRACTED from the source and run over a grid of
 *       (1h samples, store trend): all three agree with the rule "1h samples answered -> oiTrend1h, else the store trend as a fallback"
 *   D4  the selected-coin card has no other source: the only store read is the fallback, it calls useOI1h for ITS coin
 *   D5  the card must not show another coin's word: useOI1h hands back the PREVIOUS coin's snapshot for one render after a coin change (its own doc, #1651), so
 *       a consumer must check the snapshot's coin (or loading); red on the head if it does neither
 *   D6  (informational) where else a component still reads the store's own oiTrend for a displayed word
 * WHAT THIS CANNOT PROVE: how the card renders at 390/768/1280 or in light/dark (no browser here), or that the live 1h samples answer for a given coin. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { oiTrend1h, OI_MOVE_MIN_PCT, PRICE_MOVE_MIN_PCT } from '../lib/oiTrend1h.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const DASH = read('../components/DashboardTerminal.tsx');
const LAND = read('../components/LandingTerminal.tsx');
const DEF = JSON.parse(read('../lib/labelDefaults.en.json')) as Record<string, string>;

const between = (src: string, from: string, to: string) => { const a = src.indexOf(from); assert.ok(a >= 0, `not found: ${from}`); const b = src.indexOf(to, a + from.length); assert.ok(b > a, `end not found: ${to}`); return src.slice(a, b); };
const CARD = between(DASH, 'function TSelectedCoinCard() {', '\n/* Flat terminal panel');
const EDGE = between(DASH, 'function TEdgeSignals() {', '\nfunction TSelectedCoinCard');

test('D1. oiTrend1h: the four quadrants, the thresholds (inclusive), and unknown stays unknown', () => {
  assert.equal(OI_MOVE_MIN_PCT, 0.3); assert.equal(PRICE_MOVE_MIN_PCT, 0.2);
  const rows: Array<[number | null, number | null, string | null]> = [
    [1, 1, 'strong_up'], [1, -1, 'strong_down'], [-1, 1, 'weak_up'], [-1, -1, 'weak_down'],
    [0.3, 0.2, 'strong_up'], [0.3, -0.2, 'strong_down'], [-0.3, 0.2, 'weak_up'], [-0.3, -0.2, 'weak_down'],
    [0.2999, 1, null], [-0.2999, -1, null], [1, 0.1999, null], [1, -0.1999, null],
    [0, 0, null], [0, 5, null], [5, 0, null],
    [null, 1, null], [1, null, null], [null, null, null],
    [Number.NaN, 1, null], [1, Number.NaN, null], [Number.POSITIVE_INFINITY, 1, null], [1, Number.NEGATIVE_INFINITY, null],
    [12.5, 3.2, 'strong_up'], [-12.5, -3.2, 'weak_down'],
  ];
  for (const [oi, px, want] of rows) assert.equal(oiTrend1h(oi, px), want, `oiTrend1h(${oi}, ${px})`);
});

test('D2. the card\'s word table: each trend key reads its own label, and the shipped words are the four the PR names', () => {
  const meta = between(DASH, 'const OI_TREND_META', '};');
  const got = Object.fromEntries([...meta.matchAll(/(strong_up|strong_down|weak_up|weak_down):\s*\{\s*txtKey: '(\w+)',\s*subKey: '(\w+)'/g)].map((m) => [m[1], [m[2], m[3]]]));
  assert.deepEqual(got, {
    strong_up: ['OI_TREND_STRONG_UP_TXT', 'OI_TREND_STRONG_UP_SUB'], strong_down: ['OI_TREND_STRONG_DOWN_TXT', 'OI_TREND_STRONG_DOWN_SUB'],
    weak_up: ['OI_TREND_WEAK_UP_TXT', 'OI_TREND_WEAK_UP_SUB'], weak_down: ['OI_TREND_WEAK_DOWN_TXT', 'OI_TREND_WEAK_DOWN_SUB'],
  });
  assert.match(DEF.OI_TREND_STRONG_UP_TXT, /New buyers opening/); assert.match(DEF.OI_TREND_STRONG_DOWN_TXT, /New sellers opening/);
  assert.match(DEF.OI_TREND_WEAK_UP_TXT, /Short covering/); assert.match(DEF.OI_TREND_WEAK_DOWN_TXT, /Long exits/);
  /* the sub-lines carry no forecast or advice */
  for (const k of ['OI_TREND_STRONG_UP_SUB', 'OI_TREND_STRONG_DOWN_SUB', 'OI_TREND_WEAK_UP_SUB', 'OI_TREND_WEAK_DOWN_SUB']) assert.doesNotMatch(DEF[k], /\bwait for\b|\btends? to\b|\bwill (?:rise|fall|drop)\b|\bmay push\b/i, k);
});

/* run a snippet of the component source: `lines` are statements copied out of it, `ret` the expression to read afterwards */
type Oi1h = { pct: number | null; pricePct: number | null; loading?: boolean; coin?: string };
function run(lines: string[], ret: string, oi1h: Oi1h, d: { oiTrend: string | null } | undefined): unknown {
  /* the snapshot belongs to the selected coin ("btc") and has loaded, so a coin / loading guard (D5) is satisfied and the grid below tests the decision alone */
  const snap = { coin: 'btc', loading: false, ...oi1h };
  return new Function('oi1h', 'd', 'oiTrend1h', 'id', 'coin', `${lines.join('\n')}\nreturn ${ret};`)(snap, d, oiTrend1h, 'btc', 'btc');
}
const stmt = (src: string, name: string) => { const m = new RegExp(`const ${name} = [^\\n]*;`).exec(src); assert.ok(m, `statement "const ${name} = ..." not found`); return m![0]; };

const SAMPLES: Oi1h[] = [
  { pct: 1.2, pricePct: 0.8 }, { pct: 1.2, pricePct: -0.8 }, { pct: -1.2, pricePct: 0.8 }, { pct: -1.2, pricePct: -0.8 },
  { pct: 0.1, pricePct: 0.8 }, { pct: 1.2, pricePct: 0.05 }, { pct: 0, pricePct: 0 },
  { pct: 1.2, pricePct: null }, { pct: null, pricePct: 0.8 }, { pct: null, pricePct: null },
];
const STORE = [null, 'strong_up', 'strong_down', 'weak_up', 'weak_down'];
const rule = (s: Oi1h, store: string | null) => (s.pct != null && s.pricePct != null ? oiTrend1h(s.pct, s.pricePct) : store);

test('D3. selected-coin card, OI trend card and landing row run the SAME decision over every (1h samples, store trend) pair', () => {
  const card = [stmt(CARD, 'oi1hAnswered'), stmt(CARD, 'oiKey')];
  const edge = [stmt(EDGE, 'oi1hAnswered'), stmt(EDGE, 'oiTrendKey')];
  const land = [stmt(LAND, 'oi1hBoth'), stmt(LAND, 'oiTrendFrom1h')];
  let n = 0;
  for (const s of SAMPLES) for (const store of STORE) {
    const d = { oiTrend: store }; const want = rule(s, store);
    assert.equal(run(card, 'oiKey', s, d), want, `selected-coin card (${JSON.stringify(s)}, store ${store})`);
    assert.equal(run(edge, 'oiTrendKey', s, d), want, `OI trend card (${JSON.stringify(s)}, store ${store})`);
    /* landing: 1h answered -> the 1h word (or none); not answered -> the store word. Its own words differ by design, the KEY must not. */
    const landKey = run(land, 'oi1hBoth ? oiTrendFrom1h : (d?.oiTrend ?? null)', s, d);
    assert.equal(landKey, want, `landing row (${JSON.stringify(s)}, store ${store})`);
    n++;
  }
  assert.equal(n, SAMPLES.length * STORE.length);
  /* no store value at all (d undefined): the card falls back to nothing, not a crash */
  assert.equal(run(card, 'oiKey', { pct: null, pricePct: null }, undefined), null);
  /* the headline case of the PR: store says strong_up, the 1h samples say OI down + price down: the card must read long exits (weak_down), not new buyers */
  assert.equal(run(card, 'oiKey', { pct: -1.23, pricePct: -0.9 }, { oiTrend: 'strong_up' }), 'weak_down');
});

test('D4. the selected-coin card has one source: useOI1h for ITS coin; the store trend is only the fallback', () => {
  assert.match(CARD, /const id\s*=\s*store\.selectedCoin;/);
  assert.match(CARD, /const oi1h = useOI1h\(id\);/);
  assert.match(CARD, /oiTrend1h\(oi1h\.pct, oi1h\.pricePct\)/);
  const reads = [...CARD.matchAll(/d\?*\.oiTrend/g)];
  assert.equal(reads.length, 1, 'the store trend may be read exactly once (as the fallback)');
  assert.match(CARD, /: d\?\.oiTrend \?\? null;/);
  assert.doesNotMatch(CARD, /OI_TREND_META\[d\??\.oiTrend\]/, 'the card must not index the word table with the store trend directly');
  assert.match(CARD, /const sigText = oi \? t\(oi\.txtKey\)/);
});

test('D5. the card must not show another coin\'s OI word: it checks the 1h snapshot\'s coin (or loading) before using it', () => {
  /* lib/useOI1h.ts, OI1hData.coin: "for one render after a coin change the component already holds the NEW coin while this hook still returns the OLD snapshot".
     CoinMarketSnapshot guards with !oi1h.loading; the Arena stamps oi1h.coin. TSelectedCoinCard changes with store.selectedCoin and does neither. */
  const guarded = /oi1h\.coin\s*===\s*id|oi1h\.coin\s*!==\s*id|!oi1h\.loading/.test(CARD);
  assert.ok(guarded, 'TSelectedCoinCard uses oi1h.pct / oi1h.pricePct with no check that they belong to the selected coin: for one render after a coin change the card shows the previous coin\'s word');
});

test('D6. informational: components that still read the store\'s own oiTrend for a displayed word', () => {
  const files = ['components/DashboardTerminal.tsx', 'components/MarketsTerminal.tsx', 'components/BriefingTerminal.tsx', 'components/SetupScanner.tsx', 'components/AccumulationTracker.tsx', 'components/StopLossZone.tsx', 'components/LandingTerminal.tsx'];
  const out: string[] = [];
  for (const f of files) { const s = read(`../${f}`).split('\n'); s.forEach((line, i) => { if (/\.oiTrend\b/.test(line) && !/^\s*(\/\/|\/\*|\*)/.test(line)) out.push(`${f}:${i + 1}`); }); }
  console.log(`[OI-SECOND-SOURCES] store oiTrend still read at ${out.length} places (store trend is the 60-minute window of lib/oiTrendWindow.ts, same thresholds): ${out.join(', ')}`);
  assert.ok(out.length > 0);
});
