/* #2397 / #2410: Arena, footer, signed-out Settings, macro strip and econ "estimated" moved into the label table. Source-level pins (rendering is the browser run).
 *   L1  every literal key a changed component reads through t('KEY') / tl('KEY') is registered in lib/labelKeys.ts AND has an English default (a missing default renders the raw key name)
 *   L2  the English defaults keep the words the screens showed before (no silent copy change): macro strip, JPY states, DXY/SPX/Gold lines, estimated, Liq tooltip
 *   L3  the footer's legal disclosure BODIES stay English on purpose (counsel's call, flagged in the PR): no t()/tl() call inside the DISCLOSURES bodies
 *   L4  no key is registered twice and no English default is empty
 * WHAT IT CANNOT PROVE: ko/zh/ru/ar wording (AI-drafted), layout in longer languages (ru trial banner wrap etc.), or that each call site is inside a component with useLabels(): those are the browser cells. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const en = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
const keysSrc = read('lib/labelKeys.ts');
const registered = [...keysSrc.slice(keysSrc.indexOf('export const LABEL_KEYS'), keysSrc.indexOf('export type LabelKey')).matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map((m) => m[1]);
const FILES = ['app/(main)/arena/page.tsx', 'app/(main)/econ-calendar/page.tsx', 'app/(main)/settings/page.tsx', 'components/EMASignal.tsx', 'components/EconCalendarWidget.tsx', 'components/KLineProChart.tsx', 'components/MacroStrip.tsx', 'components/PlatformFooter.tsx', 'components/StrategyPanel.tsx'];

test('L1. every literal t()/tl() key in the changed components is registered and has an English default', () => {
  assert.ok(registered.length > 1000, `CONTROL: only ${registered.length} registered keys parsed`);
  const reg = new Set(registered); const missing: string[] = []; let seen = 0;
  for (const f of FILES) for (const m of read(f).matchAll(/\btl?\(\s*'([A-Z][A-Z0-9_]{3,})'/g)) {
    seen++; if (!reg.has(m[1])) missing.push(`${f}: ${m[1]} not in labelKeys.ts`); if (!(m[1] in en)) missing.push(`${f}: ${m[1]} has no English default`);
  }
  assert.ok(seen > 60, `CONTROL: only ${seen} key reads found`);
  assert.deepEqual(missing, []);
});
test('L2. the English defaults keep the words the screens showed before', () => {
  const want: Record<string, string> = {
    MACRO_STRIP_TITLE: 'Macro Correlations', MACRO_STRIP_JPY_INTERVENTION: 'BOJ intervention risk', MACRO_STRIP_JPY_APPROACHING: 'USD/JPY above {level}', MACRO_STRIP_JPY_CARRY_STABLE: 'Carry trade stable',
    MACRO_STRIP_JPY_DANGER: 'USD/JPY at 160+', MACRO_STRIP_JPY_WARNING: 'Warning', MACRO_STRIP_JPY_SAFE: 'Safe', MACRO_STRIP_NEUTRAL: 'Neutral', MACRO_STRIP_GOLD: 'Gold',
    MACRO_STRIP_DXY_UP: 'USD strengthening', MACRO_STRIP_DXY_DOWN: 'USD weakening', MACRO_STRIP_SPX_UP: 'S&P up {pct} today', MACRO_STRIP_SPX_DOWN: 'S&P down {pct} today',
    MACRO_STRIP_GOLD_UP: 'Gold rising', MACRO_STRIP_GOLD_DOWN: 'Gold falling → risk appetite up',
    ECON_ESTIMATED: 'estimated', ECON_ESTIMATED_TIP_ROW: 'Estimated date - computed from a typical release pattern, not a published schedule',
    CHART_LIQ_TITLE: 'Toggle realized liquidation clusters - the heaviest price levels where positions were actually liquidated in the last 24h. Price memory, not predicted liquidation levels.',
  };
  const wrong = Object.entries(want).filter(([k, v]) => en[k] !== v).map(([k, v]) => `${k}: ${JSON.stringify(en[k])} != ${JSON.stringify(v)}`);
  assert.deepEqual(wrong, []);
});
test('L3. the footer legal disclosure bodies stay English: no label call inside DISCLOSURES text', () => {
  const s = read('components/PlatformFooter.tsx'); const a = s.indexOf('const DISCLOSURES'); assert.ok(a > 0, 'CONTROL: DISCLOSURES not found');
  const end = s.indexOf('];', a); const block = s.slice(a, end);
  const bodies = [...block.matchAll(/\btext:\s*([`'"])([\s\S]*?)\1\s*,?\s*(?:\n|\})/g)].map((m) => m[2]);
  assert.ok(bodies.length >= 3, `CONTROL: only ${bodies.length} disclosure bodies found`);
  assert.equal(bodies.some((b) => /\btl?\(/.test(b)), false, 'a legal disclosure body is now machine-translated');
  assert.ok(bodies.filter((b) => b.length > 40).length >= 5, 'a disclosure body is truncated (the AI-analysis one is empty by design: it reads a stored key)');
});
test('L4. no key registered twice; no empty English default', () => {
  const dup = registered.filter((k, i) => registered.indexOf(k) !== i); assert.deepEqual([...new Set(dup)], []);
  assert.deepEqual(Object.entries(en).filter(([, v]) => typeof v !== 'string' || v.trim() === '').map(([k]) => k), []);
});
