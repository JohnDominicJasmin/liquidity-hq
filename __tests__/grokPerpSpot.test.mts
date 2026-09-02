/* #340 - the perps-vs-spot reading as it reaches the model.
 *
 * These test PROMPT CONSTRUCTION, not model output. Asserting what Grok
 * replies would cost the owner money on every run, and QA is right that the
 * interesting failures are all upstream of the model anyway: the wrong string,
 * a missing line, two labels that mean different things.
 *
 * Assertion 1 is the load-bearing one. Everything else here is structure.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, buildCombinedPrompt, buildQuickPrompt } from '../lib/grok.ts';
import { computePerpSpot } from '../lib/perpSpot.ts';
import type { GrokContext, ChartData } from '../lib/grok.ts';

const H = 3600_000;
const T0 = Date.UTC(2026, 7, 12, 0, 0, 0);

/** A reading whose latest closed hour runs `lastRatio` against a `ratio` norm. */
function reading(ratio: number, lastRatio = ratio) {
  const spot = [], perp = [];
  for (let i = 0; i < 48; i++) {
    const t = T0 + i * H, s = 10_000_000;
    const r = i === 47 ? lastRatio : ratio;
    spot.push({ time: t, quoteVolume: s });
    perp.push({ time: t, quoteVolume: s * r });
  }
  return computePerpSpot(spot, perp, H, T0 + 48 * H);
}

/** Minimal GrokContext - every field a string, so a Proxy fills the rest. */
function ctx(overrides: Partial<GrokContext>): GrokContext {
  return new Proxy({ ...overrides } as Record<string, unknown>, {
    get: (t, k) => (k in t ? t[k as string] : `<${String(k)}>`),
    has: () => true,
  }) as unknown as GrokContext;
}

/* A COMPLETE ChartData. The first version stubbed three fields and
   buildCombinedPrompt threw on `chart.lastClose.toFixed` - which read at a
   glance like the builder dropping the perps line. It was my fixture. Checked
   before reporting it, which is the only reason it is not filed as a defect. */
const CHART: ChartData = {
  tf: '4h', ema9: 61000, sma200: 58000, rsi: 55,
  recent20: 'flat', hi: 62000, lo: 59000, lastClose: 61500,
};

/* ── 1. the single-vocabulary guarantee ─────────────────────────────────── */

test('the prompt carries reading.explanation VERBATIM - not a paraphrase', () => {
  // The card renders this exact string. If the two ever diverge, a user reading
  // the dashboard and then the AI sees two claims where there is one fact - and
  // nothing else in the codebase would notice. A comment describes this
  // guarantee; this is the thing that enforces it.
  const r = reading(8, 8 * 1.6);
  const prompt = buildPrompt(ctx({ perpSpot: r.explanation }));

  assert.ok(prompt.includes(r.explanation),
    'the prompt must contain the card sentence character-for-character');
  assert.match(r.explanation, /usual share against spot/, 'sanity: this fixture is the perp-led wording');
});

test('every prompt builder carries it, not just the long one', () => {
  const r = reading(8, 8 * 0.5);
  const c = ctx({ perpSpot: r.explanation });
  for (const [name, built] of [
    ['buildPrompt', buildPrompt(c)],
    ['buildCombinedPrompt', buildCombinedPrompt(c, CHART)],
    ['buildQuickPrompt', buildQuickPrompt(c, CHART)],
  ] as const) {
    assert.ok(built.includes(r.explanation), `${name} dropped the perps-vs-spot line`);
  }
});

/* ── 2. absent must not be silent ───────────────────────────────────────── */

test('an unmeasurable reading still reaches the prompt', () => {
  // Omitting the line would leave the model inferring from silence, which is
  // the same failure shape as a card rendering a dash - arrived at from the
  // model's side instead of the user's.
  const r = computePerpSpot([], []);
  assert.equal(r.lean, 'unknown');
  const prompt = buildPrompt(ctx({ perpSpot: r.explanation }));
  assert.ok(prompt.includes('unavailable'),
    'the model must be told the reading is missing, not left to infer it');
});

/* ── 3. the two readings stay distinguishable (#343) ────────────────────── */

test('basis is labelled PRICE and activity is labelled VOLUME', () => {
  // Both were called "perp vs spot" until #343. They measure different things
  // and can point opposite ways, and rule 11 gives an unqualified bullish read
  // for positive basis. This guards the rename against a future tidy-up.
  const prompt = buildPrompt(ctx({ basis: '+0.08%', perpSpot: reading(8).explanation }));

  const basisLine = prompt.split('\n').find(l => /basis/i.test(l) && /\+0\.08%/.test(l));
  const actLine   = prompt.split('\n').find(l => /real yield|usual|leveraged|actually buying/i.test(l));

  assert.ok(basisLine, 'no basis line found');
  assert.ok(actLine, 'no perps-vs-spot line found');
  assert.match(basisLine!, /PRICE/, 'the basis line must say it is a price premium');
  assert.match(actLine!,  /VOLUME|ACTIVITY/, 'the activity line must say it is not price');
  assert.notEqual(basisLine, actLine, 'they must be separate lines');
});

/* ── 4. the reconciliation instruction ──────────────────────────────────── */

test('rule 11b tells the model the two can disagree, and to say so', () => {
  // The renaming alone stops confusion between the two. It does not stop the
  // model asserting "positive basis = healthy bull market" and "leverage-led,
  // fragile" in one answer. This instruction is the actual fix.
  const prompt = buildPrompt(ctx({}));
  assert.match(prompt, /11b\./, 'rule 11b is missing');
  assert.match(prompt, /may disagree/i);
  assert.match(prompt, /say so explicitly/i,
    'the model must be told to name the conflict rather than silently pick one');
});

test('CONTROL: the assertions above fail on a prompt without the feature', () => {
  // Without this, all four could be passing against any prompt that happens to
  // contain the words - which is how a test ends up asserting its own fixture.
  const bare = 'a prompt with none of this in it';
  assert.ok(!bare.includes(reading(8).explanation));
  assert.doesNotMatch(bare, /11b\./);
  assert.doesNotMatch(bare, /PRICE premium/);
});
