/* QA: PR #2838 (owner item 54), the macro alert's calendar text is escaped for Telegram's HTML message. The escaping function and the message builder are cut out of the real route and run.
 *   M1 name, estimate and previous value arrive escaped; the message's own tags stay; & is escaped once
 *   M2 an ordinary event reads as before */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';

const strip = (nodeModule as unknown as { stripTypeScriptTypes: (code: string) => string }).stripTypeScriptTypes;
const src = readFileSync(new URL('../app/api/macro-alert/route.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const cut = (from: string, to: string) => { const a = src.indexOf(from); assert.ok(a >= 0, `CONTROL: ${from}`); const b = src.indexOf(to, a); assert.ok(b > a, `CONTROL: end of ${from}`); return src.slice(a, b + to.length); };
const code = `${cut('function telegramText(', '\n}')}\n${cut('const msgIn = (', '\n    };')}`;
type Event = { name: string; estimate?: string; previous?: string; isoDate: string };
const message = (event: Event) => (new Function('event', 'emoji', 'minsStr', 'eventTimeIn', `${strip(code)}\nreturn msgIn;`) as (...a: unknown[]) => (z: string | null) => string)(event, '*', '30', () => '13:30 UTC')(null);

test('M1. calendar text is escaped', () => {
  const m = message({ name: 'CPI <MoM> & core', estimate: '<0.2%', previous: '>0.3% &amp;', isoDate: '2026-11-26T13:30:00Z' });
  assert.ok(m.includes('<b>CPI &lt;MoM&gt; &amp; core</b>'), m);
  assert.ok(m.includes('Estimate: <b>&lt;0.2%</b>  |  Prev: &gt;0.3% &amp;amp;'), m);
  assert.deepEqual([...m.matchAll(/<[^>]*>/g)].map((x) => x[0]), ['<b>', '</b>', '<b>', '</b>', '<b>', '</b>', '<i>', '</i>']);
});

test('M2. an ordinary event is unchanged', () => {
  const m = message({ name: 'Core CPI m/m', estimate: '0.3%', previous: '0.2%', isoDate: '2026-11-26T13:30:00Z' });
  assert.equal(m, '* <b>Macro Event in ~30 min</b>\n\n<b>Core CPI m/m</b>\n🕐 13:30 UTC\nEstimate: <b>0.3%</b>  |  Prev: 0.2%\n\n<i>High-impact release</i>');
});
