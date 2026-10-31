/* THE SCORER (#1818). Mechanical, blind, and decided before any numbers exist.
 *
 * It never sees a vendor name. `run.mjs` passes opaque engine ids, so nothing in here can flatter
 * a preference even by accident - which is the spec's "vendor identity stripped before scoring".
 *
 * ── THE CONVERGENCE RULE, AND WHY IT HAD TO BE WRITTEN BEFORE THE RUN ────────────────────────
 *
 * `classify.mjs` files a window under B when OUR geometry finds no line better than that window's
 * own noise. **So a real structure our code is blind to lands in B, and an engine that finds it is
 * scored as fabricating.** That circularity is inherent to making Phase 0 the scorer.
 *
 * **But two different engines independently claiming the SAME line in what we called noise is not
 * two fabrications - it is evidence that our definition is blind.** So that case is flagged,
 * reported separately, and EXCLUDED from the fabrication count, with the exclusion stated in the
 * output rather than folded into a total.
 *
 * Raised by PM. It costs nothing, it is the only part of this design that can tell "the engines
 * are wrong" from "we are", and **a rule like this invented after seeing the numbers would be
 * indistinguishable from excusing whichever engine lost.** That is why it is in this file now,
 * before a single call has been made.
 *
 * AGREEMENT IS GEOMETRIC, NOT BY SHARED TIMESTAMPS. Two engines can describe one line through
 * different pivots on it, so comparing their point lists would miss exactly the convergence this
 * rule exists to catch. Two claims agree when they name the same side and their fitted lines stay
 * within half an ATR of each other across the whole window.
 */
import { findSwingPivots, fitLine, lineValueAt, measureFit } from '../../lib/chartStructures.ts';
import { atrOf } from './classify.mjs';

/* WHAT "AGREE" MEANS, AS ONE NUMBER WITH ONE DEFINITION.
 *
 * Exported and written into every result file, so a reader can see the threshold without reading
 * this scorer - PM's point, and the right one: an exclusion rule whose criterion is buried in code
 * is an exclusion a reader has to take on trust.
 *
 * Half an ATR is the mean absolute separation two claimed lines may have across the whole window
 * and still be called the same structure. Mean rather than maximum, because two engines describing
 * one trendline will disagree most at the extrapolated ends, where neither claimed a touch. */
export const AGREEMENT_ATR = 0.5;

/** A claim's line, fitted through the timestamps the model named. Null when it named too few
 *  valid points to fit anything - which is itself a finding, not an error. */
export function claimLine(claim, candles) {
  const byTs = new Map(candles.map((c, i) => [c.timestamp, i]));
  const side = claim.side ?? 'low';
  const pts = claim.touchTimestamps
    .map(t => byTs.get(t))
    .filter(i => i !== undefined)
    .map(i => ({ index: i, price: side === 'high' ? candles[i].high : candles[i].low }));
  if (pts.length < 2) return null;
  const fit = fitLine(pts);
  return fit ? { fit, side, points: pts } : null;
}

/** Do two claims describe the same line? Mean absolute separation across the window, in ATR. */
export function claimsAgree(a, b, candles, atr) {
  if (!a || !b || a.side !== b.side) return false;
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += Math.abs(lineValueAt(a.fit, i) - lineValueAt(b.fit, i));
  }
  return (sum / candles.length) <= AGREEMENT_ATR * atr;
}

/**
 * Score one engine's answer on one fixture.
 *
 * `pivotAgreement` is the spec's second criterion: were the claimed touch points actually pivots,
 * or invented? A model can produce a line that fits beautifully through three arbitrary candles -
 * the fit says the line is real, the pivot check says the POINTS were.
 */
export function scoreAnswer(parsed, fixture) {
  const candles = fixture.candles;
  const atr = atrOf(candles);
  const { highs, lows } = findSwingPivots(candles, 3, 3);
  const pivotTs = {
    high: new Set(highs.map(p => p.timestamp)),
    low: new Set(lows.map(p => p.timestamp)),
  };

  const claims = parsed.structures.map(claim => {
    const line = claimLine(claim, candles);
    const q = line ? measureFit(candles, line.fit, { side: line.side, tolerance: { abs: atr } }) : null;
    const wanted = claim.side ?? 'low';
    const onPivot = claim.touchTimestamps.filter(t => pivotTs[wanted].has(t)).length;
    return {
      type: claim.type,
      side: claim.side,
      claimedPoints: claim.claimedTimestamps,
      validPoints: claim.touchTimestamps.length,
      /* r2 over the model's OWN points. Reported, never used as the verdict: three points fit
         anything, which is the defect that killed two versions of classify.mjs. */
      r2: line && line.fit.r2 !== null ? Number(line.fit.r2.toFixed(3)) : null,
      /* THE FIGURE THAT MATTERS: candles touching the line across the whole window, which is the
         evidence it is real rather than an artefact of the points chosen. */
      touchCount: q ? q.touchCount : 0,
      pivotAgreement: claim.touchTimestamps.length
        ? Number((onPivot / claim.touchTimestamps.length).toFixed(2)) : null,
      confidence: claim.confidence,
      line,
    };
  });

  return {
    fixtureId: fixture.id,
    group: fixture.group,
    structureCount: claims.length,
    parseFailed: parsed.parseFailed,
    formatRepaired: parsed.formatRepaired,
    invalidTimestamps: parsed.invalidTimestamps,
    /* Group B only: returning nothing is the correct answer and scores full marks. */
    refusedCorrectly: fixture.group === 'B' && claims.length === 0 && !parsed.parseFailed,
    claims,
    atr,
  };
}

