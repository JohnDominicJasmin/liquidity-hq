/* #1818 PHASE 1 OVERLAYS: WHAT GETS DRAWN MUST BE WHAT WAS MEASURED.
 *
 * `lib/chartStructureOverlays.ts` turns `DetectedStructure[]` into overlay descriptors. It draws
 * nothing itself — no klinecharts import, no component — but it decides **which candles get marked
 * on a user's chart**, and a marker on a candle the line does not touch is the product lying in the
 * one place the user can check it against the chart.
 *
 * O1 IS THE ASSERTION DEV ASKED TO BE PINNED HARDEST, and the reason is that it is the only one the
 * component cannot restore. A wrong colour is visible and fixable; a marker on the wrong candle
 * looks exactly like a marker on the right one.
 *
 * WHY THE ADAPTER NEEDS ITS OWN CELL WHEN `chartStructureDetectExcessTouches.test.mts` P7 ALREADY
 * PINS `rail.pivots`: P7 constrains the DETECTOR's output. This file constrains what the ADAPTER
 * does with it. The adapter could filter, re-sort, round, or take a different set entirely, and P7
 * would stay green while the chart marked the wrong bars. Two layers, two cells.
 *
 * NOTHING BILLED, NO NETWORK, NO CHART: the adapter is pure and the candles are built here. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectStructures } from '../lib/chartStructureDetect.ts';
import {
  toStructureOverlays, STRUCTURE_GROUP, RAIL_OVERLAY, TOUCH_OVERLAY,
} from '../lib/chartStructureOverlays.ts';
import { lineValueAt } from '../lib/chartStructures.ts';
import type { StructureCandle } from '../lib/chartStructures.ts';

const TF = '4h';
const BAND = 0.003;

function bar(i: number, high: number, low: number): StructureCandle {
  const mid = (high + low) / 2;
  return { timestamp: 1_700_000_000_000 + i * 14_400_000, open: mid, high, low, close: mid };
}

/** A rising channel with low pivots at varying depths — the same shape P6 uses, so the derived rail
 *  is tangent rather than mid-cloud and there are markers on both rails to check. */
function risingChannel(): StructureCandle[] {
  const S = 0.01, WIDTH = 5, PROM = 0.10, n = 90;
  const DEPTH = [0, 0.25, 0.5, 0.25, 0, 0.4, 0.15, 0.5, 0.3, 0.1, 0.45, 0.2];
  let d = 0;
  const out: StructureCandle[] = [];
  for (let i = 0; i < n; i++) {
    const hi = 100 + S * i, lo = hi - WIDTH;
    const highPivot = i % 8 === 0 && i >= 5 && i <= n - 7;
    const lowPivot = i % 8 === 4 && i >= 5 && i <= n - 7;
    out.push(bar(i, highPivot ? hi : hi - PROM, lowPivot ? lo + DEPTH[(d++) % DEPTH.length] : lo + PROM + 0.6));
  }
  return out;
}

function detected() {
  const res = detectStructures(risingChannel(), { timeframe: TF });
  assert.ok(res.structures.length > 0, `fixture must produce a structure, got ${res.reason}`);
  return res.structures;
}

test('O1. every MARKED candle lies on the rail it is marking (#2026)', () => {
  const structures = detected();
  const descriptors = toStructureOverlays(structures);

  /* NON-EMPTINESS IS INSIDE THIS CELL, NOT BESIDE IT. Dev's own probe passed nine `.every(...)`
     assertions over an empty array and printed green — live ETH 15m returned no structures that
     minute. A separate emptiness cell can be deleted without this one going red, which is exactly
     how a vacuity guard quietly stops guarding. */
  const markers = descriptors.filter(d => d.name === TOUCH_OVERLAY);
  assert.ok(markers.length >= 3, `expected at least 3 marked candles, got ${markers.length} - with none, every assertion below is vacuously true`);

  /* Rebuild the rail lines from the DETECTOR, not from the descriptors, so this compares the two
     layers against each other rather than the adapter against itself. */
  const rails = structures.flatMap(s => s.rails);

  const offRail: Array<{ ts: number; marked: number; nearest: number; diff: number }> = [];
  for (const m of markers) {
    assert.equal(m.points.length, 1, 'a touch marker is one point');
    const p = m.points[0];

    /* The marker must sit on SOME rail of its own structure - matched by the structureId it
       carries, so a marker cannot be excused by a rail it does not belong to. */
    const own = rails.filter(r => r.pivots.some(pv => pv.timestamp === p.timestamp));
    const candidates = own.length ? own : rails;

    let best = Infinity, bestRail = 0;
    for (const r of candidates) {
      const idx = r.pivots.find(pv => pv.timestamp === p.timestamp)?.index;
      if (idx === undefined) continue;
      const railPrice = lineValueAt(r.fit, idx);
      const d = Math.abs(p.value - railPrice);
      if (d < best) { best = d; bestRail = railPrice; }
    }
    if (best !== Infinity && best > BAND * bestRail + 1e-9) {
      offRail.push({ ts: p.timestamp, marked: p.value, nearest: bestRail, diff: best });
    }
  }

  assert.deepEqual(
    offRail, [],
    `${offRail.length} of ${markers.length} marked candles are further from their own rail than the ` +
    `tolerance band. Worst: ${JSON.stringify(offRail[0])}. A marker on a candle the line does not ` +
    'touch is the one error a user can see by looking at the chart, and the component cannot fix it.',
  );
});

