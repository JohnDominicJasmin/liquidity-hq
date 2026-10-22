/* Put an account's settings back from the CRUD baseline file WITHOUT a browser (for when memory will not allow one): the app's own PATCH /api/settings,
 * with knownAsOf = the server's current per-field timestamps so each write is accepted, only for columns that differ from the saved row and that the
 * route allows. Theme and analytics consent are per-device (localStorage / consent), not in the row, so they need nothing here.
 * usage: node restore-settings-http.mjs A[,B,T]   -> marks the baseline file restored only when no allowed column differs any more             */
import { session, BASE, REF, anonKey, ROOT } from './rlib.mjs';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
const ALLOWED = ['account_size', 'risk_pct', 'default_coin', 'default_tf', 'fr_threshold', 'fng_fear', 'fng_greed', 'rsi_ob', 'rsi_os', 'squeeze_threshold', 'anti_chop_enabled',
  'beginner_mode', 'trading_experience', 'trading_style', 'how_heard', 'watchlist', 'display_name', 'country', 'trading_challenge', 'language', 'timezone', 'strategy_selection', 'strategy_params'];
const LOG = `${ROOT}/_sweep/crud.jsonl`;
const say = (o) => { console.log(JSON.stringify(o)); appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n'); };
for (const acct of (process.argv[2] || 'A').split(',')) {
  const f = `${ROOT}/_sweep/crud-settings-before-${acct}.json`;
  if (!existsSync(f)) { say({ acct, part: 'restore-http', step: 'no baseline file' }); continue; }
  const saved = JSON.parse(readFileSync(f, 'utf8'));
  /* FORCE=1: compare the DB row even when the UI restore marked the file restored - the UI cannot always reach the stored value (B and T keep
     default_tf 15m, which their Settings page does not offer, so the UI restore wrote 4h / 1h on 2026-10-21) */
  if (saved.restoredAt && process.env.FORCE !== '1') { say({ acct, part: 'restore-http', step: `already restored at ${saved.restoredAt}` }); continue; }
  const s = await session(acct); const uid = s.user.id;
  const readRow = async () => (await (await fetch(`https://${REF}.supabase.co/rest/v1/lhq_dev_user_settings?select=*&user_id=eq.${uid}`, { headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}` } })).json())[0] ?? {};
  const before = await readRow(); const want = saved.row ?? {};
  const differs = (row) => ALLOWED.filter((k) => JSON.stringify(row[k] ?? null) !== JSON.stringify(want[k] ?? null));
  const diff = differs(before);
  if (!diff.length) { writeFileSync(f, JSON.stringify({ ...saved, restoredAt: new Date().toISOString(), restoredBy: 'http (nothing differed)' }, null, 1)); say({ acct, part: 'restore-http', step: 'nothing differed', marked: true }); continue; }
  const body = { knownAsOf: Object.fromEntries(diff.map((k) => [k, before.field_updated_at?.[k]]).filter(([, v]) => typeof v === 'string')) };
  for (const k of diff) body[k] = want[k] ?? null;
  const r = await fetch(`${BASE}/api/settings`, { method: 'PATCH', headers: { Authorization: `Bearer ${s.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  const after = await readRow(); const left = differs(after);
  say({ acct, part: 'restore-http', status: r.status, accepted: j?.accepted ?? null, rejected: j?.rejected ?? null, changedBefore: diff.map((k) => `${k}: ${JSON.stringify(before[k])} -> ${JSON.stringify(want[k])}`), stillDifferent: left });
  if (!left.length) writeFileSync(f, JSON.stringify({ ...saved, restoredAt: new Date().toISOString(), restoredBy: 'http' }, null, 1));
}
