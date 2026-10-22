import { readFileSync, writeFileSync } from 'node:fs';
const p = 'qa/platform-audit.mjs';
let s = readFileSync(p, 'utf8');
const eol = s.includes('\r\n') ? '\r\n' : '\n';
s = s.replace(/\r\n/g, '\n');
const from = "const DESIGNS = arg('--design', 'terminal').split(',');\n";
if (s.split(from).length !== 2) throw new Error('marker');
s = s.replace(from, () => from +
"/* #1111 removed the `?design=current` switch, so there is only one design and this flag can\n" +
"   only ever mean terminal. `--design current` used to select the old design; it would now\n" +
"   measure terminal and label the rows `current`, so it is refused rather than allowed to\n" +
"   produce a mislabelled number. */\n" +
"if (DESIGNS.some(d => d !== 'terminal')) {\n" +
"  console.error(`platform-audit: --design ${DESIGNS.join(',')} is not available: the current design was removed (#1111), only terminal exists.`);\n" +
"  process.exit(2);\n" +
"}\n");
writeFileSync(p, s.replace(/\n/g, eol));
console.log('ok');
