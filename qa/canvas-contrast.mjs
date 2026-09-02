#!/usr/bin/env node
/**
 * canvas-contrast.mjs — does the CANVAS itself specify anything that fails WCAG AA?
 *
 * Every contrast check this project has run measures the BUILT PAGE. That answers
 * "did we implement it accessibly", and it has repeatedly found real failures. It
 * does not answer "is the thing we were told to build accessible in the first
 * place", and twice now the answer has been no:
 *
 *   - #559 Bug 1  — the canvas's --amber failed on every surface it was used on.
 *   - #614        — the canvas's grade badge tints green text on a green tint at
 *                   15%, which measures 4.171 / 3.886 in light. Below AA.
 *
 * Both were found reactively, while building something else. This sweeps for them
 * directly, off the .dc.html frames, so "matches the canvas" stops being mistaken
 * for "meets AA" — they are different claims and only one of them was being made.
 *
 * WHERE THE EXPECTATIONS COME FROM: the canvas files, and WCAG's own ratio maths.
 * Nothing here is read off the running app — that is the trap CANVAS_MIRROR_TASK.md
 * §2 documents, and a contrast checker sourced from the page it checks would pass
 * a page that is uniformly wrong.
 *
 * WHAT IT CANNOT SEE (state these rather than let a clean run imply them):
 *   - Handlebars values. `color:{{ x.col }}` is data, not a specified colour.
 *   - Anything a real browser composites that static parsing does not: transforms,
 *     blend modes, gradients, images behind text.
 *   - Whether a pair is real. A frame can put text over a background it never
 *     actually renders against; this reports the pairing as authored.
 *
 * So a FAIL here is a claim about the design file, to be confirmed before acting.
 * A clean run means "nothing statically detectable", never "the canvas is accessible".
 *
 * Usage:  node qa/canvas-contrast.mjs [--all] [path/to/file.dc.html ...]
 *         defaults to the three screens under active work.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'design-handoff-dir/design_files';

/* The three screens the owner has approved work on. Everything else is out of
   scope until they name the next one — see qa/CANVAS_MIRROR_TASK.md. */
const DEFAULT_FILES = [
  'Dashboard 2a.dc.html', 'Dashboard 2a-light-theme.dc.html',
  'Landing 7a.dc.html',   'Landing 7a-light-theme.dc.html',
  'Arena 1a.dc.html',     'Arena 1a-light-theme.dc.html',
];

/* ── colour ── */

const hex = h => {
  const s = h.replace('#', '');
  const f = s.length === 3 ? s.split('').map(c => c + c).join('') : s;
  return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16));
};

function parseColour(v) {
  if (!v) return null;
  const s = v.trim();
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) return { rgb: hex(m[0]), a: 1 };
  m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*(?:[,/]\s*([\d.]+)\s*)?\)$/i);
  if (m) return { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] };
  return null; // named colours, gradients, {{ handlebars }} — deliberately unhandled
}

const over = (fg, bg) => fg.rgb.map((c, i) => c * fg.a + bg[i] * (1 - fg.a));

const lum = rgb => {
  const [r, g, b] = rgb.map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/* ── style extraction ── */

const decl = (style, prop) => {
  // last wins, matching the cascade within one attribute
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'gi');
  let m, out = null;
  while ((m = re.exec(style))) out = m[1].trim();
  return out;
};

/* `background` shorthand may carry more than a colour; take a leading colour only. */
function bgColour(style) {
  for (const prop of ['background-color', 'background']) {
    const v = decl(style, prop);
    if (!v) continue;
    const first = v.split(/\s+(?![^(]*\))/)[0];
    const c = parseColour(first);
    if (c) return c;
  }
  return null;
}

const FONT_SIZE = s => {
  const v = decl(s, 'font-size');
  const m = v && v.match(/([\d.]+)px/);
  return m ? +m[1] : null;
};
const FONT_WEIGHT = s => {
  const v = decl(s, 'font-weight');
  return v ? (parseInt(v, 10) || (v.trim() === 'bold' ? 700 : null)) : null;
};

/* WCAG 1.4.3: 18pt (24px), or 14pt (18.66px) bold, drops the bar to 3:1. */
const isLarge = (size, weight) =>
  size != null && (size >= 24 || (size >= 18.66 && (weight ?? 400) >= 700));

/* ── walk ── */

/**
 * Tag-level walk with a background stack. Not a real parser: it does not need to
 * be, because these frames are generated, well-formed, and use inline styles
 * exclusively. It tracks the nearest ancestor background so a text colour can be
 * measured against what it actually sits on, and composites translucent
 * backgrounds down the stack rather than treating them as opaque.
 */
