const fs = require('fs');
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
// 1. the test comment: say what is true
let f = '__tests__/aliasHookScope.test.mts';
let s = fs.readFileSync(f, 'utf8'); const crlf = s.includes(CR + LF); s = s.split(CR + LF).join(LF);
const a = s.indexOf("test('the rescue touches ONLY .json");
const b = s.indexOf("assert.match(importBare(path.join(ROOT, 'lib', 'paidPeriod.ts'), true)");
if (a < 0 || b < a) throw new Error('block');
const head = "test('an ordinary TypeScript module still imports through the hook (sanity control for the rescue)', () => {" + LF +
  "  /* NOT a bound: widening the rescue to every repo file is invisible under Node 24 (measured: a json attribute on a .ts" + LF +
  "     import is tolerated), so no test can tell. The bound that matters, node_modules, is the test above. This only" + LF +
  "     proves the rescue did not break normal imports. */" + LF + "  ";
s = s.slice(0, a) + head + s.slice(b);
if (crlf) s = s.split(LF).join(CR + LF); fs.writeFileSync(f, s);
// 2. drop the equivalent mutant from the script
f = process.argv[2]; s = fs.readFileSync(f, 'utf8');
const i = s.indexOf("  { name: 'H3");
const j = s.indexOf(LF, i);
if (i < 0) throw new Error('H3 line'); s = s.slice(0, i) + s.slice(j + 1); fs.writeFileSync(f, s);
console.log('fixed');
