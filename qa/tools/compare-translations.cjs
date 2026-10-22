/* Compares analysis.json of B (qa) against A (prod) per case: English share, English strings only on B (new),
 * English strings only on A (translated on B), clipped elements only on B, sideways scroll on each.
 * usage: node compare-translations.cjs <dirA> <dirB>                                                         */
const fs = require('fs'); const path = require('path');
const [dA, dB] = process.argv.slice(2);
const A = new Map(JSON.parse(fs.readFileSync(path.join(dA, 'analysis.json'), 'utf8')).map((s) => [s.case, s]));
const B = JSON.parse(fs.readFileSync(path.join(dB, 'analysis.json'), 'utf8'));
const en = (s) => new Set([...(s.labelEnglish || []).map((x) => x.s), ...(s.otherEnglish || [])]);
const clipKey = (c) => `${c.el}|${c.text.slice(0, 25)}`;
const rows = [];
for (const b of B) {
  const a = A.get(b.case);
  if (!a || b.error || a.error) { console.log(`# ${b.case} missing/error A=${a?.error ?? !!a} B=${b.error ?? ''}`); continue; }
  const eA = en(a), eB = en(b);
  const onlyB = [...eB].filter((s) => !eA.has(s)), onlyA = [...eA].filter((s) => !eB.has(s));
  const cA = new Set(a.clipped.map(clipKey)); const cB = new Set(b.clipped.map(clipKey));
  const clipOnlyB = b.clipped.filter((c) => !cA.has(clipKey(c)));
  const clipBoth = b.clipped.filter((c) => cA.has(clipKey(c)));
  rows.push({ case: b.case, shotB: b.shot, enShareA: a.englishShareOfNodes, enShareB: b.englishShareOfNodes, swA: a.scrollWidth, swB: b.scrollWidth, vp: b.viewport, clipBoth: clipBoth.length, clipOnlyB, onlyB, onlyA: onlyA.length, keptEnglishB: eB.size });
  console.log(`\n# ${b.case} [B ${b.status} lang=${b.htmlLang}] EN-share A ${a.englishShareOfNodes} -> B ${b.englishShareOfNodes}; sw A ${a.scrollWidth} B ${b.scrollWidth} (vp ${b.viewport}); clipped A ${a.clipped.length} B ${b.clipped.length} (same ${clipBoth.length}); EN strings A ${eA.size} B ${eB.size}; translated-on-B ${onlyA.length}`);
  if (onlyB.length) console.log('  English only on B:', onlyB.slice(0, 20).join(' ; '));
  for (const c of clipOnlyB) console.log(`  CLIP only on B: ${c.el} "${c.text}" sw${c.sw}/cw${c.cw} sh${c.sh}/ch${c.ch} ell=${c.ellipsis}`);
}
fs.writeFileSync(path.join(dB, 'compare-vs-A.json'), JSON.stringify(rows, null, 1));
