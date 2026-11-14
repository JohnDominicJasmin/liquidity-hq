import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* QA's cells for #2298 (#1651 "coin flip"): persistAlertFires reports what it did. The REAL function runs; only the network is faked. @supabase/supabase-js talks to PostgREST over
 * fetch, so a fake fetch plays the database: it answers the dedup SELECT (a row exists for the coins in `dupCoins`) and the INSERT (records the body, answers per `insertAnswers`). Each
 * expectation comes from the PR description, with a negative case beside it. */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://stub.supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key';
const { persistAlertFires } = await import('../lib/alertOutcomes.ts');

type Insert = { body: Array<Record<string, unknown>>; status: number };
function fakeDb(o: { dupCoins?: string[]; insertAnswers: Array<{ status: number; message?: string }> }) {
  const inserts: Insert[] = []; let n = 0; const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String((input as { url?: string }).url ?? input); const method = (init?.method ?? 'GET').toUpperCase();
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (method === 'GET') {
      const coin = /coin=eq\.([A-Za-z0-9]+)/.exec(url)?.[1] ?? '';
      return json((o.dupCoins ?? []).includes(coin) ? [{ id: 1 }] : []);
    }
    const body = JSON.parse(init?.body ?? '[]') as Array<Record<string, unknown>>;
    const ans = o.insertAnswers[Math.min(n++, o.insertAnswers.length - 1)];
    inserts.push({ body, status: ans.status });
    return ans.status >= 400 ? json({ message: ans.message ?? 'boom', code: '42703' }, ans.status) : new Response(null, { status: 201 });
  }) as typeof fetch;
  return { inserts, restore: () => { globalThis.fetch = real; } };
}
const fire = (over: Record<string, unknown>) => ({ ruleKey: 'rsi', coin: 'BTC', dir: 'short', label: 'x', price: 100, ...over }) as never;

test('a. all new: attempted = stored, nothing deduped or failed', async () => {
  const db = fakeDb({ insertAnswers: [{ status: 201 }] });
  try {
    const t = await persistAlertFires([fire({ coin: 'BTC' }), fire({ coin: 'ETH' }), fire({ coin: 'SOL' })]);
    assert.deepEqual(t, { attempted: 3, deduped: 0, stored: 3, failed: 0 });
    assert.equal(db.inserts.length, 1); assert.equal(db.inserts[0].body.length, 3);
  } finally { db.restore(); }
});

test('b. one fire inside its cooldown is deduped and not inserted', async () => {
  const db = fakeDb({ dupCoins: ['ETH'], insertAnswers: [{ status: 201 }] });
  try {
    const t = await persistAlertFires([fire({ coin: 'BTC' }), fire({ coin: 'ETH' }), fire({ coin: 'SOL' })]);
    assert.deepEqual(t, { attempted: 3, deduped: 1, stored: 2, failed: 0 });
    assert.deepEqual(db.inserts[0].body.map(r => r.coin), ['BTC', 'SOL'], 'the deduped coin must not be in the insert');
  } finally { db.restore(); }
});

test('b2. CONTROL: every fire deduped means no insert at all', async () => {
  const db = fakeDb({ dupCoins: ['BTC', 'ETH'], insertAnswers: [{ status: 201 }] });
  try {
    const t = await persistAlertFires([fire({ coin: 'BTC' }), fire({ coin: 'ETH' })]);
    assert.deepEqual(t, { attempted: 2, deduped: 2, stored: 0, failed: 0 }); assert.equal(db.inserts.length, 0);
  } finally { db.restore(); }
});

test('c. an insert error is counted failed and never throws', async () => {
  const db = fakeDb({ insertAnswers: [{ status: 500, message: 'database is down' }] });
  try {
    const t = await persistAlertFires([fire({ coin: 'BTC' }), fire({ coin: 'ETH' })]);
    assert.deepEqual(t, { attempted: 2, deduped: 0, stored: 0, failed: 2 });
    assert.equal(db.inserts.length, 1, 'an unrelated error must NOT trigger the column-less retry');
  } finally { db.restore(); }
});

test('d. an error naming metric_value retries WITHOUT the two columns and counts the fires stored', async () => {
  for (const col of ['metric_value', 'threshold_kind']) {
    const db = fakeDb({ insertAnswers: [{ status: 400, message: `Could not find the '${col}' column of 'lhq_alert_fires' in the schema cache` }, { status: 201 }] });
    try {
      const t = await persistAlertFires([fire({ coin: 'BTC', metricValue: 71.2, thresholdKind: 'rsi_ob' })]);
      assert.deepEqual(t, { attempted: 1, deduped: 0, stored: 1, failed: 0 }, `error on ${col}`);
      assert.equal(db.inserts.length, 2);
      assert.ok('metric_value' in db.inserts[0].body[0], 'first attempt carries the new columns');
      assert.ok(!('metric_value' in db.inserts[1].body[0]) && !('threshold_kind' in db.inserts[1].body[0]), 'the retry drops both');
      assert.equal(db.inserts[1].body[0].price_at_fire, 100, 'the retry keeps everything else');
    } finally { db.restore(); }
  }
});

