/* #1644 after 20261021e (Dev's ask): normal own-row writes must still succeed and the new limits must refuse what they should. Test accounts only;
 * every row created here is deleted again and checked gone.
 *   1. B inserts a journal trade through PostgREST (the browser's own path, TradeJournal) -> must succeed; then deletes it -> gone
 *   2. B inserts a trade whose note is 2,001 characters -> must be refused (23514, the NOT VALID length check applies to new rows)
 *   3. A creates a price alert through qa's /api/price-alerts -> must succeed; then deletes it through the same route -> gone
 *   4. A inserts a price alert with a 201-character label straight through PostgREST -> must be refused (23514)
 * Tokens and emails are never printed. usage: node probe-1644-inserts.mjs */
import { session, REF, anonKey, userId, ROOT } from './rlib.mjs';
import { appendFileSync } from 'node:fs';
const BASE = 'https://liquidity-hq-qa.onrender.com';
const rest = async (acct, method, table, query, body, prefer = 'return=representation') => {
  const s = await session(acct);
  const r = await fetch(`https://${REF}.supabase.co/rest/v1/${table}?${query}`, { method, headers: { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'content-type': 'application/json', Prefer: prefer }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { status: r.status, code: j?.code ?? null, message: j?.message ? String(j.message).slice(0, 140) : null, rows: Array.isArray(j) ? j : null };
};
const out = { at: new Date().toISOString() };
const B = userId('B'); const tag = `qa-ddl-after-probe ${out.at.slice(11, 19)}`;
const trade = { user_id: B, coin: 'BTC', direction: 'long', setup_type: 'Other', entry_price: 100, stop_loss: 90, notes: tag };
const ins = await rest('B', 'POST', 'lhq_dev_trades', 'select=id', trade);
out.tradeInsert = { status: ins.status, code: ins.code, message: ins.message };
const tid = ins.rows?.[0]?.id ?? null;
if (tid) { const del = await rest('B', 'DELETE', 'lhq_dev_trades', `id=eq.${tid}&user_id=eq.${B}`, null); out.tradeDelete = { status: del.status }; const chk = await rest('B', 'GET', 'lhq_dev_trades', `select=id&id=eq.${tid}`); out.tradeGone = Array.isArray(chk.rows) && chk.rows.length === 0; }
const long = await rest('B', 'POST', 'lhq_dev_trades', 'select=id', { ...trade, notes: 'x'.repeat(2001) });
out.tradeNote2001 = { status: long.status, code: long.code, message: long.message, REFUSED: long.status >= 400 };
if (long.rows?.[0]?.id) { await rest('B', 'DELETE', 'lhq_dev_trades', `id=eq.${long.rows[0].id}&user_id=eq.${B}`, null); out.tradeNote2001.cleanedUp = true; }
const sA = await session('A');
const pa = await fetch(`${BASE}/api/price-alerts`, { method: 'POST', headers: { Authorization: `Bearer ${sA.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ coin: 'btc', target_price: '9999999', direction: 'above', label: tag }) });
const paj = await pa.json().catch(() => ({})); out.alertCreate = { status: pa.status, error: paj.error ?? null };
const aid = paj?.alert?.id ?? null;
if (aid) { const d = await fetch(`${BASE}/api/price-alerts?id=${aid}`, { method: 'DELETE', headers: { Authorization: `Bearer ${sA.access_token}` } }); out.alertDelete = { status: d.status }; const chk = await rest('A', 'GET', 'lhq_dev_price_alerts', `select=id,active&id=eq.${aid}`); out.alertAfterDelete = chk.rows; }
const lbl = await rest('A', 'POST', 'lhq_dev_price_alerts', 'select=id', { user_id: userId('A'), coin: 'btc', target_price: 9999999, direction: 'above', label: 'y'.repeat(201) });
out.alertLabel201 = { status: lbl.status, code: lbl.code, message: lbl.message, REFUSED: lbl.status >= 400 };
if (lbl.rows?.[0]?.id) { await rest('A', 'DELETE', 'lhq_dev_price_alerts', `id=eq.${lbl.rows[0].id}`, null); out.alertLabel201.cleanedUp = true; }
console.log(JSON.stringify(out, null, 1));
appendFileSync(`${ROOT}/_sweep/probe-1644-inserts.jsonl`, JSON.stringify(out) + '\n');