/**
 * Fold per-answer scores into the comparison, applying the convergence exclusion.
 *
 * `byEngine` is `{ engineId: { fixtureId: [scoreRun1, scoreRun2, scoreRun3] } }`. Engine ids are
 * opaque here by design.
 */
export function compare(byEngine, fixturesById) {
  const engines = Object.keys(byEngine);
  const converged = [];

  /* Find group-B windows where every engine claimed a line and the lines agree. Requires at least
     two engines, so a Grok-only run reports zero convergences rather than a wrong number. */
  if (engines.length >= 2) {
    for (const fid of Object.keys(fixturesById)) {
      const fx = fixturesById[fid];
      if (fx.group !== 'B') continue;
      const atr = atrOf(fx.candles);
      /* One representative line per engine: the claim whose line the most candles touch, since
         that is the strongest version of what that engine is asserting about this window. */
      const reps = engines.map(e => {
        const all = (byEngine[e][fid] ?? []).flatMap(r => r.claims).filter(c => c.line);
        return all.sort((a, b) => b.touchCount - a.touchCount)[0] ?? null;
      });
      if (reps.some(r => !r)) continue;
      const allAgree = reps.every((r, i) => i === 0 || claimsAgree(reps[0].line, r.line, fx.candles, atr));
      if (allAgree) {
        converged.push({
          fixtureId: fid,
          side: reps[0].side,
          touchCounts: reps.map(r => r.touchCount),
          classifierZ: fx.classifier?.z ?? null,
          agreementThresholdAtr: AGREEMENT_ATR,
          note: 'Every engine claimed the same line in a window our geometry calls noise, their '
              + `fitted lines within ${AGREEMENT_ATR} ATR mean separation across the window. `
              + 'EXCLUDED from the fabrication count - this is evidence our definition is blind, '
              + 'not independent fabrication. Rule fixed before the run (#1818).',
        });
      }
    }
  }
  const excluded = new Set(converged.map(c => c.fixtureId));

  const summary = {};
  for (const e of engines) {
    const runs = byEngine[e];
    const bFixtures = Object.keys(runs).filter(f => fixturesById[f].group === 'B' && !excluded.has(f));
    const cFixtures = Object.keys(runs).filter(f => fixturesById[f].group === 'C');
    const aFixtures = Object.keys(runs).filter(f => fixturesById[f].group === 'A');

    const fabrications = bFixtures.flatMap(f => runs[f]).filter(r => r.structureCount > 0).length;
    const bRuns = bFixtures.flatMap(f => runs[f]).length;
    const cTouch = cFixtures.flatMap(f => runs[f]).flatMap(r => r.claims).map(c => c.touchCount);
    const aFound = aFixtures.flatMap(f => runs[f]).filter(r => r.structureCount > 0).length;
    const aRuns = aFixtures.flatMap(f => runs[f]).length;
    const pivots = Object.values(runs).flat().flatMap(r => r.claims)
      .map(c => c.pivotAgreement).filter(v => v !== null);

    summary[e] = {
      /* THE DECIDER, per the spec's rule stated before the run. */
      fabricationsOnB: fabrications,
      bRuns,
      fabricationRate: bRuns ? Number((fabrications / bRuns).toFixed(2)) : null,
      /* THE CONTROL. If this is not ~1.0 the prompt or the harness is wrong, not the engine, and
         nothing below it is readable - which is group A's entire job. */
      groupAFoundRate: aRuns ? Number((aFound / aRuns).toFixed(2)) : null,
      /* Tiebreak 1. Spread, not just mean - one run is an anecdote. */
      groupCTouch: cTouch.length ? {
        min: Math.min(...cTouch),
        median: cTouch.sort((a, b) => a - b)[Math.floor(cTouch.length / 2)],
        max: Math.max(...cTouch),
        n: cTouch.length,
      } : null,
      meanPivotAgreement: pivots.length
        ? Number((pivots.reduce((a, b) => a + b, 0) / pivots.length).toFixed(2)) : null,
      parseFailures: Object.values(runs).flat().filter(r => r.parseFailed).length,
      formatRepairs: Object.values(runs).flat().filter(r => r.formatRepaired).length,
      invalidTimestamps: Object.values(runs).flat().reduce((a, r) => a + r.invalidTimestamps, 0),
    };
  }

  return { summary, converged, excludedFromFabricationCount: [...excluded] };
}

