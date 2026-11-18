/* ARENA PAGE HEADER IS ONE ROW (PR #2565, owner visual 2026-11-18): the title and the "How this page works" link only. The "LIVE · web + X" badge and the subtitle are gone, and so are their two label rows (migration 20261119n, applied AFTER the deploy).
 * Source pins, no browser (the 37/40 px heights are a browser measurement and are NOT proven here):
 *   H1  the header block shows the title and the hint link, in that order, in ONE nowrap flex row; the title never shrinks, the link may
 *   H2  the old badge and subtitle are not rendered anywhere in the page, and the header row carries no second line (no marginBottom, no subtitle div)
 *   H3  the hint link keeps its accessible name (the visible label text; the "?" is aria-hidden), a 24 px minimum height (WCAG 2.5.8) and is a real button with aria-expanded
 *   H4  .arena-subtitle is gone from globals.css
 *   H5  migration 20261119n: exactly two statements, each a delete scoped by table AND a where on the two keys, one per project, PROD first
 *   H6  no app/component/lib/api source reads either deleted key (only the registry and the English default may still carry them)
 *   H7  CONTROLS: each pin fires on a planted old header */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const PAGE = stripComments(read('app/(main)/arena/page.tsx'));
const HINT = stripComments(read('components/PageHint.tsx'));
const CSS = read('app/globals.css');
const KEYS = ['ARENA_LIVE_BADGE', 'ARENA_PAGE_SUBTITLE'];

/** the header block of a page source: from the wrap div to the hint box that follows it */
function headerBlock(src: string): string {
  const a = src.indexOf('<div className="arena-term-wrap">');
  const b = src.indexOf('{arenaHintOpen && <PageHintBox');
  assert.ok(a > 0 && b > a, `header anchors moved (wrap at ${a}, hint box at ${b}): re-read the page`);
  return src.slice(a, b);
}
const hintLinkSrc = (src: string) => { const a = src.indexOf('export function PageHintLink'); const b = src.indexOf('export function PageHintBox'); assert.ok(a > 0 && b > a, 'PageHintLink anchors moved'); return src.slice(a, b); };

function checkHeader(src: string, hint: string): string[] {
  const p: string[] = [], h = headerBlock(src);
  const iTitle = h.indexOf("t('ARENA_PAGE_TITLE')"), iLink = h.indexOf('<PageHintLink pageKey="arena"');
  if (!(iTitle >= 0 && iLink > iTitle)) p.push('H1: title then hint link not found in order');
  if ((h.match(/display: 'flex'/g) || []).length !== 1 || !/flexWrap: 'nowrap'/.test(h)) p.push('H1: header is not exactly one nowrap flex row');
  const titleDiv = /<div style=\{\{[^}]*\}\}>\{t\('ARENA_PAGE_TITLE'\)\}<\/div>/.exec(h);
  if (!titleDiv || !/whiteSpace: 'nowrap'/.test(titleDiv[0]) || !/flexShrink: 0/.test(titleDiv[0])) p.push('H1: the title may shrink or wrap');
  if (/ARENA_LIVE_BADGE|ARENA_PAGE_SUBTITLE|arena-subtitle/.test(src)) p.push('H2: the old badge or subtitle is still rendered');
  if (/marginBottom/.test(h)) p.push('H2: the header row still carries a bottom margin (a second line)');
  if ((h.match(/<div/g) || []).length !== 4) p.push(`H2: expected 4 divs (wrap, padding, row, title); found ${(h.match(/<div/g) || []).length}`);
  const l = hintLinkSrc(hint);
  if (!/<button\s+type="button"/.test(l) || !/aria-expanded=\{open\}/.test(l)) p.push('H3: hint link is not a button with aria-expanded');
  if (!/PAGE_HINT_REPLAY_LABEL/.test(l) || !/<span aria-hidden="true">\?<\/span>/.test(l)) p.push('H3: hint link loses its text name or its "?" is not aria-hidden');
  const mh = /minHeight: (\d+)/.exec(l); if (!mh || Number(mh[1]) < 24) p.push('H3: hint link min height below 24 px');
  return p;
}

