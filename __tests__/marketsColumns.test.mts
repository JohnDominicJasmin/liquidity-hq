/* #413 frame 3a - Markets' column set and picker state.
 *
 * The frame and README:109 disagree four times on this screen, so these tests
 * pin the FRAME's numbers. If someone later "corrects" them to the prose, these
 * fail and say why.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLUMNS, DEFAULT_VISIBLE, ROW_HEIGHT, FILTERS, ACTION_TRACK,
  gridTemplate, toggleColumn, pickableColumns,
} from '../lib/marketsColumns.ts';

/* ── 1. the frame's six, in the frame's order ────────────────────────────── */

test('six columns visible by default, in the order the frame renders them', () => {
  assert.deepEqual(DEFAULT_VISIBLE, ['coin', 'price', 'change24h', 'funding8h', 'oi1h', 'signal']);
});

test('the six hidden columns README:109 names are present but off', () => {
  const hidden = COLUMNS.filter(c => !c.visible).map(c => c.key);
  assert.deepEqual(hidden, ['change7d', 'volume', 'takerRatio', 'sparkline', 'grade', 'oiChange']);
});

test('row height is the frame measurement, not the README figure', () => {
  // README:109 says "Rows are 33px". Measured pitch in frame 3a is 35.
  assert.equal(ROW_HEIGHT, 35);
});

test('filter chips match the frame, all first', () => {
  assert.deepEqual([...FILTERS], ['all', 'watchlist', 'majors', 'firing', 'gainers']);
});

/* ── 2. the action column README never mentions ──────────────────────────── */

test('the grid always ends with the action track', () => {
  // Every row carries OPEN ARENA -> in the frame. README:109 gives seven grid
  // values for "six visible columns" and never says what the seventh is; this
  // is it. A template one track short does not error - it silently overflows
  // the last cell, which is why this is asserted rather than assumed.
  const tpl = gridTemplate(DEFAULT_VISIBLE);
  assert.ok(tpl.endsWith(ACTION_TRACK), tpl);
  assert.equal(tpl.split(' ').length, DEFAULT_VISIBLE.length + 1);
});

test('the default template is the frame grid from README:109', () => {
  assert.equal(gridTemplate(DEFAULT_VISIBLE), '110px 1fr 96px 120px 96px 1.3fr 120px');
});

/* ── 3. picker state ─────────────────────────────────────────────────────── */

test('showing a hidden column puts it back in COLUMNS order, not at the end', () => {
  // Otherwise re-showing a column you just hid moves it to the far right and
  // the table reorders itself under the user.
  const withVolume = toggleColumn(DEFAULT_VISIBLE, 'volume');
  const idx = withVolume.indexOf('volume');
  assert.ok(idx > withVolume.indexOf('signal'), 'volume sorts after the default six');
  const withSeven = toggleColumn(withVolume, 'change7d');
  assert.ok(withSeven.indexOf('change7d') < withSeven.indexOf('volume'),
    '7d % precedes volume in COLUMNS, so it must precede it here');
});

test('coin cannot be hidden', () => {
  // A table of prices with no instrument names is unreadable, not degraded.
  assert.deepEqual(toggleColumn(DEFAULT_VISIBLE, 'coin'), DEFAULT_VISIBLE);
  assert.ok(!pickableColumns().some(c => c.key === 'coin'), 'the picker must not offer it either');
});

test('the last remaining column cannot be hidden', () => {
  const one = toggleColumn(['price'], 'price');
  assert.deepEqual(one, ['price'], 'hiding the only column would leave an empty grid');
});

test('hiding then showing returns the original set', () => {
  const hidden = toggleColumn(DEFAULT_VISIBLE, 'oi1h');
  assert.ok(!hidden.includes('oi1h'));
  assert.deepEqual(toggleColumn(hidden, 'oi1h'), DEFAULT_VISIBLE);
});

/* ── 4. control ──────────────────────────────────────────────────────────── */

test('CONTROL: toggleColumn actually changes something', () => {
  // Guards against a version that returns its input unchanged - every
  // assertion about refusing to hide would pass on that.
  assert.notDeepEqual(toggleColumn(DEFAULT_VISIBLE, 'volume'), DEFAULT_VISIBLE);
  assert.notDeepEqual(toggleColumn(DEFAULT_VISIBLE, 'signal'), DEFAULT_VISIBLE);
});
