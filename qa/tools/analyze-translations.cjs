/* Reads translations-layout.mjs output for one build and splits the visible Latin-only text per case into:
 *  - label English: the string is an English label value (bundled EN of that build, or served EN) -> key(s), and
 *    whether that locale's served label for the key is translated (so: app shows English although a translation
 *    exists) or not (the table has no translation);
 *  - other English: no label matches (hard-coded copy, or data such as tickers/headlines) - listed for review.
 * usage: node analyze-translations.cjs <dir> <bundledEn.json> <servedEnPrefix>   (prefix: labels-  or labels-prod-) */
const fs = require('fs'); const path = require('path');
const [dir, bundledPath, prefix] = process.argv.slice(2);
const SP = __dirname;
const m = JSON.parse(fs.readFileSync(path.join(dir, 'measure.json'), 'utf8'));
const bundled = JSON.parse(fs.readFileSync(bundledPath, 'utf8'));
const servedEn = JSON.parse(fs.readFileSync(path.join(SP, `${prefix}${prefix === 'labels-' ? 'qa-' : ''}en.json`), 'utf8'));
const loc = {}; for (const l of ['ko', 'zh', 'ar', 'ru']) loc[l] = JSON.parse(fs.readFileSync(path.join(SP, `${prefix}${l}.json`), 'utf8'));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const byVal = new Map();
for (const src of [bundled, servedEn]) for (const [k, v] of Object.entries(src)) { const n = norm(v); if (n.length < 3 || !/[A-Za-z]{3,}/.test(n)) continue; if (!byVal.has(n)) byVal.set(n, new Set()); byVal.get(n).add(k); }
/* data-ish Latin that is not UI copy */
const DATA = /^(?:[A-Z0-9.$%+\-\/ ·,:]{1,14}|qa-synthetic@example\.invalid|LIQUIDITYHQ|LiquidityHQ|Grok|Auto|FREE|PRO|VWAP|RSI.*|EMA.*|SMA.*|MACD|ATR|CVD|OBV|GEX|LIQ|S\/R|[A-Z]{2,6}USDT?|\d.*)$/;
const summary = [];
for (const r of m.slice(1)) {
  if (!r.texts) { summary.push({ case: `${r.width} ${r.page} ${r.askedLang}`, error: r.error }); continue; }
  const lang = r.askedLang;
  const latin = r.texts.filter((t) => t.k === 'latin'); const native = r.texts.filter((t) => t.k === 'native');
  const latinChars = latin.reduce((a, t) => a + (t.t.match(/[A-Za-z]/g) || []).length, 0);
  const nativeChars = native.reduce((a, t) => a + t.t.replace(/[\s\d\p{P}\p{S}A-Za-z]/gu, '').length, 0);
  const labelEn = new Map(); const other = new Map();
  for (const t of latin) {
    const n = norm(t.t); const keys = byVal.get(n);
    if (keys) {
      const ks = [...keys]; const translated = ks.some((k) => loc[lang][k] && norm(loc[lang][k]) !== n);
      labelEn.set(n, { keys: ks.slice(0, 3), translatedInTable: translated });
    } else if (!DATA.test(n)) other.set(n, (other.get(n) || 0) + 1);
  }
  summary.push({ case: `${r.width} ${r.page} ${lang}`, shot: r.shot, status: r.status, htmlLang: r.lang, dir: r.dir, scrollWidth: r.scrollWidth, viewport: r.width, sideways: r.scrollWidth > r.width, nodes: { latin: latin.length, native: native.length }, englishShareOfNodes: +(latin.length / Math.max(1, latin.length + native.length)).toFixed(2), chars: { latin: latinChars, native: nativeChars }, clipped: r.clipped, labelEnglish: [...labelEn].map(([s, v]) => ({ s: s.slice(0, 70), ...v })), otherEnglish: [...other.keys()].map((s) => s.slice(0, 70)) });
}
fs.writeFileSync(path.join(dir, 'analysis.json'), JSON.stringify(summary, null, 1));
for (const s of summary) {
  if (s.error) { console.log(s.case, 'ERROR', s.error); continue; }
  const tr = s.labelEnglish.filter((x) => x.translatedInTable), un = s.labelEnglish.filter((x) => !x.translatedInTable);
  console.log(`\n# ${s.case} [${s.status} lang=${s.htmlLang} dir=${s.dir}] sw=${s.scrollWidth}/${s.viewport}${s.sideways ? ' SIDEWAYS' : ''} EN-share(nodes)=${s.englishShareOfNodes} chars latin/native=${s.chars.latin}/${s.chars.native} clipped=${s.clipped.length}`);
  if (tr.length) console.log('  label EN although translation exists:', tr.map((x) => `${x.keys.join('|')}="${x.s}"`).join(' ; '));
  if (un.length) console.log('  label EN, no translation in table:', un.map((x) => `${x.keys.join('|')}="${x.s}"`).join(' ; '));
  if (s.otherEnglish.length) console.log('  other EN:', s.otherEnglish.slice(0, 25).join(' ; '));
  for (const c of s.clipped) console.log(`  CLIP ${c.el} "${c.text}" sw${c.sw}/cw${c.cw} sh${c.sh}/ch${c.ch} h=${c.h} v=${c.v} ell=${c.ellipsis} @${c.x},${c.y}`);
}
