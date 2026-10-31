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
  return (sum / candles.length) <= 0.5 * atr;
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
          note: 'Every engine claimed the same line in a window our geometry calls noise. '
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
