const { execFileSync } = require('child_process');
const fs = require('fs');
const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const T = '__tests__/proBuyable.test.mts';
const M = [
  { name: 'B1 isProBuyable asks the Lemon Squeezy link', f: 'lib/checkout.ts', from: '  return isCryptoCheckoutConfigured(env);\n}', to: '  return isCheckoutConfigured(env);\n}', red: ['P1.', 'P2.', 'E1.', 'E2.'] },
  { name: 'B2 any BoomFi plan link makes Pro buyable', f: 'lib/checkout.ts', from: '  return isCryptoCheckoutConfigured(env);\n}', to: '  return isCryptoCheckoutConfigured(env) || isCryptoCheckoutConfiguredAnnual(env);\n}', red: ['P1.', 'E3.'] },
  { name: 'B3 the email always promises a purchase', f: 'lib/email.ts', from: 'const checkoutLive = isProBuyable();', to: 'const checkoutLive = true;', red: ['E2.', 'E3.', 'S2.'] },
  { name: 'B4 the email never offers Keep Pro', f: 'lib/email.ts', from: 'const checkoutLive = isProBuyable();', to: 'const checkoutLive = false;', red: ['E1.', 'E3.'] },
  { name: 'B5 the email reads the Lemon Squeezy variable directly', f: 'lib/email.ts', from: 'const checkoutLive = isProBuyable();', to: 'const checkoutLive = Boolean(process.env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL);', red: ['E1.', 'E2.', 'S2.', 'S3.'] },
  { name: 'B6 the email links a payment page', f: 'lib/email.ts', from: 'Keep Pro: <a href="${upgradeUrl}">${upgradeUrl}</a>', to: 'Keep Pro: <a href="https://pay.boomfi.xyz/x">${upgradeUrl}</a>', red: ['E1.', 'E4.'] },
  { name: 'B7 the prompt hands out the Lemon Squeezy link when it is set', f: 'components/UpgradeGateModal.tsx', from: "  return user ? '/upgrade' : '/login?signup=1&next=/upgrade';", to: "  return process.env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL || (user ? '/upgrade' : '/login?signup=1&next=/upgrade');", red: ['S1.', 'S3.'] },
  { name: 'B8 one of the two prompts stops using the shared link', f: 'components/UpgradeGateModal.tsx', from: 'const ctaHref = useUpgradeHref();', to: "const ctaHref = '/login?signup=1';", first: true, red: ['S1.'] },
  { name: 'B9 /api/version reports proBuyable from the Lemon Squeezy link', f: 'lib/configured.ts', from: 'proBuyable:                isProBuyable(env),', to: 'proBuyable:                isCheckoutConfigured(env),', red: ['P2.'] },
  { name: 'B10 /upgrade stops asking isProBuyable', f: 'app/upgrade/page.tsx', from: 'const CHECKOUT_CONFIGURED = isProBuyable();', to: 'const CHECKOUT_CONFIGURED = isCryptoCheckoutConfiguredAnnual();', red: ['S2.'] },
  { name: 'B11 another file starts reading the Lemon Squeezy link', f: 'app/upgrade/page.tsx', from: 'const CHECKOUT_CONFIGURED = isProBuyable();', to: 'const CHECKOUT_CONFIGURED = isProBuyable();\nconst LEGACY = process.env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL;', red: ['S3.'] },
];
const files = [...new Set(M.map(m => m.f))];
const revert = () => execFileSync('git', ['-C', ROOT, 'checkout', '--', ...files]);
const run = () => { let out = ''; let code = 0; try { out = execFileSync('node', ['--import', './qa/alias-register.mjs', '--test', T], { cwd: ROOT, encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { out = (e.stdout || '') + (e.stderr || ''); code = e.status || 1; }
  return { code, failed: [...new Set([...out.matchAll(/^\s*\u2716 (\S+)/gm)].map(x => x[1]))].filter(k => /^[A-Z]\d+[a-z]?\.$/.test(k)) }; };
revert(); const b = run(); console.log('BASELINE exit', b.code, b.failed.join(',') || '(none red)'); if (b.code) process.exit(2);
let ok = 0;
for (const m of M) {
  const src = fs.readFileSync(`${ROOT}/${m.f}`, 'utf8').split('\r\n').join('\n');
  const n = src.split(m.from).length - 1;
  if (m.first ? n < 1 : n !== 1) { console.log('SKIP ', m.name, 'anchor x' + n); continue; }
  const at = src.indexOf(m.from);
  fs.writeFileSync(`${ROOT}/${m.f}`, src.slice(0, at) + m.to + src.slice(at + m.from.length));
  const r = run(); revert();
  const missing = m.red.filter(k => !r.failed.includes(k));
  const good = r.code !== 0 && missing.length === 0; if (good) ok++;
  console.log(good ? 'OK   ' : 'WRONG', m.name, '| want', m.red.join(','), '| red:', r.failed.join(',') || '(none)', missing.length ? '| NOT CAUGHT: ' + missing.join(',') : '');
}
revert(); console.log(`${ok}/${M.length}`, execFileSync('git', ['-C', ROOT, 'status', '--short', '--', ...files], { encoding: 'utf8' }) || 'sources clean');
