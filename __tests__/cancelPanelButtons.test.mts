/* The two cancel-confirm buttons in Settings must be the same size (#1396, PR #1439).
 *
 * The owner rejected the panel because "Yes, cancel" and "Keep Pro" did not match: the red button carries the sign-out
 * button's `margin-top: 10px`, so in the flex row it sat 10px LOWER than the purple one, and the two labels are different
 * lengths so the boxes were different widths. #1439 fixes it with one shared class, `.st-confirm-btn`, applied on top of
 * the two colour classes.
 *
 * This is a SOURCE guard. It cannot see pixels: a browser measurement of the real panel (both buttons' width, height and
 * top, at desktop and phone width) is what proves it looks right, and the owner's approval is what closes a visual
 * issue. What this file does is stop the fix quietly coming undone: a class dropped from one button, a per-button width or
 * margin added inline, the rule moved above the colour classes (equal specificity, so the LAST rule wins, and then the
 * red button is 10px low again), or a later rule re-introducing a size on one colour class. The contrast test computes
 * the colours from the CSS tokens rather than trusting a figure quoted in a comment.
 *
 * Expectations are literals from the owner's complaint and the WCAG formula, not read back from the code under test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const page = read('app/settings/page.tsx');
const rawCss = read('app/globals.css');
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');

/* ── a small CSS reader: innermost rules only (so rules inside @media are included), in source order ── */

type Rule = { selector: string; decls: Map<string, string>; at: number };
function rulesOf(text: string): Rule[] {
  const out: Rule[] = [];
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = new Map<string, string>();
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i > 0) decls.set(d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim());
    }
    out.push({ selector: m[1].trim(), decls, at: m.index ?? 0 });
  }
  return out;
}
const RULES = rulesOf(css);
const only = (selector: string) => RULES.filter((r) => r.selector === selector);
const BUTTON_CLASSES = ['.st-confirm-btn', '.st-signout-btn', '.st-save-btn'];
const touchesButtons = (r: Rule) => BUTTON_CLASSES.some((c) => new RegExp(`${c.replace('.', '\\.')}(?![\\w-])`).test(r.selector));
const px = (v: string | undefined) => (v && /^-?[\d.]+px$/.test(v) ? parseFloat(v) : NaN);

/* ── G1: the markup ──────────────────────────────────────────────────────────────────────── */

function buttonWith(label: string): { classes: string[]; hasStyle: boolean } {
  const at = page.indexOf(label);
  assert.ok(at > 0, `${label} is no longer in the settings page`);
  const start = page.lastIndexOf('<button', at);
  const head = page.slice(start, at);
  const cls = /className="([^"]+)"/.exec(head);
  assert.ok(cls, `the button holding ${label} has no className`);
  return { classes: cls[1].split(/\s+/), hasStyle: /\bstyle=/.test(head) };
}

test('G1. both confirm buttons carry the one shared sizing class, keep their own colour class, and have no inline style', () => {
  const yes = buttonWith('SETTINGS_SUB_CANCEL_CONFIRM_YES');
  const no = buttonWith('SETTINGS_SUB_CANCEL_CONFIRM_NO');
  assert.ok(yes.classes.includes('st-confirm-btn'), '"Yes, cancel" lost the shared sizing class');
  assert.ok(no.classes.includes('st-confirm-btn'), '"Keep Pro" lost the shared sizing class');
  assert.ok(yes.classes.includes('st-signout-btn'), '"Yes, cancel" is no longer red');
  assert.ok(no.classes.includes('st-save-btn'), '"Keep Pro" is no longer purple');
  assert.equal(yes.hasStyle, false, '"Yes, cancel" has an inline style, which is how one button ends up a different size');
  assert.equal(no.hasStyle, false, '"Keep Pro" has an inline style, which is how one button ends up a different size');
});

test('G2. the two buttons sit together in one flex row', () => {
  const at = page.indexOf('SETTINGS_SUB_CANCEL_CONFIRM_YES');
  const start = page.lastIndexOf('<div', page.lastIndexOf('<button', at));
  const tag = page.slice(start, page.indexOf('>', start));
  assert.match(tag, /display:\s*'flex'/,'the element holding the two confirm buttons is no longer a flex row');
  const rowEnd = page.indexOf('</div>', at);
  assert.ok(page.slice(at, rowEnd).includes('SETTINGS_SUB_CANCEL_CONFIRM_NO'), 'the two buttons are no longer in the same row');
});

/* ── the stylesheet ───────────────────────────────────────────────────────────────────────── */

test('G3. `.st-confirm-btn` exists once, is at least a 44px touch target, cancels the sign-out button\'s top margin, and sets no width or height of its own', () => {
  const rules = only('.st-confirm-btn');
  assert.equal(rules.length, 1, 'the shared class is missing or defined more than once');
  const d = rules[0].decls;
  assert.ok(px(d.get('min-height')) >= 44, `min-height is ${d.get('min-height')}, under a 44px touch target`);
  assert.ok(px(d.get('min-width')) > 0, 'no shared min-width, so the two labels set the two widths again');
  assert.equal(d.get('margin-top'), '0', '.st-signout-btn adds margin-top: 10px; without a reset the red button sits 10px low');
  for (const prop of ['width', 'height', 'max-width', 'max-height', 'flex', 'flex-basis', 'flex-grow', 'flex-shrink']) {
    assert.equal(d.has(prop), false, `.st-confirm-btn sets ${prop}: a fixed size belongs to neither colour class`);
  }
});

