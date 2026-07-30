#!/usr/bin/env node
/**
 * Generates the two icon variants the design handoff did NOT already export:
 *   1. app/apple-icon.png - a SQUARE (radius 0), opaque, edge-to-edge tile.
 *      iOS applies its own rounded-corner mask to whatever you give it; the
 *      exported icon-*.svg files already have a 22.5% radius baked in with
 *      transparent corners, so iOS masking a pre-rounded image on top would
 *      either double-round (a visibly different curve than the rest of the
 *      OS) or leave a seam where our transparency meets iOS's own fill.
 *      A flat square lets iOS's mask be the only rounding applied.
 *   2. public/icons/icon-maskable-{192,512}.png - Android adaptive icons.
 *      Launchers crop to shapes we don't control (circle, squircle, teardrop
 *      etc.), so content must fit inside a centered "safe zone" - a circle
 *      whose diameter is 66.67% of the icon (Android's own spec: a 72dp
 *      safe circle inside a 108dp viewport). The source glyph's own bounding
 *      box is 71.5% wide, i.e. LARGER than the safe zone - used as-is, an
 *      adaptive launcher would clip the L's foot and the third bar. So the
 *      glyph is scaled down and re-centered on a full-bleed square background
 *      (no transparency - a maskable icon must not rely on alpha, since the
 *      system decides what shape crops it, not the image).
 *
 * Everything else (app/icon.svg, favicon.ico's payload, the 192/512 "any"
 * manifest icons) is a direct copy of files the design handoff already
 * exported correctly - regenerating them here would just be a second,
 * riskier way to reproduce math the export already got right.
 *
 * Run: node scripts/gen-brand-icons.mjs
 */
import sharp from 'sharp';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPORT_DIR = resolve(
  'C:/Users/Dominic/Downloads/App logo redesign-handoff/app-logo-redesign/project/export',
);

const BG = '#080C15';
const FG = '#F4F7FB';
const DIM = '#1C3E76';
const ACCENT = '#2E7BFF';
const ACCENT2 = '#6FD3FF';

// ── 1. Apple touch icon: square, opaque, no baked radius ───────────────────
const appleSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="${BG}"/>
  <rect x="14" y="22" width="11.5" height="42" fill="${FG}"/>
  <rect x="14" y="64" width="29" height="11.5" fill="${FG}"/>
  <rect x="51" y="58.5" width="9.5" height="17" fill="${DIM}"/>
  <rect x="63.5" y="46.5" width="9.5" height="29" fill="${ACCENT}"/>
  <rect x="76" y="33.5" width="9.5" height="42" fill="${ACCENT2}"/>
</svg>`;

// ── 2. Maskable icon: full-bleed square bg, glyph scaled into the safe zone ─
// Glyph bounding box (all 5 rects together): x:[14,85.5] y:[22,75.5],
// so width=71.5 height=53.5, center=(49.75, 48.75) - all copied directly
// from MarkLadder.dc.html's fixed percentages, not re-derived by eye.
//
// Android's safe zone is a circle of radius 33.33 (100 * 1/3) centered at
// the icon's own center (50,50). Scaling the glyph by k about its own
// bounding-box center, then re-centering that box on (50,50), the farthest
// point from center is k * half-diagonal = k * sqrt(35.75^2 + 26.75^2) =
// k * 44.65. Solving k*44.65 = 30 (a deliberate 3-unit margin under the
// 33.33 limit, since real launchers vary slightly) gives k = 0.67.
const K = 0.67;
const CX_OLD = 49.75, CY_OLD = 48.75;
const CX_NEW = 50, CY_NEW = 50;
function xf(x) { return CX_NEW + K * (x - CX_OLD); }
function yf(y) { return CY_NEW + K * (y - CY_OLD); }

const maskRects = [
  { x: 14,   y: 22,   w: 11.5, h: 42,   fill: FG },
  { x: 14,   y: 64,   w: 29,   h: 11.5, fill: FG },
  { x: 51,   y: 58.5, w: 9.5,  h: 17,   fill: DIM },
  { x: 63.5, y: 46.5, w: 9.5,  h: 29,   fill: ACCENT },
  { x: 76,   y: 33.5, w: 9.5,  h: 42,   fill: ACCENT2 },
].map(r => ({
  x: xf(r.x), y: yf(r.y), w: r.w * K, h: r.h * K, fill: r.fill,
}));

const maskableSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="${BG}"/>
  ${maskRects.map(r => `<rect x="${r.x.toFixed(3)}" y="${r.y.toFixed(3)}" width="${r.w.toFixed(3)}" height="${r.h.toFixed(3)}" fill="${r.fill}"/>`).join('\n  ')}
</svg>`;

// ── ICO container: wraps already-exported PNGs, no re-rasterizing ──────────
// Modern ICO readers (Windows Vista+, every current browser) accept a raw
// PNG byte stream as a directory entry's payload - this avoids reproducing
// the compact favicon's 2-bar math a third time when the export already has
// pixel-correct 32/48px PNGs sitting right there.
function buildIco(pngBuffers) {
  const count = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  let offset = 6 + 16 * count;
  const dirEntries = [];
  const payloads = [];
  for (const { size, buf } of pngBuffers) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);  // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1);  // height
    entry.writeUInt8(0, 2);                       // color count
    entry.writeUInt8(0, 3);                       // reserved
    entry.writeUInt16LE(1, 4);                    // color planes
    entry.writeUInt16LE(32, 6);                   // bits per pixel
    entry.writeUInt32LE(buf.length, 8);           // payload size
    entry.writeUInt32LE(offset, 12);              // payload offset
    offset += buf.length;
    dirEntries.push(entry);
    payloads.push(buf);
  }
  return Buffer.concat([header, ...dirEntries, ...payloads]);
}

async function main() {
  mkdirSync(resolve(ROOT, 'public/icons'), { recursive: true });

  // 1. Apple touch icon
  const appleBuf = await sharp(Buffer.from(appleSvg), { density: 384 })
    .resize(180, 180)
    .flatten({ background: BG }) // drop the alpha channel entirely - Apple's
    // own guidance is not to ship one on touch icons, even a fully-opaque one
    .png()
    .toBuffer();
  writeFileSync(resolve(ROOT, 'app/apple-icon.png'), appleBuf);
  console.log('wrote app/apple-icon.png', appleBuf.length, 'bytes');

  // 2. Maskable icons
  for (const size of [192, 512]) {
    const buf = await sharp(Buffer.from(maskableSvg), { density: size >= 512 ? 384 : 300 })
      .resize(size, size)
      .flatten({ background: BG }) // Android's adaptive-icon spec: content
      // must not rely on alpha, since the launcher decides the crop shape
      .png()
      .toBuffer();
    const out = resolve(ROOT, `public/icons/icon-maskable-${size}.png`);
    writeFileSync(out, buf);
    console.log('wrote', out, buf.length, 'bytes');
  }

  // 3. favicon.ico from the already-exported compact favicons
  const png32 = readFileSync(resolve(EXPORT_DIR, 'favicon-32.png'));
  const png48 = readFileSync(resolve(EXPORT_DIR, 'favicon-48.png'));
  const ico = buildIco([{ size: 32, buf: png32 }, { size: 48, buf: png48 }]);
  writeFileSync(resolve(ROOT, 'app/favicon.ico'), ico);
  console.log('wrote app/favicon.ico', ico.length, 'bytes');
}

main().catch(e => { console.error(e); process.exit(1); });
