/* #1631 E: on a hard load the chat finds the page's coin even when Arena announced it before the chat was listening (QA's review of
 * #1665). lib/pageCoin.ts keeps the last announcement, and GrokChat reads it when it attaches its listener.
 *
 * lib/pageCoin.ts runs here for real. `window` is an EventTarget stand-in, so both the event and the kept value are observed.
 * GrokChat's half is STRUCTURE ONLY: there is no DOM library in this repo, the same limit grokChatAuthGate.test.mts names. Its source must
 * read the kept value where it attaches the listener, and must check both coins it is handed against the tracked list. The browser half,
 * a real hard load, is qa/e2e/grokchat-page-coin-handoff.spec.ts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appPath } from './_appPath.mts';

(globalThis as { window?: EventTarget }).window = new EventTarget();
const { announcePageCoin, currentPageCoin, PAGE_COIN_EVENT } = await import('../lib/pageCoin.ts');
const win = (globalThis as unknown as { window: EventTarget }).window;

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
function anchorOnce(src: string, needle: string, label: string): number {
  const n = src.split(needle).length - 1;
  assert.equal(n, 1, `${label}: anchor occurs ${n} time(s), expected exactly 1 - re-read the current source`);
  return src.indexOf(needle);
}

test('H1. a listener that attaches AFTER the announcement (the hard-load order) still finds the coin, and leaving the page clears it', () => {
  announcePageCoin('xrp');
  const seen: unknown[] = [];
  win.addEventListener(PAGE_COIN_EVENT, (e) => seen.push((e as CustomEvent<{ coin: string | null }>).detail.coin)); // attaches late
  assert.deepEqual(seen, [], 'sanity: a late listener does not see the earlier event');
  assert.equal(currentPageCoin(), 'xrp', 'the announcement was lost for a listener that attached after it');
  announcePageCoin(null);
  assert.equal(currentPageCoin(), null, 'leaving the page did not clear the kept coin');
  assert.deepEqual(seen, [null]);
});

test('H2. a listener attached first gets every announcement on the event, and the kept value is the latest', () => {
  const seen: unknown[] = [];
  const l = (e: Event) => seen.push((e as CustomEvent<{ coin: string | null }>).detail.coin);
  win.addEventListener(PAGE_COIN_EVENT, l);
  announcePageCoin('sol'); announcePageCoin('pepe');
  win.removeEventListener(PAGE_COIN_EVENT, l);
  assert.deepEqual(seen, ['sol', 'pepe']);
  assert.equal(currentPageCoin(), 'pepe');
});

test('H3. GrokChat reads the kept coin where it attaches its listener, and checks the page coin and the opener coin against the tracked list', () => {
  const src = stripTsComments(read('components/GrokChat.tsx'));
  const listen = anchorOnce(src, 'window.addEventListener(PAGE_COIN_EVENT, onPageCoin);', 'the page-coin listener');
  const late = anchorOnce(src, 'take(currentPageCoin());', 'reading the kept coin');
  assert.ok(late > listen && late - listen < 300, 'the kept coin is not read in the same effect that attaches the listener');
  anchorOnce(src, 'setPageCoin(c && (COINS as readonly string[]).includes(c)', 'the page coin is checked against the tracked list');
  anchorOnce(src, "(COINS as readonly string[]).includes(ev.detail.coin)", 'the opener coin is checked against the tracked list');
  anchorOnce(src, 'if (evCoin) { coinPinnedRef.current = true; setCoin(evCoin); }', 'the opener coin is set only after the check');
  assert.doesNotMatch(src, /setCoin\(ev\.detail\.coin\b/, 'the opener\'s coin is set unchecked again: an untracked coin would reach the server and come back 400');
});

test('H4. Arena announces through lib/pageCoin (so the coin is always kept), on each change and with null on leaving', () => {
  const arena = stripTsComments(read(appPath('app/arena/page.tsx')));
  anchorOnce(arena, 'useEffect(() => { announcePageCoin(selectedCoin); }, [selectedCoin]);', 'Arena announcing its coin');
  anchorOnce(arena, 'useEffect(() => () => { announcePageCoin(null); }, []);', 'Arena clearing it on leaving');
  assert.doesNotMatch(arena, /new CustomEvent\('page-coin'/, 'Arena dispatches the event directly again: the coin would not be kept for a late listener');
});