test('O2. every descriptor is locked, grouped, and carries no colour', () => {
  const descriptors = toStructureOverlays(detected());
  assert.ok(descriptors.length >= 4, `expected rails plus markers, got ${descriptors.length}`);

  for (const d of descriptors) {
    /* LOCKED. KLineProChart records an unlocked overlay being DRAGGED OFF the price data with no
       way back short of forcing a rebuild. */
    assert.equal(d.lock, true, `a ${d.name} descriptor is not locked - it can be dragged off the data`);

    /* ITS OWN GROUP. The chart clears by group, so sharing the user-drawing group would mean
       clearing structures deletes what the user drew by hand. */
    assert.equal(d.groupId, STRUCTURE_GROUP, `a ${d.name} is in group ${d.groupId}, not ${STRUCTURE_GROUP}`);

    assert.ok(d.name === RAIL_OVERLAY || d.name === TOUCH_OVERLAY, `unexpected overlay name ${d.name}`);

    /* NO COLOUR IN extendData. An overlay is created once and only its POINTS are overridden
       afterwards, so a colour chosen at creation survives a theme switch and goes stale. Asserted
       on the SHAPE so a field added later has to pass here. */
    const colourish = Object.keys(d.extendData).filter(k => /colou?r|theme|style|css|hex|rgb/i.test(k));
    assert.deepEqual(colourish, [], `extendData carries ${colourish.join(', ')} - a colour chosen at creation outlives a theme switch`);
  }
});

test('O3. nothing in extendData can be rendered as advice', () => {
  /* The owner put this feature first to teach beginners to READ structure. A field a UI can render
     as an entry or a target is what turns a chart annotation into trading advice, which PRODUCT.md
     rule 1 forbids. `invalidationPrice` is allowed and is the one to watch - it is the structure's
     own line at the newest candle, not a stop. */
  const descriptors = toStructureOverlays(detected());
  const banned = /^(target|entry|stop|stopLoss|direction|bias|signal|recommendation|confidence|score|forecast|prediction)$/i;

  for (const d of descriptors) {
    const bad = Object.keys(d.extendData).filter(k => banned.test(k));
    assert.deepEqual(bad, [], `extendData carries ${bad.join(', ')} - the detector describes geometry, it does not tell anyone what to do`);
    assert.equal(typeof d.extendData.invalidationPrice, 'number',
      'invalidationPrice is the line\'s own value at the newest candle - geometry, not a stop');
    assert.equal(typeof d.extendData.summary, 'string', 'summary must be present and plain text');
    assert.ok(!/\b(buy|sell|long|short|target|entry)\b/i.test(d.extendData.summary),
      `summary reads as advice: "${d.extendData.summary}"`);
  }
});

test('O4. a derived rail reports r2 null rather than a number nobody fitted', () => {
  const structures = detected();
  const descriptors = toStructureOverlays(structures);
  const derived = descriptors.filter(d => d.extendData.gate === 'derived');
  assert.ok(derived.length > 0, 'the channel fixture must produce a derived rail - see P6');

  for (const d of derived) {
    assert.equal(
      d.extendData.r2, null,
      `a derived rail reports r2 ${d.extendData.r2}. No slope was fitted, so a number here is a ` +
      'defensible-looking value for a line nobody fitted - and a label would print it as evidence.',
    );
  }
});
