import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, installControlsWorld } from '../telegramControlsWorld.mjs';
import { loadRoute } from '../telegramWorld.mjs';

/* QA's cells for #2567 (the "your plan ended, alerts are paused" message), the REAL /api/telegram/alert route in-process with a fake network and database; nothing leaves the machine.
 *   L1  a Pro that lapses gets ONE plain message in its linked chat: said once, not once per cron run (4 runs, one message); the mark is stored in the database (user_settings.telegram_lapse_notified_at)
 *   L2  the mark survives a restart (a brand-new route module, the same database) and is not cleared by the cron when the account is Pro again; a NEW lapse later gets its own one message
 *   L3  who is NOT told: never-Pro Free, lapsed more than 7 days ago, still inside the 48 h grace, Pro with no period end (lifetime), a trial still running, no linked chat (and nothing is claimed for them)
 *   L4  a trial that ended says "Pro trial"; a paid plan says "Pro plan"
 *   L5  the text: plain, English, one short message (40 words or fewer), says alerts are paused and how to turn them back on (the upgrade link), no AI vendor name, no NaN/undefined
 *   L6  /ops pause (feature flag telegram off): nothing sent AND nothing claimed, so the message still goes once when sends resume
 *   L7  a failed send (Telegram refuses) is claimed and NOT retried: documented, pinned so a change shows
 *   L8  two overlapping runs: one message (the claim is conditional)
 *   L9  the message goes out even when the run itself has no recipients (every other user held / none)
 * WHAT IT CANNOT PROVE: a real Telegram delivery, the real database's conditional update, or what a serverless host would do with the run's un-awaited send. */
type Row = Record<string, unknown>;
const NOW = Date.now(); const DAY = 86_400_000; const iso = (ms: number) => new Date(ms).toISOString();
const PRO_OK = { role: 'pro', trial_ends_at: null, current_period_end: iso(NOW + 30 * DAY) };
const lapsedPro = (daysAgo: number) => ({ role: 'pro', trial_ends_at: null, current_period_end: iso(NOW - daysAgo * DAY) });   // lapse = period end + 48 h
const lapsedTrial = (daysAgo: number) => ({ role: 'free', trial_ends_at: iso(NOW - daysAgo * DAY), current_period_end: null });
const settle = () => new Promise((r) => setTimeout(r, 400));   // the send is not awaited by the run
async function scenario(users: Array<{ id: string; chat: string | null; sub: Row; notified?: string | null; paused?: boolean }>, o: { flagOff?: boolean } = {}) {
  const w = makeWorld({ tables: {
    lhq_price_alerts: [], lhq_muted_alerts: [], lhq_user_subscriptions: users.map((u) => ({ user_id: u.id, ...u.sub })),
    lhq_user_settings: users.map((u) => ({ user_id: u.id, telegram_chat_id: u.chat, timezone: 'UTC', alert_paused: u.paused ?? null, telegram_lapse_notified_at: u.notified ?? null })),
    lhq_app_config: o.flagOff ? [{ key: 'feature_flags', value: { telegram: false } }] : [],
  } }) as ReturnType<typeof makeWorld>;
  installControlsWorld(w); let route = await loadRoute();
  return { w, run: async () => { const r = await route.run(); await settle(); return r; }, restart: async () => { route = await loadRoute(); }, row: (id: string) => (w.tables.lhq_user_settings as Row[]).find((r) => r.user_id === id)! };
}
const HOLD = { id: 'u-hold', chat: '9001', sub: PRO_OK, paused: true };       // a Pro user that is held: keeps the run quiet and fast
const msgs = (w: ReturnType<typeof makeWorld>, chat: string) => w.telegram.sent.filter((m: { chat_id: string }) => m.chat_id === chat).map((m: { text: string }) => m.text);

