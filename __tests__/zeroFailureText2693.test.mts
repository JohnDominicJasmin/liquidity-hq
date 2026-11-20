import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/* #2693 (owner's zero-failure-text rule, QA signed-out matrix on #1185): where data is missing the page shows nothing. Written rule (PR body): the Perps-vs-spot card is LEFT OUT for a coin with no spot reading (it said CANNOT MEASURE, a dash and "Spot data unavailable for this coin"); a reading that exists is drawn as before (verdict, explanation, a stale age after 90 minutes); a failed read with nothing earlier is left out too; the Liquidations row with no amount is blank, never a dash; the Briefing page never prints "Economic calendar unavailable right now" (the AI context keeps the flag; briefingHonesty C1 and briefingFailureText2682 P1 are re-anchored); the Multi-timeframe card is left out after its wait (mtfAlignmentNoDash2576 D3).
 *   Q1 the real PerpSpotCard server-rendered with its hooks stood in   Q2 hooks are all called BEFORE any early return in the two cards that now return null (the rules of hooks: a later hook would crash the page when the wait ends)
 * NOT covered (browser cells after deploy): layout of the dashboard column when a card is left out. */
const here = path.dirname(fileURLToPath(import.meta.url)); const TREE = path.resolve(here, '..');
const req = createRequire(path.join(TREE, 'package.json')); const React = req('react'); const { renderToStaticMarkup } = req('react-dom/server');
const transpile = (rel: string) => ts.transpileModule(readFileSync(path.join(TREE, rel), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
type Reading = { lean: 'perp' | 'spot' | 'normal' | 'unknown'; relative?: number | null } | null;
const world: { reading: Reading; fetchedAt: number | null; now: number } = { reading: null, fetchedAt: null, now: 10_000_000_000 };
const T = (k: string, v?: Record<string, unknown>) => (v ? `${k}|${JSON.stringify(v)}` : k);
const mocks: Record<string, unknown> = {
  '@/lib/marketStore': { useMarket: () => ({ store: { selectedCoin: 'btc' } }) },
  '@/lib/usePerpSpot': { usePerpSpot: () => world.reading, useAbsorption: () => ({ available: true, spotTakerPct: 55 }), perpSpotFetchedAt: () => world.fetchedAt },
  '@/lib/labels': { useLabels: () => ({ t: T }) },
  '@/lib/useNow': { useNow: () => world.now },
  '@/lib/ageLabel': { ageLabel: (ms: number) => `AGE:${Math.round(ms / 60_000)}m` },
};
const Card: () => unknown = (() => { const m = { exports: {} as { default?: unknown } }; new Function('exports', 'module', 'require', transpile('components/PerpSpotCard.tsx'))(m.exports, m, (id: string) => (id in mocks ? mocks[id] : req(id))); return m.exports.default as never; })();
const render = (r: Reading, fetchedAt: number | null = null) => { world.reading = r; world.fetchedAt = fetchedAt; return (renderToStaticMarkup(React.createElement(Card as never)) as string).replace(/&quot;/g, '"'); };

test('Q1. Perps-vs-spot: no reading or an unknown reading leaves the card out; a real reading is drawn with its verdict and sentence, and a stale age after 90 minutes', () => {
  assert.equal(render(null).trim(), '', 'a failed read with nothing earlier draws nothing'); assert.equal(render({ lean: 'unknown' }).trim(), '', 'a coin with no spot reading draws nothing');
  const unknown = render({ lean: 'unknown' }); for (const bad of ['PERP_SPOT_VERDICT_UNKNOWN', 'PERP_SPOT_EXPLAIN_UNKNOWN']) assert.equal(unknown.includes(bad), false, `${bad} is drawn again`);
  for (const [lean, verdict] of [['perp', 'PERP_SPOT_VERDICT_PERP'], ['spot', 'PERP_SPOT_VERDICT_SPOT'], ['normal', 'PERP_SPOT_VERDICT_NORMAL']] as const) { const h = render({ lean, relative: 2.5 }, world.now - 5 * 60_000); assert.ok(h.includes(verdict), `${lean}: the verdict is missing`); assert.equal(h.includes('PERP_SPOT_VERDICT_UNKNOWN'), false); assert.equal(h.includes('AGE:'), false, `${lean}: a fresh reading must not show an age`); }
  const old = render({ lean: 'perp', relative: 2.5 }, world.now - 120 * 60_000); assert.ok(old.includes('AGE:120m'), 'a reading older than 90 minutes says how old it is'); const edge = render({ lean: 'perp', relative: 2.5 }, world.now - 90 * 60_000); assert.equal(edge.includes('AGE:'), false, 'exactly 90 minutes is not yet stale');
  assert.ok(render({ lean: 'perp', relative: 2.5 }).includes('"times":"2.5x"'), 'the multiple is carried into the sentence');
});
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
test('Q2. every hook is called BEFORE the early returns that leave a card out (PerpSpotCard, MultiTFAlignment)', () => {
  for (const [file, ret] of [['components/PerpSpotCard.tsx', "if (reading.lean === 'unknown') return null;"], ['components/MultiTFAlignment.tsx', 'if (noDataShown) return null;']] as const) {
    const src = strip(readFileSync(path.join(TREE, file), 'utf8').replace(/\r\n/g, '\n')); const at = src.indexOf(ret); assert.ok(at > 0, `${file}: the early return is gone`);
    assert.equal(/\buse[A-Z][A-Za-z]*\(/.test(src.slice(at)), false, `${file}: a hook is called AFTER the early return that leaves the card out`);
    assert.ok(/\buse(State|Effect|Market|Labels|NowContext|Now)\(/.test(src.slice(0, at)), `CONTROL: ${file} has no hooks before the return`);
  }
});
