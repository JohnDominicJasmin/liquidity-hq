const { execFileSync } = require('child_process');
const fs = require('fs');
const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const M = [
  { t: '__tests__/cryptoCheckout.test.mts', name: 'F1 Instant access is back in the trust row', f: 'app/upgrade/page.tsx',
    from: "const TRUST_LABELS = ['UPGRADE_TRUST_CANCEL_ANYTIME', 'UPGRADE_TRUST_SECURE_CHECKOUT'] as const;",
    to: "const TRUST_LABELS = ['UPGRADE_TRUST_CANCEL_ANYTIME', 'UPGRADE_TRUST_INSTANT_ACCESS', 'UPGRADE_TRUST_SECURE_CHECKOUT'] as const;", red: 'U9.' },
  { t: '__tests__/cryptoCheckout.test.mts', name: 'F2 one state renders its own inline list with Instant access', f: 'app/upgrade/page.tsx', nth: 2,
    from: '{TRUST_LABELS.map(label => (', to: "{(['UPGRADE_TRUST_CANCEL_ANYTIME', 'UPGRADE_TRUST_INSTANT_ACCESS'] as const).map(label => (", red: 'U9.' },
  { t: '__tests__/boomfiWebhookRoute.test.mts', name: 'F3 the spaces-only org id is reported as set again', f: 'app/api/boomfi/webhook/route.ts',
    from: "ORG_ID.trim() ? 'set' : 'UNSET'", to: "ORG_ID ? 'set' : 'UNSET'", red: 'R9c.' },
  { t: '__tests__/boomfiWebhookRoute.test.mts', name: 'F4 a missing database client is answered 500 without a report', f: 'app/api/boomfi/webhook/route.ts',
    from: "  } catch (e) {\n    return apiError('boomfi/webhook', e);\n  }", to: "  } catch {\n    return NextResponse.json({ error: 'x' }, { status: 500 });\n  }", red: 'R12.' },
  { t: '__tests__/boomfiWebhookRoute.test.mts', name: 'F5 a missing database client is acknowledged', f: 'app/api/boomfi/webhook/route.ts',
    from: "  } catch (e) {\n    return apiError('boomfi/webhook', e);\n  }", to: "  } catch {\n    return NextResponse.json({ received: true });\n  }", red: 'R12.' },
];
const files = [...new Set(M.map(m => m.f))];
const revert = () => execFileSync('git', ['-C', ROOT, 'checkout', '--', ...files]);
const run = (t) => { let out = ''; let code = 0; try { out = execFileSync('node', ['--import', './qa/alias-register.mjs', '--test', t], { cwd: ROOT, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { out = (e.stdout || '') + (e.stderr || ''); code = e.status || 1; }
  return { code, failed: [...new Set([...out.matchAll(/^\s*\u2716 (\S+)/gm)].map(x => x[1]))].filter(k => /^[A-Z]\d+[a-z]?\.$/.test(k)) }; };
revert(); let ok = 0;
for (const m of M) {
  const src = fs.readFileSync(`${ROOT}/${m.f}`, 'utf8').split('\r\n').join('\n');
  const n = src.split(m.from).length - 1; const need = m.nth || 1;
  if (m.nth ? n < need : n !== 1) { console.log('SKIP', m.name, 'anchor x' + n); continue; }
  let at = -1; for (let i = 0; i < need; i++) at = src.indexOf(m.from, at + 1);
  fs.writeFileSync(`${ROOT}/${m.f}`, src.slice(0, at) + m.to + src.slice(at + m.from.length));
  const r = run(m.t); revert();
  const good = r.code !== 0 && r.failed.includes(m.red); if (good) ok++;
  console.log(good ? 'OK   ' : 'WRONG', m.name, '| want', m.red, '| red:', r.failed.join(', ') || '(none)');
}
revert(); console.log(`${ok}/${M.length}`, execFileSync('git', ['-C', ROOT, 'status', '--short', '--', ...files], { encoding: 'utf8' }) || 'sources clean');
