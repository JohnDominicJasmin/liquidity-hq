const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const TEST = '__tests__/notificationPermissionOnClick.test.mts';
const M = [
  { id: 'M1 on-load request back in NewsProvider', file: 'components/NewsProvider.tsx', from: '    const sb = getSupabase();\n    if (!sb) { setAlertsLoaded(true); setEventsLoaded(true); return; }', to: "    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();\n    const sb = getSupabase();\n    if (!sb) { setAlertsLoaded(true); setEventsLoaded(true); return; }", expect: ['N1', 'N2'] },
  { id: 'M2 request in an effect in Settings', file: 'app/settings/page.tsx', from: '  async function handlePushToggle() {', to: "  useEffect(() => { if ('Notification' in window) { Notification.requestPermission(); } }, []);\n  async function handlePushToggle() {", expect: ['N2'] },
  { id: 'M3 Arena asks on mount', file: 'app/arena/page.tsx', from: '  const enableNotifications = async () => {', to: '  useEffect(() => { enableNotifications(); }, []); // eslint-disable-line\n  const enableNotifications = async () => {', expect: ['N3'] },
  { id: 'M4 Settings toggle fired from an effect', file: 'app/settings/page.tsx', from: '  async function handlePushToggle() {', to: '  useEffect(() => { void handlePushToggle(); }, []); // eslint-disable-line\n  async function handlePushToggle() {', expect: ['N3'] },
  { id: 'M5 news notification feature removed', file: 'components/NewsProvider.tsx', from: "Notification.permission === 'granted'", to: 'false', expect: ['N4'] },
];
const run = () => {
  const r = spawnSync(process.execPath, ['--import', './qa/alias-register.mjs', '--test', TEST], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  return [...new Set([...((r.stdout || '') + (r.stderr || '')).matchAll(/^✖ (N\d|CONTROL)/gm)].map((m) => m[1]))].sort();
};
console.log('baseline failed:', JSON.stringify(run()));
let killed = 0;
for (const m of M) {
  const p = path.join(ROOT, m.file);
  const orig = fs.readFileSync(p, 'utf8');
  try {
    const crlf = orig.includes('\r\n');
    const from = crlf ? m.from.replace(/\n/g, '\r\n') : m.from;
    const to = crlf ? m.to.replace(/\n/g, '\r\n') : m.to;
    if (!orig.includes(from)) { console.log(m.id, '=> NOT APPLIED'); continue; }
    fs.writeFileSync(p, orig.replace(from, to));
    const f = run();
    const ok = m.expect.every((e) => f.includes(e));
    if (ok) killed++;
    console.log(m.id, '=>', ok ? 'KILLED' : 'SURVIVED', JSON.stringify(f));
  } finally { execFileSync('git', ['checkout', '--', m.file], { cwd: ROOT }); }
}
console.log(`killed ${killed} of ${M.length}`);
console.log('tree after:', execFileSync('git', ['status', '--short'], { cwd: ROOT, encoding: 'utf8' }).trim());
