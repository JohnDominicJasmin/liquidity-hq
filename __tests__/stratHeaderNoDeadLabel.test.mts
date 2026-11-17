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
test('D2. the header still has its title, its select and the indicators section', () => {
  assert.ok(/<div className="strat-lbl">\s*<span>\{t\('STRATEGY_PANEL_SECTION_SET'\)\}<\/span>/.test(panel), 'the Strategy set header title is gone');
  assert.ok(panel.includes('data-testid="strategy-set-select"') && panel.includes("t('STRATEGY_PANEL_SECTION_INDICATORS')"), 'the strategy select or the indicators section header is gone');
});
