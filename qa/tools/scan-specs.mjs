import { readdirSync, readFileSync } from 'node:fs';
const dir = 'qa/e2e/';
const files = readdirSync(dir).filter(f => f.endsWith('.spec.ts')).sort();
const rows = [];
for (const f of files) {
  const s = readFileSync(dir + f, 'utf8');
  // strip comments so prose mentioning PATCH/POST does not count
  const code = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const auth = /signedInContext|gotoSignedIn|AUTH_READY|FIXTURES\.|signIn\(/.test(code);
  const dbfix = /FIXTURES\.(tradeId|hypothesisId|priceAlertId|bPriceAlertId|cEmail)|ENTITLEMENT_READY|ACCOUNT_C_READY/.test(code);
  const writeCalls = [];
  if (/method:\s*['"](PATCH|POST|PUT|DELETE)['"]/.test(code)) writeCalls.push('fetch-write');
  if (/\.(post|put|patch|delete)\(/.test(code.replace(/\.delete\(\)/g, '').replace(/Map|Set|localStorage/g, ''))) writeCalls.push('request-write');
  const seam = /__LHQ_QA_/.test(code) ? 'dev-only seam' : '';
  const billed = /BILLED_CALLS_READY|E2E_ALLOW_BILLED_CALLS/.test(code) ? 'billed AI' : '';
  const save = /(click\(\)[^;]*){0}getByRole\('button',\s*\{\s*name:\s*\/?(save|delete|add|create|send|submit|remove|connect)/i.test(code) ? 'clicks a mutating control?' : '';
  rows.push({ f, auth, dbfix, writeCalls: writeCalls.join('+'), seam, billed, save });
}
const cat = r => (r.seam || r.billed) ? 'X-devonly' : r.writeCalls ? 'W-writes' : r.auth ? (r.dbfix ? 'A2-auth-fixture' : 'A-auth-readonly?') : 'R-anonymous';
const groups = {};
for (const r of rows) (groups[cat(r)] ??= []).push(r);
for (const k of Object.keys(groups).sort()) {
  console.log(`\n### ${k}  (${groups[k].length})`);
  for (const r of groups[k]) console.log(`${r.f}${r.writeCalls ? '  [' + r.writeCalls + ']' : ''}${r.seam ? '  [' + r.seam + ']' : ''}${r.billed ? '  [' + r.billed + ']' : ''}${r.save ? '  [' + r.save + ']' : ''}`);
}
console.log(`\ntotal ${rows.length}`);
