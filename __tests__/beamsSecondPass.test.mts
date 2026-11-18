import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* PR #2583 - components/BeamsBackground.tsx, second speed pass. FINAL DESIGN (head cec0c68c): each beam is blurred as it is drawn, exactly as on main
 * (so beams just outside the frame still glow into it, no edge vignette), and the speed comes from the bitmap: ONE pixel per 8 CSS px (was 4 on #2578).
 * An off-screen layer / single composited blur was tried and dropped: it clipped glow at the frame edge (a right/bottom vignette at 390 px).
 * SOURCE PINS ONLY. They fix: no off-screen layer, one blur setting per frame applied before the beams, per-beam drawing on the visible context,
 * the bitmap size independent of devicePixelRatio, reduced motion / cleanup / CSS size unchanged, rAF the only scheduler.
 * WHAT THEY DO NOT PROVE: what the picture looks like (measured in a real browser: mean abs diff vs main <= 0.5/255) - the page still needs looking at. */
const src = readFileSync(new URL('../components/BeamsBackground.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const slice = (from: string) => {
  const at = src.indexOf(from);
  assert.ok(at >= 0, 'not found: ' + from);
  const end = src.indexOf('\n    };', at);
  assert.ok(end > at, 'no end for: ' + from);
  return src.slice(at, end);
};
const setup = slice('const setup = () => {');
const drawBeam = slice('const drawBeam = (beam: Beam) => {');
const animate = slice('const animate = () => {');

test('the bitmap is one pixel per 8 CSS px, sized from the parent in CSS px: no devicePixelRatio in the size, so memory does not grow with DPR', () => {
  assert.match(src, /const BITMAP_SCALE = 0\.125;/);
  assert.match(setup, /canvas\.width = Math\.max\(1, Math\.round\(w \* BITMAP_SCALE\)\);/);
  assert.match(setup, /canvas\.height = Math\.max\(1, Math\.round\(h \* BITMAP_SCALE\)\);/);
  assert.match(setup, /ctx\.scale\(BITMAP_SCALE, BITMAP_SCALE\);/);
  assert.ok(setup.indexOf('canvas.width =') < setup.indexOf('ctx.scale('), 'assigning width resets the context, so the scale must come after it');
  for (const line of setup.split('\n').filter(l => /canvas\.(width|height) =/.test(l))) assert.ok(!/dpr/.test(line), 'bitmap size must not use dpr: ' + line.trim());
});

test('memory model: the bitmap at 1280x700 and at 2560x1440 is tiny and the same at DPR 1, 2 and 3', () => {
  const scale = Number(/const BITMAP_SCALE = ([0-9.]+);/.exec(src)![1]);
  const bytes = (w: number, h: number) => Math.max(1, Math.round(w * scale)) * Math.max(1, Math.round(h * scale)) * 4;
  assert.ok(bytes(1280, 700) < 128 * 1024, 'canvas at 1280x700: ' + bytes(1280, 700));
  assert.ok(bytes(2560, 1440) < 512 * 1024, 'canvas at 2560x1440: ' + bytes(2560, 1440));
});

test('each beam keeps its OWN blur as on main: no off-screen layer, no drawImage, every draw call is on the visible ctx', () => {
  assert.ok(!/createElement\('canvas'\)/.test(src), 'an off-screen layer is back (it clips the glow at the frame edge)');
  assert.ok(!/drawImage|lctx|\blayer\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), 'a layer or composite step is back');
  for (const call of ['ctx.save()', 'ctx.translate(beam.x, beam.y)', 'ctx.rotate(', 'ctx.createLinearGradient(0, 0, 0, beam.length)', 'ctx.fillStyle = g', 'ctx.fillRect(-beam.width / 2, 0, beam.width, beam.length)', 'ctx.restore()'])
    assert.ok(drawBeam.includes(call), 'missing ' + call);
});

test('a frame is: clear, set the blur ONCE, then draw every beam (the filter applies to each draw), advance only when motion is allowed, schedule the next frame', () => {
  const order = [
    'ctx.clearRect(0, 0, w, h);',
    'ctx.filter = `blur(${blurPx}px)`;',
    'beamsRef.current.forEach((beam, i) => {',
    'drawBeam(beam);',
    'if (!reduceMotion) rafRef.current = requestAnimationFrame(animate);',
  ];
  let at = -1;
  for (const s of order) { const i = animate.indexOf(s, at + 1); assert.ok(i > at, 'out of order or missing: ' + s); at = i; }
  assert.equal((src.match(/ctx\.filter = /g) ?? []).length, 1, 'the blur is set in one place');
  assert.equal((animate.match(/blur\(/g) ?? []).length, 1);
});

test('the blur size keeps its on-screen size: 35 * BITMAP_SCALE / dpr, recomputed in setup (a canvas blur is in bitmap pixels and ignores ctx.scale)', () => {
  assert.match(setup, /blurPx = \(35 \* BITMAP_SCALE\) \/ dpr;/);
  assert.match(src, /let blurPx = 35;/);
});

test('reduced motion and cleanup are unchanged: beams advance only when motion is allowed, one still frame is drawn, rAF cancelled, listener removed', () => {
  assert.match(animate, /if \(!reduceMotion\) \{\n\s*beam\.y -= beam\.speed;\n\s*beam\.pulse \+= beam\.pulseSpeed;/);
  assert.match(src, /const onResize = \(\) => \{ setup\(\); if \(reduceMotion\) animate\(\); \};/);
  assert.match(src, /window\.removeEventListener\('resize', onResize\);\s*cancelAnimationFrame\(rafRef\.current\);/);
  assert.match(src, /\n    setup\(\);\n[\s\S]*?window\.addEventListener\('resize', onResize\);\n\s*animate\(\);/);
});

test('the only scheduler is requestAnimationFrame: no timer keeps drawing in a hidden tab (browsers pause rAF there)', () => {
  assert.ok(!/setInterval|setTimeout/.test(src));
  assert.equal((src.match(/requestAnimationFrame\(/g) ?? []).length, 1);
});

test('visible canvas keeps its CSS size (the parent size) and its element blur, so there is no sideways overflow', () => {
  assert.match(setup, /canvas\.style\.width = `\$\{w\}px`;/);
  assert.match(setup, /canvas\.style\.height = `\$\{h\}px`;/);
  assert.match(src, /filter: 'blur\(15px\)'/);
});