function walk(html, onText) {
  /* Start "outside", with no background asserted. These files are CANVASES: each
     one holds device frames plus the design doc's own annotation chrome (titles,
     file references, notes to the reader). That chrome is not the product and
     must not be measured — it also sits on the canvas backdrop rather than on
     --bg0, so measuring it produced 44 confident false failures on the first
     run of this script. Text only counts once we are inside a frame, and a frame
     is an element that declares BOTH a fixed device width and its own background.
     Everything above that is documentation. */
  let bgStack = [];
  let frameDepth = 0;
  const openTags = [];
  const re = /<(\/?)([a-z0-9-]+)([^>]*?)(\/?)>([^<]*)/gi;
  let m;

  while ((m = re.exec(html))) {
    const [, closing, tag, attrs, selfClose, text] = m;

    if (closing) {
      const last = openTags.pop();
      if (last?.pushed) bgStack.pop();
      if (last?.frame) frameDepth--;
      continue;
    }

    const styleMatch = attrs.match(/style\s*=\s*"([^"]*)"/i);
    const style = styleMatch ? styleMatch[1] : '';
    const bg = bgColour(style);
    /* A device frame: fixed px width AND its own background. 1440/390 in these
       files, but matched by shape rather than by those literals so a frame drawn
       at another width still registers. */
    const widthPx = /(?:^|;)\s*width\s*:\s*(\d{3,4})px/i.exec(style);
    const isFrame = !!(bg && bg.a >= 1 && widthPx);
    if (isFrame) frameDepth++;

    let pushed = false;
    if (bg) {
      const under = bgStack.length ? bgStack[bgStack.length - 1] : null;
      // Opaque, or translucent over something known. A translucent background with
      // nothing under it cannot be composited — skip rather than invent a base.
      if (bg.a >= 1) { bgStack.push(bg.rgb); pushed = true; }
      else if (under) { bgStack.push(over(bg, under)); pushed = true; }
    }

    const isVoid = selfClose || /^(img|br|hr|input|meta|link|path|circle|rect|line)$/i.test(tag);
    if (!isVoid) openTags.push({ tag, pushed, frame: isFrame });
    else {
      if (pushed) bgStack.pop();
      if (isFrame) frameDepth--;
    }

    const content = text.trim();
    // Inside a frame, real text, an actual background to measure against, and not
    // a handlebars placeholder (that is data, not a specified colour).
    if (frameDepth > 0 && content && !/^\{\{/.test(content) && bgStack.length) {
      const fg = parseColour(decl(style, 'color'));
      if (fg) {
        onText({
          text: content.slice(0, 40),
          fg,
          bg: bgStack[bgStack.length - 1],
          size: FONT_SIZE(style),
          weight: FONT_WEIGHT(style),
        });
      }
    }
  }
}

/* ── run ── */

const args = process.argv.slice(2);
const files = args.filter(a => !a.startsWith('--'));
const all = args.includes('--all');

const targets = files.length ? files
  : all ? readdirSync(DIR).filter(f => f.endsWith('.dc.html')).map(f => join(DIR, f))
  : DEFAULT_FILES.map(f => join(DIR, f));

let totalFail = 0, totalChecked = 0;

for (const path of targets) {
  let html;
  try { html = readFileSync(path, 'utf8'); }
  catch { console.log(`\n${path}\n  SKIP — not found`); continue; }

  const fails = [];
  let checked = 0;

  walk(html, ({ text, fg, bg, size, weight }) => {
    const composited = fg.a >= 1 ? fg.rgb : over(fg, bg);
    const r = ratio(composited, bg);
    const large = isLarge(size, weight);
    const bar = large ? 3 : 4.5;
    checked++;
    if (r < bar) {
      fails.push({ text, r, bar, size, weight, large,
        fgs: `rgba(${fg.rgb.map(Math.round).join(',')},${fg.a})`,
        bgs: `rgb(${bg.map(Math.round).join(',')})` });
    }
  });

  totalChecked += checked;
  totalFail += fails.length;

  console.log(`\n${path}`);
  console.log(`  ${checked} static text nodes measured, ${fails.length} below AA`);
  for (const f of fails.sort((a, b) => a.r - b.r)) {
    const sz = f.size ? `${f.size}px${(f.weight ?? 400) >= 700 ? '/700' : ''}` : 'size unset';
    console.log(`    ${f.r.toFixed(2)}:1  (needs ${f.bar})  ${sz}${f.large ? ' large' : ''}`);
    console.log(`      "${f.text}"`);
    console.log(`      ${f.fgs} on ${f.bgs}`);
  }
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`${totalChecked} measured, ${totalFail} below AA`);
console.log('Static parse only: no handlebars values, no browser compositing.');
console.log('A fail is a claim about the design file — confirm before acting.');
console.log('A clean run means "nothing statically detectable", not "accessible".');
