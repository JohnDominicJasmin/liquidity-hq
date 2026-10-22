/* Undo a mute the CRUD alerts step left behind (it flipped "Breaking News" and could not flip it back): reads the account's mutes through the app's
 * own GET /api/alert-prefs, and if the key is muted, unmutes it with POST /api/alert-prefs { key, muted: false }. usage: node restore-mute-http.mjs A news */
import { session, BASE, ROOT } from './rlib.mjs';
import { appendFileSync } from 'node:fs';
const [, , acct = 'A', key = 'news'] = process.argv;
const s = await session(acct); const H = { Authorization: `Bearer ${s.access_token}`, 'content-type': 'application/json' };
const read = async () => { const r = await fetch(`${BASE}/api/alert-prefs`, { headers: H }); const j = await r.json().catch(() => null); return { status: r.status, j }; };
const before = await read();
const keysOf = (j) => (Array.isArray(j?.muted) ? j.muted : Array.isArray(j?.keys) ? j.keys : Array.isArray(j) ? j.map((x) => x.key ?? x) : null);
const was = keysOf(before.j);
let post = null;
if (was?.includes(key)) { const r = await fetch(`${BASE}/api/alert-prefs`, { method: 'POST', headers: H, body: JSON.stringify({ key, muted: false }) }); post = { status: r.status, body: await r.json().catch(() => null) }; }
const after = await read();
const row = { at: new Date().toISOString(), acct, part: 'restore-mute-http', key, getStatus: before.status, mutedBefore: was, unmute: post, mutedAfter: keysOf(after.j), rawShape: was ? null : JSON.stringify(before.j).slice(0, 200) };
console.log(JSON.stringify(row)); appendFileSync(`${ROOT}/_sweep/crud.jsonl`, JSON.stringify(row) + '\n');
