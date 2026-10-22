/* Reads the #1640 sweep results and prints, per page, what each account x width showed: the automatic checks only (fence blocks and refused writes
 * are never counted). Photos are judged separately (contact sheets). usage: node summarize.mjs [md|json] */
import { readFileSync } from 'node:fs';
import { ROOT, slug } from './rlib.mjs';
import { PAGES } from './pages.mjs';
const mode = process.argv[2] || 'md';
const last = new Map(); for (const l of readFileSync(`${ROOT}/_sweep/results.jsonl`, 'utf8').split('\n').filter(Boolean)) { const j = JSON.parse(l); last.set(j.key, j); }
const rows = [...last.values()]; // the LAST row per key: a re-run replaces a row that ended in an error
const FENCE = /BLOCKED_BY_CLIENT|ACCESS_DENIED/;
const out = {};
for (const r of rows) {
  const d = r.dark || {}; const l = r.light || {}; const f = [];
  if (r.error) f.push({ sev: 'FAIL', what: `did not load: ${r.error.slice(0, 90)}` });
  if (r.status && r.status >= 400) f.push({ sev: 'FAIL', what: `document HTTP ${r.status}` });
  if (d.boundary) f.push({ sev: 'FAIL', what: `error page: "${d.boundary}"` });
  const sw = Math.max(d.scrollWidth || 0, l.scrollWidth || 0); if (sw > r.w + 1) f.push({ sev: 'FAIL', what: `sideways scroll: ${sw}px at ${r.w}` });
  for (const e of r.pageErr || []) f.push({ sev: 'FAIL', what: `page error: ${e.slice(0, 120)}` });
  for (const h of r.httpErr || []) f.push({ sev: h.s >= 500 ? 'FAIL' : 'WARN', what: `HTTP ${h.s} ${h.m} ${h.u.replace(/\?.*$/, '')}` });
  for (const x of r.failed || []) f.push({ sev: 'FAIL', what: `request failed ${x.e} ${x.u.replace(/\?.*$/, '')}` });
  for (const c of (r.consoleErr || []).filter((c) => !FENCE.test(c.t) && !/status of \d{3}/.test(c.t))) f.push({ sev: 'WARN', what: `console: ${c.t.slice(0, 120)}` });
  for (const c of d.fabCovers || []) f.push({ sev: 'WARN', what: `Ask AI button covers "${c.label}" (${c.pct}%)` });
  for (const a of d.deadAnchors || []) f.push({ sev: 'WARN', what: `link with no href: "${a}"` });
  (out[r.page] ??= []).push({ acct: r.acct, w: r.w, final: r.finalUrl, loadMs: r.loadMs, quietMs: r.quietMs, findings: f });
}
if (mode === 'json') { console.log(JSON.stringify(out, null, 1)); process.exit(0); }
const ACC = ['anon', 'B', 'T', 'A'];
for (const p of PAGES) {
  const list = out[p] || []; if (!list.length) { console.log(`| ${p} | not run yet | | |`); continue; }
  const done = ACC.map((a) => `${a}:${list.filter((x) => x.acct === a).length}/2`).join(' ');
  const fails = new Map(); for (const x of list) for (const f of x.findings) { const k = `${f.sev} ${f.what}`; const v = fails.get(k) || []; v.push(`${x.acct}@${x.w}`); fails.set(k, v); }
  const verdict = [...fails.keys()].some((k) => k.startsWith('FAIL')) ? 'FAIL' : [...fails.keys()].length ? 'pass, with notes' : 'pass';
  const redirects = [...new Set(list.filter((x) => x.final && x.final.split('?')[0] !== p.split('?')[0]).map((x) => `${x.acct}→${x.final.split('?')[0]}`))];
  console.log(`| ${p} (\`${slug(p)}\\\`) | ${done} | **${verdict}** | ${[...fails.entries()].map(([k, v]) => `${k} [${v.join(', ')}]`).join('<br>') || '-'}${redirects.length ? `<br>redirects: ${redirects.join(', ')}` : ''} |`);
}
