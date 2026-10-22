/* #1644 step 2 (M9) on qa's dev database, HTTP only: the 50-active price-alert cap, live, on the seeded trial account T.
 *   1. count T's active alerts; insert just enough of OUR OWN alerts (label "qa-1644-m9 <stamp> #n", BTC above 9,999,999, so they can never fire) to reach 50;
 *   2. a direct REST insert of the 51st must be refused with P0001 (hint LHQ_ALERT_CAP);
 *   3. the app route POST /api/price-alerts must answer 400 ALERT_LIMIT with its message;
 *   4. deleting one of ours lets one more in; then the 51st is refused again;
 *   5. cleanup: every row this run inserted is DELETED by id (own-row delete is allowed by the price_alerts_own policy), and T's active count must be
 *      back to what it was. Rows that were T's before the run are never touched.
 * usage: node probe-1644-m9.mjs                                                                                                                      */
import { session, BASE, REF, anonKey } from './rlib.mjs';
import { appendFileSync, mkdirSync } from 'node:fs';
const ROOT = 'C:/Users/Dominic/Documents/LiquidityHQ-QA-regression-2026-10-21'; mkdirSync(`${ROOT}/_sweep`, { recursive: true });
const LOG = `${ROOT}/_sweep/probe-1644-m9.jsonl`;
const SB = `https://${REF}.supabase.co/rest/v1/lhq_dev_price_alerts`;
const s = await session('T'); const uid = s.user.id;
const H = { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'content-type': 'application/json' };
const stamp = new Date().toISOString();
const out = { at: stamp, acct: 'T', build: (await (await fetch(BASE + '/api/version')).json()).commit, steps: [] };
const step = (o) => { out.steps.push(o); console.log(JSON.stringify(o).slice(0, 300)); };
const activeCount = async () => { const r = await fetch(`${SB}?select=id&user_id=eq.${uid}&active=eq.true`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } }); return Number((r.headers.get('content-range') || '*/-1').split('/')[1]); };
const row = (n) => ({ user_id: uid, coin: 'btc', target_price: 9999999, direction: 'above', label: `qa-1644-m9 ${stamp} #${n}`, active: true });
const insert = async (rows) => { const r = await fetch(SB, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(rows) }); let j = null; try { j = await r.json(); } catch { /* */ } return { status: r.status, j }; };
const ours = [];
let before = null;
try {
  before = await activeCount(); step({ step: 'active before', count: before });
  if (!(before >= 0)) throw new Error('could not count T\'s active alerts');
  const need = Math.max(0, 50 - before);
  if (need > 0) { const r = await insert(Array.from({ length: need }, (_, i) => row(i + 1))); step({ step: `insert ${need} to reach 50`, status: r.status, inserted: Array.isArray(r.j) ? r.j.length : 0, code: r.j?.code ?? null }); if (Array.isArray(r.j)) ours.push(...r.j.map((x) => x.id)); }
  step({ step: 'active at the cap', count: await activeCount() });
  const r51 = await insert([row(51)]);
  if (Array.isArray(r51.j)) ours.push(...r51.j.map((x) => x.id));
  step({ step: 'REST insert of the 51st', status: r51.status, code: r51.j?.code ?? null, hint: r51.j?.hint ?? null, message: (r51.j?.message ?? '').slice(0, 90), REFUSED: r51.status >= 400 && r51.j?.code === 'P0001' });
  const rr = await fetch(`${BASE}/api/price-alerts`, { method: 'POST', headers: { Authorization: `Bearer ${s.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ coin: 'btc', target_price: '9999999', direction: 'above', label: `qa-1644-m9 ${stamp} route` }) });
  let rj = null; try { rj = await rr.json(); } catch { /* */ }
  if (rj?.alert?.id) ours.push(rj.alert.id); if (rj?.id) ours.push(rj.id);
  step({ step: 'route POST /api/price-alerts at the cap', status: rr.status, error: rj?.error ?? null, message: (rj?.message ?? '').slice(0, 120) });
  if (ours.length) {
    const one = ours.shift();
    const d = await fetch(`${SB}?id=eq.${one}&user_id=eq.${uid}`, { method: 'DELETE', headers: H }); step({ step: 'delete one of ours', status: d.status });
    const again = await insert([row(52)]); if (Array.isArray(again.j)) ours.push(...again.j.map((x) => x.id));
    step({ step: 'insert after deleting one', status: again.status, ok: again.status === 201 });
    const over = await insert([row(53)]); if (Array.isArray(over.j)) ours.push(...over.j.map((x) => x.id));
    step({ step: 'insert past the cap again', status: over.status, code: over.j?.code ?? null, REFUSED: over.status >= 400 && over.j?.code === 'P0001' });
  }
} finally {
  /* by this run's stamped label, not only by the ids we saw: that also takes a row the route might have inserted by mistake */
  const mine = `label=like.${encodeURIComponent(`qa-1644-m9 ${stamp}*`)}`;
  const d = await fetch(`${SB}?user_id=eq.${uid}&${mine}`, { method: 'DELETE', headers: { ...H, Prefer: 'return=representation' } }); let dj = []; try { dj = await d.json(); } catch { /* */ }
  step({ step: 'cleanup: delete this run\'s rows', status: d.status, idsSeen: ours.length, deleted: Array.isArray(dj) ? dj.length : null });
  const left = await (await fetch(`${SB}?select=id&user_id=eq.${uid}&label=like.${encodeURIComponent('qa-1644-m9*')}`, { headers: H })).json();
  const after = await activeCount();
  step({ step: 'after cleanup', activeAfter: after, activeBefore: before, restored: after === before, oursLeft: Array.isArray(left) ? left.length : null });
  appendFileSync(LOG, JSON.stringify(out) + '\n');
}
