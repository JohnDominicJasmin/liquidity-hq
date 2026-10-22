// Writes two throwaway control specs next to the real ones. Each must FAIL against qa.
const fs = require('fs');
const path = require('path');
const E2E = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq/qa/e2e';
const norm = (s) => s.replace(/\r\n/g, '\n');

let a = norm(fs.readFileSync(path.join(E2E, 'checkout-config-agrees.spec.ts'), 'utf8'));
const a1 = "return { era: 'proBuyable (#1468+)', monthly: c.proBuyable,";
if (!a.includes(a1)) throw new Error('control 1 anchor missing');
fs.writeFileSync(path.join(E2E, 'zz-control-config.spec.ts'), a.replace(a1, "return { era: 'proBuyable (#1468+)', monthly: !c.proBuyable,"));

let b = norm(fs.readFileSync(path.join(E2E, 'checkout.spec.ts'), 'utf8'));
const b1 = '    const page = await ctx.newPage();\n\n    const leftTheApp';
if (!b.includes(b1)) throw new Error('control 2 anchor missing');
const inject = `    const page = await ctx.newPage();
    // CONTROL: a synthetic SIGNED-IN session. The click must now open the payment panel, not signup - so the test must fail.
    const UID = '00000000-0000-4000-8000-00000000fa4e';
    const session = JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'x', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
    await ctx.addInitScript((v) => { localStorage.setItem('sb-wdtjhrilakoitfcezxpx-auth-token', v); }, session);
    await ctx.route('**/auth/v1/token*', (r) => r.abort());
    await ctx.route('**/rest/v1/**', (r) => r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(/user_subscriptions/.test(r.request().url()) ? [{ user_id: UID, role: 'free', trial_ends_at: null }] : /user_onboarding/.test(r.request().url()) ? [{ user_id: UID, tour_seen: true, profile_complete: true }] : []) })
      : r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await ctx.route('**/api/**', (r) => r.request().method() === 'GET' ? r.fallback() : r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

    const leftTheApp`;
b = b.replace(b1, inject).replace("test.describe('checkout hand-off, signed out'", "test.describe('CONTROL signed-in session'");
fs.writeFileSync(path.join(E2E, 'zz-control-signedout.spec.ts'), b);
console.log('controls written');