test('L1. a lapsed Pro gets ONE message, however many runs follow; the mark is in the database', async () => {
  const { w, run, row } = await scenario([HOLD, { id: 'u-l', chat: '1001', sub: lapsedPro(5) }]);
  for (let i = 0; i < 4; i++) await run();
  assert.equal(msgs(w, '1001').length, 1, `messages: ${JSON.stringify(msgs(w, '1001'))}`); assert.equal(msgs(w, '9001').length, 0, 'a Pro user got the lapse message');
  assert.ok(typeof row('u-l').telegram_lapse_notified_at === 'string' && Date.parse(row('u-l').telegram_lapse_notified_at as string) >= NOW - 1000, 'the mark was not stored');
});
test('L2a. the mark survives a restart (new route module, same database); L2b. a renewed then lapsed-again account is told once more, and only once', async () => {
  const { w, run, restart, row } = await scenario([HOLD, { id: 'u-l', chat: '1001', sub: lapsedPro(5) }]);
  await run(); assert.equal(msgs(w, '1001').length, 1); await restart(); await run(); await restart(); await run(); assert.equal(msgs(w, '1001').length, 1, 'a restart repeated the message');
  const sub = (w.tables.lhq_user_subscriptions as Row[]).find((r) => r.user_id === 'u-l')!;
  Object.assign(sub, PRO_OK); await run(); assert.equal(msgs(w, '1001').length, 1, 'told while Pro again'); const mark = row('u-l').telegram_lapse_notified_at;
  assert.ok(mark, 'the cron cleared the mark on upgrade (documented: it keeps it; the NEXT lapse is later than the mark, so it is told again)');
  row('u-l').telegram_lapse_notified_at = iso(NOW - 5 * DAY);                               // the first notice was claimed 5 days ago
  Object.assign(sub, lapsedPro(3));                                                            // renewed, then lapsed again: lapse = now - 1 day, later than the mark
  await run(); await run(); assert.equal(msgs(w, '1001').length, 2, 'a second lapse was not announced once');
});
test('L3. NOT told: never-Pro Free, lapsed 9 days ago (past the 7-day window), inside the 48 h grace, lifetime Pro (no period end), a running trial, no linked chat, a blank chat; and nothing is claimed for them', async () => {
  const users = [HOLD,
    { id: 'u-free', chat: '1001', sub: { role: 'free', trial_ends_at: null, current_period_end: null } },
    { id: 'u-old', chat: '1002', sub: lapsedPro(9) },
    { id: 'u-grace', chat: '1003', sub: lapsedPro(1) },
    { id: 'u-life', chat: '1004', sub: { role: 'pro', trial_ends_at: null, current_period_end: null } },
    { id: 'u-trial', chat: '1005', sub: { role: 'free', trial_ends_at: iso(NOW + 3 * DAY), current_period_end: null } },
    { id: 'u-nochat', chat: null, sub: lapsedPro(5) },
    { id: 'u-blank', chat: '   ', sub: lapsedPro(5) },
    { id: 'u-oldtrial', chat: '1006', sub: lapsedTrial(30) },
  ];
  const { w, run, row } = await scenario(users); await run(); await run();
  for (const c of ['1001', '1002', '1003', '1004', '1005', '1006', '   ']) assert.equal(msgs(w, c).filter((t: string) => /has ended/.test(t)).length, 0, `chat ${c} was told the plan ended`);   // 1003-1005 are real Pro / trial recipients and get ordinary alerts: only the lapse text counts
  for (const id of ['u-free', 'u-old', 'u-grace', 'u-life', 'u-trial', 'u-nochat', 'u-blank', 'u-oldtrial']) assert.equal(row(id).telegram_lapse_notified_at, null, `${id}: a mark was claimed for a user who was not owed the message`);
});
test('L4. a trial that ended says "Pro trial"; a paid plan says "Pro plan"; each user is told once in its own chat', async () => {
  const { w, run } = await scenario([HOLD, { id: 'u-t', chat: '1001', sub: lapsedTrial(2) }, { id: 'u-p', chat: '1002', sub: lapsedPro(4) }]); await run(); await run();
  assert.match(msgs(w, '1001')[0] ?? '', /Your Pro trial has ended/); assert.match(msgs(w, '1002')[0] ?? '', /Your Pro plan has ended/); assert.equal(msgs(w, '1001').length + msgs(w, '1002').length, 2);
});
test('L5. the text: plain English, 40 words or fewer, says alerts are paused and how to resume (the upgrade link), no vendor name, no NaN/undefined', async () => {
  const { w, run } = await scenario([HOLD, { id: 'u-l', chat: '1001', sub: lapsedPro(5) }]); await run(); const t = msgs(w, '1001')[0]!;
  assert.match(t, /alerts are paused/i); assert.match(t, /Upgrade to turn them back on: https:\/\/[^\s]+\/upgrade$/); assert.ok(t.trim().split(/\s+/).length <= 40, `${t.trim().split(/\s+/).length} words`);
  assert.doesNotMatch(t, /claude|anthropic|openai|gpt|gemini|grok|xai|NaN|undefined|null|<|>/i); assert.ok(/^[\x20-\x7E\n]+$/.test(t), 'non-ASCII text'); assert.doesNotMatch(t, /\b(buy|sell|should|recommend|guarantee|profit)\b/i);
  const sent = w.telegram.sent.find((m: { chat_id: string }) => m.chat_id === '1001'); assert.ok(sent);
});
test('L6. feature flag telegram OFF (/ops pause): nothing sent, nothing claimed; when it is back ON the message goes once', async () => {
  const off = await scenario([HOLD, { id: 'u-l', chat: '1001', sub: lapsedPro(5) }], { flagOff: true }); await off.run(); await off.run();
  assert.equal(msgs(off.w, '1001').length, 0, 'sent while paused'); assert.equal(off.row('u-l').telegram_lapse_notified_at, null, 'claimed while paused: the notice would be lost');
  (off.w.tables.lhq_app_config as Row[]).length = 0; await off.restart(); await off.run(); await off.run(); assert.equal(msgs(off.w, '1001').length, 1);
});
test('L7. a refused send (403) is claimed and NOT retried: the person is not told (documented), and the cron does not loop on it', async () => {
  const { w, run, row } = await scenario([HOLD, { id: 'u-l', chat: '1001', sub: lapsedPro(5) }]); w.telegram.mode = '403'; await run(); w.telegram.mode = 'ok'; await run(); await run();
  assert.equal(w.telegram.attempts.filter((a: { chat_id: string }) => a.chat_id === '1001').length, 1, 'retried'); assert.ok(row('u-l').telegram_lapse_notified_at, 'not claimed'); assert.equal(msgs(w, '1001').length, 0);
});
test('L8. two overlapping runs send one message (the claim is conditional)', async () => {
  const { w, run } = await scenario([HOLD, { id: 'u-l', chat: '1001', sub: lapsedPro(5) }]); await Promise.all([run(), run()]); await run(); assert.equal(msgs(w, '1001').length, 1);
});
test('L9. the message goes out even when the run has no recipient at all (the only Pro users are held or there are none)', async () => {
  const { w, run } = await scenario([{ id: 'u-l', chat: '1001', sub: lapsedPro(5) }]); const r = await run();
  assert.equal(msgs(w, '1001').length, 1, `status ${r.status} ${JSON.stringify(r.body)}`);
});
test('L10. migration q not applied (no telegram_lapse_notified_at column): no message, no crash, a warning is logged, and the run itself still answers', async () => {
  const { w, run } = await scenario([HOLD, { id: 'u-l', chat: '1001', sub: lapsedPro(5) }]); (w as unknown as { missingColumns: Record<string, string[]> }).missingColumns.lhq_user_settings = ['telegram_lapse_notified_at', 'alert_paused', 'alert_snooze_until', 'alert_quiet_start', 'alert_quiet_end'];
  const warns: string[] = []; const ow = console.warn; console.warn = (...a: unknown[]) => { warns.push(a.join(' ')); };
  let r: { status: number }; try { r = await run(); } finally { console.warn = ow; }
  assert.equal(msgs(w, '1001').length, 0, 'told without a place to store the mark (it would repeat every run)'); assert.ok(warns.some((m) => /plan-ended notices skipped/.test(m)), `no warning: ${warns.join(' | ')}`); assert.ok(r.status === 200 || r.status === 503, `status ${r.status}`);
});
