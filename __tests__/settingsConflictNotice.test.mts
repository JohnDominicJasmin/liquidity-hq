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
  const failureAt = anchorOnce(provider, "setSaveStatus('error');", 'the genuine-failure status set');
  assert.ok(successAt < failureAt, 'the real-failure setSaveStatus(\'error\') comes before the success-path branch - order changed');
});

test('S3. the provider clears the status after the SAME 3000/2000ms split the toast\'s own visibility timer uses - a conflict and an error get equal screen time', () => {
  anchorOnce(provider, "setTimeout(() => setSaveStatus('idle'), result.rejected.length > 0 ? 3000 : 2000);", 'the status-clear timeout');
});

/* ══ SettingsSaveToast.tsx: the render ═══════════════════════════════════════════════════════════════ */

test('S4. the toast becomes visible for conflict, exactly alongside saved and error - not a fourth, separate condition that could drift from the other two', () => {
  anchorOnce(toastSrc, "if (saveStatus === 'saved' || saveStatus === 'error' || saveStatus === 'conflict') {", 'the visibility condition');
});

test('S5. the toast\'s own hide-timer now matches the provider\'s clear-timer for error/conflict (3000ms), not the old flat 2000ms - fixes the second bug this commit names: the toast used to disappear before the provider even cleared the status', () => {
  anchorOnce(toastSrc, "setTimeout(() => setVisible(false), saveStatus === 'saved' ? 2000 : 3000);", 'the visibility hide-timer');
});

test('S6. the FAB-hiding effect keys ONLY on `visible`, not on which saveStatus - saving/saved/error/conflict all hide it the same way', () => {
  const at = anchorOnce(toastSrc,
    "useEffect(() => {\n    document.body.classList.toggle('settings-toast-open', visible);\n    return () => { document.body.classList.remove('settings-toast-open'); };\n  }, [visible]);",
    'the FAB-hiding effect');
  assert.ok(at > 0);
});

test('S7. conflict gets its own CSS class, distinct from error - never shares the "error" class, which would paint it red', () => {
  anchorOnce(toastSrc, "const cls = saveStatus === 'error' ? ' error' : saveStatus === 'conflict' ? ' conflict' : saveStatus === 'saving' ? ' saving' : '';", 'the class ternary');
});

test('S8. conflict renders its own label key, never the FAILED text - the whole point of the fix', () => {
  const at = anchorOnce(toastSrc,
    "const text = saveStatus === 'saving' ? t('SETTINGS_STATUS_SAVING')\n    : saveStatus === 'saved' ? t('SETTINGS_STATUS_SAVED')\n    : saveStatus === 'conflict' ? t('SETTINGS_STATUS_CONFLICT')\n    : t('SETTINGS_STATUS_FAILED');",
    'the text ternary');
  assert.ok(at > 0, 'conflict does not come before the final t(\'SETTINGS_STATUS_FAILED\') fallback - it would fall through to "Failed"');
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

test('S10. body.settings-toast-open hides the FAB the same way the existing nav-drawer/PWA-prompt rules do (opacity 0 + pointer-events none), not a new, different mechanism', () => {
  const rule = css.match(/body\.settings-toast-open \.gchat-fab\s*\{([^}]*)\}/);
  assert.ok(rule, 'the settings-toast-open FAB rule not found');
  assert.match(rule[1], /opacity:\s*0/);
  assert.match(rule[1], /pointer-events:\s*none/);
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
