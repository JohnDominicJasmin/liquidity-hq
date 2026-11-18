/* #2574 (QA): the pure half of the Telegram "Mute 1 h / Mute 4 h" buttons (lib/alertTypeMute.ts) and the notification-threshold ranges (lib/alertThresholdRanges.ts). No database, no network.
 *   A1  the allowlist: exactly six callback strings parse (3 rule keys x 1 / 4 hours); every hostile string is null (unknown type, hours 0 / -1 / 99999 / NaN / "1h" / "1;drop" / "01" / "1 ", a 5 KB tail, other prefix, wrong case, an extra field naming an account or a chat, prototype keys, non-strings)
 *   A2  every button's callback_data is under Telegram's 64-byte limit and round-trips through the parser
 *   A3  withTypeMute: now + 1 h / 4 h exactly; the other types are kept; expired ones are dropped; the LATEST tap wins (a 1 h tap after a 4 h one SHORTENS it: stated, pinned)
 *   A4  isTypeMuted / activeTypeMuteKeys: true only before the stored time; a missing, garbage or past time is not muted; a key that is not one of the three is ignored by readTypeMutes
 *   A5  typeMuteKeyboard: one type -> exactly two buttons "Mute 1 h" / "Mute 4 h"; no type -> null; several types -> one row per type with the type named
 *   T1  the six threshold fields: min / max exactly as listed; squeeze tops out at 80 (the highest score calcSqueezeScore can produce: 40 + 40); clampThreshold brings a value inside, refuses a non-number
 * WHAT IT CANNOT PROVE: the route, the webhook or the page: those are the harness cells (qa/harness/telegramTypeMute.test.mts). */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTypeMuteCallback, isTypeMuteCallback, typeMuteCallbackData, withTypeMute, isTypeMuted, activeTypeMuteKeys, readTypeMutes,
  typeMuteKeyboard, typeMuteConfirmation, TYPE_MUTE_RULE_KEYS, TYPE_MUTE_HOURS,
} from '../lib/alertTypeMute.ts';
import { THRESHOLD_RANGES, SQUEEZE_SCORE_MAX, clampThreshold, isThresholdField } from '../lib/alertThresholdRanges.ts';

const T0 = Date.UTC(2026, 10, 18, 12, 0, 0);
const H = 3_600_000;

test('A1. the allowlist: six callback strings parse, every hostile string is null', () => {
  const valid: string[] = [];
  for (const k of ['oi_spike', 'cvd', 'rapid_move']) for (const h of [1, 4]) valid.push(`tmute:${k}:${h}`);
  assert.equal(valid.length, 6);
  for (const v of valid) { const p = parseTypeMuteCallback(v); assert.ok(p, `${v} should parse`); assert.equal(`tmute:${p!.ruleKey}:${p!.hours}`, v); }
  const hostile: unknown[] = [
    'tmute:oi_spike:0', 'tmute:oi_spike:-1', 'tmute:oi_spike:99999', 'tmute:oi_spike:NaN', 'tmute:oi_spike:1h', 'tmute:oi_spike:1;drop table x', 'tmute:oi_spike:01', 'tmute:oi_spike:1 ', ' tmute:oi_spike:1', 'tmute:oi_spike:1\n',
    'tmute:oi_spike:2', 'tmute:oi_spike:1.0', 'tmute:oi_spike:1e0', 'tmute:oi_spike:0x1', 'tmute:oi_spike:', 'tmute:oi_spike', 'tmute:', 'tmute', '',
    'tmute:rsi:1', 'tmute:squeeze:4', 'tmute:whales:1', 'tmute:__proto__:1', 'tmute:constructor:1', 'tmute:toString:1', 'tmute:oi_spike:1:u-other', 'tmute:oi_spike:1:1002', 'tmute:oi_spike:1:-100123',
    `tmute:oi_spike:1${'x'.repeat(5000)}`, 'tmute:' + 'a'.repeat(5000),
    'mute:oi_spike:1', 'link:ABC123', 'TMUTE:oi_spike:1', 'Tmute:oi_spike:1', 'tmute :oi_spike:1', 'xtmute:oi_spike:1',
    undefined, null, 5, {}, [], ['tmute:oi_spike:1'], true,
  ];
  for (const h of hostile) assert.equal(parseTypeMuteCallback(h as string), null, `hostile ${JSON.stringify(h)?.slice(0, 60)} must be null`);
  assert.equal(isTypeMuteCallback('tmute:anything'), true, 'the prefix routes to this feature even when the rest is invalid (so it never reaches the link flow)');
  assert.equal(isTypeMuteCallback('link:ABC'), false); assert.equal(isTypeMuteCallback(undefined), false); assert.equal(isTypeMuteCallback('TMUTE:x'), false);
});

