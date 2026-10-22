/* Wait for /api/version on qa to report WANT, then diff the `configured` block against the pre-deploy snapshot
 * and probe the webhook's two 401s. Prints on flip or on timeout; a probe failure prints too. */
import { readFileSync, writeFileSync } from 'node:fs';
const [, , WANT, BEFORE, AFTER] = process.argv;
const URL_ = 'https://liquidity-hq-staging.onrender.com/api/version';
const t0 = Date.now();
const stamp = () => new Date().toISOString().slice(11, 19) + 'Z';
let last = '';
for (;;) {
  let j = null, err = null;
  try { const r = await fetch(URL_, { cache: 'no-store', signal: AbortSignal.timeout(30_000) }); j = await r.json(); }
  catch (e) { err = e?.name ?? 'err'; }
  const cur = j ? String(j.commit).slice(0, 7) : `UNREACHABLE(${err})`;
  if (cur !== last) { console.log(`[${stamp()}] version -> ${cur}`); last = cur; }
  if (j && String(j.commit).startsWith(WANT)) {
    writeFileSync(AFTER, JSON.stringify(j, null, 2));
    console.log(`[${stamp()}] FLIPPED after ${Math.round((Date.now() - t0) / 1000)} s: commit ${j.commit} branch ${j.branch} appEnv ${j.appEnv}`);
    break;
  }
  if (Date.now() - t0 > 12 * 60_000) { console.log(`[${stamp()}] TIMEOUT: still ${last} after 12 min`); process.exit(3); }
  await new Promise((r) => setTimeout(r, 10_000));
}
const b = JSON.parse(readFileSync(BEFORE, 'utf8')), a = JSON.parse(readFileSync(AFTER, 'utf8'));
const bc = b.configured ?? {}, ac = a.configured ?? {};
const keys = [...new Set([...Object.keys(bc), ...Object.keys(ac)])].sort();
const changed = keys.filter((k) => JSON.stringify(bc[k]) !== JSON.stringify(ac[k]));
console.log(`BEFORE commit ${String(b.commit).slice(0, 7)} | AFTER commit ${String(a.commit).slice(0, 7)} | keys before/after: ${Object.keys(bc).length} / ${Object.keys(ac).length}`);
console.log(`CHANGED (${changed.length}): ${changed.length ? changed.map((k) => `${k}: ${JSON.stringify(bc[k])} -> ${JSON.stringify(ac[k])}`).join('; ') : 'none'}`);
const flags = Object.entries(ac).filter(([, v]) => typeof v === 'boolean');
console.log(`boolean flags after: ${flags.map(([k, v]) => `${k}=${v}`).join(', ')}`);
const hook = 'https://liquidity-hq-staging.onrender.com/api/lemonsqueezy/webhook';
for (const [label, headers] of [['unsigned', {}], ['bogus sig', { 'x-signature': 'deadbeef' }]]) {
  try { const r = await fetch(hook, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(30_000) }); console.log(`webhook ${label} -> ${r.status}`); }
  catch (e) { console.log(`webhook ${label} -> PROBE FAILED (${e?.name})`); }
}
