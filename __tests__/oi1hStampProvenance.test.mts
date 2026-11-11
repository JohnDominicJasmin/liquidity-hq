import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* #1651 / #2120 - the OI ref's stamp must name the coin the DATA came from, not the one currently
 * selected.
 *
 * WHY THIS IS A SOURCE ASSERTION AND NOT A REAL TEST. `oi1hDataRef` is component-internal state in
 * a page that cannot be mounted here, so there is no seam to drive. A browser test is the real
 * check and it is owed. This exists because the failure it guards is silent, survives review, and
 * reads as fixed: #2120's first version stamped `selectedCoin`, which during the one render between
 * a coin switch and the hook's loading flip wrote `{ coin: NEW, pct: OLD }`. The builder's own
 * comparison then passed and the model was told one coin's open-interest change as another's. A
 * stamp from the wrong source is worse than no stamp, because the guard looks present.
 *
 * NOT A WHOLE-FILE SEARCH. `selectedCoin` appears all over `arena/page.tsx`, so "the file does not
 * mention selectedCoin" would be absurd and green forever. Each cell narrows to specific lines and
 * then asserts how many it found, so a rename or a collapsed write fails loudly instead of matching
 * nothing and passing.
 */

const ARENA = 'app/(main)/arena/page.tsx';
const HOOK  = 'lib/useOI1h.ts';

const lines = (p: string): string[] => readFileSync(p, 'utf8').split('\n');

test('O1. both ref writes stamp the coin the data came from, and neither reads the selection', () => {
  const src = lines(ARENA);
  const writes = src.filter(l => l.includes('oi1hDataRef.current = {'));

  /* THE CONTROL, and the reason this cell is not vacuous: there are exactly two writes - the clear
     on loading/absent, and the real value. If a refactor renames the ref or merges the writes, this
     count fails rather than the filter quietly returning [] and every assertion below passing. */
  assert.equal(writes.length, 2,
    'expected exactly 2 `oi1hDataRef.current = {` writes (the clear and the value); if this '
    + 'changed, re-derive which lines carry the stamp before trusting the rest of this file');

  for (const w of writes) {
    assert.ok(w.includes('coin: oi1h.coin'),
      `every ref write must stamp provenance via \`coin: oi1h.coin\`, got: ${w.trim()}`);
    assert.ok(!w.includes('selectedCoin'),
      'a write stamped with `selectedCoin` labels the PREVIOUS coin\'s pct with the CURRENT coin '
      + `and defeats the builder's check entirely: ${w.trim()}`);
  }
});

test('O2. the clear is covered too, not just the value write', () => {
  /* The clear fires during the loading window, which is exactly when the stale value is in hand.
     It is harmless today only because the builder checks `pct == null` second - relying on the
     second check to cover a wrong first one is how this class returned once already. */
  const clear = lines(ARENA).find(l =>
    l.includes('oi1hDataRef.current = {') && l.includes('pct: null'));
  assert.ok(clear, 'the clearing write (pct: null) must still exist');
  assert.ok(clear.includes('coin: oi1h.coin'), 'the CLEAR must carry provenance as well');
});

test('O3. the effect no longer depends on the selection', () => {
  const src = lines(ARENA);
  const last = src.reduce((acc, l, i) => l.includes('oi1hDataRef.current = {') ? i : acc, -1);
  assert.ok(last > 0, 'control: found the ref writes to search forward from');

  const deps = src.slice(last, last + 14).find(l => l.trimStart().startsWith('}, ['));
  assert.ok(deps, 'control: found the dependency array closing this effect');
  assert.ok(deps.includes('oi1h.coin'),
    'the stamp source belongs in the deps, so the ref is rewritten when the snapshot changes');
  assert.ok(!deps.includes('selectedCoin'),
    '`selectedCoin` in the deps is what made the effect re-run mid-switch and re-stamp stale data '
    + `with the new coin: ${deps.trim()}`);
});

test('O4. OI1hData.coin is REQUIRED, which is what makes an unstamped write a compile error', () => {
  /* The real guarantee is the type, not these cells: every full `OI1hData` literal in the hook must
     name `coin` or it does not compile, which covers all five of them without a test each. That
     guarantee disappears the moment someone writes `coin?:` to silence an error - silently, and
     this file would otherwise still pass. So the optionality is the thing worth pinning. */
  const decl = lines(HOOK).find(l => /^\s+coin\??:/.test(l));
  assert.ok(decl, 'control: found the `coin` declaration on OI1hData');
  assert.ok(!decl.includes('coin?:'),
    'making `coin` optional removes the compile-time guarantee that every literal stamps it, '
    + `leaving only these source cells behind: ${decl.trim()}`);
});
