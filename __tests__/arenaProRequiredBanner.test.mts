/* Arena's AI-read banner never shows the raw code PRO_REQUIRED (#1263, #1511, PR #1524).
 *
 * THE BUG. #1511's /api/grok gate refuses a fast-timeframe read (1m, 5m, 15m) from a free account with 403
 * `{ error: 'PRO_REQUIRED', message }`. lib/grok.ts callGrokViaProxy threw `err.error` as the MESSAGE, and the Arena
 * page showed `setReadError(e.message)`. A free account still on 5m (the plan still loading, or the plan read
 * failed, #1119) therefore saw the text "PRO_REQUIRED" in the banner. The fix passes it on as `code:
 * 'PRO_REQUIRED'`; the Arena shows the labelled line "Fast timeframes (1m, 5m, 15m) are part of Pro." plus an
 * Upgrade link to /upgrade, and the next read clears both.
 *
 * WHAT RUNS. callGrokViaProxy is imported and run for real with `fetch` stubbed to the route's exact 403 body: that
 * is the BEHAVIOUR half. The page half is SOURCE PINS (no DOM test library in this repo): they fail when the
 * handler loses the branch, sets the wrong key, drops the link or stops resetting. They cannot show the banner
 * renders; only a browser on a free account on 5m does. The label half checks the key in labelKeys, the English
 * default, and migration 20261001j (en row equals the default; the dev block is commented).
 *
 * MUTATIONS (each must turn the named tests red; recorded in the commit):
 *   M1 lib/grok.ts: PRO_REQUIRED no longer passed on as a code   -> G1
 *   M2 lib/grok.ts: status check dropped (any status maps)       -> G3
 *   M3 page: the PRO_REQUIRED branch removed                     -> P1
 *   M4 page: branch moved after the generic setReadError(msg)    -> P1
 *   M5 page: setReadProLocked(true) removed from the branch      -> P1
 *   M6 page: the Upgrade link removed from the banner            -> P2
 *   M7 page: reset of readProLocked removed from the next read   -> P3
 *   M8 labelDefaults.en.json value changed                       -> L2, L3 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://stand-in.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon_stand_in_key';

const { callGrokViaProxy } = await import('../lib/grok.ts');

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/^﻿/, '').split(/\r?\n/).join('\n');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function anchorOnce(src: string, needle: string, label: string): number {
  const n = src.split(needle).length - 1;
  assert.equal(n, 1, `${label}: anchor occurs ${n} time(s), expected exactly 1 - re-read the current source`);
  return src.indexOf(needle);
}

const KEY = 'ARENA_READ_FAST_TF_PRO_REQUIRED';
const COPY = 'Fast timeframes (1m, 5m, 15m) are part of Pro.';

/* ══ lib/grok.ts: the behaviour ═══════════════════════════════════════════════════════════════════════ */

