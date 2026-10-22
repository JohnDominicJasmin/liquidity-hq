import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
const root = process.argv[2];
const files = [];
const walk = (d) => { for (const e of readdirSync(path.join(root, d), { withFileTypes: true })) { const r = `${d}/${e.name}`; if (e.isDirectory()) walk(r); else if (/\.(tsx?|mjs|js)$/.test(e.name)) files.push(r); } };
for (const d of ['app', 'components', 'lib']) walk(d);
const t0 = Date.now();
const printer = ts.createPrinter({ removeComments: true });
let chars = 0;
for (const f of files) {
  const src = readFileSync(path.join(root, f), 'utf8');
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, false, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = printer.printFile(sf);
  chars += out.length;
  if (/useDesignMode/.test(out)) console.log('STILL', f);
}
console.log(files.length, 'files', Date.now() - t0, 'ms', chars);
