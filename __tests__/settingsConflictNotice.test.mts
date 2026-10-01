/* #1285/#1292: a save the server accepted but that lost one or more fields to a newer write from another
 * device used to report `saveStatus: 'error'` - the exact same status and toast wording as a genuine save
 * failure. Tab B in the issue's repro got a 200, had its stale value silently replaced with the server's real
 * one, and the toast said "Failed" though nothing failed. Fix adds a fourth status, `'conflict'`, distinct
 * from `'error'` end to end: lib/settings.ts's type, components/SettingsProvider.tsx's branch, and
 * components/SettingsSaveToast.tsx's render.
 *
 * Structure only, same limit as every component file tonight: `saveStatus`/`visible` are closures inside
 * these components, no exported decision function, no DOM test library in this repo. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const provider = stripComments(read('components/SettingsProvider.tsx'));
const toastSrc = stripComments(read('components/SettingsSaveToast.tsx'));
const settingsLib = stripComments(read('lib/settings.ts'));
const css = read('app/globals.css').replace(/\/\*[\s\S]*?\*\//g, '');

function anchorOnce(src: string, needle: string, label: string): number {
  const n = src.split(needle).length - 1;
  assert.equal(n, 1, `${label}: anchor occurs ${n} time(s), expected exactly 1 - re-read the current source`);
  return src.indexOf(needle);
}

/* ══ lib/settings.ts and the provider: the decision ═══════════════════════════════════════════════════ */

test('S1. saveStatus\'s type includes conflict, distinct from error, in both the lib and the provider', () => {
  anchorOnce(settingsLib, "saveStatus: 'idle' | 'saving' | 'saved' | 'error' | 'conflict';", 'the context-value type');
  anchorOnce(provider, "useState<'idle' | 'saving' | 'saved' | 'error' | 'conflict'>('idle');", 'the provider\'s useState type');
});

test('S2. a save with rejected fields sets conflict, not error - and that branch runs only inside the SUCCESS path (a real network/attempt failure below still uses \'error\', which is correct and untouched by this fix)', () => {
  const successAt = anchorOnce(provider, "setSaveStatus(result.rejected.length > 0 ? 'conflict' : 'saved');", 'the success-path status branch');
  /* Two 'error' sets since the #1503 follow-up: the signed-out retry (before the request) and the genuine failure
     after every attempt. The genuine one is the one right after the failed patch is kept. */
  const failureAt = anchorOnce(provider, "lastFailedRef.current = partial;\n    setSaveStatus('error');", 'the genuine-failure status set');
  assert.ok(successAt < failureAt, 'the real-failure setSaveStatus(\'error\') comes before the success-path branch - order changed');
});

