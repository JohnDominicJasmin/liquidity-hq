/* The estimated-date marker on /econ-calendar (#696).
 *
 * 15 of 19 events on that page are computed from release PATTERNS - "CPI lands
 * mid-month, FOMC meets eight times a year" - not read from a schedule. Four
 * come from a real source. The generator is fine and says so in its own header;
 * the gap was that a user could not tell which row was which, on a page whose
 * whole affordance is dates you can plan around.
 *
 * The hero banner has said "estimated" in words since #245. The ROWS carried a
 * `~` prefix and a `title` attribute, and a disclosure you have to hover to
 * find is one nobody sees. The owner ruled: label them.
 *
 * WHY THIS IS A SOURCE TEST. The marker is a rendered string whose correctness
 * is "a human reading the row learns the date is a guess". No unit test reaches
 * that. What a test CAN pin is the three ways it silently stops being true: the
 * word disappears back into a tooltip, the gate inverts so scheduled rows get
 * marked, or the colour drifts below readable in one of the four contexts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrastRatio, parseCssColor } from '../lib/readableOn.ts';
import { CONTEXTS, resolve } from './_cssContexts.mts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = readFileSync(path.join(ROOT, 'app', 'econ-calendar', 'page.tsx'), 'utf8');
const API = readFileSync(path.join(ROOT, 'app', 'api', 'econ-calendar', 'route.ts'), 'utf8');

const TEXT_MIN = 4.5;
const ratio = (a: string, b: string) => contrastRatio(parseCssColor(a)!.rgb, parseCssColor(b)!.rgb);

/** The marker block in the row's TIME cell: `{e.estimated && ( <div …>estimated</div> )}` */
function rowMarker(): string | null {
  const at = PAGE.indexOf('{e.estimated && (');
  return at < 0 ? null : PAGE.slice(at, at + 400);
}

test('the row marker exists and is a visible word, not only a tooltip', () => {
  const block = rowMarker();
  assert.ok(block, 'no {e.estimated && (…)} marker in the row - /econ-calendar is back to a bare tilde');
  assert.match(block, />\s*estimated\s*</,
    'the marker no longer renders the word. A title attribute is not a disclosure: ' +
    'nobody hovers a date to find out whether it is real.');
});

test('the marker is gated on the data, not re-derived in the view', () => {
  /* #696 was explicit: read whatever field already separates the four real ones.
     The API sets `estimated: true` on every entry from computeMacroSchedule and
     nowhere else, so the view must not invent its own rule - a second definition
     of "is this a guess" is a second thing to drift. */
  assert.match(API, /estimated\?: boolean/, 'the API no longer carries an estimated flag');
  assert.match(API, /estimated: true/, 'computed entries are no longer flagged at the source');
  assert.equal(/estimated:\s*false/.test(API), false,
    'a scheduled entry is now explicitly flagged rather than left absent - if that is ' +
    'deliberate, the view\'s truthiness check still works, but say so here');
  assert.match(PAGE, /e\.estimated\b/, 'the row no longer reads the flag');
});

test('a scheduled row gets no marker - silence is the signal for the accurate case', () => {
  /* The gate is `&&` on the flag, so the marker cannot appear on a row without
     it. Asserting the shape rather than the absence, because "no marker on
     scheduled rows" has no rendered artefact to count. */
  const block = rowMarker()!;
  assert.ok(block.startsWith('{e.estimated && ('),
    'the marker is no longer gated on the flag itself');
  assert.equal(/e\.estimated\s*\?\s*[^:]+:\s*['"`]/.test(block), false,
    'the marker renders something for the scheduled case too');
});

test('the marker clears 4.5:1 as text in all four contexts', () => {
  /* It is text on the row, and the row is transparent over --bg1's card. Read
     from globals.css through the cascade rather than restated here, so a token
     change moves the assertion with it. */
  const colour = /color:\s*'var\((--[a-z0-9-]+)\)'/.exec(rowMarker()!);
  assert.ok(colour, 'the marker colour is no longer a token - a literal cannot follow the theme');
  const failures: string[] = [];
  for (const [name, map] of CONTEXTS) {
    const fg = resolve(map, `var(${colour[1]})`);
    const bg = resolve(map, 'var(--bg1)');
    assert.ok(fg && bg, `${name}: could not resolve ${colour[1]} or --bg1`);
    const r = ratio(fg, bg);
    if (r < TEXT_MIN) failures.push(`${name}: ${fg} on ${bg} = ${r.toFixed(2)}:1`);
  }
  assert.deepEqual(failures, [],
    `the estimated marker is unreadable in ${failures.length} context(s):\n  ${failures.join('\n  ')}`);
});

test('the marker is a word, so colour is not the only channel', () => {
  /* SC 1.4.1. A coloured dot or a tinted date would carry the same information
     and vanish for a reader who cannot see the colour. The word survives
     greyscale, and it is also why no aria is needed: visible text is already
     the accessible name, read in document order right after the time. */
  const block = rowMarker()!;
  assert.match(block, />\s*estimated\s*</);
  assert.equal(/aria-label|sr-only/.test(block), false,
    'the marker grew an aria label - if the visible text stopped being the ' +
    'accessible name, that is the thing to fix rather than to paper over');
});

test('CONTROL: these assertions can fail', () => {
  /* Every check above is a regex over a file. A pattern that matched nothing
     would report success for all of them. */
  assert.ok(rowMarker(), 'the marker block is findable at all');
  assert.equal(/{e\.estimated && \(/.test('nothing like the marker'), false);
  assert.ok(ratio('#7c828a', '#ebe9e6') < TEXT_MIN,
    'terminal light --txt2 on --bg1 should still measure as failing - if this passes, ' +
    'the ratio function is not discriminating and the context test above proves nothing');
});
