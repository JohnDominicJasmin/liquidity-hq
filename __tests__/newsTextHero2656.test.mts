/* QA: the /news hero is a text card above 540 px and nothing else changes. PR #2656, #1185 (PM decision 2026-11-19).
 * THE WRITTEN RULE (the PR body): above 540 px the first story has no full-width image block; phones (540 px and below) keep the 88 px thumbnail row; EVERY OTHER card keeps its image at every width.
 * The page cannot be rendered here, so this evaluates app/globals.css the way the cascade does for one element at one viewport width: all rules that name the image wrapper, media conditions read from the file, specificity then source order.
 *   H1  hero image wrapper: display none at 541, 600, 768, 920, 921, 1024, 1280 and 1920 px
 *   H2  hero image wrapper: NOT hidden at 320, 360, 390, 414, 480 and 540 px, and there it is the 88 px thumbnail (width 88px)
 *   H3  every other card's image wrapper (.ncard-grid-img-wrap without the hero ancestor) is never display none, at any of those widths
 *   H4  CONTROL: the evaluator itself - it finds the hide rule, reads its media condition, and a hero wrapper at 1280 with that rule removed is NOT hidden
 *   H5  the hero card still carries its text: HeroCard keeps the headline link, the tags row and the buttons in the DOM (only the image block is hidden), and the hero headline rule is untouched
 *   H6  no rule other than the PR's one hides the hero image wrapper above 540 px (a second hiding rule would be a second, unreviewed change)
 * WHAT THIS CANNOT PROVE: how it looks at 768 / 1280 in light and dark, that headlines start higher, that nothing shifts, or whether the hero <img> is still requested (see the report: it has no loading="lazy"). Those need the browser run on GitHub CI. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
const PAGE = readFileSync(new URL('../app/(main)/news/page.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

interface Rule { media: string | null; selectors: string[]; decls: Record<string, string>; order: number }
function parse(css: string): Rule[] {
  const rules: Rule[] = []; let order = 0;
  const walk = (src: string, media: string | null) => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i); if (open < 0) break;
      const head = src.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (j < src.length && depth > 0) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
      const body = src.slice(open + 1, j - 1);
      if (head.startsWith('@media')) walk(body, head.slice(6).trim());
      else if (head.startsWith('@')) { /* @keyframes, @font-face, @supports ...: not a cascade input for this element */ }
      else {
        const decls: Record<string, string> = {};
        for (const d of body.split(';')) { const k = d.indexOf(':'); if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).replace(/!important/, '').trim(); }
        rules.push({ media, selectors: head.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), decls, order: order++ });
      }
      i = j;
    }
  };
  walk(css, null);
  return rules;
}
const RULES = parse(CSS);

/* a media condition made only of min-width / max-width in px, joined by "and"; anything else is "not a width condition" */
function mediaApplies(media: string | null, w: number): boolean | 'other' {
  if (media === null) return true;
  const parts = media.split(/\band\b/).map((s) => s.trim());
  for (const p of parts) {
    const m = /^\(\s*(min|max)-width\s*:\s*([\d.]+)px\s*\)$/.exec(p);
    if (!m) return 'other';
    if (m[1] === 'min' && !(w >= Number(m[2]))) return false;
    if (m[1] === 'max' && !(w <= Number(m[2]))) return false;
  }
  return true;
}
const WRAP = '.ncard-grid-img-wrap', HERO_WRAP = '.ncard-grid-hero .ncard-grid-img-wrap';
/* the value of `prop` on the wrapper at width w. hero: the element is inside .ncard-grid-hero. */
function valueAt(prop: string, w: number, hero: boolean, rules: Rule[] = RULES): string | undefined {
  let best: { spec: number; order: number; v: string } | undefined;
  for (const r of rules) {
    if (!(prop in r.decls)) continue;
    const ok = mediaApplies(r.media, w); if (ok !== true) continue;
    for (const s of r.selectors) {
      const spec = s === WRAP ? 1 : s === HERO_WRAP && hero ? 2 : 0; if (spec === 0) continue;
      if (!best || spec > best.spec || (spec === best.spec && r.order > best.order)) best = { spec, order: r.order, v: r.decls[prop] };
    }
  }
  return best?.v;
}
const ABOVE = [541, 600, 768, 920, 921, 1024, 1280, 1920], PHONE = [320, 360, 390, 414, 480, 540];

test('H1. the hero image wrapper is not drawn above 540 px', () => {
  for (const w of ABOVE) assert.equal(valueAt('display', w, true), 'none', `at ${w} px the hero image wrapper is still drawn`);
});
test('H2. on a phone (540 px and below) the hero keeps its 88 px thumbnail', () => {
  for (const w of PHONE) { assert.notEqual(valueAt('display', w, true), 'none', `at ${w} px the hero image wrapper is hidden`); assert.equal(valueAt('width', w, true), '88px', `at ${w} px the hero thumbnail is not the 88 px row`); }
});
test('H3. every other card keeps its image at every width', () => {
  for (const w of [...PHONE, ...ABOVE]) assert.notEqual(valueAt('display', w, false), 'none', `at ${w} px a NON-hero card lost its image wrapper`);
});
test('H4. CONTROL: the evaluator reads the hide rule, its condition, and goes quiet when the rule is removed', () => {
  const hide = RULES.filter((r) => r.selectors.includes(HERO_WRAP) && r.decls.display === 'none');
  assert.equal(hide.length, 1, 'CONTROL: expected exactly one hero hide rule');
  assert.equal(hide[0].media, '(min-width: 541px)');
  const without = RULES.filter((r) => r !== hide[0]);
  assert.notEqual(valueAt('display', 1280, true, without), 'none', 'CONTROL: still hidden with the rule removed, so the evaluator is reading something else');
  assert.ok(RULES.length > 500, `CONTROL: only ${RULES.length} rules parsed from globals.css`);
});
test('H5. the hero card keeps its text content; only the image block is hidden', () => {
  const a = PAGE.indexOf('function HeroCard'); assert.ok(a > 0, 'CONTROL: HeroCard not found');
  const b = PAGE.indexOf('function NewsCard', a); const hero = PAGE.slice(a, b);
  assert.match(hero, /className="ncard-grid-headline"/); assert.match(hero, /ncard-headline-link/); assert.match(hero, /className="ncard-tags"/); assert.match(hero, /ncard-grid-actions/);
  const headRule = RULES.find((r) => r.media === null && r.selectors.includes('.ncard-grid-hero .ncard-grid-headline'));
  assert.equal(headRule?.decls['font-size'], 'var(--fs-card-title)', 'the hero headline is no longer the larger card-title size');
});
test('H6. nothing else hides the hero image wrapper above 540 px', () => {
  const hiders = RULES.filter((r) => r.selectors.some((s) => s === HERO_WRAP || s === WRAP) && /^(none)$/.test(r.decls.display ?? '') );
  assert.deepEqual(hiders.map((r) => `${r.media} ${r.selectors.join(',')}`), ['(min-width: 541px) .ncard-grid-hero .ncard-grid-img-wrap']);
});
