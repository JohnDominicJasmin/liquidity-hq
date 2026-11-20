/* FIRST-LOAD WEIGHT OF A PAGE, READ FROM THE BUILT HTML (#1185 slow-3G boxes, 2026-11-20).
 *
 * `next build` (Next 16 / Turbopack) prints no per-route size table, and the laptop is not used for measurements, so this reads what the build wrote: the pre-rendered HTML of a few static
 * routes (.next/server/app/<route>.html), the scripts, stylesheets and preloaded fonts it names, and the size of each file (raw and gzip) from .next/static and app/fonts. The total is what a cold
 * visitor downloads before the page can settle, excluding anything the page fetches after load. Run by .github/workflows/bundle-stats.yml (dispatch only), which writes the tables into the job summary.
 *
 * Usage: node scripts/bundle-stats.mjs [route ...]   (default: / /about /faq /pricing /arena) */
import { readFileSync, existsSync, statSync, appendFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const routes = process.argv.length > 2 ? process.argv.slice(2) : ['/', '/about', '/faq', '/pricing', '/arena'];
const root = process.cwd();
const out = [];
const log = (s = '') => { out.push(s); console.log(s); };

function htmlFor(route) {
  const base = route === '/' ? 'index' : route.replace(/^\//, '');
  for (const p of [`.next/server/app/${base}.html`, `.next/server/app/(main)/${base}.html`]) if (existsSync(path.join(root, p))) return p;
  return null;
}
function fileFor(url) {
  const clean = url.split('?')[0];
  if (clean.startsWith('/_next/static/')) return path.join(root, '.next/static', clean.slice('/_next/static/'.length));
  if (clean.startsWith('/_next/')) return path.join(root, '.next', clean.slice('/_next/'.length));
  return path.join(root, 'public', clean);
}
const kb = n => (n / 1024).toFixed(1);
/* CHUNK -> CLIENT MODULES from the route's client-reference manifest (Next writes it next to the page: it names every client module and the chunks that carry it). */
function moduleMap(route) {
  const base = route === '/' ? '' : route.replace(/^\//, '') + '/';
  const f = path.join(root, `.next/server/app/${base}page_client-reference-manifest.js`);
  if (!existsSync(f)) return null;
  try {
    const text = readFileSync(f, 'utf8');
    const json = JSON.parse(text.slice(text.indexOf('= ') + 2).replace(/;\s*$/, ''));
    const byChunk = new Map();
    for (const [mod, info] of Object.entries(json.clientModules ?? {})) for (const ch of info.chunks ?? []) {
      const name = String(ch).split('/').pop().split('?')[0];
      if (!byChunk.has(name)) byChunk.set(name, new Set());
      byChunk.get(name).add(mod.replace(/^\[project\]\//, '').split('#')[0]);
    }
    return byChunk;
  } catch (e) { return null; }
}
/* WHAT A CHUNK HOLDS, by strings that survive minification (package names in error messages and globals). A hint, not a module list. */
const MARKERS = [['react-dom', 'react-dom'], ['react-dom', '__reactContainer'], ['next/router', 'next-router'], ['supabase', 'supabase'], ['supabase', 'GoTrue'], ['posthog', 'posthog'], ['sentry', '@sentry'], ['sentry', 'Sentry'], ['klinecharts', 'klinecharts'], ['klinecharts', 'registerIndicator'], ['zod', 'ZodError'], ['lucide', 'lucide'], ['framer', 'framer-motion'], ['date-fns', 'date-fns'], ['intl', 'Intl.DateTimeFormat'], ['i18n labels', 'labelDefaults'], ['market store', 'fundingRate'], ['arena', 'ARENA_'], ['strategies', 'STRAT_OV_'], ['landing', 'LandingTerminal'], ['polyfills', 'Array.prototype.at']];
function recognise(text) { return [...new Set(MARKERS.filter(([, m]) => text.includes(m)).map(([n]) => n))].join(', '); }

for (const route of routes) {
  const rel = htmlFor(route);
  log(`\n### ${route}`);
  if (!rel) { log('no pre-rendered HTML for this route (dynamic or not built)'); continue; }
  const html = readFileSync(path.join(root, rel), 'utf8');
  const urls = new Map();   // url -> kind
  for (const m of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) urls.set(m[1], 'script');
  for (const m of html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)) urls.set(m[1], 'css');
  for (const m of html.matchAll(/<link[^>]*href="([^"]+)"[^>]*rel="stylesheet"/g)) urls.set(m[1], 'css');
  for (const m of html.matchAll(/<link[^>]*rel="preload"[^>]*as="font"[^>]*href="([^"]+)"/g)) urls.set(m[1], 'font');
  for (const m of html.matchAll(/<link[^>]*href="([^"]+)"[^>]*as="font"/g)) urls.set(m[1], 'font');
  for (const m of html.matchAll(/<link[^>]*rel="preload"[^>]*as="script"[^>]*href="([^"]+)"/g)) urls.set(m[1], 'script');
  const rows = [];
  for (const [url, kind] of urls) {
    const f = fileFor(url);
    if (!existsSync(f)) { rows.push({ url, kind, raw: 0, gz: 0, missing: true }); continue; }
    const buf = readFileSync(f);
    rows.push({ url, kind, raw: buf.length, gz: gzipSync(buf).length });
  }
  const inlineHtml = Buffer.byteLength(html);
  const sum = k => rows.filter(r => r.kind === k).reduce((a, r) => ({ raw: a.raw + r.raw, gz: a.gz + r.gz, n: a.n + 1 }), { raw: 0, gz: 0, n: 0 });
  const s = sum('script'), c = sum('css'), f = sum('font');
  log(`HTML ${kb(inlineHtml)} KB raw (${kb(gzipSync(Buffer.from(html)).length)} KB gzip, includes the inlined data)`);
  log(`scripts: ${s.n} files, ${kb(s.raw)} KB raw / ${kb(s.gz)} KB gzip`);
  log(`stylesheets: ${c.n} files, ${kb(c.raw)} KB raw / ${kb(c.gz)} KB gzip (render-blocking)`);
  log(`preloaded fonts: ${f.n} files, ${kb(f.raw)} KB`);
  log(`TOTAL over the wire (gzip, fonts raw): ${kb(s.gz + c.gz + f.raw + gzipSync(Buffer.from(html)).length)} KB`);
  const mm = moduleMap(route);
  log(mm ? '
client modules per chunk (from the client-reference manifest, up to 10 each):' : `
(no client-reference manifest found for ${route})`);
  if (mm) for (const r of rows.filter(r => r.kind === 'script').sort((a, b) => b.gz - a.gz).slice(0, 10)) { const mods = mm.get(path.basename(r.url)); if (mods) log(`- ${path.basename(r.url)} (${kb(r.gz)} KB gzip): ${[...mods].slice(0, 10).join(', ')}`); }
  log('| file | kind | raw KB | gzip KB | recognised content |');
  log('|---|---|---:|---:|---|');
  for (const r of rows.sort((a, b) => b.gz - a.gz).slice(0, 14)) log(`| ${path.basename(r.url)}${r.missing ? ' (missing)' : ''} | ${r.kind} | ${kb(r.raw)} | ${kb(r.gz)} | ${r.kind === 'script' && !r.missing ? recognise(readFileSync(fileFor(r.url), 'utf8')) : ''} |`);
}
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## First-load weight (built HTML)\n```\n' + out.join('\n') + '\n```\n');