test('H1-H3. the header is one nowrap row: title, then the hint link; no badge, no subtitle; the link is a named, 24 px button', () => {
  assert.deepEqual(checkHeader(PAGE, HINT), []);
});

test('H4. the .arena-subtitle rule is gone from globals.css', () => {
  assert.equal(/\.arena-subtitle/.test(CSS), false);
});

test('H5. migration 20261119n: two deletes, each scoped by table and by a where on exactly the two keys; PROD block before DEV', () => {
  const sql = read('supabase/migrations/20261119n_remove_arena_header_badge_subtitle_rows.sql');
  const code = sql.replace(/--[^\n]*/g, '').trim();
  const stmts = code.split(';').map((s) => s.trim()).filter(Boolean);
  assert.equal(stmts.length, 2, `expected 2 statements, found ${stmts.length}`);
  const want = (t: string) => new RegExp(`^delete from ${t} where key in \\('ARENA_LIVE_BADGE', 'ARENA_PAGE_SUBTITLE'\\)$`);
  assert.match(stmts[0], want('lhq_labels'));
  assert.match(stmts[1], want('lhq_dev_labels'));
  assert.ok(sql.indexOf('===== PROD') < sql.indexOf('===== DEV'), 'PROD block must come first');
  assert.ok(sql.indexOf('delete from lhq_labels') < sql.indexOf('===== DEV'), 'the PROD delete sits in the DEV block');
});

function walk(dir: URL, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === '.next') continue;
    const u = new URL(n + (statSync(new URL(n, dir)).isDirectory() ? '/' : ''), dir);
    if (u.pathname.endsWith('/')) walk(u, out); else if (/\.(ts|tsx|mts)$/.test(n)) out.push(decodeURIComponent(u.pathname));
  }
  return out;
}

test('H6. no source reads a key the migration deletes (the registry labelKeys.ts is the only code file that may name them)', () => {
  const files = ['app', 'components', 'lib'].flatMap((d) => walk(new URL(`../${d}/`, import.meta.url))).filter((f) => !/lib\/labelKeys\.ts$/.test(f));
  assert.ok(files.length > 100, `only ${files.length} source files found: the walk is wrong`);
  const hits = files.filter((f) => KEYS.some((k) => readFileSync(f.replace(/^\/([A-Za-z]:)/, '$1'), 'utf8').includes(k)));
  assert.deepEqual(hits, []);
  assert.ok(read('lib/labelKeys.ts').includes("'ARENA_LIVE_BADGE'"), 'registry no longer carries the key: the M4 guard for held 20261118f now fails');
});

test('H7. CONTROLS: every pin fires on a planted old header', () => {
  const oldPage = PAGE
    .replace("<div className=\"arena-term-wrap\">", "<div className=\"arena-term-wrap\">")
    .replace("{arenaHintOpen && <PageHintBox", "<span>{t('ARENA_LIVE_BADGE')}</span><div className=\"arena-subtitle\">{t('ARENA_PAGE_SUBTITLE')}</div>{arenaHintOpen && <PageHintBox");
  assert.ok(checkHeader(oldPage, HINT).some((x) => x.startsWith('H2')), 'H2 did not catch the badge/subtitle');
  const wrapped = PAGE.replace("flexWrap: 'nowrap'", "flexWrap: 'wrap'");
  assert.ok(checkHeader(wrapped, HINT).some((x) => x.startsWith('H1')), 'H1 did not catch a wrapping row');
  const shrinkTitle = PAGE.replace("whiteSpace: 'nowrap', flexShrink: 0 }}>{t('ARENA_PAGE_TITLE')}", "}}>{t('ARENA_PAGE_TITLE')}");
  assert.ok(checkHeader(shrinkTitle, HINT).some((x) => x.startsWith('H1')), 'H1 did not catch a shrinkable title');
  assert.ok(checkHeader(PAGE, HINT.split('minHeight: 24').join('minHeight: 16')).some((x) => x.startsWith('H3')), 'H3 did not catch a small target');
  assert.ok(checkHeader(PAGE, HINT.replace('<span aria-hidden="true">?</span>', '<span>?</span>')).some((x) => x.startsWith('H3')), 'H3 did not catch an unhidden "?"');
});