const realFetch = globalThis.fetch;
async function proxyAnswers(status: number, body: unknown) {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  try {
    await callGrokViaProxy('prompt', '5m', 'london', 'quick');
    return null;
  } catch (e) {
    return e as Error & { code?: string; usage?: unknown };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('CONTROL. a 200 from the proxy resolves with the body, so a throw below is the mapping and not the stub', async () => {
  globalThis.fetch = (async () => Response.json({ result: { signal: 'WAIT' }, usage: null })) as typeof fetch;
  try {
    const out = await callGrokViaProxy('prompt', '1h', 'london', 'quick');
    assert.deepEqual(out, { result: { signal: 'WAIT' }, usage: null });
  } finally { globalThis.fetch = realFetch; }
});

test('G1. a 403 with error PRO_REQUIRED throws an error whose CODE is PRO_REQUIRED, so the page can show its own locked state', async () => {
  const e = await proxyAnswers(403, { error: 'PRO_REQUIRED', message: 'Fast timeframes are part of Pro.' });
  assert.ok(e, 'no error was thrown for a 403');
  assert.equal(e.code, 'PRO_REQUIRED', 'the code is not passed on; Arena cannot tell a locked read from a failure and shows the text');
});

test('G2. the thrown error keeps the usage the route sent, and it is the only thing a caller could still display as text', async () => {
  const usage = { quick_used: 3, quick_limit: 5 };
  const e = await proxyAnswers(403, { error: 'PRO_REQUIRED', message: 'x', usage });
  assert.ok(e);
  assert.deepEqual(e.usage, usage);
  // The message is the bare code on purpose: the page must branch on `code` BEFORE it ever shows `message`
  // (P1 pins that order). This records what a page that forgot to would put on screen.
  assert.equal(e.message, 'PRO_REQUIRED');
});

test('G3. only a 403 with that error is mapped: other statuses and other 403 errors keep their old behaviour', async () => {
  const wrongStatus = await proxyAnswers(500, { error: 'PRO_REQUIRED' });
  assert.ok(wrongStatus);
  assert.notEqual(wrongStatus.code, 'PRO_REQUIRED', 'a 500 carrying the word PRO_REQUIRED was treated as a Pro lock');
  assert.equal(wrongStatus.message, 'PRO_REQUIRED', 'unchanged: err.error is the message');
  const other403 = await proxyAnswers(403, { error: 'Forbidden thing', code: 'SOMETHING' });
  assert.ok(other403);
  assert.equal(other403.code, 'SOMETHING');
  assert.equal(other403.message, 'Forbidden thing');
  const blank = await proxyAnswers(502, {});
  assert.ok(blank);
  assert.equal(blank.message, 'Grok proxy error', 'an error with no body still reads "Grok proxy error"');
  const limited = await proxyAnswers(429, { error: 'Daily limit reached.', code: 'RATE_LIMIT' });
  assert.ok(limited);
  assert.equal(limited.code, 'RATE_LIMIT');
  assert.match(limited.message, /^Daily limit reached\. Resets at /, 'the rate-limit message is unchanged');
});

/* ══ app/arena/page.tsx: the page (SOURCE PINS) ═══════════════════════════════════════════════════════ */

const ARENA = 'app/arena/page.tsx';
const arena = stripComments(read(ARENA));

test('P1. on code PRO_REQUIRED the read handler sets the labelled line and the locked flag and returns, BEFORE the generic message path', () => {
  const branch = anchorOnce(arena, "if ((e as { code?: string }).code === 'PRO_REQUIRED') {", 'the PRO_REQUIRED branch');
  const body = arena.slice(branch, arena.indexOf('}', arena.indexOf('return;', branch)) + 1);
  assert.match(body, /setReadError\(t\('ARENA_READ_FAST_TF_PRO_REQUIRED'\)\);/, 'the branch does not set the labelled line');
  assert.ok(body.includes('setReadProLocked(true);'), 'the branch does not set readProLocked, so no Upgrade link appears');
  assert.ok(/return;\s*\}$/.test(body), 'the branch must return, or the generic path below overwrites the labelled line with the raw message');
  const generic = anchorOnce(arena, 'setReadError(msg);', 'the generic message path');
  assert.ok(branch < generic, 'the generic setReadError(msg) now runs before the PRO_REQUIRED branch - the raw code reaches the banner');
});

test('P2. the banner shows an Upgrade link to /upgrade only while readProLocked, using the existing label', () => {
  const at = anchorOnce(arena, '{readProLocked && (', 'the conditional link');
  const chunk = arena.slice(at, at + 400);
  assert.match(chunk, /<Link href="\/upgrade"/, 'the link does not go to /upgrade');
  assert.ok(chunk.includes("t('TNAV_UPGRADE_LABEL')"), 'the link text is not the shared TNAV_UPGRADE_LABEL');
  const banner = arena.lastIndexOf('{readError && (', at);
  assert.ok(banner >= 0 && at - banner < 200, 'the link is no longer inside the readError banner');
});

test('P3. every new read starts by clearing the error AND the locked flag together, and the locked flag has no other way to stay set', () => {
  anchorOnce(arena, 'setReadLoading(true); setReadError(\'\'); setReadProLocked(false);', 'the reset at the start of a read');
  const sets = [...arena.matchAll(/setReadProLocked\((true|false)\)/g)].map((m) => m[1]);
  assert.equal(sets.filter((s) => s === 'true').length, 1, `readProLocked is set true in ${sets.filter((s) => s === 'true').length} places; only the PRO_REQUIRED branch should`);
  assert.ok(sets.filter((s) => s === 'false').length >= 2, 'the no-data-source path and the new-read path should both clear it');
});

/* ══ the label ════════════════════════════════════════════════════════════════════════════════════════ */

const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
const MIGRATION = 'supabase/migrations/20261001j_labels_arena_pro_required.sql';

test('L1. the key is in lib/labelKeys.ts exactly once', () => {
  anchorOnce(read('lib/labelKeys.ts'), `'${KEY}'`, 'the key in labelKeys');
});

test('L2. the English default is the approved copy, with no placeholder text', () => {
  assert.equal(defaults[KEY], COPY);
});

function tuples(sql: string, commented: boolean) {
  const out: { key: string; locale: string; value: string }[] = [];
  for (const raw of sql.split('\n')) {
    let line = raw.trim();
    if (commented) { if (!line.startsWith("-- ('")) continue; line = line.slice(3); }
    else if (!line.startsWith("('")) continue;
    const parts = line.replace(/^\('/, '').replace(/'\)[,;]?\s*$/, '').split("','");
    if (parts.length === 3) out.push({ key: parts[0], locale: parts[1], value: parts[2].split("''").join("'") });
  }
  return out;
}

test('L3. migration 20261001j has one live en row equal to the default and the same row as a commented dev block', () => {
  const sql = read(MIGRATION);
  const live = tuples(sql, false);
  const dev = tuples(sql, true);
  assert.deepEqual(live, [{ key: KEY, locale: 'en', value: COPY }], 'the live block must be exactly the en row');
  assert.deepEqual(dev, live, 'the commented dev block must carry the same row');
  assert.equal(live[0].value, defaults[KEY], 'the migration and the build-time default disagree: English would change when it is applied');
  assert.ok(sql.includes('insert into lhq_labels'), 'the live block is not against the prod table');
  assert.ok(sql.includes('-- insert into lhq_dev_labels'), 'the dev block is not commented out');
  assert.equal(sql.split('on conflict (key, locale) do nothing;').length - 1, 2, 'a new key must be do nothing on conflict, in both blocks');
});
