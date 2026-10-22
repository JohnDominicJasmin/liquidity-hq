/* #1632 item 1 (#1644): can a signed-in user write telegram_chat_id straight to the database? As seeded Free account B (real session), with the anon
 * key and B's token, through PostgREST - the way a browser could. Run BEFORE migration 20261021e (expect the write to LAND: proof the test can fail)
 * and AFTER it (expect 42501 permission denied).
 *   1. read B's row (telegram_chat_id, display_name) - recorded
 *   2. PATCH B's own row {telegram_chat_id: "qa-probe-1640"}; read it back
 *   3. restore the recorded value at once if it changed; read it back (must equal the recording)
 *   4. control: PATCH B's own row {display_name: <its own recorded value>} (an allowlisted column; value unchanged)
 *   5. PATCH ANOTHER user's row (A) {telegram_chat_id: "qa-probe-1640"} as B: must touch 0 rows (RLS)
 *   6. INSERT a row for B carrying telegram_chat_id (on conflict ignored): must not change B's value
 * Never prints a token or an email. usage: node probe-1632.mjs <before|after> */
import { session, REF, anonKey, userId } from './rlib.mjs';
import { appendFileSync } from 'node:fs';
import { ROOT } from './rlib.mjs';
const phase = process.argv[2] || 'before';
const T = 'lhq_dev_user_settings';
const s = await session('B'); const B = userId('B'); const A = userId('A');
const H = { apikey: anonKey(), Authorization: `Bearer ${s.access_token}`, 'content-type': 'application/json', Prefer: 'return=representation' };
const url = (q) => `https://${REF}.supabase.co/rest/v1/${T}?${q}`;
const call = async (method, q, body) => { const r = await fetch(url(q), { method, headers: H, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { status: r.status, rows: Array.isArray(j) ? j.length : null, code: j?.code ?? null, message: j?.message ? String(j.message).slice(0, 120) : null, body: j }; };
const readB = async () => { const r = await call('GET', `select=telegram_chat_id,display_name&user_id=eq.${B}`); return r.body?.[0] ?? null; };
const out = { phase, at: new Date().toISOString() };
const before = await readB(); out.recorded = { telegram_chat_id: before?.telegram_chat_id ?? null, display_name_set: before?.display_name != null };
const p = await call('PATCH', `user_id=eq.${B}`, { telegram_chat_id: 'qa-probe-1640' });
out.patchOwnChatId = { status: p.status, rows: p.rows, code: p.code, message: p.message };
const after = await readB(); out.valueAfterPatch = after?.telegram_chat_id ?? null; out.WRITE_LANDED = out.valueAfterPatch === 'qa-probe-1640';
if (out.WRITE_LANDED) { const r = await call('PATCH', `user_id=eq.${B}`, { telegram_chat_id: before?.telegram_chat_id ?? '' }); out.restore = { status: r.status, rows: r.rows }; }
out.valueAfterRestore = (await readB())?.telegram_chat_id ?? null; out.restoredToRecording = out.valueAfterRestore === (before?.telegram_chat_id ?? null) || (out.valueAfterRestore === '' && !before?.telegram_chat_id);
const c = await call('PATCH', `user_id=eq.${B}`, { display_name: before?.display_name ?? null });
out.controlAllowlistedColumn = { status: c.status, rows: c.rows, code: c.code };
const o = await call('PATCH', `user_id=eq.${A}`, { telegram_chat_id: 'qa-probe-1640' });
out.patchOtherUsersRow = { status: o.status, rows: o.rows, code: o.code };
const i = await fetch(url('on_conflict=user_id'), { method: 'POST', headers: { ...H, Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ user_id: B, telegram_chat_id: 'qa-probe-1640' }) });
out.insertWithChatId = { status: i.status };
out.valueAtEnd = (await readB())?.telegram_chat_id ?? null; out.endsAsRecorded = out.valueAtEnd === (before?.telegram_chat_id ?? null) || (out.valueAtEnd === '' && !before?.telegram_chat_id);
console.log(JSON.stringify(out, null, 1));
appendFileSync(`${ROOT}/_sweep/probe-1632.jsonl`, JSON.stringify(out) + '\n');
