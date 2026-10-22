/* Mutation check for the two rewritten toast test files: each mutation must turn at least the named test red.
   Restores every file in finally. Run from the repo root. */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const FILES = { css: 'app/globals.css', toast: 'components/SettingsSaveToast.tsx', provider: 'components/SettingsProvider.tsx' };
const orig = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, readFileSync(p, 'utf8')]));
const TESTS = ['__tests__/toastMobileNavOverlap.test.mts', '__tests__/settingsConflictNotice.test.mts'];

const M = [
  ['css', 'top: calc(var(--banner-h, 0px) + 44px + 8px);', 'top: calc(var(--banner-h, 0px) + 40px + 8px);', 'S2'],
  ['css', 'top: calc(var(--banner-h, 0px) + 44px + 8px);', 'top: calc(var(--banner-h, 0px) + 44px + 8px); bottom: 24px;', 'S5'],
  ['css', 'left: 50%; z-index: 1001;', 'left: 50%; z-index: 10000;', 'S6'],
  ['css', 'left: 50%; z-index: 1001;', 'left: 50%; z-index: 999;', 'S6'],
  ['css', 'transform: translate(-50%, 0); }', 'transform: translateY(0); }', 'S7'],
  ['css', '+ 38px + 8px); }', '+ 60px + 8px); }', 'S4'],
  ['css', '.st-save-toast-retry { min-height: 44px; }', '.st-save-toast-retry { min-height: 40px; }', 'S4'],
  ['css', 'color: var(--red); pointer-events: auto; }', 'color: var(--red); pointer-events: none; }', 'S10'],
  ['css', '.st-save-toast-icon { flex-shrink: 0; }', '.st-save-toast-icon { flex-shrink: 0; }\nbody.settings-toast-open .gchat-fab { opacity: 0; pointer-events: none; }', 'S7'],
  ['css', 'translate(-50%, -6px)', 'translateY(-6px)', 'S7'],
  ['toast', "if (saveStatus === 'error') { setShown('error'); return; }", "if (saveStatus === 'error') { setShown('error'); const x = setTimeout(() => setShown(null), 3000); return () => clearTimeout(x); }", 'S5'],
  ['toast', "saveStatus === 'saved' ? 2000 : 4000);", "saveStatus === 'saved' ? 2000 : 2000);", 'S4'],
  ['toast', '<div className="st-save-toast error" role="alert">', '<div className="st-save-toast error" role="status">', 'S8b'],
  ['toast', "onClick={() => { setShown('saving'); retrySave(); }}", "onClick={() => { setShown('saving'); }}", 'S8c'],
  ['toast', " aria-label={t('SETTINGS_SAVE_DISMISS_ARIA')}", '', 'S8c'],
  ['toast', "{t('SETTINGS_SAVE_FAILED_TITLE')}", "{t('SETTINGS_STATUS_FAILED')}", 'S8'],
  ['toast', "shown === 'conflict' ? ' conflict'", "shown === 'conflict' ? ' error'", 'S7'],
  ['toast', 'role="status" aria-live="polite"', 'role="status"', 'S8b'],
  ['provider', "    lastFailedRef.current = partial;\n    setSaveStatus('error');", "    setSaveStatus('error');\n    lastFailedRef.current = partial;", 'S8d'],
  ['provider', 'void flushToDb(failed);', 'void flushToDb({});', 'S8d'],
];

let bad = 0;
try {
  for (const [k, from, to, expect] of M) {
    const src = orig[k].split('\r\n').join('\n');
    const n = src.split(from).length - 1;
    if (n !== 1) { console.log(`SKIP-BAD-ANCHOR (${n}x) ${k}: ${from.slice(0, 60)}`); bad++; continue; }
    writeFileSync(FILES[k], src.replace(from, to));
    let out = '';
    try { out = execFileSync(process.execPath, ['--import', './qa/alias-register.mjs', '--test', ...TESTS], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { out = String(e.stdout || ''); }
    const red = [...out.matchAll(/^\s*✖ (S\d+[a-z]?)\./gm)].map((m) => m[1]);
    const ok = red.includes(expect);
    if (!ok) bad++;
    console.log(`${ok ? 'KILLED ' : 'SURVIVED'} ${k} expect ${expect} red=[${[...new Set(red)].join(',')}] :: ${from.slice(0, 50)}`);
    writeFileSync(FILES[k], orig[k]);
  }
} finally {
  for (const [k, p] of Object.entries(FILES)) writeFileSync(p, orig[k]);
}
console.log(bad ? `${bad} mutation(s) not killed` : 'all mutations killed');
