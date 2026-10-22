/* Evidence sweep for the release candidate: for each merged PR in staging..qa, what does the record show?
 * This finds QA EVIDENCE, it does not decide. "no QA comment found" is a lead to test, never a verdict of
 * "not tested": the account is shared with Dev, so authorship is useless and the only signal is a
 * "- QA Team" signature in a comment on the PR or on an issue it closes. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const SP = process.argv[2];
const nums = readFileSync(`${SP}/range-prs.txt`, 'utf8').split(/\s+/).filter(Boolean).map(Number);
const gh = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true }));
const SIG = /(?:—|--?)\s*QA Team\b/i;
const out = [];
for (const n of nums) {
  let pr;
  try { pr = gh(['pr', 'view', String(n), '--json', 'number,title,body,closingIssuesReferences,files,comments,mergedAt,labels']); }
  catch (e) { out.push({ n, error: String(e.message).slice(0, 120) }); continue; }
  const files = (pr.files ?? []).map((f) => f.path);
  const app = files.filter((p) => /^(app|components|lib|middleware|instrumentation|next\.config|public)/.test(p) && !/\.test\./.test(p));
  const mig = files.filter((p) => p.startsWith('supabase/migrations'));
  const testsOnly = files.length > 0 && files.every((p) => /^(__tests__|qa|e2e|tests|docs|\.github|\.githooks|scripts)\b|\.md$|playwright\.config/.test(p));
  const refs = new Set((pr.closingIssuesReferences ?? []).map((r) => r.number));
  for (const m of (pr.body ?? '').matchAll(/(?:fix(?:es)?|close[sd]?|resolve[sd]?|refs?|for|see)\s+#(\d+)/gi)) refs.add(Number(m[1]));
  for (const m of ((pr.title ?? '') + ' ' + (pr.body ?? '')).matchAll(/#([0-9]{3,4})/g)) refs.add(Number(m[1]));
  refs.delete(n);
  const evidence = [];
  const scan = (comments, where) => { for (const c of comments ?? []) if (SIG.test(c.body ?? '')) evidence.push({ where, url: c.url, at: c.createdAt?.slice(0, 16), strong: /\b(verified|PASS(ED)?|passed|measured|confirmed|observed|reproduced|tested)\b/i.test(c.body), head: (c.body ?? '').replace(/\s+/g, ' ').slice(0, 110) }); };
  scan(pr.comments, `PR #${n}`);
  for (const r of [...refs].slice(0, 10)) {
    try { const is = gh(['issue', 'view', String(r), '--json', 'comments,title']); scan(is.comments, `#${r}`); } catch { /* not an issue, or no access */ }
  }
  out.push({
    n, title: pr.title, mergedAt: pr.mergedAt?.slice(0, 10), files: files.length, app: app.length, mig: mig.length, testsOnly,
    howToTest: /how to test/i.test(pr.body ?? ''), refs: [...refs], evidence,
  });
}
writeFileSync(`${SP}/checklist-range.json`, JSON.stringify(out, null, 1));
console.log('done', out.length);
