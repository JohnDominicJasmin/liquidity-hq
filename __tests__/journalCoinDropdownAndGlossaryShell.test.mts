/* #1673 items 4 and 5, both owner-approved from the screenshots on 2026-10-22.
 *
 * Item 4, the Journal's Log tab: the wall of ~45 coin chips becomes the search-and-pick dropdown the rest of the app already uses
 * ("too many selections put in into drop down with combination of search field and checkbox of items").
 * Item 5, the Glossary: /learn matches the app instead of the landing page ("too vibe coded" -> "Match the app"), which also closes R6
 * on #1640 - the page ignored the light theme because its wrapper was a fixed dark background.
 *
 * THE ORACLE is those two decisions. STRUCTURE ONLY, the same limit as the other component tests here: no DOM test library, and the look
 * is the owner's to judge, which he did. What is pinned is what a later edit could undo invisibly - which component the card renders, that
 * no coin became unloggable, that the glossary no longer paints its own shell, and that its sticky bar clears the app's bars.
 * WHAT IT CANNOT PROVE: the rendered page, the theme switch actually repainting, or that /learn#funding-rate lands clear of the sticky
 * search. Those are #1679's and #1680's screenshots, and the live steps QA runs on qa after promotion. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COINS } from '../lib/marketStore.ts';
import { EMA_SIGNAL_TFS } from '../lib/ribbonCandles.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const journal = stripComments(read('components/TradeJournal.tsx'));
const picker = stripComments(read('components/CoinMultiSelect.tsx'));
const learn = stripComments(read('components/LearnContent.tsx'));
const navRoutes = stripComments(read('lib/navRoutes.ts'));
const css = read('app/globals.css');

function anchorOnce(src: string, needle: string, label: string): number {
  const n = src.split(needle).length - 1;
  assert.equal(n, 1, `${label}: anchor occurs ${n} time(s), expected exactly 1 - re-read the current source`);
  return src.indexOf(needle);
}

/* ── item 4: the Log tab's coin picker ────────────────────────────────────── */