test('A2. every callback_data is under 64 bytes and round-trips', () => {
  for (const k of TYPE_MUTE_RULE_KEYS) for (const h of TYPE_MUTE_HOURS) {
    const d = typeMuteCallbackData(k, h); assert.ok(Buffer.byteLength(d) <= 64, d); assert.deepEqual(parseTypeMuteCallback(d), { ruleKey: k, hours: h });
  }
});

test('A3. withTypeMute: now + exactly 1 h / 4 h; others kept; expired dropped; the latest tap wins (1 h after 4 h shortens)', () => {
  assert.equal(withTypeMute(null, 'cvd', 1, T0).cvd, new Date(T0 + H).toISOString());
  assert.equal(withTypeMute(undefined, 'cvd', 4, T0).cvd, new Date(T0 + 4 * H).toISOString());
  const base = { oi_spike: new Date(T0 + 2 * H).toISOString(), rapid_move: new Date(T0 - 1).toISOString() };
  const next = withTypeMute(base, 'cvd', 1, T0);
  assert.equal(next.oi_spike, base.oi_spike, 'the other live type is kept'); assert.equal('rapid_move' in next, false, 'an expired one is dropped'); assert.equal(next.cvd, new Date(T0 + H).toISOString());
  const four = withTypeMute(null, 'oi_spike', 4, T0); const then1 = withTypeMute(four, 'oi_spike', 1, T0 + 60_000);
  assert.equal(then1.oi_spike, new Date(T0 + 60_000 + H).toISOString(), 'STATED: a later 1 h tap replaces a running 4 h mute, so it ends EARLIER than the 4 h one would have');
  assert.ok(Date.parse(then1.oi_spike) < Date.parse(four.oi_spike));
  const replay = withTypeMute(withTypeMute(null, 'cvd', 1, T0), 'cvd', 1, T0 + 30 * 60_000);
  assert.equal(replay.cvd, new Date(T0 + 30 * 60_000 + H).toISOString(), 'STATED: a replayed tap restarts the hour from the replay (it EXTENDS a same-length mute)');
});

test('A4. isTypeMuted / activeTypeMuteKeys / readTypeMutes', () => {
  const m = { cvd: new Date(T0 + H).toISOString(), oi_spike: 'not a date', rapid_move: new Date(T0).toISOString() };
  assert.equal(isTypeMuted(m, 'cvd', T0), true); assert.equal(isTypeMuted(m, 'cvd', T0 + H - 1), true); assert.equal(isTypeMuted(m, 'cvd', T0 + H), false, 'ends AT the stored time');
  assert.equal(isTypeMuted(m, 'oi_spike', T0), false, 'garbage is not muted'); assert.equal(isTypeMuted(m, 'rapid_move', T0), false, 'a time equal to now is over');
  assert.equal(isTypeMuted(null, 'cvd', T0), false); assert.equal(isTypeMuted({}, 'cvd', T0), false); assert.equal(isTypeMuted(m, 'rsi', T0), false);
  assert.deepEqual(activeTypeMuteKeys(m, T0), ['cvd']);
  assert.deepEqual(readTypeMutes({ cvd: 'x', rsi: 'y', oi_spike: 5, rapid_move: 'z' }), { cvd: 'x', rapid_move: 'z' }, 'a non-feature key or a non-string value is dropped');
  for (const bad of [null, undefined, 'a string', 5, [], [['cvd', 'x']], true]) assert.deepEqual(readTypeMutes(bad), {});
  assert.equal(typeMuteConfirmation('oi_spike', 1), 'Open interest alerts muted for 1 h.');
});

