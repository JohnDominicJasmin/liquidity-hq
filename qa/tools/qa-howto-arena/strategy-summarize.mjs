/* Turn strategy-matrix.mjs output into the chip x plan x result table and the "one source" findings.
 * usage: node strategy-summarize.mjs <matrix.json> [more.json ...]   (prints Markdown)                                      */
import { readFileSync } from 'node:fs';
import { OUT } from './lib.mjs';
const files = process.argv.slice(2).map((f) => (f.includes('/') || f.includes('\\') ? f : `${OUT}/strategy-matrix/${f}`));
const rows = files.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')));
const build = rows.find((r) => r.step === 'build');
/* chip label -> what the chart must draw for it, from what the chart instance really holds */
const OVERLAY = { 'EMA ribbon': 'emaRibbonLine', 'S/R': 'srLevelLine', 'GEX': 'gexLevelLine' };
const BUILTIN = { SMA: 'SMA', PSAR: 'SAR', RSI: 'RSI', MACD: 'MACD', Bollinger: 'BOLL' };
const has = (d, chip) => { if (!d) return null; if (OVERLAY[chip]) return (d.overlays[OVERLAY[chip]] || 0) > 0; if (BUILTIN[chip]) return (d.indicators[BUILTIN[chip]] || 0) > 0; return null; };
const ctxs = [...new Set(rows.filter((r) => r.ctx).map((r) => r.ctx))];
const out = [];
out.push(`**Build:** \`${build?.commit}\` (${build?.branch}), run ${build?.at}. Plans are stubbed through the subscription read, so this tests the client only.\n`);
out.push('| Context | Chips (usable / not wired) | Cap | select / deselect | cap holds | reload keeps it | timeframe keeps it | sets | keyboard | chart draws with zero chips |');
out.push('|---|---|---|---|---|---|---|---|---|---|');
const issues = [];
for (const c of ctxs) {
  const R = rows.filter((r) => r.ctx === c); const g = (s) => R.filter((r) => r.step === s);
  const base = g('baseline')[0]; const chips = g('chip'); const usable = chips.filter((x) => !x.notyet);
  const selOk = usable.filter((x) => x.selected === true && x.deselected === true).length;
  const selBad = usable.filter((x) => !(x.selected === true && x.deselected === true)).map((x) => x.chip);
  const notYetBad = chips.filter((x) => x.notyet && x.selected).map((x) => x.chip);
  const cap = g('cap')[0]; const capOk = cap && cap.extraSelected === false && cap.countAfterExtra === cap.limit;
  const rl = g('reload')[0]; const tf = g('timeframe')[0]; const kb = g('keyboard')[0];
  const reloadOk = rl && JSON.stringify(rl.on) === JSON.stringify(cap?.onFull ?? rl.on) ? 'yes' : (rl ? `no (${(rl.on || []).join(',') || 'none'})` : '?');
  const tfOk = tf && JSON.stringify(tf.onBefore) === JSON.stringify(tf.onAfter);
  const sets = g('set').map((s) => `${s.id}:${s.on.join('+') || 'none'}`).join(' ');
  const kbOk = kb && kb.afterSpace?.length === 1 && kb.afterSecondSpace?.length === 0 && kb.afterEnter?.length === 1;
  const zero = base?.drawn ? Object.entries(base.drawn.overlays).filter(([n]) => /ribbon|srlevel|gexlevel|liq/i.test(n)).map(([n, k]) => `${n}×${k}`).concat(Object.keys(base.drawn.indicators).map((n) => `ind:${n}`)).join(' ') : 'n/a';
  out.push(`| ${c} | ${usable.length} / ${chips.length - usable.length} | ${cap?.limit ?? '?'} | ${selOk}/${usable.length}${selBad.length ? ' ✖ ' + selBad.join(',') : ''} | ${capOk ? 'yes' : 'NO'} | ${reloadOk} | ${tfOk ? 'yes' : 'NO'} | ${sets} | ${kbOk ? 'yes' : 'NO'} | ${zero} |`);
  if (notYetBad.length) issues.push(`${c}: a not-wired chip became selected: ${notYetBad.join(', ')}`);
  // one-source check: overlay-backed and builtin chips versus what the chart holds
  for (const x of usable) {
    const before = has(x.drawnBefore, x.chip), afterSel = has(x.drawnAfterSelect, x.chip), afterDesel = has(x.drawnAfterDeselect, x.chip);
    if (before === true) issues.push(`${c}: "${x.chip}" is drawn while its chip is NOT selected (zero chips selected, before any click)`);
    if (x.selected && afterSel === false) issues.push(`${c}: "${x.chip}" chip selected but the chart does not hold it`);
    if (x.deselected && afterDesel === true) issues.push(`${c}: "${x.chip}" chip deselected but the chart still draws it`);
  }
}
out.push('\n**One source (chip state vs what the chart holds).** Each line is one disagreement, de-duplicated by chip and kind:');
const uniq = [...new Set(issues.map((i) => i.replace(/^[^:]+: /, '')))];
for (const u of uniq) out.push(`- ${u}  _(in ${issues.filter((i) => i.endsWith(u)).length} of ${ctxs.length} contexts)_`);
if (!uniq.length) out.push('- none found');
console.log(out.join('\n'));
