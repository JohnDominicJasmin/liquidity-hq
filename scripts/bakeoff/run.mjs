/* THE RUNNER (#1818). 12 fixtures x 3 runs x N engines, scored blind, reported with the spread.
 *
 * Run:  node scripts/bakeoff/run.mjs              both engines, whichever have keys
 *       node scripts/bakeoff/run.mjs --only grok  one engine
 *       node scripts/bakeoff/run.mjs --runs 1     cheaper smoke pass, NOT a result
 *
 * ── HOW THE BLINDING ACTUALLY WORKS, because "we stripped the vendor name" is easy to say and
 *    easy to get wrong ──────────────────────────────────────────────────────────────────────────
 *
 * The vendor is known HERE, where calls are made, and nowhere downstream. `score.mjs` receives
 * opaque ids (`engine-a`, `engine-b`) assigned in an order that depends on the run seed, and the
 * mapping is written to the output only AFTER every score is computed. So the scorer cannot favour
 * a vendor, and neither can I while reading intermediate output.
 *
 * **THE RAW REPLIES ARE SAVED.** A score that cannot be traced back to what the model actually
 * said is not evidence, and the one question this test will certainly raise - "what did it
 * actually answer on that window" - has to be answerable without re-running and re-paying.
 *
 * ── WHAT A FAILED CALL IS NOT ────────────────────────────────────────────────────────────────
 *
 * A transport error or an HTTP 5xx is recorded as a FAILURE, never as an empty answer. On group B
 * an empty answer scores full marks, so folding a timeout into "returned nothing" would silently
 * award points for an outage - the same shape as a dead dependency reading as fine.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseReply } from './prompt.mjs';
import { scoreAnswer, compare, AGREEMENT_ATR } from './score.mjs';
import { ENGINES, PRICING } from './engines.mjs';

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const RUNS = args.includes('--runs') ? Number(args[args.indexOf('--runs') + 1]) : 3;
const SEED = args.includes('--seed') ? Number(args[args.indexOf('--seed') + 1]) : 1;

const FIX = new URL('./fixtures/', import.meta.url);
const OUT = new URL('./results/', import.meta.url);

const fixtures = readdirSync(FIX).filter(n => n !== 'manifest.json')
  .map(n => JSON.parse(readFileSync(new URL(n, FIX), 'utf8')))
  .sort((a, b) => a.id.localeCompare(b.id));

const byGroup = g => fixtures.filter(f => f.group === g).length;
if (!fixtures.length) {
  console.error('No fixtures. Run scripts/bakeoff/pull-fixtures.mjs first.');
  process.exit(1);
}
console.log(`fixtures: ${fixtures.length}  A=${byGroup('A')} B=${byGroup('B')} C=${byGroup('C')}  runs=${RUNS}`);

const active = ENGINES.filter(e => !only || e.vendor === only);
/* Blind ids, order dependent on the seed so it is not always grok=a. */
const order = SEED % 2 === 0 ? [...active].reverse() : active;
const blind = new Map(order.map((e, i) => [e.vendor, `engine-${String.fromCharCode(97 + i)}`]));

const byEngine = {};
const raw = [];
const failures = [];
let calls = 0;

for (const engine of active) {
  const id = blind.get(engine.vendor);
  byEngine[id] = {};
  for (const fx of fixtures) {
    byEngine[id][fx.id] = [];
    for (let run = 1; run <= RUNS; run++) {
      const res = await engine.call(fx.candles);
      calls++;
      if (!res.ok) {
        failures.push({ engine: id, fixtureId: fx.id, run, reason: res.reason });
        /* NOT pushed as a score. An outage is not an answer - see the header. */
        process.stdout.write('!');
        continue;
      }
      const parsed = parseReply(res.text, fx.candles);
      const score = scoreAnswer(parsed, fx);
      score.latencyMs = res.latencyMs;
      score.cost = res.cost;
      score.usage = res.usage;
      byEngine[id][fx.id].push(score);
      raw.push({ engine: id, fixtureId: fx.id, run, model: res.model,
                 latencyMs: res.latencyMs, cost: res.cost, usage: res.usage, text: res.text });
      process.stdout.write(score.structureCount > 0 ? '.' : 'o');
    }
  }
  process.stdout.write('\n');
}

const fixturesById = Object.fromEntries(fixtures.map(f => [f.id, f]));
const result = compare(byEngine, fixturesById);
/* The un-blinding, attached only now that every score is computed - see the header. */
result.engineMap = Object.fromEntries([...blind].map(([v, id]) => [id, v]));

