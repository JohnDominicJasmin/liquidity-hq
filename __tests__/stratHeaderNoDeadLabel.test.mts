/* #2464: the Strategy set header no longer shows the dead "Edit · Save as" caption (there is no edit / save-as action behind it).
 *   D1  StrategyPanel renders no "Edit · Save as" text and no .strat-cap element, and no stylesheet rule styles a class nothing uses
 *   D2  the header still renders its own title and the strategy chips (the deletion took only the caption)
 * WHAT IT CANNOT PROVE: the header's look at 390/768/1280 after the caption left the row (browser cell). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const panel = read('components/StrategyPanel.tsx'), css = read('app/globals.css');

test('D1. no "Edit · Save as" caption and no orphan .strat-cap rule', () => {
  assert.equal(/Edit · Save as|EDIT_SAVE_AS/.test(panel), false, 'the dead caption is back in the header');
  assert.equal(/className="[^"]*\bstrat-cap\b/.test(panel), false, 'a .strat-cap element is back');
  assert.equal(/\.strat-cap\b/.test(css), false, 'a CSS rule still styles .strat-cap although nothing uses it');
});
test('D2. the header still has its title and plan chip, the select (named for assistive tech) and the indicators section', () => {
  /* RE-ANCHORED for the compact panel (#2500 pass 2): the visible "Strategy set" line is gone; the select carries it as its aria-label. */
  assert.ok(/<div className="strat-head">\s*<span>\{t\('STRAT_CARD_TITLE'\)\}<\/span>/.test(panel), 'the Strategy card title in the header is gone');
  assert.ok(panel.includes('data-testid="strategy-set-select"') && /aria-label=\{t\('STRATEGY_PANEL_SECTION_SET'\)\}/.test(panel), 'the strategy select lost its accessible name');
  assert.ok(panel.includes("t('STRATEGY_PANEL_SECTION_INDICATORS')"), 'the indicators section header is gone');
});