test('S3. the provider returns to idle after 3000ms for conflict and error, 2000ms for saved, through ONE timer helper', () => {
  anchorOnce(provider, "settleToIdle(result.rejected.length > 0 ? 3000 : 2000);", 'the success-path idle timer');
  anchorOnce(provider, "    setSaveStatus('error');\n    settleToIdle(3000);", 'the failure-path idle timer');
  assert.doesNotMatch(provider, /setTimeout\(\(\) => setSaveStatus\('idle'\)/, 'a bare idle timer is back - nothing can cancel it, and it resets a retry mid-flight');
});

/* #1503 follow-up (QA): the failure's own 3s idle timer used to fire during a retry started within 3s, clearing the
   retry's "Saving…" mid-flight. The timer now lives in a ref; a newer result replaces it and a new save cancels it. */
test('S3b. ONE pending idle timer: settleToIdle replaces the previous one, and a new save cancels it before "Saving…"', () => {
  anchorOnce(provider, 'const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);', 'the idle-timer ref');
  anchorOnce(provider, "if (idleTimerRef.current) clearTimeout(idleTimerRef.current);\n    idleTimerRef.current = setTimeout(() => { idleTimerRef.current = null; setSaveStatus('idle'); }, ms);", 'settleToIdle replaces the pending timer');
  const cancelAt = anchorOnce(provider, "if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }", 'a new save cancels the pending timer');
  const savingAt = provider.indexOf("setSaveStatus('saving');", cancelAt);
  assert.ok(savingAt > cancelAt && savingAt - cancelAt < 120, 'the cancel no longer sits right before setSaveStatus(\'saving\') - a stale timer can reset the new save');
});

test('S3c. a toast retry while signed out ends in error (not "Saving…" left on screen) and puts the failed change BACK, so a second "Try again" still has it to send; an ordinary signed-out save still returns quietly', () => {
  anchorOnce(provider, "if (!user) { if (lastFailedRef.current === null && retryingRef.current) { retryingRef.current = false; lastFailedRef.current = partial; setSaveStatus('error'); settleToIdle(3000); } return; }", 'the signed-out branch');
  anchorOnce(provider, 'retryingRef.current = true;\n    void flushToDb(failed);', 'retrySave marks the retry before flushing');
});

/* ══ SettingsSaveToast.tsx: the render ═══════════════════════════════════════════════════════════════ */

/* #1498 (owner, 2026-10-01) rebuilt the toast: top-centre, "Saved" 2s, "Updated from another device" 4s, and
   "Couldn't save" an alert that stays until the visitor retries or dismisses it. S4-S8 pin that state machine;
   the old S4-S8 pinned the bottom-right toast with one shared visibility timer and the FAB-hiding effect. */

test('S4. only saved and conflict are timed - 2000ms for saved, 4000ms for conflict - and a timer clears only the toast it was started for', () => {
  anchorOnce(toastSrc, "if (!toast || (toast.shown !== 'saved' && toast.shown !== 'conflict')) return;", 'the timer guard (saving and error get no timer)');
  anchorOnce(toastSrc, "toast.shown === 'saved' ? 2000 : 4000);", 'the per-state duration');
  anchorOnce(toastSrc, 'setToast(cur => (cur?.seq === seq ? null : cur))', 'the timer clears only its own toast (seq match)');
});

test('S5. the provider\'s reset to idle clears only a dangling "Saving…" and hands back the SAME toast object otherwise - so it neither clears "Couldn\'t save" nor restarts or cancels a dismiss timer', () => {
  anchorOnce(toastSrc, "setToast(prev => (prev?.shown === 'saving' ? null : prev));", 'the idle branch');
});

/* The race QA found on 2026-10-01 (#1498), on production 4936037, qa 136c4722 and c1f129b1: SettingsProvider resets
   saveStatus to 'idle' at 2000ms ('saved') or 3000ms, at or before the toast's own dismiss timer. While that timer
   lived in the effect keyed on [saveStatus], the reset ran the effect's cleanup and cancelled it, so "Saved" (and on
   the old toast, a fall-through "Couldn't save - try again") stayed on screen for good - 4 of 4 runs on /dashboard
   after the timezone PATCH. bddb5980 moved the timer into its own effect keyed on the toast. */
test('S5b. RACE: no setTimeout lives in the effect keyed on saveStatus, and the dismiss-timer effect does not depend on saveStatus', () => {
  const effects = [...toastSrc.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[([^\]]*)\]\);/g)].map((m) => ({ body: m[1], deps: m[2].split(',').map((d) => d.trim()) }));
  assert.ok(effects.length >= 1, 'CONTROL: no useEffect parsed - the effect shape changed, re-read the component');
  const onStatus = effects.filter((e) => e.deps.includes('saveStatus'));
  assert.equal(onStatus.length, 1, 'expected exactly one effect keyed on saveStatus');
  assert.doesNotMatch(onStatus[0].body, /setTimeout/, 'a timer is back inside the [saveStatus] effect - the provider\'s idle reset will cancel it');
  const timed = effects.filter((e) => /setTimeout/.test(e.body));
  assert.equal(timed.length, 1, 'expected exactly one effect that starts the dismiss timer');
  assert.ok(!timed[0].deps.includes('saveStatus'), 'the dismiss-timer effect depends on saveStatus - the provider\'s idle reset will cancel it');
  assert.deepEqual(timed[0].deps, ['toast'], 'the dismiss-timer effect is no longer keyed on the toast state alone');
});

