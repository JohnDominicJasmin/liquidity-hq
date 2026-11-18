import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { isValidSoundPrefs, normaliseSoundPrefs } from '../lib/arenaSoundPrefs.ts';
import { readMove } from '../lib/arenaSoundTriggers.ts';
import { SOUND_IDS, previewSound, playPing, unlockAudio, audioReady } from '../lib/arenaSound.ts';
import { useArenaSounds } from '../lib/useArenaSounds.ts';
import { FREE_FALLBACK_TF, GATED_TFS, ARENA_TFS, isGatedTf } from '../lib/limits.ts';

/* QA's units for PR #2561 (Arena sound picker). Expected numbers are the owner's written spec (big move 2.5x body, volume spike 3x volume,
 * volume 0-1, 8 sounds, 3 triggers, Free fallback 30m), typed here as literals - never read back from the constants under test. */

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const VALID = { sound: 'chime', volume: 0.6, on: { signal: true, move: true, volume: true } };
const DEFAULTS = { sound: 'chime', volume: 0.6, on: { signal: true, move: true, volume: true } };

/* ---------- 1. validate / normalise ---------- */
test('P1. isValidSoundPrefs: a valid object and null pass; every bad shape is refused', () => {
  assert.equal(isValidSoundPrefs(VALID), true);
  assert.equal(isValidSoundPrefs(null), true, 'null = defaults, allowed');
  assert.equal(isValidSoundPrefs({ ...VALID, sound: 'drop', volume: 0 }), true, 'volume 0 is allowed (silent)');
  assert.equal(isValidSoundPrefs({ ...VALID, volume: 1 }), true, 'volume 1 is the maximum, allowed');
  assert.equal(isValidSoundPrefs({ ...VALID, sound: 'kazoo' }), false, 'unknown sound id');
  assert.equal(isValidSoundPrefs({ ...VALID, volume: 1.5 }), false);
  assert.equal(isValidSoundPrefs({ ...VALID, volume: -0.1 }), false);
  assert.equal(isValidSoundPrefs({ ...VALID, volume: Number.NaN }), false);
  assert.equal(isValidSoundPrefs({ ...VALID, volume: '0.5' }), false);
  assert.equal(isValidSoundPrefs({ ...VALID, extra: 1 }), false, 'an extra unknown key');
  assert.equal(isValidSoundPrefs({ ...VALID, on: { ...VALID.on, extra: true } }), false, 'an extra key inside on');
  assert.equal(isValidSoundPrefs({ ...VALID, on: { signal: true, move: true } }), false, 'a missing trigger');
  assert.equal(isValidSoundPrefs({ ...VALID, on: { signal: true, move: true, volume: 'yes' } }), false, 'a non-boolean trigger');
  assert.equal(isValidSoundPrefs({ sound: 'chime', volume: 0.6 }), false, 'on missing');
  for (const bad of [undefined, 'chime', 5, true, [], [VALID]]) assert.equal(isValidSoundPrefs(bad), false, JSON.stringify(bad));
});

test('P2. normaliseSoundPrefs: null and garbage give the defaults; a good object passes through; one bad field falls back alone', () => {
  assert.deepEqual(normaliseSoundPrefs(null), DEFAULTS);
  assert.deepEqual(normaliseSoundPrefs(undefined), DEFAULTS);
  for (const g of ['x', 7, [], true, { sound: 5, volume: 'loud', on: 'no' }]) assert.deepEqual(normaliseSoundPrefs(g), DEFAULTS, JSON.stringify(g));
  const good = { sound: 'marimba', volume: 0.25, on: { signal: false, move: true, volume: false } };
  assert.deepEqual(normaliseSoundPrefs(good), good);
  assert.deepEqual(normaliseSoundPrefs({ ...good, volume: 9 }), { ...good, volume: 0.6 }, 'out-of-range volume takes the default, the rest is kept');
  assert.deepEqual(normaliseSoundPrefs({ ...good, sound: 'nope' }), { ...good, sound: 'chime' });
  assert.deepEqual(normaliseSoundPrefs({ sound: 'bell' }).on, { signal: true, move: true, volume: true }, 'missing triggers default to ON');
});

