const fs = require('fs');
const f = '__tests__/cancelSubscription.test.mts';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(f, 'utf8').split(CR + LF).join(LF);
let tail = fs.readFileSync(process.argv[2], 'utf8');
tail = tail.split("test('PV").join("pv('PV").split('test(`PV').join('pv(`PV');
const helper = [
  "type PvFn = (t: TestContext) => Promise<void> | void;",
  "/* Runs, is expected to FAIL today (the leak), and turns green when the logs stop printing the object.",
  "   Flip `PII_PENDING` to false the day the fix lands; it must then pass as ordinary tests. */",
  "const PII_PENDING: string | false = 'finding on #1435: the success and failure logs print the customer\'s data; the allow-list fix is pending';",
  "const pv = (name: string, fn: PvFn) => (PII_PENDING ? test(name, { todo: PII_PENDING }, fn) : test(name, fn));",
  "",
].join(LF);
const marker = "const PII = {";
if (tail.split(marker).length !== 2) throw new Error('marker');
tail = tail.replace(marker, helper + marker);
const imp = "import test from 'node:test';";
if (s.split(imp).length !== 2) throw new Error('import anchor');
s = s.replace(imp, "import test, { type TestContext } from 'node:test';");
fs.writeFileSync(f, s + tail);
console.log('applied');
