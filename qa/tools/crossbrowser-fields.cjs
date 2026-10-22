// Per field of the "surface" annotation: which pages differ across engines, and how. Chromium is the control column.
const fs = require('fs');
const rep = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const rows = [];
const walk = (s) => {
  for (const sp of s.specs ?? []) for (const t of sp.tests ?? []) for (const r of t.results ?? []) {
    const a = [...(t.annotations ?? []), ...(r.annotations ?? [])].find((x) => x.type === 'surface');
    rows.push({ page: sp.title.replace(' renders and runs', ''), project: t.projectName, s: a ? JSON.parse(a.description) : {} });
  }
  for (const c of s.suites ?? []) walk(c);
};
for (const s of rep.suites) walk(s);
const fields = [...new Set(rows.flatMap((r) => Object.keys(r.s)))].filter((f) => !['engine', 'url'].includes(f));
console.log('fields:', fields.join(', '));
const norm = (f, v) => {
  if (f === 'consoleErrors') return JSON.stringify((v || []).map((e) => e.replace(/\d+/g, 'N').slice(0, 90)).sort());
  if (f === 'overflowing') return String((v || []).length) + ' elements';
  return JSON.stringify(v);
};
const pages = [...new Set(rows.map((r) => r.page))];
for (const f of fields) {
  // compare by width: 1440 projects together, 390 together
  const diffs = [];
  for (const p of pages) for (const w of ['1440', '390']) {
    const cells = rows.filter((r) => r.page === p && r.project.endsWith('-' + w)).map((r) => [r.project.split('-')[0], norm(f, r.s[f])]);
    if (new Set(cells.map((c) => c[1])).size > 1) diffs.push({ p, w, cells });
  }
  console.log(`\n== ${f}: ${diffs.length ? diffs.length + ' page-width pairs differ by engine' : 'same across engines everywhere'}`);
  for (const d of diffs.slice(0, 14)) console.log(`  ${d.p} @${d.w}: ` + d.cells.map(([e, v]) => `${e}=${v.slice(0, 150)}`).join(' | '));
  if (!diffs.length) console.log('  sample:', rows[0].page, rows[0].project, norm(f, rows[0].s[f]).slice(0, 200));
}
