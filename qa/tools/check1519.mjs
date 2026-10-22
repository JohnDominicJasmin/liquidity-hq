import { execSync } from 'node:child_process';
const repo = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const sh = (c) => execSync(c, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const show = (p) => sh(`git show "rv-1519:${p}"`);
const files = sh('git ls-tree --name-only rv-1519 supabase/migrations/').trim().split('\n').sort();
const keys = ['ALERTS_PAGE_SUBTITLE', 'ALERTS_LOCKED_FEATURE_DESC'];
const rowRe = /^(--\s*)?\('(ALERTS_PAGE_SUBTITLE|ALERTS_LOCKED_FEATURE_DESC)','([a-z]{2})','((?:[^']|'')*)'\)/;
const latestPrior = {};
let newLive = {}, newDev = {};
for (const f of files) {
  const txt = show(f);
  for (const line of txt.split('\n')) {
    const m = line.match(rowRe);
    if (!m) continue;
    const id = `${m[2]}|${m[3]}`;
    if (f.includes('20261001i')) { (m[1] ? newDev : newLive)[id] = m[4]; }
    else if (!m[1]) latestPrior[id] = { f, v: m[4] };
  }
}
const cuts = { ko: ['펀딩비, ', '펀딩비 극단치, '], zh: ['资金费率、', '资金费率极端值、'], ar: ['التمويل، ', 'تطرف معدل التمويل، '], ru: ['фандинг, '], en: ['funding, ', 'funding rate extremes, '] };
const defaults = JSON.parse(show('lib/labelDefaults.en.json'));
let ok = true;
for (const id of Object.keys(newLive)) {
  const [k, loc] = id.split('|');
  const prior = latestPrior[id];
  const matchesCut = prior && cuts[loc].some(c => prior.v.includes(c) && prior.v.replace(c, '') === newLive[id]);
  const devSame = newDev[id] === newLive[id];
  const enOk = loc !== 'en' || defaults[k] === newLive[id];
  console.log(id, 'prior=', prior?.f, 'cutMatch=', matchesCut, 'devSame=', devSame, 'enDefault=', enOk);
  if (!matchesCut || !devSame || !enOk) ok = false;
}
console.log('live rows', Object.keys(newLive).length, 'dev rows', Object.keys(newDev).length);
for (const k of keys) for (const loc of ['en','ko','zh','ar','ru']) {
  const id = `${k}|${loc}`;
  if (latestPrior[id] && !newLive[id]) { console.log('PRIOR ROW NOT REWRITTEN:', id, latestPrior[id].f); ok = false; }
}
// any other default still promising funding alerts on /alerts?
for (const [k, v] of Object.entries(defaults)) if (/^ALERTS_/.test(k) && /funding/i.test(v)) console.log('ALERTS_* mentioning funding:', k, '=>', v);
console.log(ok ? 'ALL OK' : 'MISMATCH');