test('A5. the keyboard: one type = two buttons; none = null; several = one row per type, named', () => {
  assert.equal(typeMuteKeyboard(['rsi']), null); assert.equal(typeMuteKeyboard([]), null); assert.equal(typeMuteKeyboard(['ema_signal_1h', 'whales', 'squeeze', 'price_alerts']), null);
  for (const [k, d] of [['oi_spike', 'tmute:oi_spike:'], ['cvd', 'tmute:cvd:'], ['rapid_move', 'tmute:rapid_move:']] as const) {
    assert.deepEqual(typeMuteKeyboard([k]), { inline_keyboard: [[{ text: 'Mute 1 h', callback_data: `${d}1` }, { text: 'Mute 4 h', callback_data: `${d}4` }]] });
    assert.deepEqual(typeMuteKeyboard([k, k]), typeMuteKeyboard([k]), 'two entries of one type: still the plain two buttons');
  }
  const multi = typeMuteKeyboard(['rapid_move', 'rsi', 'oi_spike'])!;
  assert.equal(multi.inline_keyboard.length, 2); assert.deepEqual(multi.inline_keyboard.map(r => r.map(b => b.text)), [['Mute Open interest 1 h', 'Mute Open interest 4 h'], ['Mute Rapid move 1 h', 'Mute Rapid move 4 h']]);
  const withRsiOnly = typeMuteKeyboard(['oi_spike', 'rsi'])!; assert.deepEqual(withRsiOnly.inline_keyboard[0].map(b => b.text), ['Mute Open interest 1 h', 'Mute Open interest 4 h'], 'one muteable type beside a non-muteable one is named, not generic');
});

test('T1. the threshold ranges and the clamp', () => {
  assert.deepEqual(THRESHOLD_RANGES, {
    fr_threshold: { min: 0.01, max: 0.5 }, fng_fear: { min: 1, max: 40 }, fng_greed: { min: 60, max: 99 },
    rsi_ob: { min: 60, max: 90 }, rsi_os: { min: 10, max: 40 }, squeeze_threshold: { min: 40, max: 80 },
  });
  assert.equal(SQUEEZE_SCORE_MAX, 80);
  assert.equal(clampThreshold('squeeze_threshold', 95), 80); assert.equal(clampThreshold('squeeze_threshold', 80), 80); assert.equal(clampThreshold('squeeze_threshold', 81), 80); assert.equal(clampThreshold('squeeze_threshold', 39), 40); assert.equal(clampThreshold('squeeze_threshold', 70), 70);
  assert.equal(clampThreshold('rsi_ob', 100), 90); assert.equal(clampThreshold('rsi_os', 0), 10); assert.equal(clampThreshold('fr_threshold', 0), 0.01); assert.equal(clampThreshold('fng_greed', 100), 99);
  for (const bad of ['70', null, undefined, NaN, Infinity, -Infinity, {}, [], true]) assert.equal(clampThreshold('squeeze_threshold', bad), null, `${String(bad)} is refused`);
  assert.equal(isThresholdField('squeeze_threshold'), true); for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'telegram_chat_id', 'alert_type_mutes', '']) assert.equal(isThresholdField(k), false, k);
});

test('T2. a squeeze threshold stored ABOVE the new max (95, saved when the field allowed it): the page shows 80, the cron uses 80 (source pin)', async () => {
  const { rowToSettings, DEFAULT_SETTINGS } = await import('../lib/settings.ts');
  assert.equal(rowToSettings({ squeeze_threshold: 95 }).squeeze_threshold, 80, 'the page would show a value no alert can reach');
  assert.equal(rowToSettings({ squeeze_threshold: 80 }).squeeze_threshold, 80); assert.equal(rowToSettings({ squeeze_threshold: 55 }).squeeze_threshold, 55);
  assert.equal(rowToSettings({}).squeeze_threshold, DEFAULT_SETTINGS.squeeze_threshold);
  const { readFileSync } = await import('node:fs');
  const cron = readFileSync('app/api/telegram/alert/route.ts', 'utf8');
  assert.match(cron, /squeezeThreshold: typeof row\.squeeze_threshold === 'number' \? Math\.min\(row\.squeeze_threshold, SQUEEZE_SCORE_MAX\)/, 'the cron no longer caps a stored 95 at 80');
});