/* ── SEPARATION, NOT LEVEL. THE DECIDING MEASUREMENT (#1818, second design) ───────────────────
 *
 * The first design counted structures on group B and called that a fabrication rate. Measured,
 * list length was decided by two lines of prompt wording rather than by the candles, so it could
 * not separate A from B at all - see `prompt.mjs`.
 *
 * **The absolute confidence LEVEL has the same defect one layer down:** a sterner preamble lowers
 * every number and a looser one raises them, so scoring the level measures wording again.
 *
 * **A rank statistic does not have it.** AUC here is the probability that a confidence drawn from
 * a group A window exceeds one drawn from a group B window. A prompt that shifts confidence
 * globally moves A and B together and leaves that probability untouched - **prompt-robust by
 * construction**, which is the property the first design lacked. PM's design.
 *
 * 0.5 is chance. 1.0 is perfect separation. **Below 0.5 means the engine is more confident about
 * noise than about structure**, which is a finding rather than a bad score.
 */

/** Mann-Whitney U as AUC, with ties counted as half - a tie is genuinely no information, and
 *  dropping ties instead would quietly reward an engine that emits one confidence for everything. */
export function auc(aValues, bValues) {
  if (!aValues.length || !bValues.length) return null;
  let wins = 0;
  for (const a of aValues) for (const b of bValues) wins += a > b ? 1 : a === b ? 0.5 : 0;
  return wins / (aValues.length * bValues.length);
}

/** Percentile bootstrap interval. Seeded, so a reported interval is reproducible rather than
 *  slightly different every time anyone re-reads the result file. */
export function aucInterval(aValues, bValues, iterations = 2000, seed = 7) {
  if (!aValues.length || !bValues.length) return null;
  let st = seed >>> 0;
  const rand = () => {
    st = (st + 0x6D2B79F5) >>> 0;
    let t = Math.imul(st ^ (st >>> 15), 1 | st);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const draw = arr => Array.from({ length: arr.length }, () => arr[Math.floor(rand() * arr.length)]);
  const samples = [];
  for (let i = 0; i < iterations; i++) samples.push(auc(draw(aValues), draw(bValues)));
  samples.sort((x, y) => x - y);
  return {
    lo: Number(samples[Math.floor(iterations * 0.025)].toFixed(3)),
    hi: Number(samples[Math.floor(iterations * 0.975)].toFixed(3)),
  };
}

/**
 * The separation figures for one engine.
 *
 * TWO READINGS, and the primary is the stricter one. `perWindow` takes the engine's HIGHEST
 * confidence on each window-run - "how sure are you there is structure here", which is the
 * question - giving one value per run. `perClaim` pools every candidate, which has a larger n and
 * **correlated values**, because three candidates from one reply are not three independent
 * opinions. The interval is reported on the primary only, and n is printed beside both so nobody
 * reads the pooled figure as better evidence for being narrower.
 */
export function separation(runsByFixture, fixturesById) {
  const conf = group => Object.keys(runsByFixture)
    .filter(f => fixturesById[f].group === group)
    .flatMap(f => runsByFixture[f]);

  const maxOf = runs => runs
    .map(r => r.claims.map(c => c.confidence).filter(v => typeof v === 'number'))
    .filter(v => v.length)
    .map(v => Math.max(...v));
  const allOf = runs => runs
    .flatMap(r => r.claims.map(c => c.confidence))
    .filter(v => typeof v === 'number');

  const aMax = maxOf(conf('A')), bMax = maxOf(conf('B'));
  const aAll = allOf(conf('A')), bAll = allOf(conf('B'));
  const primary = auc(aMax, bMax);

  return {
    perWindow: {
      auc: primary === null ? null : Number(primary.toFixed(3)),
      interval: aucInterval(aMax, bMax),
      nA: aMax.length, nB: bMax.length,
      note: 'PRIMARY. Highest confidence per window-run. 0.5 is chance; below 0.5 means the engine '
          + 'was more confident about noise than about structure.',
    },
    perClaim: {
      auc: (() => { const v = auc(aAll, bAll); return v === null ? null : Number(v.toFixed(3)); })(),
      nA: aAll.length, nB: bAll.length,
      note: 'SECONDARY. Pools every candidate, so n is larger and the values are CORRELATED - '
          + 'three candidates from one reply are not three independent opinions. No interval is '
          + 'given, because a bootstrap over correlated draws would understate the uncertainty.',
    },
    /* Reported so a reader can see whether a prompt shifted the whole distribution, which is the
       thing AUC is designed to be immune to - showing it is how that immunity is checkable. */
    meanConfidence: {
      A: aAll.length ? Number((aAll.reduce((x, y) => x + y, 0) / aAll.length).toFixed(3)) : null,
      B: bAll.length ? Number((bAll.reduce((x, y) => x + y, 0) / bAll.length).toFixed(3)) : null,
    },
  };
}