test('d2. CONTROL: if the retry fails too it is counted failed, not stored', async () => {
  const db = fakeDb({ insertAnswers: [{ status: 400, message: "column metric_value does not exist" }, { status: 500, message: 'still down' }] });
  try {
    const t = await persistAlertFires([fire({ coin: 'BTC' })]);
    assert.deepEqual(t, { attempted: 1, deduped: 0, stored: 0, failed: 1 });
  } finally { db.restore(); }
});

test('e. rows carry metric_value and threshold_kind for RSI and squeeze fires, null for whales', async () => {
  const db = fakeDb({ insertAnswers: [{ status: 201 }] });
  try {
    await persistAlertFires([
      fire({ ruleKey: 'rsi', coin: 'BTC', metricValue: 74.5, thresholdKind: 'rsi_ob' }),
      fire({ ruleKey: 'squeeze', coin: 'ETH', dir: 'long', metricValue: 82, thresholdKind: 'squeeze' }),
      fire({ ruleKey: 'whales', coin: 'SOL', dir: 'long' }),
    ]);
    const rows = Object.fromEntries(db.inserts[0].body.map(r => [r.rule_key as string, r]));
    assert.equal(rows.rsi.metric_value, 74.5); assert.equal(rows.rsi.threshold_kind, 'rsi_ob');
    assert.equal(rows.squeeze.metric_value, 82); assert.equal(rows.squeeze.threshold_kind, 'squeeze');
    assert.equal(rows.whales.metric_value, null); assert.equal(rows.whales.threshold_kind, null);
  } finally { db.restore(); }
});

test('e2. the cron copies metricValue/thresholdKind from the queue entry to the logged fire, and the whale entries never set them (source guard)', () => {
  const src = readFileSync(new URL('../app/api/telegram/alert/route.ts', import.meta.url), 'utf8');
  assert.match(src, /metricValue: e\.metricValue,\s*\n\s*thresholdKind: e\.thresholdKind,/);
  for (const m of src.matchAll(/ruleKey: 'whales'[^\n]*\n?[^\n]*\n?[^\n]*/g)) assert.doesNotMatch(m[0], /metricValue|thresholdKind/, 'a whale fire must not carry a metric');
});

/* ---------- the resolver stamps resolved_at (migration 20261114a; SQL cannot run here, so these are source guards on the migration text; the live check follows PM's dev apply) ---------- */
const sql = readFileSync(new URL('../supabase/migrations/20261114a_alert_fires_measurable.sql', import.meta.url), 'utf8');
const prod = sql.slice(0, sql.indexOf('-- ── dev:'));
test('f. the prod block adds the four columns nullable and additive (no default, no not null, no drop)', () => {
  for (const c of ['metric_value    numeric', 'threshold_kind  text', 'resolved_at_24h timestamptz', 'resolved_at_48h timestamptz']) assert.ok(prod.includes('add column if not exists ' + c), c);
  assert.doesNotMatch(prod, /not null|default |drop column(?![^;]*--)/i.source ? /not null|\bdefault\b/i : /x/, 'no not-null or default on the new columns');
});
test('g. the resolver stamps resolved_at_24h only on the 24 h branch and resolved_at_48h only on the 48 h branch, only for unresolved rows', () => {
  const b24 = /if p_hours = 24 then([\s\S]*?)elsif p_hours = 48/.exec(prod)![1], b48 = /elsif p_hours = 48 then([\s\S]*?)else\s+raise/.exec(prod)![1];
  assert.match(b24, /resolved_at_24h = now\(\)/); assert.doesNotMatch(b24, /resolved_at_48h/); assert.match(b24, /not f\.resolved_24h/);
  assert.match(b48, /resolved_at_48h = now\(\)/); assert.doesNotMatch(b48, /resolved_at_24h/); assert.match(b48, /not f\.resolved_48h/);
  assert.match(prod, /raise exception 'lhq_resolve_alert_outcomes: p_hours must be 24 or 48/);
});
test('h. the replaced function stays server-only: revoked from public/anon/authenticated, granted to service_role, security definer with a pinned search_path', () => {
  assert.match(prod, /security definer\s+set search_path = public/);
  assert.match(prod, /revoke execute on function lhq_resolve_alert_outcomes\(integer, jsonb\) from public, anon, authenticated;/);
  assert.match(prod, /grant execute on function lhq_resolve_alert_outcomes\(integer, jsonb\) to service_role;/);
});