test('G4. CASCADE: the shared rule comes AFTER both colour rules, because equal specificity means the last rule wins', () => {
  const at = only('.st-confirm-btn')[0].at;
  assert.ok(only('.st-signout-btn')[0].at < at, '.st-confirm-btn is above .st-signout-btn, so its margin-top: 0 loses to margin-top: 10px');
  assert.ok(only('.st-save-btn')[0].at < at, '.st-confirm-btn is above .st-save-btn');
});

test('G5. no other rule sizes one colour class: exactly the three known rules set geometry, once each', () => {
  const GEOMETRY = /^(margin|padding|width|height|min-|max-|font-size|line-height|border(-width)?$|flex|display|gap|box-sizing|zoom|transform)/;
  const sizing = RULES.filter(touchesButtons)
    .map((r) => ({ selector: r.selector, props: [...r.decls.keys()].filter((p) => GEOMETRY.test(p)) }))
    .filter((r) => r.props.length > 0)
    .map((r) => r.selector)
    .sort();
  assert.deepEqual(sizing, ['.st-confirm-btn', '.st-save-btn', '.st-signout-btn'],
    'a rule other than the three known ones sets size or spacing on a confirm-button class (a media query, a compound selector, a per-theme override): check both buttons still match');
});

test('G6. the sizing sweep can see: it finds the three rules, and a hypothetical stray rule would be caught (control)', () => {
  assert.equal(RULES.filter(touchesButtons).length >= 5, true, 'the parser found almost no button rules: it is not reading the stylesheet');
  const stray = rulesOf('.st-signout-btn { padding: 4px 8px; } @media (max-width: 400px) { .st-save-btn { width: 100%; } }').filter(touchesButtons);
  assert.equal(stray.length, 2, 'the reader does not see rules inside @media');
});

/* ── contrast, computed from the tokens ───────────────────────────────────────────────────── */

type RGBA = [number, number, number, number];
const lightBlock = (() => {
  const blocks = RULES.filter((r) => r.selector === '[data-theme="light"]');
  assert.ok(blocks.length >= 1, 'the default light theme block was not found');
  return blocks[0].decls;
})();
function colour(value: string, depth = 0): RGBA {
  const v = value.trim();
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  if (ref) {
    assert.ok(depth < 5 && lightBlock.has(ref[1]), `${ref[1]} is not defined in the light theme block`);
    return colour(lightBlock.get(ref[1])!, depth + 1);
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(v);
  assert.ok(fn, `cannot read the colour "${v}"`);
  const p = fn[1].split(',').map((x) => parseFloat(x));
  return [p[0], p[1], p[2], p[3] ?? 1];
}
const over = (top: RGBA, under: RGBA): RGBA => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1) as RGBA;
const lum = (c: RGBA) => {
  const [r, g, b] = c.slice(0, 3).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (fg: RGBA, bg: RGBA) => { const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05); };

test('G7. sanity for the contrast helper: black on white is 21:1 and #767676 on white is the classic 4.54:1', () => {
  assert.equal(Math.round(contrast([0, 0, 0, 1], [255, 255, 255, 1])), 21);
  assert.ok(Math.abs(contrast([0x76, 0x76, 0x76, 1], [255, 255, 255, 1]) - 4.54) < 0.01);
});

function lightRule(selector: string) {
  const r = RULES.find((x) => x.selector === selector);
  assert.ok(r, `${selector} not found`);
  return r.decls;
}

test('G8. default light theme: both confirm buttons clear WCAG AA (4.5:1) over the card they actually sit on', (t) => {
  const card = colour(lightRule('[data-theme="light"] .st-section').get('background') ?? '');
  assert.deepEqual(card.slice(0, 3), [255, 255, 255], 'the settings card in the light theme is no longer white: re-derive the surface');
  const override = RULES.find((r) => r.selector === '[data-theme="light"]:not([data-design="terminal"]) .st-confirm-btn.st-signout-btn');

  const redBg = over(colour(lightRule('.st-signout-btn').get('background') ?? ''), card);
  const redText = colour(override?.decls.get('color') ?? lightRule('.st-signout-btn').get('color') ?? '');
  const yes = contrast(redText, redBg);
  const baseRed = contrast(colour(lightRule('.st-signout-btn').get('color') ?? ''), redBg);
  t.diagnostic(`"Yes, cancel" on the white card: ${yes.toFixed(2)}:1 (the base --red without the override: ${baseRed.toFixed(2)}:1)`);
  assert.ok(yes >= 4.5, `"Yes, cancel" is ${yes.toFixed(2)}:1, under AA`);

  const blueBg = over(colour(lightRule('.st-save-btn').get('background') ?? ''), card);
  const blueText = colour(lightRule('.st-save-btn').get('color') ?? '');
  const no = contrast(blueText, blueBg);
  t.diagnostic(`"Keep Pro" on the white card: ${no.toFixed(2)}:1`);
  assert.ok(no >= 4.5, `"Keep Pro" is ${no.toFixed(2)}:1, under AA`);
});