test('S6. the FAB-hiding workaround is gone from the toast - the toast no longer shares a corner with the Ask AI button', () => {
  assert.doesNotMatch(toastSrc, /settings-toast-open/, 'SettingsSaveToast still toggles body.settings-toast-open');
});

test('S7. conflict gets its own CSS class, never "error" - which would paint it red - and the error toast carries "error" on its own element', () => {
  anchorOnce(toastSrc, "const cls = shown === 'conflict' ? ' conflict' : shown === 'saving' ? ' saving' : '';", 'the class ternary');
  anchorOnce(toastSrc, '<div className="st-save-toast error" role="alert">', 'the error toast element');
});

test('S8. conflict renders its own label, the error toast renders SETTINGS_SAVE_FAILED_TITLE, and the retired one-line FAILED text renders nowhere', () => {
  anchorOnce(toastSrc,
    "const text = shown === 'saving' ? t('SETTINGS_STATUS_SAVING')\n    : shown === 'saved' ? t('SETTINGS_STATUS_SAVED')\n    : t('SETTINGS_STATUS_CONFLICT');",
    'the text ternary');
  anchorOnce(toastSrc, "{t('SETTINGS_SAVE_FAILED_TITLE')}", 'the error title');
  assert.doesNotMatch(toastSrc, /SETTINGS_STATUS_FAILED/, 'the old "Couldn\'t save - try again" one-liner is rendered again');
});

test('S8b. roles: the error is role="alert" (announced at once), every other state is role="status" with aria-live="polite" - and none moves focus', () => {
  assert.equal(toastSrc.split('role="alert"').length - 1, 1, 'expected exactly one role="alert" (the error toast)');
  anchorOnce(toastSrc, '<div className={`st-save-toast${cls}`} role="status" aria-live="polite">', 'the status toast element');
  assert.doesNotMatch(toastSrc, /\.focus\(|autoFocus/, 'the toast moves focus');
});

test('S8c. "Try again" re-sends through the provider\'s retrySave, and the X has its own accessible name', () => {
  anchorOnce(toastSrc, "onClick={() => { setToast(prev => ({ shown: 'saving', seq: (prev?.seq ?? 0) + 1 })); retrySave(); }}", 'the retry handler');
  anchorOnce(toastSrc, "{t('SETTINGS_SAVE_RETRY_BUTTON')}", 'the retry label');
  anchorOnce(toastSrc, "aria-label={t('SETTINGS_SAVE_DISMISS_ARIA')}", 'the dismiss X accessible name');
  anchorOnce(toastSrc, 'onClick={() => setToast(null)}', 'the dismiss handler');
});

test('S8d. the provider keeps the failed patch and retrySave re-sends exactly that patch through flushToDb; the type is in lib/settings.ts', () => {
  /* One anchor for both lines: the patch is kept on the line BEFORE the error is shown, so a fast click on
     "Try again" always has something to re-send. */
  anchorOnce(provider, "lastFailedRef.current = partial;\n    setSaveStatus('error');", 'the failed patch is kept before the failure status');
  anchorOnce(provider, 'void flushToDb(failed);', 'retrySave re-sends the failed patch');
  anchorOnce(settingsLib, 'retrySave:  () => void;', 'the context type');
  assert.match(provider, /\[settings, loading, settingsLoadStatus, saveStatus, update, refresh, retrySave\]/, 'retrySave is missing from the context value\'s deps');
});

/* ══ CSS: the amber class, and its contrast ══════════════════════════════════════════════════════════ */

test('S9. .st-save-toast.conflict uses the amber tokens, not the pre-existing red/green/saving ones', () => {
  const rule = css.match(/\.st-save-toast\.conflict\s*\{([^}]*)\}/);
  assert.ok(rule, '.st-save-toast.conflict rule not found');
  assert.match(rule[1], /var\(--amber-bg\)/);
  assert.match(rule[1], /var\(--amber-bdr\)/);
  assert.match(rule[1], /var\(--amber\)/);
  assert.doesNotMatch(rule[1], /--red|--green/, 'the conflict toast still references a red or green token');
});

