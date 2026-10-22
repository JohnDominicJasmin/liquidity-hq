// Summarise qa/crossbrowser-report.json: every annotation per page x project, then which values DIFFER across engines.
const fs = require('fs');
const rep = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const rows = [];
const walk = (s) => {
  for (const sp of s.specs ?? []) for (const t of sp.tests ?? []) for (const r of t.results ?? []) {
    rows.push({ title: sp.title, project: t.projectName, status: r.status, ann: [...(t.annotations ?? []), ...(r.annotations ?? [])] });
  }
  for (const c of s.suites ?? []) walk(c);
};
for (const s of rep.suites) walk(s);
console.log('results:', rows.length, 'statuses:', JSON.stringify(rows.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {})));
const types = [...new Set(rows.flatMap((r) => r.ann.map((a) => a.type)))];
console.log('annotation types:', types.join(', '));
const pages = [...new Set(rows.map((r) => r.title))];
for (const type of types) {
  const differing = [];
  for (const p of pages) {
    const vals = rows.filter((r) => r.title === p).map((r) => [r.project, (r.ann.find((a) => a.type === type) || {}).description ?? '(none)']);
    const distinct = new Set(vals.map((v) => v[1]));
    if (distinct.size > 1) differing.push({ page: p, vals });
  }
  console.log(`\n== ${type}: ${differing.length ? differing.length + ' page(s) differ across projects' : 'same on every project for every page'}`);
  for (const d of differing) {
    console.log(`  ${d.page}`);
    for (const [proj, v] of d.vals) console.log(`    ${proj.padEnd(14)} ${String(v).slice(0, 170)}`);
  }
  if (!differing.length) { const ex = rows[0].ann.find((a) => a.type === type); console.log('  e.g.', rows[0].project, rows[0].title, '=>', String(ex?.description ?? '').slice(0, 170)); }
}
