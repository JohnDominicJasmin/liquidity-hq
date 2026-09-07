/* The registry is data, so it is checkable without rendering anything - which
 * matters here because the panel is terminal-only and `npm test` is bare
 * `node --test` with no DOM. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUPS, GROUP_LABEL, INDICATORS, STRATEGY_SETS, LIMITS,
  AUTO_SET_ID, CUSTOM_SET_ID,
  byGroup, findIndicator, indicatorLimit, defaultParams, describeSelection, canRender,
} from '../lib/strategyRegistry.ts';

test('the approved layout draws 21 indicators in 5 groups', () => {
  /* 21 and 5 are counted off the owner-approved artifact, twice. Three numbers
     were in circulation - 21 from the drawing, 7 from a stale wireframe, 20
     from a miscount - and this is the one that came from the spec. */
  assert.equal(INDICATORS.length, 21);
  assert.equal(GROUPS.length, 5);
});

test('every group in the drawing has at least one indicator', () => {
  /* Guards a rename: a group whose entries all move away would otherwise render
     as an empty heading rather than fail. */
  for (const g of GROUPS) {
    assert.ok(byGroup(g).length > 0, `group ${g} is empty`);
    assert.ok(GROUP_LABEL[g], `group ${g} has no label`);
  }
});

test('ids are unique', () => {
  const ids = INDICATORS.map(i => i.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('only ADX and STOCH declare a basis, and each names a real klinecharts builtin', () => {
  /* `basis` is the honesty field: klinecharts' DMI renders four figures
     including adxr, and KDJ renders three where stochastic means two. Measured
     against dist/index.esm.js - every other builtin is honest under its own
     name, so this must not grow silently. */
  const derived = INDICATORS.filter(i => i.basis).map(i => `${i.id}<-${i.basis}`).sort();
  assert.deepEqual(derived, ['ADX<-DMI', 'STOCH<-KDJ']);
});

test('a derived entry is source "new", never "builtin"', () => {
  /* If ADX were `builtin` the registry would be claiming klinecharts ships one.
     It does not - it ships DMI, and we register a custom figure list. */
  for (const i of INDICATORS) {
    if (i.basis) assert.equal(i.source, 'new', `${i.id} derives from ${i.basis} but claims ${i.source}`);
  }
});

test('the EMA ribbon stays an overlay on the candle pane', () => {
  /* Not decoration. klinecharts folds every indicator's values into its pane's
     auto Y-range, and a long EMA dragged the candle axis ~11x wider than the
     visible price range - measured live on PEPE/BONK 15m, recorded at
     KLineProChart.tsx:997. Turning this into a builtin reinstates that. */
  const ema = findIndicator('EMA_RIBBON');
  assert.ok(ema);
  assert.equal(ema.source, 'overlay');
  assert.equal(ema.pane, 'candle');
});

test('every param schema yields a default for each key', () => {
  for (const i of INDICATORS) {
    const d = defaultParams(i);
    for (const p of i.paramSchema) {
      assert.notEqual(d[p.key], undefined, `${i.id}.${p.key} has no default`);
    }
  }
});

test('numeric defaults sit inside their own min/max', () => {
  /* A default outside its range makes the input invalid the moment it renders. */
  for (const i of INDICATORS) {
    for (const p of i.paramSchema) {
      if (p.kind === 'int' || p.kind === 'float') {
        assert.ok(p.default >= p.min && p.default <= p.max,
          `${i.id}.${p.key} default ${p.default} outside ${p.min}..${p.max}`);
      }
      if (p.kind === 'enum') {
        assert.ok(p.options.includes(p.default), `${i.id}.${p.key} default not in options`);
      }
    }
  }
});

test('free gets one indicator and pro gets three', () => {
  assert.equal(indicatorLimit(false), 1);
  assert.equal(indicatorLimit(true), 3);
  assert.equal(LIMITS.free, 1);
  assert.equal(LIMITS.pro, 3);
});

test('"Let the read choose" is first, is empty, and Custom is last', () => {
  /* First and default because the owner's reason is that not every trader has
     their own strategy - so the read choosing for itself is what happens when a
     user does nothing. Empty is the valid state, not an error. */
  assert.equal(STRATEGY_SETS[0].id, AUTO_SET_ID);
  assert.equal(STRATEGY_SETS[0].indicators.length, 0);
  assert.equal(STRATEGY_SETS[STRATEGY_SETS.length - 1].id, CUSTOM_SET_ID);
});

test('every preset names indicators that exist', () => {
  for (const s of STRATEGY_SETS) {
    for (const id of s.indicators) {
      assert.ok(findIndicator(id), `set ${s.id} names unknown indicator ${id}`);
    }
  }
});

test('CONTROL: the lookups can fail', () => {
  /* Without this, every assertion above passes on a registry that returns
     nothing for everything. Both directions, because a finder that matches
     anything is as useless as one that matches nothing. */
  assert.equal(findIndicator('NOT_AN_INDICATOR'), undefined);
  assert.ok(findIndicator('RSI'));
  // @ts-expect-error - deliberately outside the union
  assert.equal(byGroup('not_a_group').length, 0);
  assert.ok(byGroup('trend').length > 0);
});

test('describeSelection names the chosen indicators, and says nothing for none', () => {
  /* The empty case returns null rather than '' so a caller cannot append
     "the trader is watching: " with nothing after it. Empty means "let the read
     choose", which means adding no sentence at all. */
  assert.equal(describeSelection([]), null);
  assert.equal(describeSelection(['RSI']), 'RSI');
  assert.equal(describeSelection(['EMA_RIBBON', 'LIQ_CLUSTERS']), 'EMA ribbon, Liq clusters');
});

test('describeSelection names the basis for a derived entry', () => {
  /* ADX renders klinecharts' DMI with a custom figure list. A prompt that says
     "ADX" without that is telling the model something slightly untrue about
     what the user is looking at. */
  assert.equal(describeSelection(['ADX']), 'ADX (from DMI)');
  assert.equal(describeSelection(['STOCH']), 'Stoch (from KDJ)');
});

test('CONTROL: an unknown id is dropped rather than named', () => {
  /* Without this, a stale id from a saved set would reach the prompt as
     "undefined" and the model would be told to weigh an indicator that does
     not exist. Both directions: real ids survive the same filter. */
  assert.equal(describeSelection(['NOT_AN_INDICATOR']), null);
  assert.equal(describeSelection(['NOT_AN_INDICATOR', 'RSI']), 'RSI');
});

test('the chart can only render the builtin entries today, and the registry says which', () => {
  /* KLineProChart's indicator effect handles `builtin` by calling
     createIndicator. `overlay` entries are already drawn from their own props,
     and `new` entries have no calculation yet - selecting one draws nothing.

     Pinned so the counts cannot drift silently: if someone implements a `new`
     entry and forgets to flip its source, or adds a builtin the chart has never
     been told about, this fails rather than the chip quietly doing nothing. */
  const bySource = (s: string) => INDICATORS.filter(i => i.source === s).map(i => i.id).sort();
  assert.deepEqual(bySource('builtin'), ['BOLL', 'MACD', 'RSI', 'SAR', 'SMA']);
  assert.deepEqual(bySource('overlay'), ['EMA_RIBBON', 'GEX', 'LIQ_CLUSTERS', 'SR']);
  assert.equal(bySource('new').length, 12);
  assert.equal(bySource('builtin').length + bySource('overlay').length + bySource('new').length, 21);
});

test('every builtin id is a real klinecharts indicator name', () => {
  /* createIndicator({ name }) silently does nothing for a name klinecharts does
     not know, so a typo here is a chip that renders no line and no error. The
     27 names are read off node_modules/klinecharts/dist/index.esm.js. */
  const KLINECHARTS = new Set([
    'AO','AVP','BBI','BIAS','BOLL','BRAR','CCI','CR','DMA','DMI','EMA','EMV','KDJ','MA',
    'MACD','MTM','OBV','PSY','PVT','ROC','RSI','SAR','SMA','TRIX','VOL','VR','WR',
  ]);
  for (const i of INDICATORS) {
    if (i.source === 'builtin') {
      assert.ok(KLINECHARTS.has(i.id), `${i.id} is marked builtin but klinecharts ships no such name`);
    }
    if (i.basis) {
      assert.ok(KLINECHARTS.has(i.basis), `${i.id} derives from ${i.basis}, which klinecharts does not ship`);
    }
  }
});

test('canRender is true for exactly the entries the chart can draw', () => {
  /* Derived from `source` rather than a stored flag, because a flag can
     disagree with reality. The split itself is pinned by the test above and by
     the klinecharts-name check, so this only has to hold the derivation. */
  for (const i of INDICATORS) {
    assert.equal(canRender(i), i.source !== 'new', `${i.id}: canRender disagrees with source`);
  }
  assert.equal(INDICATORS.filter(canRender).length, 9);
  assert.equal(INDICATORS.filter(i => !canRender(i)).length, 12);
});

test('a preset never names an indicator that cannot draw', () => {
  /* Choosing a preset that selects a chip which then explains it is unavailable
     is a worse first experience than a preset that works. When a `new` entry is
     implemented it can go back into a set - this fails until then. */
  for (const set of STRATEGY_SETS) {
    for (const id of set.indicators) {
      const entry = findIndicator(id);
      assert.ok(entry, `set ${set.id} names unknown indicator ${id}`);
      assert.ok(canRender(entry), `set ${set.id} names ${id}, which cannot draw yet`);
    }
  }
});
