/* QA: PR #2734 (off-site failing-text sweep, PM 2026-11-20), what users get OUTSIDE the site (Telegram, the daily summary) states only what it has.
 *
 * THE WRITTEN RULES (PR body; the literals below come from it, never from the code under test):
 *   R1  daily summary: buildDailySummaryMessages takes an optional `squeezeKnown` (false -> NO squeeze block; absent / true -> the block exactly as before). The call site in checkDailySummary passes
 *       "some coin has a funding read or a long/short read"; with no read at all the block is left out, because "None at or above your threshold" would be false.
 *   R2  squeeze alert: the Funding line and the L/S line are each left out when their source is missing (the other stays); never a "-" placeholder.
 *   R3  distribution alert: "Built from inputs worth N of 100 points." when scoreableMax < 100, and nothing at 100.
 *   R4  macro reminder: Estimate / Prev are joined from what exists (no 'undefined', no dangling separator).
 *   R5  news alert: a missing Source line is omitted (it used to THROW and drop every later item of the run).
 *   R6  whale alert (both venues): a size that is NaN / undefined / below the threshold queues nothing; a size AT the threshold queues.
 *   M1  no produced message carries 'undefined', 'NaN', 'null' or '[object' anywhere.
 *
 *   B1-B3  the real lib buildDailySummaryMessages    D1-D5  the real checkDailySummary call site    S1-S5  the real checkSqueezeAlerts    T1-T3  the real checkDistribution (stubbed score, then the real scorer)
 *   A1-A2  the macro reminder's message builder    N1-N3  the real checkNews    W1-W4  the real checkWhales
 *
 * HOW IT RUNS: lib/dailySummary.ts is imported as it is. The route files do not export these builders (a route may export only handlers), so each is CUT out of the file by name with the TypeScript parser, its types stripped, and rebuilt with
 * new Function, given a small stand-in world (a fake fetch, a recording tg(), a fixed cooldown) and the route's own helpers (escapeHtml, fmtSignalPrice, runBatched, calcSqueezeScore ...) cut the same way, so the SOURCE of the rule is what runs.
 * A route function catches its own errors, so every negative case sits beside a positive control that must produce a message (a missing name in the stand-in world would otherwise read as "nothing sent" and pass).
 * WHAT THIS CANNOT PROVE: a real Telegram send, the real feeds, or the macro cron's own GET loop (only its message builder is cut out). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as nodeModule from 'node:module';
import { buildDailySummaryMessages, topMovers, squeezeSetups, type Mover, type SqueezeRead } from '../lib/dailySummary.ts';
import { computeDistributionScore } from '../lib/distribution.ts';
import { classifyNews } from '../lib/classify.ts';
import { symbolDenominationFactor } from '../lib/coins.ts';
import { tgKeep, localizeTelegram } from '../lib/telegramI18n.ts';

const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (code: string) => string }).stripTypeScriptTypes;
const ts = createRequire(import.meta.url)('typescript') as typeof import('typescript');
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ALERT = 'app/api/telegram/alert/route.ts', MACRO = 'app/api/macro-alert/route.ts';

/** The source of one named function or const (anywhere in the file), types stripped. */
function cut(rel: string, name: string): string {
  const src = read(rel); const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.ES2022, true); let found: string | null = null;
  const visit = (n: import('typescript').Node) => {
    if (found) return;
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) found = n.getText(sf);
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) found = 'const ' + n.getText(sf);
    else ts.forEachChild(n, visit);
  };
  visit(sf); assert.ok(found, `CONTROL: ${name} was not found in ${rel}`);
  return stripTypeScriptTypes(found!);
}
/** Rebuild `name` from the route's own source, with `deps` cut from the same file and `env` as the free names it uses. */
function build<T>(rel: string, name: string, deps: string[], env: Record<string, unknown>): T {
  const code = [...deps.map((d) => cut(rel, d)), cut(rel, name)].join('\n'); const keys = Object.keys(env);
  return new Function(...keys, `${code}\nreturn ${name};`)(...keys.map((k) => env[k])) as T;
}
const BAD = /undefined|NaN|\bnull\b|\[object/;
const clean = (m: string, where: string) => assert.doesNotMatch(m, BAD, `${where}: a placeholder word reached the message:\n${m}`);
const STAMP = 'Sent 12:00';

/* ── B: the real builder ── */
const mover: Mover = { coin: 'btc', label: 'BTC', changePct: 4.2, price: 100000, high: 101000, low: 95000 };
const setup: SqueezeRead = { coin: 'btc', label: 'BTC', score: 80, dir: 'LONG_LIQ', fundingPct: 0.06, longPct: 70 };
const bo = { dateStr: 'Fri 20 Nov', movers: [mover], threshold: 70, stamp: STAMP };
const HEAD = '☀️ <b>Daily Summary - Fri 20 Nov</b>\n\n📈 <b>Biggest 24 h moves</b>\n<b>BTC</b> · Up\n+4.20% in 24 h · now $100,000 · 24 h range $95,000 - $101,000';
const SQ_NONE = '⚡ <b>Squeeze setups (score 70+)</b>\nNone at or above your threshold (70).';
const SQ_ONE = '⚡ <b>Squeeze setups (score 70+)</b>\n• <b>BTC</b> long-heavy positioning, score 80/100 (funding +0.0600%, 70% of accounts long)';

test('B1. squeezeKnown false: no squeeze block at all, whether or not a setup is passed in', () => {
  assert.deepEqual(buildDailySummaryMessages({ ...bo, setups: [], squeezeKnown: false }), [`${HEAD}\n\n<i>${STAMP}</i>`]);
  assert.deepEqual(buildDailySummaryMessages({ ...bo, setups: [setup], squeezeKnown: false }), [`${HEAD}\n\n<i>${STAMP}</i>`]);
  for (const m of buildDailySummaryMessages({ ...bo, setups: [setup], squeezeKnown: false })) { assert.doesNotMatch(m, /Squeeze setups|None at or above|⚡/); clean(m, 'B1'); }
});
test('B2. squeezeKnown true or absent: the block is exactly as before (the "None" sentence with no setups, the setup line with one)', () => {
  for (const extra of [{}, { squeezeKnown: true }]) {
    assert.deepEqual(buildDailySummaryMessages({ ...bo, setups: [], ...extra }), [`${HEAD}\n\n${SQ_NONE}\n\n<i>${STAMP}</i>`], JSON.stringify(extra));
    assert.deepEqual(buildDailySummaryMessages({ ...bo, setups: [setup], ...extra }), [`${HEAD}\n\n${SQ_ONE}\n\n<i>${STAMP}</i>`], JSON.stringify(extra));
  }
});
test('B3. the flag changes only the squeeze block: the moves and the stamp are identical either way', () => {
  const on = buildDailySummaryMessages({ ...bo, setups: [setup] })[0], off = buildDailySummaryMessages({ ...bo, setups: [setup], squeezeKnown: false })[0];
  assert.ok(off.startsWith(HEAD) && on.startsWith(HEAD) && on.endsWith(`<i>${STAMP}</i>`) && off.endsWith(`<i>${STAMP}</i>`)); assert.ok(on.length > off.length);
});

/* ── D: the real call site ── */
type Sent = { to: string; text: string };
async function summaryText(frMap: Record<string, number | null>, lsMap: Record<string, number | null>): Promise<string> {
  const sent: Sent[] = [];
  const fn = build<(token: string, recipients: unknown[], muted: Map<string, Set<string>>, stamp: string, fr: unknown, ls: unknown, th: Map<string, unknown>) => Promise<string[]>>(ALERT, 'checkDailySummary', ['isMutedFor', 'calcSqueezeScore', 'DEFAULT_THRESHOLDS'], {
    isDailySummaryOn: () => true, getSupabaseAdmin: () => ({ from: () => ({}) }), selectAllRows: async () => ({ data: [], error: null }), T: { user_settings: 'user_settings' }, summaryHour: (h: unknown) => Number(h),
    CHAT_TZ: new Map(), DEFAULT_DAILY_SUMMARY_HOUR: 7, summaryDueNow: () => true, lastSentAt: () => 0, fetchMovers24h: async () => [mover], COINS: ['btc', 'eth'], LABELS: { btc: 'BTC', eth: 'ETH' },
    tgDateLocale: () => 'en', CHAT_LANG: new Map(), topMovers, squeezeSetups, buildDailySummaryMessages, markSent: () => {}, tg: async (_t: string, to: string, text: string) => { sent.push({ to, text }); return { sent: 1 }; },
  });
  const fired = await fn('tok', [{ userId: 'u1', chatId: '111' }], new Map(), STAMP, frMap, lsMap, new Map());
  assert.deepEqual(fired, ['Daily summary (1)'], 'CONTROL: the summary was not sent at all (the stand-in world is missing a name)'); assert.equal(sent.length, 1); assert.equal(sent[0].to, '111');
  assert.ok(sent[0].text.includes('Biggest 24 h moves') && sent[0].text.endsWith(`<i>${STAMP}</i>`), 'CONTROL: the moves and the stamp are in every summary');
  clean(sent[0].text, 'daily summary'); return sent[0].text;
}

test('D1. no funding read and no long/short read for ANY coin: the summary goes out with NO squeeze block', async () => {
  const t = await summaryText({ btc: null, eth: null }, { btc: null, eth: null });
  assert.doesNotMatch(t, /Squeeze setups|None at or above|⚡/); assert.ok(t.endsWith(`\n\n<i>${STAMP}</i>`));
});
test('D2. one coin has a funding read, the rest nothing: the block is there ("None at or above" is TRUE: a real read scored under the threshold)', async () => {
  const t = await summaryText({ btc: 0.0001, eth: null }, { btc: null, eth: null }); assert.ok(t.includes(SQ_NONE), t);
});
test('D3. only a long/short read exists: the block is there', async () => {
  const t = await summaryText({ btc: null, eth: null }, { btc: null, eth: 0.7 }); assert.ok(t.includes(SQ_NONE), t);
});
test('D4. a funding read of exactly 0 is a read (not "missing"): the block is there', async () => {
  const t = await summaryText({ btc: 0, eth: null }, { btc: null, eth: null }); assert.ok(t.includes(SQ_NONE), t);
});
test('D5. both reads present and a setup over the threshold: the setup line is listed', async () => {
  const t = await summaryText({ btc: 0.0006, eth: null }, { btc: 0.7, eth: null }); assert.ok(t.includes(SQ_ONE), t);
});

/* ── S: the real squeeze alert ── */
async function squeezeBody(fr: number | null, ls: number | null): Promise<string | undefined> {
  const queue: Array<{ body: string }> = [];
  const fn = build<(stamp: string, fr: unknown, ls: unknown, prices: unknown, queue: unknown[], recipients: unknown[], th: Map<string, unknown>) => Promise<string[]>>(ALERT, 'checkSqueezeAlerts', ['calcSqueezeScore', 'DEFAULT_THRESHOLDS', 'CD'], { COINS: ['btc'], LABELS: { btc: 'BTC' } });
  await fn(STAMP, { btc: fr }, { btc: ls }, { btc: 100000 }, queue, [{ userId: 'u1', chatId: '1' }], new Map([['u1', { rsiOb: 70, rsiOs: 30, squeezeThreshold: 40, antiChopEnabled: false }]]));
  const b = queue[0]?.body; if (b !== undefined) { clean(b, 'squeeze alert'); assert.doesNotMatch(b, /<b>-<\/b>|: -\n|-%/, `a dash placeholder reached the alert:\n${b}`); } return b;
}
test('S1. funding present, long/short missing: the Funding line stays and there is no L/S line (short-heavy and long-heavy)', async () => {
  assert.equal(await squeezeBody(-0.0004, null), '⚡ <b>SHORT-HEAVY POSITIONING - BTC/USDT</b>\nScore: <b>40/100</b>\n\nFunding: <b>-0.0400%</b> (shorts paying heavily)\n\nPositioning is short-heavy.\n\n<i>Sent 12:00</i>');
  assert.equal(await squeezeBody(0.0006, null), '🔥 <b>LONG-HEAVY POSITIONING - BTC/USDT</b>\nScore: <b>40/100</b>\n\nFunding: <b>+0.0600%</b> (longs paying heavily)\n\nPositioning is long-heavy.\n\n<i>Sent 12:00</i>');
});
test('S2. long/short present, funding missing: the L/S line stays and there is no Funding line (both directions)', async () => {
  assert.equal(await squeezeBody(null, 0.2), '⚡ <b>SHORT-HEAVY POSITIONING - BTC/USDT</b>\nScore: <b>40/100</b>\n\nL/S Ratio: <b>20.0% long / 80.0% short</b>\n\nPositioning is short-heavy.\n\n<i>Sent 12:00</i>');
  assert.equal(await squeezeBody(null, 0.7), '🔥 <b>LONG-HEAVY POSITIONING - BTC/USDT</b>\nScore: <b>40/100</b>\n\nL/S Ratio: <b>70.0% long / 30.0% short</b>\n\nPositioning is long-heavy.\n\n<i>Sent 12:00</i>');
});
test('S3. both present: both lines, Funding first, one blank line before the closing sentence (unchanged for a complete alert)', async () => {
  assert.equal(await squeezeBody(-0.0004, 0.2), '⚡ <b>SHORT-HEAVY POSITIONING - BTC/USDT</b>\nScore: <b>80/100</b>\n\nFunding: <b>-0.0400%</b> (shorts paying heavily)\nL/S Ratio: <b>20.0% long / 80.0% short</b>\n\nPositioning is short-heavy.\n\n<i>Sent 12:00</i>');
  assert.equal(await squeezeBody(0.0006, 0.7), '🔥 <b>LONG-HEAVY POSITIONING - BTC/USDT</b>\nScore: <b>80/100</b>\n\nFunding: <b>+0.0600%</b> (longs paying heavily)\nL/S Ratio: <b>70.0% long / 30.0% short</b>\n\nPositioning is long-heavy.\n\n<i>Sent 12:00</i>');
});
test('S4. a funding read of exactly 0 with a long/short read is a present Funding line, not a missing one', async () => {
  const b = await squeezeBody(0, 0.7); assert.ok(b !== undefined && b.includes('Funding: <b>+0.0000%</b> (longs paying heavily)\nL/S Ratio: <b>70.0% long / 30.0% short</b>'), String(b));
});
test('S5. a long/short read of exactly 0 % long is a present L/S line (100 % short), not a missing one', async () => {
  const b = await squeezeBody(null, 0); assert.ok(b !== undefined && b.includes('L/S Ratio: <b>0.0% long / 100.0% short</b>') && !b.includes('Funding:'), String(b));
});

/* ── T: the real distribution alert ── */
function klines(): unknown[][] {
  return Array.from({ length: 26 }, (_, i) => { const vol = i === 25 ? 200 : 100; return [0, 0, 0, 0, i === 25 ? '103' : '100', String(vol), 0, 0, 0, String(vol * 0.35)]; });
}
async function distBody(opts: { bySym: boolean; score?: { score: number; scoreableMax: number; reasons: string[] } }): Promise<string | undefined> {
  const queue: Array<{ body: string }> = [];
  const json = (v: unknown) => ({ ok: true, json: async () => v });
  const fn = build<(stamp: string, fr: unknown, queue: unknown[], muted: Set<string>, skip: unknown) => Promise<string[]>>(ALERT, 'checkDistribution', ['runBatched', 'CD'], {
    COINS: ['btc'], BINANCE_PERP: { btc: 'BTCUSDT' }, BYBIT_SYMS: opts.bySym ? { btc: 'BTCUSDT' } : {}, LABELS: { btc: 'BTC' },
    exchangeFetch: async (url: string) => url.includes('/fapi/v1/klines') ? json(klines()) : url.includes('topLongShortPositionRatio') ? json([{ longAccount: '0.40' }]) : json({ result: { list: [] } }),
    fetchBybitOi5m: async () => ({ result: { list: [] } }), noteSkip: () => {}, bootstrapReadings: () => [1, 2], trendBetween: () => 'weak_up',
    computeDistributionScore: opts.score ? () => ({ label: 'Distribution', inputsPresent: 8, inputsTotal: 8, ...opts.score }) : computeDistributionScore, onCooldown: () => false, markSent: () => {},
  });
  await fn(STAMP, { btc: 0.0005 }, queue, new Set(), {});
  const b = queue[0]?.body; if (b !== undefined) clean(b, 'distribution alert'); return b;
}
test('T1. scoreableMax under 100: "Built from inputs worth N of 100 points." right under the score; at 100 nothing (score and scoreableMax stubbed to literals)', async () => {
  const r = ['Sellers into strength'];
  assert.equal(await distBody({ bySym: false, score: { score: 62, scoreableMax: 85, reasons: r } }), '💰 <b>DISTRIBUTION DETECTED - BTC/USDT</b>\nScore: <b>62/100</b>\nBuilt from inputs worth 85 of 100 points.\n\nPrice still up <b>+3.0%</b> in 24h, while these distribution signs show:\n• Sellers into strength\n\n\n\n<i>Sent 12:00</i>');
  assert.equal(await distBody({ bySym: false, score: { score: 75, scoreableMax: 100, reasons: r } }), '💰 <b>DISTRIBUTION DETECTED - BTC/USDT</b>\nScore: <b>75/100</b>\n\nPrice still up <b>+3.0%</b> in 24h, while these distribution signs show:\n• Sellers into strength\n\n\n\n<i>Sent 12:00</i>');
});
test('T2. the boundaries: 99 and 60 print the line, 100 does not', async () => {
  const r = ['x'];
  assert.match((await distBody({ bySym: false, score: { score: 80, scoreableMax: 99, reasons: r } }))!, /\nBuilt from inputs worth 99 of 100 points\.\n/);
  assert.match((await distBody({ bySym: false, score: { score: 45, scoreableMax: 60, reasons: r } }))!, /\nBuilt from inputs worth 60 of 100 points\.\n/);
  assert.doesNotMatch((await distBody({ bySym: false, score: { score: 100, scoreableMax: 100, reasons: r } }))!, /Built from inputs/);
});
test('T3. through the real scorer: no Bybit open-interest read -> 25+15+15+15+10 = 80 reachable, the line says 80; with it -> 100 reachable and no line', async () => {
  const a = (await distBody({ bySym: false }))!; assert.ok(a, 'CONTROL: no alert was queued for a coin that scores 80 of 80');
  assert.deepEqual(a.split('\n').slice(0, 4), ['💰 <b>DISTRIBUTION DETECTED - BTC/USDT</b>', 'Score: <b>80/100</b>', 'Built from inputs worth 80 of 100 points.', '']);
  assert.ok(a.includes('• Sellers into strength\n• 65% taker sells\n• Whales 40% long\n• Retail longs paying\n• Vol 2.0x on sells'), a);
  const b = (await distBody({ bySym: true }))!; assert.ok(b, 'CONTROL: no alert was queued for a coin that scores 100 of 100');
  assert.deepEqual(b.split('\n').slice(0, 3), ['💰 <b>DISTRIBUTION DETECTED - BTC/USDT</b>', 'Score: <b>100/100</b>', '']); assert.doesNotMatch(b, /Built from inputs/);
});

/* ── A: the macro reminder's message builder, cut out of the cron's GET ── */
function macroMsg(event: { name: string; isoDate: string; estimate?: unknown; previous?: unknown }): string {
  const msgIn = build<(tz: string | null) => string>(MACRO, 'msgIn', [], { emoji: '🔴', minsStr: 60, event, eventTimeIn: () => '14:30 UTC' });
  const m = msgIn(null); clean(m, 'macro reminder'); return m;
}
const ev = { name: 'US CPI', isoDate: '2026-11-20T14:30:00Z' };
const MHEAD = '🔴 <b>Macro Event in ~60 min</b>\n\n<b>US CPI</b>\n🕐 14:30 UTC\n', MTAIL = '\n<i>High-impact release</i>';
test('A1. estimate and previous both present: one line, joined by a separator', () => assert.equal(macroMsg({ ...ev, estimate: '3.1%', previous: '3.0%' }), `${MHEAD}Estimate: <b>3.1%</b>  |  Prev: 3.0%\n${MTAIL}`));
test('A2. previous without an estimate: the line starts with "Prev:" (no leading separator); estimate alone has no trailing one', () => {
  assert.equal(macroMsg({ ...ev, previous: '3.0%' }), `${MHEAD}Prev: 3.0%\n${MTAIL}`); assert.equal(macroMsg({ ...ev, estimate: '3.1%' }), `${MHEAD}Estimate: <b>3.1%</b>\n${MTAIL}`);
});
test('A3. neither (absent, empty, null, undefined): no figures line at all, no stray separator', () => {
  for (const f of [{}, { estimate: '', previous: '' }, { estimate: null, previous: null }, { estimate: undefined, previous: '' }]) {
    const m = macroMsg({ ...ev, ...f }); assert.equal(m, `${MHEAD}${MTAIL}`, JSON.stringify(f)); assert.doesNotMatch(m, /\|/);
  }
});

/* ── N: the real news alert ── */
async function newsRun(items: Array<Record<string, unknown>>): Promise<{ sent: string[]; fired: string[] }> {
  const sent: string[] = []; const now = Math.floor(Date.now() / 1000);
  const fn = build<(token: string, recipients: unknown[], muted: Map<string, Set<string>>, stamp: string) => Promise<string[]>>(ALERT, 'checkNews', ['escapeHtml', 'isMutedFor', 'recipientChatIds', 'CD'], {
    tgKeep, classifyNews, onCooldown: () => false, markSent: () => {}, FINNHUB_KEY: 'k',
    fetch: async (url: string) => url.includes('category=crypto') ? { ok: true, json: async () => items.map((i) => ({ datetime: now, ...i })) } : { ok: false, json: async () => [] },
    tg: async (_t: string, _to: unknown, text: string) => { sent.push(localizeTelegram(text, 'en', null)); return { sent: 1 }; },   // what the real tg() does to an English message: the tgKeep markers are removed before the send
  });
  const fired = await fn('tok', [{ userId: 'u1', chatId: '111' }], new Map(), STAMP); for (const s of sent) clean(s, 'news alert'); return { sent, fired };
}
const H1 = 'Missile attack closes the strait', H2 = 'Troops deploy to the border';
test('N1. with a source: the Source line is there, exactly', async () => {
  const { sent } = await newsRun([{ id: 1, headline: H1, source: 'Reuters' }]);
  assert.deepEqual(sent, ['🚨 <b>Breaking Alert</b>\n\n<b>Missile attack closes the strait</b>\nSource: Reuters\n\n<i>Sent 12:00</i>']);
});
test('N2. a missing source (absent, undefined, null, empty) does not throw: the alert goes out with NO Source line', async () => {
  for (const src of [{}, { source: undefined }, { source: null }, { source: '' }]) {
    const { sent, fired } = await newsRun([{ id: 2, headline: H1, ...src }]);
    assert.deepEqual(sent, ['🚨 <b>Breaking Alert</b>\n\n<b>Missile attack closes the strait</b>\n\n<i>Sent 12:00</i>'], JSON.stringify(src)); assert.equal(fired.length, 1); assert.doesNotMatch(sent[0], /Source/);
  }
});
test('N3. a sourceless item no longer drops the rest of the run: the next items still send, in order', async () => {
  const { sent, fired } = await newsRun([{ id: 3, headline: H1 }, { id: 4, headline: H2, source: 'AP' }, { id: 5, headline: H1 + ' again' }]);
  assert.equal(sent.length, 3, `expected 3 alerts, got ${sent.length}`); assert.equal(fired.length, 3); assert.ok(sent[1].includes('Source: AP') && !sent[0].includes('Source') && !sent[2].includes('Source'));
  assert.equal(classifyNews(H1), 'red', 'CONTROL: the headline is a breaking one'); assert.equal(classifyNews(H2), 'red');
});

/* ── W: the real whale alert (both venues) ── */
type Trades = { bybit?: unknown[]; binance?: unknown[] };
async function whaleRun(t: Trades): Promise<{ queue: Array<{ body: string; title: string }>; fired: string[] }> {
  const queue: Array<{ body: string; title: string }> = [];
  const fn = build<(stamp: string, queue: unknown[], skip: unknown) => Promise<string[]>>(ALERT, 'checkWhales', ['runBatched', 'fmtSignalPrice', 'CD'], {
    BYBIT_SYMS: { hype: 'HYPEUSDT' }, BINANCE_PERP: { fet: 'FETUSDT' }, WHALE_THRESHOLD: { hype: 500_000, fet: 250_000 }, LABELS: { hype: 'HYPE', fet: 'FET' }, symbolDenominationFactor,
    fetchOrSkip: async (url: string) => ({ json: async () => url.includes('bybit.com') ? { result: { list: t.bybit ?? [] } } : (t.binance ?? []) }),
    onCooldown: () => false, markSent: () => {},
  });
  const fired = await fn(STAMP, queue, {}); for (const q of queue) clean(q.body + q.title, 'whale alert'); return { queue, fired };
}
const bb = (size: unknown, price: unknown = '20', side = 'Buy') => ({ time: String(Date.now()), price, size, side });
const bn = (q: unknown, p: unknown = '0.5', m = false) => ({ p, q, m });
const HYPE_AT = bb('25000');   // 20 x 25000 = 500000 exactly
const FET_AT = bn('500000');   // 0.5 x 500000 = 250000 exactly

test('W1. Bybit venue: a size at the threshold queues (control), a NaN, undefined, empty, missing or below-threshold size queues nothing', async () => {
  const ok = await whaleRun({ bybit: [HYPE_AT] }); assert.equal(ok.queue.length, 1, 'CONTROL: an at-threshold trade must queue');
  assert.equal(ok.queue[0].body, '🐋 <b>HYPE Whale BUY Detected</b>\n\nSize: <b>$500K</b> at $20.0000\nSignal: Large aggressive buy\n\n<i>Sent 12:00</i>'); assert.equal(ok.queue[0].title, 'Whale BUY $500K');
  for (const [name, trade] of [['NaN size', bb('x')], ['undefined size', bb(undefined)], ['empty size', bb('')], ['NaN price', bb('25000', 'x')], ['no fields', { time: String(Date.now()) }], ['just under', bb('24999.99')], ['far under', bb('1')]] as const) {
    const { queue, fired } = await whaleRun({ bybit: [trade] }); assert.equal(queue.length, 0, `${name}: queued ${JSON.stringify(queue)}`); assert.deepEqual(fired, [], name);
  }
});
test('W2. Binance venue (FET): the same, a size at the threshold queues, a NaN / undefined / below-threshold size does not', async () => {
  const ok = await whaleRun({ binance: [FET_AT] }); assert.equal(ok.queue.length, 1, 'CONTROL: an at-threshold trade must queue');
  assert.equal(ok.queue[0].body, '🐋 <b>FET Whale BUY Detected</b>\n\nSize: <b>$250K</b> at $0.5000\nSignal: Large aggressive buy\n\n<i>Sent 12:00</i>');
  const sell = await whaleRun({ binance: [bn('500000', '0.5', true)] }); assert.match(sell.queue[0].body, /FET Whale SELL Detected[\s\S]*Large aggressive sell/);
  for (const [name, trade] of [['NaN size', bn('x')], ['undefined size', bn(undefined)], ['empty size', bn('')], ['NaN price', bn('500000', 'x')], ['no fields', {}], ['just under', bn('499999')], ['far under', bn('1')]] as const) {
    const { queue, fired } = await whaleRun({ binance: [trade] }); assert.equal(queue.length, 0, `${name}: queued ${JSON.stringify(queue)}`); assert.deepEqual(fired, [], name);
  }
});
test('W3. a garbled trade FIRST does not hide a real one behind it (both venues): exactly the real one is queued, with a clean size', async () => {
  const a = await whaleRun({ bybit: [bb('x'), bb(undefined), bb('100000')] }); assert.equal(a.queue.length, 1); assert.match(a.queue[0].body, /Size: <b>\$2\.00M<\/b> at \$20\.0000/);
  const b = await whaleRun({ binance: [bn('x'), bn('1'), bn('1000000')] }); assert.equal(b.queue.length, 1); assert.match(b.queue[0].body, /Size: <b>\$500K<\/b> at \$0\.5000/);
});
test('W4. both venues in one run: each queues its own at-threshold trade and nothing else', async () => {
  const { queue, fired } = await whaleRun({ bybit: [bb('x'), HYPE_AT], binance: [bn('x'), FET_AT] });
  assert.equal(queue.length, 2); assert.deepEqual(fired, ['HYPE whale BUY $500K', 'FET whale BUY $250K']);
});
