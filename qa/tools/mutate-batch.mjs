// usage: node mutate-batch.mjs <repoRoot> <mutations.json>
// mutations.json: [{ "id": "M1", "file": "lib/x.ts", "from": "...", "to": "...", "test": "__tests__/y.test.mts", "pattern": "^P1", "expect": "red" }]
// Each mutation must occur exactly once. The file's original bytes are restored after every run, whatever happens.
// "expect": "red" means at least one test in the filtered run must fail; "green" means none may (an equivalence control).
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const [root, listPath] = process.argv.slice(2);
const list = JSON.parse(readFileSync(listPath, 'utf8'));
let ok = 0;
for (const m of list) {
  const file = join(root, m.file);
  const orig = readFileSync(file);
  let text = orig.toString('utf8');
  const edits = m.edits ?? [{ from: m.from, to: m.to }];
  const missing = edits.map((e) => [e, text.split(e.from).length - 1]).filter(([, n]) => n !== 1);
  if (missing.length) { console.log(`${m.id}: NOT APPLIED - ${missing.map(([e, n]) => `"${e.from.slice(0, 50)}" occurs ${n} times`).join('; ')} in ${m.file}`); continue; }
  for (const e of edits) text = text.replace(e.from, () => e.to); // a function: "$'" or "$&" in e.to is literal, not a replace pattern
  let verdict = 'ERROR', detail = '';
  try {
    writeFileSync(file, text);
    const args = ['--import', './qa/alias-register.mjs', '--test', ...(m.pattern ? [`--test-name-pattern=${m.pattern}`] : []), m.test];
    const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 180_000 });
    const out = (r.stdout ?? '') + (r.stderr ?? '');
    const pass = Number(/ℹ pass (\d+)/.exec(out)?.[1] ?? NaN), fail = Number(/ℹ fail (\d+)/.exec(out)?.[1] ?? NaN);
    const red = fail > 0;
    verdict = (m.expect === 'green' ? !red && pass > 0 : red) ? 'AS EXPECTED' : 'UNEXPECTED';
    detail = `pass ${pass} fail ${fail}` + (red ? ` | ${(/AssertionError[^\n]*/.exec(out)?.[0] ?? /✖ ([^\n]*)/.exec(out)?.[1] ?? '').slice(0, 150)}` : '');
  } finally {
    writeFileSync(file, orig);
    if (!readFileSync(file).equals(orig)) detail += ' | RESTORE FAILED';
  }
  if (verdict === 'AS EXPECTED') ok++;
  console.log(`${m.id} [${m.expect}] ${verdict}: ${m.file} -> ${m.test} | ${detail}`);
}
console.log(`${ok}/${list.length} as expected`);