/* Cost and latency per engine, from the vendors' own figures. */
for (const id of Object.keys(byEngine)) {
  const all = Object.values(byEngine[id]).flat();
  const costs = all.map(r => r.cost).filter(c => c !== null);
  const lat = all.map(r => r.latencyMs).filter(Number.isFinite).sort((a, b) => a - b);
  result.summary[id].calls = all.length;
  result.summary[id].costTotal = costs.length ? Number(costs.reduce((a, b) => a + b, 0).toFixed(4)) : null;
  result.summary[id].costPerCall = costs.length
    ? Number((costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(5)) : null;
  result.summary[id].latencyMs = lat.length
    ? { min: lat[0], median: lat[Math.floor(lat.length / 2)], max: lat[lat.length - 1] } : null;
}

mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
writeFileSync(new URL(`raw-${stamp}.json`, OUT), JSON.stringify(raw, null, 1));
writeFileSync(new URL(`result-${stamp}.json`, OUT), JSON.stringify({
  ranAt: new Date().toISOString(),
  runs: RUNS, seed: SEED, calls,
  /* The un-blinding, written only now that every score is computed. */

  pricing: PRICING,
  /* The criterion the convergence exclusion used, in the output rather than only in the code. */
  convergence: {
    agreementThresholdAtr: AGREEMENT_ATR,
    meaning: 'Two claims are the same structure when they name the same side and their fitted '
           + `lines differ by <= ${AGREEMENT_ATR} ATR in mean absolute separation across the window.`,
    appliesTo: 'group B only',
    effect: 'converged windows are excluded from the fabrication count and listed separately',
  },
  caveats: [
    'Claude cost is an UPPER BOUND: prompt caching is off on the account.',
    'Groups were assigned by scripts/bakeoff/classify.mjs against a shuffled-returns null, which is'
      + ' an easier null than real price - so z is inflated and the C band should not be over-read.',
    'Engines are scored by the same geometry that chose the fixtures; a structure our code cannot'
      + ' see lands in B. The convergence rule is the only guard against that.',
  ],
  ...result,
  failures,
}, null, 1));

console.log('');
for (const [id, s] of Object.entries(result.summary)) {
  console.log(`${id}  (${result.engineMap[id]})`);
  console.log(`  group A found            ${s.groupAFoundRate}   <- THE CONTROL. not ~1.0 means the prompt is wrong, not the engine`);
  console.log(`  fabrications on B        ${s.fabricationsOnB}/${s.bRuns}  rate ${s.fabricationRate}   <- THE DECIDER`);
  console.log(`  group C touches          ${s.groupCTouch ? `min ${s.groupCTouch.min} median ${s.groupCTouch.median} max ${s.groupCTouch.max}` : 'n/a'}`);
  console.log(`  mean pivot agreement     ${s.meanPivotAgreement}`);
  console.log(`  parse fails / repairs    ${s.parseFailures} / ${s.formatRepairs}   invalid timestamps ${s.invalidTimestamps}`);
  console.log(`  cost  total ${s.costTotal}  per call ${s.costPerCall}`);
  console.log(`  latency ms  ${s.latencyMs ? `min ${s.latencyMs.min} median ${s.latencyMs.median} max ${s.latencyMs.max}` : 'n/a'}`);
}
if (result.converged.length) {
  console.log(`\nCONVERGED ON ${result.converged.length} GROUP-B WINDOW(S) - excluded from the fabrication count:`);
  for (const c of result.converged) console.log(`  ${c.fixtureId}  side ${c.side}  touches ${c.touchCounts.join(' vs ')}  classifier z ${c.classifierZ}`);
  console.log('  Every engine claimed the same line in a window our geometry calls noise.');
  console.log('  That is evidence OUR definition is blind, not independent fabrication.');
}
if (failures.length) {
  console.log(`\n${failures.length} FAILED CALL(S) - not scored as empty answers:`);
  for (const f of failures.slice(0, 10)) console.log(`  ${f.engine} ${f.fixtureId} run ${f.run}: ${f.reason}`);
}
console.log(`\nresults/result-${stamp}.json   raw replies in results/raw-${stamp}.json`);
if (active.length < 2) {
  console.log('\nONE ENGINE ONLY. No comparison and no convergence check - both need two.');
}
