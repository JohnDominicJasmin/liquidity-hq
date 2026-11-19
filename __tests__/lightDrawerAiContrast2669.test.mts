import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* #2669 (#1185 contrast, QA's dev-site sweep run 44542828265): in the LIGHT theme the drawer section labels ("Main", "Analysis", "Research", "My Tools", "Account") read #afb1b3 on white = 2.16:1 because the label carried opacity:0.5, and the Ask AI panel painted its background only as a gradient so a contrast check read the glyph colour against nothing. Written rule: every small text is at least 4.5:1.
 *   K1 .nav-section-label has no opacity, and its colour token on the light surface it sits on is at least 4.5:1
 *   K2 the light Ask AI panel has a SOLID background-color under its gradient, and the header icon buttons (back, clear, history, close) read --txt2 there (hover --txt), each at least 4.5:1 against that panel colour
 *   K3 the dark theme is untouched by the change: the base .gchat-icon-btn colour is still --txt3 and the dark panel still uses --bg1 (the dark-theme 1:1 readings in the sweep were the probe reading a coloured fill as the page background, not a defect: that is not claimed fixed here) */
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (sel: string, from = 0) => { const i = css.indexOf(sel + ' {', from); if (i < 0) return null; const j = css.indexOf('}', i); return css.slice(i + sel.length + 2, j); };
const light = (() => { const i = css.indexOf('[data-theme="light"] {'); assert.ok(i >= 0, 'CONTROL: the light token block was not found'); return css.slice(i, css.indexOf('\n}', i)); })();
const tok = (name: string) => { const m = new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(light); assert.ok(m, `CONTROL: light ${name} not found`); return m![1]; };
const lum = (hex: string) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('K1. the drawer section label has no opacity and clears 4.5:1 on the light drawer', () => {
  const r = rule('.nav-section-label'); assert.ok(r, 'CONTROL: .nav-section-label not found'); assert.equal(/opacity\s*:/.test(r!), false, 'the label still carries an opacity (the 2.16:1 cause)');
  assert.ok(/color:\s*var\(--txt3\)/.test(r!), 'the label colour is no longer --txt3');
  for (const bg of ['#FFFFFF', tok('--bg1'), tok('--bg2')]) assert.ok(ratio(tok('--txt3'), bg) >= 4.5, `--txt3 ${tok('--txt3')} on ${bg} is ${ratio(tok('--txt3'), bg).toFixed(2)}:1`);
});
test('K2. the light Ask AI panel is a solid colour under its gradient and its header icons are readable on it', () => {
  const panel = rule('[data-theme="light"] .gchat-panel'); assert.ok(panel, 'CONTROL: the light panel rule was not found');
  const bg = /background-color:\s*(#[0-9A-Fa-f]{6})/.exec(panel!); assert.ok(bg, 'the light panel has no solid background-color (a gradient alone reads as no colour to a contrast check)'); assert.ok(/background-image:\s*linear-gradient/.test(panel!), 'the gradient was dropped');
  assert.equal(rule('[data-theme="light"] .gchat-icon-btn')?.trim(), 'color: var(--txt2);', 'the light icon buttons do not read --txt2'); assert.equal(rule('[data-theme="light"] .gchat-icon-btn:hover')?.trim(), 'color: var(--txt);', 'the light hover is not --txt');
  assert.ok(ratio(tok('--txt2'), bg![1]) >= 4.5, `--txt2 ${tok('--txt2')} on the panel ${bg![1]} is ${ratio(tok('--txt2'), bg![1]).toFixed(2)}:1`); assert.ok(ratio(tok('--txt'), bg![1]) >= 7, '--txt on the panel');
  const gradEnd = /#F0EDE4/.exec(panel!)?.[0]; if (gradEnd) assert.ok(ratio(tok('--txt2'), gradEnd) >= 4.5, 'the icon colour fails on the darker end of the gradient');
});
test('K3. the dark theme is untouched', () => {
  assert.ok(/color:\s*var\(--txt3\)/.test(rule('.gchat-icon-btn') ?? ''), 'the base icon colour changed'); assert.ok(/background:\s*var\(--bg1\)/.test(rule('.gchat-panel') ?? ''), 'the base panel background changed');
});
