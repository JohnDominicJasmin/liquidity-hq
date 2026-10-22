const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const TEST = '__tests__/cryptoCheckout.test.mts';
const F = 'app/upgrade/page.tsx';
const M = [
  { id: 'M1 listener never removed', from: "return () => window.removeEventListener('keydown', onKey);", to: 'return () => {};', expect: ['U5d'] },
  { id: 'M2 Escape also while redirecting', from: 'if (!selectedPlan || isRedirecting) return;\n    const onKey', to: 'if (!selectedPlan) return;\n    const onKey', expect: ['U5d'] },
  { id: 'M3 X clickable while redirecting', from: 'onClick={closePanel}\n        disabled={isRedirecting}', to: 'onClick={closePanel}', expect: ['U5b'] },
  { id: 'M4 X starts a payment', from: 'onClick={closePanel}', to: 'onClick={payWithCrypto}', expect: ['U5b'] },
  { id: 'M5 focus not returned', from: 'if (opener?.isConnected) opener.focus();', to: '', expect: ['U5c'] },
  { id: 'M6 opener not recorded', from: 'if (document.activeElement instanceof HTMLElement) panelOpener.current = document.activeElement;', to: '', expect: ['U5c'] },
  { id: 'M7 Cancel anytime back', from: "const TRUST_LABELS = ['UPGRADE_TRUST_SECURE_CHECKOUT'] as const;", to: "const TRUST_LABELS = ['UPGRADE_TRUST_CANCEL_ANYTIME', 'UPGRADE_TRUST_SECURE_CHECKOUT'] as const;", expect: ['U9'] },
  { id: 'M8 badge can wrap again', from: "padding: '2px 7px', whiteSpace: 'nowrap' };", to: "padding: '2px 7px' };", expect: ['U5e'] },
  { id: 'M9 a second payment button', from: '<button\n          data-testid="checkout-method-crypto"', to: '<button data-testid="checkout-method-card" onClick={payWithCrypto}>card</button>\n        <button\n          data-testid="checkout-method-crypto"', expect: ['U5'] },
  { id: 'M10 X has no accessible name', from: "aria-label={t('UPGRADE_METHOD_PANEL_CLOSE_ARIA')}", to: '', expect: ['U5b'] },
];
const run = () => {
  const r = spawnSync(process.execPath, ['--import', './qa/alias-register.mjs', '--test', TEST], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  return [...new Set([...((r.stdout || '') + (r.stderr || '')).matchAll(/^✖ ([A-Z]\d+[a-z]?)\./gm)].map((m) => m[1]))].sort();
};
console.log('baseline failed:', JSON.stringify(run()));
let killed = 0;
const p = path.join(ROOT, F);
for (const m of M) {
  const orig = fs.readFileSync(p, 'utf8');
  try {
    const crlf = orig.includes('\r\n');
    const from = crlf ? m.from.replace(/\n/g, '\r\n') : m.from;
    const to = crlf ? m.to.replace(/\n/g, '\r\n') : m.to;
    if (!orig.includes(from)) { console.log(m.id, '=> NOT APPLIED'); continue; }
    fs.writeFileSync(p, orig.replace(from, to));
    const f = run();
    const ok = m.expect.every((e) => f.includes(e));
    if (ok) killed++;
    console.log(m.id, '=>', ok ? 'KILLED' : 'SURVIVED', JSON.stringify(f));
  } finally { execFileSync('git', ['checkout', '--', F], { cwd: ROOT }); }
}
console.log(`killed ${killed} of ${M.length}`);
console.log('tree after:', execFileSync('git', ['status', '--short'], { cwd: ROOT, encoding: 'utf8' }).trim());