/* ---------- 1b. readMove boundaries ---------- */
const TF = 3_600_000;
const NOW = Date.now();
type B = { timestamp: number; open: number; high: number; low: number; close: number; volume: number };
/** 20 closed bars (body 10, volume 100 -> averages exactly 10 and 100) then a forming bar with the given body and volume. */
function bars(body: number, vol: number): B[] {
  const out: B[] = [];
  for (let i = 0; i < 20; i++) out.push({ timestamp: NOW - (21 - i) * TF, open: 100, close: 110, high: 111, low: 99, volume: 100 });
  out.push({ timestamp: NOW - 1000, open: 100, close: 100 + body, high: 100 + body, low: 99, volume: vol });
  return out;
}
test('P3. big move trigger: body 2.5x the average is a hit, just under is not (volume irrelevant)', () => {
  assert.equal(readMove(bars(25, 100), TF, NOW)!.bigMove, true, 'exactly 2.5x');
  assert.equal(readMove(bars(24.99, 100), TF, NOW)!.bigMove, false, 'just under 2.5x');
  assert.equal(readMove(bars(25, 1), TF, NOW)!.bigMove, true, 'a big move needs no volume');
  assert.equal(readMove(bars(10, 100), TF, NOW)!.bigMove, false, 'average body is not a big move');
});
test('P4. volume spike trigger: volume 3x the average is a hit, just under is not (body irrelevant)', () => {
  assert.equal(readMove(bars(10, 300), TF, NOW)!.volumeSpike, true, 'exactly 3x');
  assert.equal(readMove(bars(10, 299.9), TF, NOW)!.volumeSpike, false, 'just under 3x');
  assert.equal(readMove(bars(0.1, 300), TF, NOW)!.volumeSpike, true, 'a spike needs no big body');
  assert.equal(readMove(bars(10, 100), TF, NOW)!.volumeSpike, false);
});
test('P5. a quiet candle is never a hit on either trigger, and the two triggers are independent', () => {
  const q = readMove(bars(5, 50), TF, NOW)!;
  assert.equal(q.bigMove, false); assert.equal(q.volumeSpike, false); assert.equal(q.hit, false);
  const both = readMove(bars(25, 300), TF, NOW)!;
  assert.equal(both.bigMove, true); assert.equal(both.volumeSpike, true);
  const moveOnly = readMove(bars(25, 100), TF, NOW)!;
  assert.equal(moveOnly.bigMove, true); assert.equal(moveOnly.volumeSpike, false);
});

/* ---------- Web Audio stub ---------- */
interface Osc { type: string; freq: number; peak: number }
const made: Osc[] = [];
const timers: Array<() => void> = [];
class StubCtx {
  state = 'running'; currentTime = 0; destination = {};
  createOscillator() {
    const o: Osc = { type: '', freq: 0, peak: 0 };
    made.push(o);
    const node: Record<string, unknown> = { frequency: { set value(v: number) { o.freq = v; } }, connect: (n: unknown) => n, start() {}, stop() {} };
    Object.defineProperty(node, 'type', { set(v: string) { o.type = v; }, get() { return o.type; } });
    return node;
  }
  createGain() {
    const cur = made[made.length - 1];
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime(v: number) { if (v > cur.peak) cur.peak = v; } }, connect: (n: unknown) => n };
  }
  resume() { return Promise.resolve(); }
}
(globalThis as unknown as { window: unknown }).window = { AudioContext: StubCtx, setTimeout: (f: () => void) => { timers.push(f); return 1; } };
const flush = () => { while (timers.length) timers.shift()!(); };

