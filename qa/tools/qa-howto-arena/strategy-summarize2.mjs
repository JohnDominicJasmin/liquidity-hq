/* The chip x plan x result table for the "chips mirror the chart" fix (#1544), from strategy-matrix.mjs output.
 * The rules are PM's: the chart's actual overlay state is the source of truth and the chips mirror it; EMA ribbon and GEX are
 * "always on" and take no slot; S/R and Liq chips are one switch with the chart toolbar; RSI shows "pane always on".
 * usage: node strategy-summarize2.mjs <matrix.json> [more.json ...]   (prints Markdown)                                      */
import { readFileSync } from 'node:fs';
import { OUT } from './lib.mjs';
const files = process.argv.slice(2).map((f) => (f.includes('/') || f.includes('\\') ? f : `${OUT}/strategy-matrix/${f}`));
const rows = files.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')));
const build = rows.filter((r) => r.step === 'build').map((b) => b.commit);
const n = (d, k) => (d ? d.overlays[k] || 0 : null);
const ind = (d, k) => (d ? d.indicators[k] || 0 : null);
const BUILTIN = { SMA: 'SMA', PSAR: 'SAR', RSI: 'RSI', MACD: 'MACD', Bollinger: 'BOLL' };
const liq = (d) => (d ? Object.entries(d.overlays).filter(([k]) => /liq/i.test(k)).reduce((a, [, v]) => a + v, 0) : null);
/* verdict for one chip row; returns [pass|fail|info, reason] */
function judge(x) {
  if (/not drawn on this coin/i.test(x.ariaLabel0 || '')) return ['info', `state none: "${x.ariaLabel0}"; click changes nothing (QA fence refuses cluster data, so no Liq layer can draw here: not proof either way)`];
  if (x.notyet) return x.on1 === false && x.on2 === false ? ['pass', 'not wired: a click changes nothing'] : ['fail', 'a not-wired chip became selected'];
  const dB = x.drawnBefore, dS = x.drawnAfterSelect, dD = x.drawnAfterDeselect;
  const counterSame = x.counterBefore === x.countAfterSelect && x.countAfterSelect === x.countAfterDeselect;
  if (x.chip === 'EMA ribbon') {
    if (dS === null || dD === null) return ['info', `chart instance not read in this context (before=${dB === null}, afterSelect=${dS === null}, afterDeselect=${dD === null}): the chip says always=${x.always} on=${x.on0}/${x.on1}/${x.on2}`];
    const ok = x.always && x.on0 && x.on1 && x.on2 && (dB === null || n(dB, 'emaRibbonLine') > 0) && n(dS, 'emaRibbonLine') > 0 && n(dD, 'emaRibbonLine') > 0 && counterSame;
    return [ok ? 'pass' : 'fail', ok ? 'always on, drawn, no slot, click is a no-op' : `always=${x.always} on=${x.on0}/${x.on1}/${x.on2} drawn=${n(dB, 'emaRibbonLine')} counter ${x.counterBefore}->${x.countAfterSelect}`];
  }
  if (x.chip === 'GEX') {
    const drawn = n(dB, 'gexLevelLine');
    if (x.always) { const ok = x.on0 && drawn > 0 && counterSame; return [ok ? 'pass' : 'fail', ok ? 'always on, drawn, no slot' : `on=${x.on0} drawn=${drawn}`]; }
    const ok = !x.on0 && !drawn; return [ok ? 'pass' : 'fail', ok ? 'dimmed and not drawn (no levels for this coin)' : `not always but on=${x.on0} drawn=${drawn}`];
  }
  if (x.chip === 'S/R') {
    const d0 = n(dB, 'srLevelLine') > 0, d1 = n(dS, 'srLevelLine') > 0, d2 = n(dD, 'srLevelLine') > 0;
    const ok = x.on0 === d0 && x.on1 === d1 && x.on2 === d2 && x.on1 === !x.on0 && x.on2 === x.on0 && counterSame;
    return [ok ? 'pass' : 'fail', ok ? `one switch: chip ${x.on0}->${x.on1}->${x.on2}, chart ${d0}->${d1}->${d2}, no slot` : `chip ${x.on0}->${x.on1}->${x.on2} vs chart ${d0}->${d1}->${d2}, counter ${x.counterBefore}->${x.countAfterSelect}`];
  }
  if (x.chip === 'Liq clusters') {
    const l0 = liq(dB) > 0; const ok = x.on0 === l0 && counterSame;
    return [ok ? 'info' : 'fail', `chip on=${x.on0}, liq lines drawn=${liq(dB)}${l0 ? '' : ' (QA fence refuses cluster data, so none can draw: not proof either way)'}; counter ${counterSame ? 'unchanged' : 'CHANGED'}`];
  }
  if (x.chip === 'RSI') {
    const tagOk = /pane always on/i.test(x.tag || ''); const pane0 = ind(dB, 'RSI') > 0; const ok = tagOk && pane0 && x.on1 === true && x.on2 === false && x.countAfterSelect === (x.counterBefore ?? 0) + 1 && ind(dS, 'RSI') >= 1;
    return [ok ? 'pass' : 'fail', `tag="${x.tag}" default RSI pane=${pane0}; select ${x.on1}, RSI panes ${ind(dB, 'RSI')}->${ind(dS, 'RSI')}->${ind(dD, 'RSI')}; counter ${x.counterBefore}->${x.countAfterSelect}->${x.countAfterDeselect}`];
  }
  const k = BUILTIN[x.chip];
  if (k) {
    const ok = x.on1 === true && x.on2 === false && ind(dB, k) === 0 && ind(dS, k) > 0 && ind(dD, k) === 0 && x.countAfterSelect === (x.counterBefore ?? 0) + 1 && x.countAfterDeselect === x.counterBefore;
    return [ok ? 'pass' : 'fail', `chip ${x.on1}->${x.on2}; chart ${k} ${ind(dB, k)}->${ind(dS, k)}->${ind(dD, k)}; counter ${x.counterBefore}->${x.countAfterSelect}->${x.countAfterDeselect}`];
  }
  return ['info', 'unclassified chip'];
}
const ctxs = [...new Set(rows.filter((r) => r.ctx).map((r) => r.ctx))]; const plans = [...new Set(ctxs.map((c) => c.split('/')[0]))];
const chipNames = [...new Set(rows.filter((r) => r.step === 'chip').map((r) => r.chip))];
const out = [`**Build under test:** ${build.map((b) => '`' + b + '`').join(', ')}. Plans are stubbed through the subscription read: this tests the client, never the server. The chart column comes from the chart instance (\`getOverlays\` / \`getIndicators\`), not pixels.\n`];
out.push(`**Contexts run (${ctxs.length}):** ${ctxs.join(', ')}\n`);
out.push('| Chip | ' + plans.join(' | ') + ' | Note |'); out.push('|---|' + plans.map(() => '---|').join('') + '---|');
const fails = [];
for (const chip of chipNames) {
  const cells = []; let note = '';
  for (const p of plans) {
    const rs = rows.filter((r) => r.step === 'chip' && r.chip === chip && r.ctx.startsWith(p + '/')); const v = rs.map((r) => { let j = judge(r); if (r.chip === 'EMA ribbon' && j[0] === 'info') { const later = rows.filter((q) => q.ctx === r.ctx && q.drawn !== undefined && q.drawn !== null || (q.ctx === r.ctx && q.drawnFull)).map((q) => q.drawn || q.drawnFull).filter(Boolean); if (r.always && r.on0 && r.on1 && r.on2 && later.length >= 3 && later.every((d) => (d.overlays.emaRibbonLine || 0) > 0)) j = ['pass', `always on, chip on in every read, no slot; ribbon drawn in all ${later.length} later chart reads of this context (the first click's chart read came back empty)`]; } return { r, j }; });
    const pass = v.filter((x) => x.j[0] === 'pass').length, fail = v.filter((x) => x.j[0] === 'fail'), info = v.filter((x) => x.j[0] === 'info').length;
    cells.push(fail.length ? `✖ ${pass}/${v.length}` : info ? `info ${v.length}` : `✔ ${pass}/${v.length}`);
    for (const f of fail) fails.push(`${f.r.ctx} · ${chip}: ${f.j[1]}`);
    if (!note && v[0]) note = v[0].j[1].slice(0, 90);
  }
  out.push(`| ${chip} | ${cells.join(' | ')} | ${note} |`);
}
out.push('\n**Other actions, per context** (cap · reload · timeframe · sets · keyboard):\n');
out.push('| Context | cap holds | reload keeps | timeframe keeps | keyboard | counter after cap | sets |'); out.push('|---|---|---|---|---|---|---|');
for (const c of ctxs) {
  const R = rows.filter((r) => r.ctx === c); const g = (s) => R.filter((r) => r.step === s); const cap = g('cap')[0]; const rl = g('reload')[0]; const tf = g('timeframe')[0]; const kb = g('keyboard')[0];
  const noGex = (a) => (a || []).filter((l) => l !== 'GEX'); const capOk = cap && cap.extraSelected === false && cap.countAfterExtra === cap.limit; const rlOk = rl && cap && JSON.stringify(noGex(rl.on)) === JSON.stringify(noGex(cap.onFull));
  const tfOk = tf && JSON.stringify(noGex(tf.onBefore)) === JSON.stringify(noGex(tf.onAfter)); const kbOk = kb && kb.afterSpace?.length >= 1 && kb.afterSecondSpace?.length < kb.afterSpace.length;
  if (!capOk) fails.push(`${c} · cap: extra chip ${cap?.extraTried} selected=${cap?.extraSelected} counter after=${cap?.countAfterExtra} limit=${cap?.limit}`);
  const gexMis = g('set').filter((x) => x.drawn && x.on.includes('GEX') !== ((x.drawn.overlays.gexLevelLine || 0) > 0)).map((x) => x.id); if (gexMis.length) fails.push(`${c} · GEX chip and chart disagree in set(s): ${gexMis.join(',')}`);
  out.push(`| ${c} | ${capOk ? '✔' : '✖'} | ${rlOk ? '✔' : '✖ ' + (rl?.on || []).join(',')} | ${tfOk ? '✔' : '✖'} | ${kbOk ? '✔' : '✖'} | ${cap?.counterFull} | ${g('set').map((s) => `${s.id}:${s.counter?.replace(/^.*· /, '')}`).join(' ')} |`);
}
out.push('\n**Failures:**'); const u = [...new Set(fails)]; out.push(u.length ? u.map((f) => '- ' + f).join('\n') : '- none');
console.log(out.join('\n'));
