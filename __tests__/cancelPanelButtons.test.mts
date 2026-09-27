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
 * The second half (G9 onward) covers the owner's follow-up in the same PR: the confirm sentence names the real renewal date.
 *
 * Expectations are literals from the owner's complaint, the owner-approved sentences and the WCAG formula, not read back
 * from the code under test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { interpolate } from '../lib/labels.ts';
import { subscriptionPanelView } from '../lib/subscriptionPanel.ts';

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

/* ══ The confirm sentence names the real date (owner, 2026-09-27) ═════════════════════════════
 *
 * "Cancel Pro? You'll keep access until {date}." when the subscription's renewal date is known and in the future, and the
 * older dateless sentence when it is not. The date is formatted exactly like the "Cancelled · access until" line. The panel
 * cannot be rendered here (the confirm row needs a click, a signed-in Pro session and a live subscription), so this is
 * checked as its pieces: the choice the page makes, the words, and the pure view function that supplies the date. */

const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
const DATED = 'SETTINGS_SUB_CANCEL_CONFIRM_DATED';
const UNDATED = 'SETTINGS_SUB_CANCEL_CONFIRM';

test('G9. the page picks the dated sentence when the view has a date and the dateless one when it has none', () => {
  const at = page.indexOf(DATED);
  assert.ok(at > 0, 'the settings page no longer uses the dated confirm sentence');
  const start = page.lastIndexOf('<div className="st-desc">', at);
  const chunk = page.slice(start, page.indexOf('</div>', at));
  assert.match(chunk, /\{\s*subView\.untilDate\s*\?/, 'the choice is no longer made on the view\'s untilDate (a negated test would swap the two sentences)');
  const [ifDate, ifNone] = chunk.split(/\?([\s\S]*)/)[1].split(/\s:\s(?=t\()/);
  assert.ok(ifDate.includes(DATED), 'a known date does not show the dated sentence');
  assert.ok(ifNone?.includes(`t('${UNDATED}')`), 'no date does not fall back to the dateless sentence');
  assert.equal(ifNone.includes(DATED), false, 'the dateless branch also asks for a date');
});

test('G10. the date is filled in and formatted exactly like the "Cancelled, access until" line', () => {
  const dated = /t\('SETTINGS_SUB_CANCEL_CONFIRM_DATED', \{ date: (new Date\(subView\.untilDate\)\.toLocaleDateString\(\)) \}\)/.exec(page);
  assert.ok(dated, 'the dated sentence is no longer filled with { date: new Date(subView.untilDate).toLocaleDateString() }');
  const cancelled = /t\('SETTINGS_SUB_CANCELLED_UNTIL', \{ date: (new Date\(subView\.untilDate\)\.toLocaleDateString\(\)) \}\)/.exec(page);
  assert.ok(cancelled, 'the cancelled line no longer has the format this test compares against');
  assert.equal(dated[1], cancelled[1], 'the two sentences format their date differently');
});

test('G11. the words: the owner-approved sentence with one {date} placeholder, and the dateless fallback keeps its old words', () => {
  assert.equal(defaults[DATED], "Cancel Pro? You'll keep access until {date}.");
  assert.equal(defaults[UNDATED], "Cancel Pro? You'll keep access until the end of your current paid period.");
  assert.equal(defaults[DATED].match(/\{\w+\}/g)?.join(), '{date}', 'the placeholder is not exactly {date}');
  assert.equal(/\{/.test(defaults[UNDATED]), false, 'the dateless sentence has a placeholder nothing fills');
});

test('G12. the placeholder is really filled: no "{date}" or "undefined" reaches the screen, whatever the locale prints', () => {
  for (const printed of ['27/10/2026', '10/27/2026', '27.10.2026', '2026. 10. 27.']) {
    const shown = interpolate(defaults[DATED], { date: printed });
    assert.equal(shown, `Cancel Pro? You'll keep access until ${printed}.`);
  }
  assert.equal(interpolate(defaults[DATED]), defaults[DATED], 'control: without a value the placeholder is left as it is (so a missing date would be visible)');
});

test('G13. the label is registered and its migration row equals the default, in both the live and the commented dev block', () => {
  assert.ok(read('lib/labelKeys.ts').includes(`'${DATED}'`), `${DATED} is not registered in lib/labelKeys.ts`);
  const sql = read('supabase/migrations/20260926a_labels_subscription_cancel.sql');
  const rows = sql.split('\n').filter((l) => l.replace(/^--\s?/, '').startsWith(`('${DATED}','en','`));
  assert.equal(rows.length, 2, 'the row must be in the live block and in the commented dev block');
  for (const row of rows) {
    const bare = row.replace(/^--\s?/, '');
    const value = bare.slice(`('${DATED}','en','`.length).replace(/'\),?\s*$/, '').split("''").join("'");
    assert.equal(value, defaults[DATED], 'the migration row differs from the shipped default');
  }
});

/* The view that supplies the date, driven end to end the way the page does: a real view, then the real interpolation. */
function confirmSentence(currentPeriodEnd: string | null, nowMs: number, print: (d: Date) => string): string {
  const view = subscriptionPanelView({ role: 'pro', lsStatus: 'active', currentPeriodEnd, hasSubscription: true, canCancel: true }, nowMs);
  assert.equal(view.kind, 'cancellable');
  const until = (view as { untilDate: string | null }).untilDate;
  return until ? interpolate(defaults[DATED], { date: print(new Date(until)) }) : defaults[UNDATED];
}

test('G14. with a future renewal date the confirm names it; with none, a past one or garbage it says the dateless sentence', () => {
  const NOW = Date.UTC(2030, 5, 1);
  const print = (d: Date) => d.toISOString().slice(0, 10);
  assert.equal(confirmSentence('2030-07-01T00:00:00.000Z', NOW, print), "Cancel Pro? You'll keep access until 2030-07-01.");
  for (const none of [null, '', 'not a date', '2030-05-31T00:00:00.000Z', new Date(NOW).toISOString()]) {
    assert.equal(confirmSentence(none, NOW, print), defaults[UNDATED], `renewal "${none}" should give the dateless sentence`);
  }
});