test('J1. the Log card renders the shared dropdown in SINGLE mode with the current coin, and no chip grid is left', () => {
  anchorOnce(journal, '<CoinMultiSelect single value={[coin]}', 'the Log card picker');
  assert.match(journal, /onChange=\{\(\[c\]\) => \{ if \(c\) setCoin\(c as CoinId\); \}\}/, 'picking a coin no longer sets the Log tab\'s coin');
  /* The wall of chips the owner objected to: a button per coin, each with its badge dot. */
  assert.equal(/className=\{`tj-coin\$\{/.test(journal), false, 'the coin chip grid is back in the Log card');
  assert.equal(journal.includes('<div className="tj-coins">'), false, 'the chip container is back in the Log card');
});

test('J2. NO COIN BECAME UNLOGGABLE: the dropdown offers the same list the chips did', () => {
  /* The one way this change could have cost a user something. Both read COINS from lib/marketStore, so the pickable set is identical -
     asserted against the real module rather than by reading two imports and trusting them. */
  assert.match(picker, /import \{ CoinId, COINS \} from '@\/lib\/marketStore'/, 'the picker no longer sources its list from marketStore');
  assert.match(picker, /orderRef\s*=\s*useRef<CoinId\[\]>\(COINS\)/, 'the picker no longer offers the whole COINS list');
  assert.ok(COINS.length > 40, `precondition: COINS is ${COINS.length}, so this is not the small list the test assumes`);
  assert.match(journal, /import \{ COINS, CoinId \} from '@\/lib\/marketStore'/, 'the Journal no longer shares that list');
});

test('J3. single mode replaces and closes, and re-picking the current coin does not fire a change', () => {
  const at = anchorOnce(picker, 'const toggleCoin = (c: CoinId) => {', 'the picker toggle');
  const body = picker.slice(at, at + 600);
  assert.match(body, /if \(single\) \{[\s\S]*?if \(!value\.includes\(c\)\) onChange\(\[c\]\);[\s\S]*?closePanel\(\);/,
    'single mode no longer replaces-and-closes, or fires onChange for a coin that is already picked');
});

test('J4. ?coin= still prefills the Log tab', () => {
  anchorOnce(journal, "useState<CoinId>((sp.get('coin') as CoinId) || 'btc')", 'the coin prefill');
});

/* ── item 5: the Glossary inside the app shell ────────────────────────────── */

test('G1. /learn no longer paints its own shell, so the app bar, footer and THEME apply (R6 on #1640)', () => {
  assert.equal(/body\.classList|classList\.add\('landing'\)|className="lp-nav"/.test(learn), false,
    'the glossary adds body.landing or draws .lp-nav again: the theme switch stops reaching the page');
  assert.equal(navRoutes.includes("'/learn'") && /OWN_NAV_ROUTES[^;]*'\/learn'/.test(navRoutes), false,
    '/learn is back in OWN_NAV_ROUTES: the app nav would be hidden on a page that no longer draws its own');
  anchorOnce(navRoutes, "export const OWN_NAV_ROUTES = ['/'] as const;", 'the own-nav list');
});

test('G2. the phone header has a name for /learn, or the bar renders blank', () => {
  /* The gap QA's navScreenNameAgreement found before #1680 was pushed: leaving OWN_NAV_ROUTES means /learn now shows the terminal bar,
     and that bar takes its title from SCREEN_NAMES. */
  assert.match(navRoutes, /'\/learn':\s*'NAV_GLOSSARY'/, '/learn has no SCREEN_NAMES entry: its phone header would be empty');
});

test('G3. the sticky search clears the app bars rather than guessing a height', () => {
  const at = anchorOnce(learn, '.gl-sticky {', 'the sticky bar');
  const rule = learn.slice(at, at + 260);
  assert.match(rule, /position: sticky;\s*top: calc\(var\(--appbar-h\) \+ var\(--strip-h\) \+ var\(--banner-h\)\)/,
    'the sticky search no longer offsets by the app bar, strip and banner heights: it would sit under them or float below them');
  /* An undefined variable makes the whole calc invalid, which silently drops the stickiness - so each one must exist with a default. */
  for (const v of ['--appbar-h', '--strip-h', '--banner-h']) {
    assert.ok(new RegExp(`${v}:\\s*[0-9]`).test(css), `${v} has no default in globals.css: calc() would be invalid and the bar would not stick`);
  }
});

test('G4. every term keeps its slug id, so a shared /learn#term link still lands', () => {
  anchorOnce(learn, '<dt id={entry.slug}>', 'the term id');
  assert.match(learn, /scroll-margin-top/, 'the headings have no scroll offset: a #term link lands under the sticky search');
});

test('G5. the result count appears only while something is typed, and is announced', () => {
  anchorOnce(learn, '{q && filtered.length > 0 && (', 'the count guard');
  const at = learn.indexOf('{q && filtered.length > 0 && (');
  assert.match(learn.slice(at, at + 220), /className="gl-count" role="status"/, 'the count is not announced, or lost its class');
  assert.match(learn, /t\('LEARN_CONTENT_RESULTS_COUNT', \{ count: shown, total \}\)/, 'the count no longer passes both numbers to the label');
});

test('G6. the empty state is still the glossary\'s own, not a silent blank', () => {
  anchorOnce(learn, "{filtered.length === 0 && (", 'the empty state');
  assert.match(learn, /t\('LEARN_CONTENT_EMPTY_STATE', \{ query \}\)/, 'a search matching nothing shows no message');
});

/* ── a precondition shared by both, so neither test family drifts silently ── */

test('P1. the modules these tests read are the ones the app uses', () => {
  assert.ok(EMA_SIGNAL_TFS.length > 0, 'precondition: ribbonCandles is importable, so the test environment resolves @/lib paths');
  assert.ok(journal.length > 1000 && learn.length > 1000 && picker.length > 500, 'a source file read as near-empty: the paths moved');
});