/* ---------- 2. sounds, volume, preview ---------- */
test('S1. exactly 8 sounds, the owner\'s eight, each with a label key, an English default and a Settings mapping', () => {
  assert.deepEqual([...SOUND_IDS], ['chime', 'bell', 'pop', 'marimba', 'beep', 'soft', 'digital', 'drop']);
  const keys = src('lib/labelKeys.ts'), en = JSON.parse(src('lib/labelDefaults.en.json')), page = src('app/(main)/settings/page.tsx');
  for (const id of ['chime', 'bell', 'pop', 'marimba', 'beep', 'soft', 'digital', 'drop']) {
    const k = `SETTINGS_SOUND_${id.toUpperCase()}`;
    assert.ok(keys.includes(`'${k}'`), `${k} in labelKeys`);
    assert.equal(typeof en[k], 'string', `${k} in labelDefaults.en.json`);
    assert.ok(page.includes(`${id}: '${k}'`), `${k} mapped for ${id} in the Settings page`);
  }
});

test('S2. every one of the 8 sounds plays and they are not all the same tone', () => {
  assert.equal(unlockAudio(), true); assert.equal(audioReady(), true);
  const sigs = new Set<string>();
  for (const id of SOUND_IDS) {
    made.length = 0;
    assert.equal(playPing('buy', { sound: id, volume: 1 }), true, id);
    assert.equal(made.length, 2, `${id}: a buy is two notes`);
    sigs.add(JSON.stringify(made.map(o => [o.type, Math.round(o.freq)])));
  }
  assert.equal(sigs.size, 8, 'eight distinct (waveform, pitch) signatures');
});

test('S3. volume scales the playback gain linearly, is clamped to 0-1, and 0 is silent', () => {
  const peak = (v: number | undefined) => { made.length = 0; playPing('buy', { sound: 'bell', volume: v }); return made[0]?.peak; };
  const full = peak(1)!;
  assert.ok(full > 0.0002 && full < 1, 'a sane gain at full volume');
  assert.ok(Math.abs(peak(0.5)! - full * 0.5) < 1e-9, 'half volume = half gain');
  assert.ok(Math.abs(peak(0.25)! - full * 0.25) < 1e-9, 'quarter volume = quarter gain');
  assert.equal(peak(1.5), full, 'above 1 is clamped to 1');
  assert.equal(peak(-1), undefined, 'below 0 plays nothing');
  assert.equal(peak(0), undefined, 'volume 0 plays nothing');
  assert.ok(Math.abs(peak(undefined)! - full * 0.6) < 1e-9, 'no volume given = the old loudness, 0.6');
  assert.ok(Math.abs(peak(Number.NaN)! - full * 0.6) < 1e-9, 'NaN falls back to 0.6, never a NaN gain');
});

