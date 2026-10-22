// Mutation check for __tests__/arenaHonestStates.test.mts: puts each #1490 fix back to its pre-#1490 shape,
// runs the test file, records which tests went red, restores the file with git checkout.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

const WT = process.argv[2];
const TEST = '__tests__/arenaHonestStates.test.mts';
const only = process.argv[3];

const ARENA = 'app/arena/page.tsx';
const PROV = 'components/SettingsProvider.tsx';
const CHART = 'components/KLineProChart.tsx';

const M = {
  'M1 item 9: IIFE guard removed, ?? [] restored': [
    [ARENA, 'if (!selectionSeeded || cacheEntry?.selectionAtAnalysis === undefined) return false;', ''],
    [ARENA, '[...cacheEntry.selectionAtAnalysis]', '[...(cacheEntry?.selectionAtAnalysis ?? [])]'],
  ],
  'M2 item 9: setSelectionSeeded(true) removed': [
    [ARENA, 'setSelectionSeeded(true);', ''],
  ],
  'M3 item 9: block-local selectionChanged copy restored': [
    [ARENA, '        const secsDiff = Math.floor((nowMs - result.analyzedAt) / 1000);',
      "        const selectionChanged = (() => {\n          const before = [...(cacheEntry?.selectionAtAnalysis ?? [])].sort().join('\\0');\n          const now = [...strategySelection].sort().join('\\0');\n          return before !== now;\n        })();\n        const secsDiff = Math.floor((nowMs - result.analyzedAt) / 1000);"],
  ],
  'M4 item 10: accepted/rejected ?? [] restored': [
    [PROV, 'if (!Array.isArray(body.accepted) || !Array.isArray(body.rejected)) return { failed: true };', ''],
    [PROV, 'accepted: body.accepted, rejected: body.rejected,', 'accepted: body.accepted ?? [], rejected: body.rejected ?? [],'],
  ],
  'M5 item 11: coin-change clear + success-path ref removed': [
    [ARENA, 'if (chartAlertsCoinRef.current !== selectedCoin) { chartAlertsCoinRef.current = null; setChartAlerts([]); }', ''],
    [ARENA, 'if (!cancelled) { chartAlertsCoinRef.current = selectedCoin; setChartAlerts(alerts.filter(a => a.coin === selectedCoin)); }',
      'if (!cancelled) setChartAlerts(alerts.filter(a => a.coin === selectedCoin));'],
  ],
  'M6 item 11: local-create ref tag removed': [
    [ARENA, '      chartAlertsCoinRef.current = selectedCoin;\r\n      setChartAlerts(prev => [...prev,', '      setChartAlerts(prev => [...prev,', 'crlf-or-lf'],
  ],
  'M7 item 11: indicators optional + ?? []': [
    [CHART, '  indicators:    readonly string[];', '  indicators?:   readonly string[];'],
    [CHART, 'for (const id of indicators) {', 'for (const id of indicators ?? []) {'],
  ],
};

function apply([file, from, to, mode]) {
  const p = `${WT}/${file}`;
  let src = readFileSync(p, 'utf8');
  let needle = from;
  let repl = to;
  if (mode === 'crlf-or-lf' && !src.includes(needle)) { needle = from.replace('\r\n', '\n'); }
  const n = src.split(needle).length - 1;
  if (n !== 1) throw new Error(`${file}: needle found ${n} times: ${needle.slice(0, 80)}`);
  src = src.replace(needle, () => repl);
  writeFileSync(p, src);
}

function runTests() {
  const r = spawnSync(process.execPath, ['--import', './qa/alias-register.mjs', '--test', TEST], { cwd: WT, encoding: 'utf8' });
  const out = r.stdout + r.stderr;
  const failed = [...new Set([...out.matchAll(/^✖ ([A-Z]\d)\./gm)].map((m) => m[1]))];
  const pass = out.match(/ℹ pass (\d+)/)?.[1];
  const fail = out.match(/ℹ fail (\d+)/)?.[1];
  return { failed, pass, fail };
}

for (const [name, edits] of Object.entries(M)) {
  if (only && !name.startsWith(only)) continue;
  const files = [...new Set(edits.map((e) => e[0]))];
  try {
    for (const e of edits) apply(e);
    const r = runTests();
    console.log(`${name} -> red: [${r.failed.join(', ')}] (pass ${r.pass}, fail ${r.fail})`);
  } finally {
    execFileSync('git', ['checkout', '--', ...files], { cwd: WT });
  }
}
const clean = execFileSync('git', ['status', '--short'], { cwd: WT, encoding: 'utf8' });
console.log(`git status after restore:\n${clean}`);