test('S10. the error toast takes clicks (pointer-events: auto) and its two buttons are real targets - 32px on desktop', () => {
  const err = css.match(/\.st-save-toast\.error\s*\{([^}]*)\}/);
  assert.ok(err, '.st-save-toast.error rule not found');
  assert.match(err[1], /pointer-events:\s*auto/, 'the error toast does not take clicks - "Try again" and the X would be dead');
  const retry = css.match(/\.st-save-toast-retry\s*\{([^}]*)\}/);
  assert.ok(retry && /min-height:\s*32px/.test(retry[1]), '"Try again" is under 32px on desktop');
  const close = css.match(/\.st-save-toast-close\s*\{([^}]*)\}/);
  assert.ok(close && /width:\s*32px/.test(close[1]) && /height:\s*32px/.test(close[1]), 'the X is under 32x32 on desktop');
});

/* Computed from the CSS tokens, not asserted as a hard pass/fail: the toast is `position: fixed` over
   whatever the page happens to show, so there is no one "the" backdrop the way a settings card has one.
   Printed against the base page background (--bg0) in both themes as a representative floor, alongside the
   pre-existing .error toast for comparison - not a regression either way. */
test('S11. INFORMATIONAL: amber-on-toast contrast against the base page background, both themes, next to the existing red toast', (t) => {
  type RGBA = [number, number, number, number];
  const hex = (h: string): RGBA => { const c = h.replace('#', ''); return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16), 1]; };
  const over = (top: RGBA, under: RGBA): RGBA => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1) as RGBA;
  const lum = (c: RGBA) => { const [r, g, b] = c.slice(0, 3).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a: RGBA, b: RGBA) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const darkBg = over([251, 191, 36, 0.08], hex('#030405'));
  const darkAmber = contrast(hex('#fbbf24'), darkBg);
  const lightBg = over([180, 83, 9, 0.07], hex('#E8EAED'));
  const lightAmber = contrast(hex('#8F4508'), lightBg);
  t.diagnostic(`dark amber-on-toast: ${darkAmber.toFixed(2)}:1 | light amber-on-toast: ${lightAmber.toFixed(2)}:1`);
  assert.ok(darkAmber >= 4.5, `dark theme conflict toast is ${darkAmber.toFixed(2)}:1, under AA`);
  assert.ok(lightAmber >= 4.5, `light theme conflict toast is ${lightAmber.toFixed(2)}:1, under AA`);
});

/* ══ Labels ═════════════════════════════════════════════════════════════════════════════════════════ */

const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;

test('L1. SETTINGS_STATUS_CONFLICT is registered and has a non-empty English default, distinct from FAILED', () => {
  const keys = read('lib/labelKeys.ts');
  assert.ok(keys.includes("'SETTINGS_STATUS_CONFLICT'"), 'not in lib/labelKeys.ts');
  assert.ok(typeof defaults.SETTINGS_STATUS_CONFLICT === 'string' && defaults.SETTINGS_STATUS_CONFLICT.trim().length > 0);
  assert.notEqual(defaults.SETTINGS_STATUS_CONFLICT, defaults.SETTINGS_STATUS_FAILED);
});

test('L2. the migration\'s row equals the shipped default, exactly - this file predates the commented-dev-block convention (no #1342-era block to compare here), so only the one insert is checked', () => {
  const sql = read('supabase/migrations/20260913a_labels_seed_settings_conflict.sql');
  const out: Record<string, string> = {};
  for (const raw of sql.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith("('")) continue;
    const parts = line.replace(/^\('/, '').replace(/'\)[,;]?\s*$/, '').split("','");
    if (parts.length === 3 && parts[1] === 'en') out[parts[0]] = parts[2].split("''").join("'");
  }
  assert.ok(out.SETTINGS_STATUS_CONFLICT, 'the migration has no row for this key');
  assert.equal(out.SETTINGS_STATUS_CONFLICT, defaults.SETTINGS_STATUS_CONFLICT, 'migration and shipped default differ');
});