test('S4. tapping a sound previews it: the gesture unlocks audio first, then that sound plays at the saved volume', () => {
  made.length = 0; timers.length = 0;
  previewSound('marimba', 0.5);
  assert.equal(made.length, 0, 'nothing plays inside the tap itself; it is deferred a tick so resume() can finish');
  assert.equal(timers.length, 1, 'one deferred play');
  flush();
  assert.equal(made.length, 2, 'the buy ping of that sound');
  const ref = (v: number) => { made.length = 0; playPing('buy', { sound: 'marimba', volume: v }); return made[0].peak; };
  const got = (made.length = 0, timers.length = 0, previewSound('marimba', 0.5), flush(), made[0].peak);
  assert.equal(got, ref(0.5), 'preview used the passed (saved) volume');
  assert.notEqual(got, ref(1));
  const page = src('app/(main)/settings/page.tsx');
  assert.ok(/onClick=\{\(\) => \{ previewSound\(id, prefs\.volume\);/.test(page), 'the chip tap calls previewSound(id, prefs.volume)');
  assert.ok(/onPointerUp=\{\(\) => previewSound\(prefs\.sound, prefs\.volume\)\}/.test(page), 'the slider release previews at the new volume');
  assert.ok(/export function previewSound[\s\S]{0,200}unlockAudio\(\);/.test(src('lib/arenaSound.ts')), 'previewSound unlocks audio from the gesture first');
});

/* ---------- 3. triggers through the real hook ---------- */
function hook(prefs: unknown, enabled = true) {
  let cb: (i: { coin: string; tf: string; bars: B[] }) => void = () => {};
  function C() { cb = useArenaSounds({ enabled, coin: 'BTC', tf: '1h', signal: null, prefs: normaliseSoundPrefs(prefs) }).onLiveBars; return null; }
  renderToString(createElement(C));
  return (body: number, vol: number) => cb({ coin: 'BTC', tf: '1h', bars: bars(body, vol) });
}
const prefsOn = (o: Partial<{ signal: boolean; move: boolean; volume: boolean }>) => ({ sound: 'bell', volume: 0.8, on: { signal: true, move: true, volume: true, ...o } });
/** Oscillators created by one reading. A move ping is ONE note, a volume ping is TWO. */
const notes = (run: () => void) => { made.length = 0; run(); return made.length; };

test('T1. big move plays one note, volume spike plays two, a quiet candle plays nothing', () => {
  const feed = hook(prefsOn({}));
  assert.equal(notes(() => feed(25, 100)), 1, 'big move only');
  assert.equal(notes(() => hook(prefsOn({}))(10, 300)), 2, 'volume spike only');
  assert.equal(notes(() => hook(prefsOn({}))(5, 50)), 0, 'quiet');
  assert.equal(notes(() => hook(prefsOn({}))(24.99, 299.9)), 0, 'just under both thresholds');
});
test('T2. each trigger switched OFF never plays; the others still do; enabled=false plays nothing', () => {
  assert.equal(notes(() => hook(prefsOn({ move: false }))(25, 300)), 2, 'move off: only the volume spike');
  assert.equal(notes(() => hook(prefsOn({ volume: false }))(25, 300)), 1, 'volume off: only the big move');
  assert.equal(notes(() => hook(prefsOn({ move: false, volume: false }))(25, 300)), 0, 'both off: silence');
  assert.equal(notes(() => hook(prefsOn({}))(25, 300)), 3, 'both on: both play');
  assert.equal(notes(() => hook(prefsOn({}), false)(25, 300)), 0, 'master switch off');
});
test('T3. each trigger plays at most once per candle', () => {
  const feed = hook(prefsOn({}));
  assert.equal(notes(() => { feed(25, 300); feed(26, 310); feed(25, 300); }), 3, 'three readings of one candle = one move + one volume ping');
});
test('T4. the signal ping is gated by on.signal (source pin: effects do not run in a server render)', () => {
  const s = src('lib/useArenaSounds.ts');
  assert.ok(/if \(kind && enabled && ctxRef\.current\.prefs\.on\.signal\) playPing\(kind,/.test(s), 'buy/sell only plays when on.signal');
  assert.ok(/cur\.prefs\.on\.move && r\.bigMove/.test(s) && /cur\.prefs\.on\.volume && r\.volumeSpike/.test(s));
});

/* ---------- 3b. save path ---------- */
test('A1. /api/settings allowlists arena_sound_prefs and refuses an invalid shape BEFORE any database write', () => {
  const r = src('app/api/settings/route.ts');
  const allowed = r.slice(r.indexOf('const ALLOWED'), r.indexOf('];', r.indexOf('const ALLOWED')));
  assert.ok(allowed.includes("'arena_sound_prefs'"), 'allowlisted');
  const check = r.indexOf("!isValidSoundPrefs(payload.arena_sound_prefs)");
  assert.ok(check > 0, 'validated with isValidSoundPrefs');
  assert.ok(/!isValidSoundPrefs\(payload\.arena_sound_prefs\)\) \{\s*return NextResponse\.json\(\{ error: 'Invalid arena_sound_prefs' \}, \{ status: 400 \}\)/.test(r), 'invalid = 400');
  assert.ok(check < r.indexOf('.upsert('), 'the check comes before the upsert');
});
test('A2. settings.ts reads the column back (object only, else null) and the default is null', () => {
  const s = src('lib/settings.ts');
  assert.ok(/arena_sound_prefs:\s+null,/.test(s), 'DEFAULT_SETTINGS.arena_sound_prefs = null');
  assert.ok(/arena_sound_prefs: row\.arena_sound_prefs && typeof row\.arena_sound_prefs === 'object' && !Array\.isArray\(row\.arena_sound_prefs\)/.test(s), 'rowToSettings keeps an object only');
  assert.ok(/normaliseSoundPrefs\(settings\.arena_sound_prefs\)/.test(src('app/(main)/arena/page.tsx')), 'the Arena normalises what it read');
  assert.ok(/normaliseSoundPrefs\(settings\.arena_sound_prefs\)/.test(src('app/(main)/settings/page.tsx')), 'Settings normalises what it read');
});

/* ---------- 4. lock chip ---------- */
test('C1. the lock chip is shown only while sound is enabled AND audio is locked, and one tap unlocks', () => {
  const c = src('components/ArenaSoundLockChip.tsx');
  assert.ok(/if \(!enabled \|\| !locked\) return null;/.test(c), 'hidden unless enabled and locked');
  assert.ok(/if \(!enabled\) \{ setLocked\(false\); return; \}/.test(c), 'switching sound off clears it');
  assert.ok(/setLocked\(!audioReady\(\)\)/.test(c), 'locked is read from the audio state');
  assert.ok(/onClick=\{\(\) => \{ unlockAudio\(\);/.test(c), 'the tap calls unlockAudio inside the click');
  assert.ok(/enabled=\{settingsLoadStatus === 'ready' && settings\.arena_sound === true\}/.test(src('app/(main)/arena/page.tsx')), 'Arena passes the saved yes only once settings are loaded');
});

/* ---------- 5. Free fallback ---------- */
test('F1. the Free fallback is 30m: 15m lands on 30m, 1h is untouched, and 30m itself is a Free, real Arena timeframe', () => {
  assert.equal(FREE_FALLBACK_TF, '30m');
  for (const t of ['1m', '5m', '15m']) assert.equal(isGatedTf(t), true, `${t} is Pro-only`);
  for (const t of ['30m', '1h', '2h', '4h', '1d']) assert.equal(isGatedTf(t), false, `${t} is Free (so it is never rewritten)`);
  assert.deepEqual([...GATED_TFS], ['1m', '5m', '15m']);
  assert.ok((ARENA_TFS as readonly string[]).includes('30m'));
  assert.equal(isGatedTf(FREE_FALLBACK_TF), false, 'the fallback is not itself gated (no clamp loop)');
});
test('F2. both places use it, and only for a Free (not_entitled) account: Settings chip display and Arena load', () => {
  const st = src('app/(main)/settings/page.tsx'), ar = src('app/(main)/arena/page.tsx');
  assert.ok(/const shownTf = entitlementStatus === 'not_entitled' && isGatedTf\(settings\.default_tf\) \? FREE_FALLBACK_TF : settings\.default_tf;/.test(st), 'Settings: only Free + a gated saved tf is shown as the fallback; a Pro account shows its own');
  assert.ok(/aria-pressed=\{shownTf === tf\}/.test(st));
  assert.ok(/const FREE_FALLBACK_TF = LIMIT_FREE_FALLBACK_TF as ChartTf;/.test(ar), 'Arena takes the fallback from lib/limits (one source)');
  assert.ok(/if \(authLoading \|\| entitlementsLoading \|\| entitlementStatus !== 'not_entitled'\) return;\s*if \(GATED_TFS\.includes\(readTf\)\) setReadTf\(FREE_FALLBACK_TF\);/.test(ar), 'Arena: clamp acts only for not_entitled, only on a gated tf');
});
