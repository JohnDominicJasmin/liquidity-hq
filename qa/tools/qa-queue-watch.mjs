// One GraphQL call per poll for the whole QA queue; prints ONE line per item whose state moved.
// Silence is not success: repeated gh failures print a line, and the first poll prints a baseline line.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const OWNER = 'JohnDominicJasmin', REPO = 'liquidity-hq';
const PRS = [1384, 1385, 1386, 1387, 1388, 1389, 1390, 1391, 1405, 1406, 1407, 1408, 1409];
const ISSUES = [1113, 1173, 1259, 1263, 1282, 1309, 1347, 1397, 1398, 1399, 1400, 1403, 1404, 1410];
const ALL = [...PRS, ...ISSUES];
const SNAP = process.argv[2];
const EVERY_MS = 90_000;

const frag = n => `n${n}: issueOrPullRequest(number:${n}){__typename
  ... on Issue{state comments(last:1){totalCount nodes{author{login} body}}}
  ... on PullRequest{state isDraft merged headRefOid comments(last:1){totalCount nodes{author{login} body}} reviews(last:1){totalCount}}}`;
const QUERY = `{repository(owner:"${OWNER}",name:"${REPO}"){${ALL.map(frag).join('\n')}}}`;

function poll() {
  const out = execFileSync('gh', ['api', 'graphql', '-f', `query=${QUERY}`], { encoding: 'utf8', timeout: 60_000, windowsHide: true });
  const repo = JSON.parse(out).data.repository;
  const now = {};
  for (const n of ALL) {
    const x = repo['n' + n];
    if (!x) continue;
    const last = x.comments.nodes[0];
    now[n] = {
      kind: x.__typename === 'PullRequest' ? 'PR' : 'issue',
      s: x.merged ? 'MERGED' : x.state,
      d: !!x.isDraft, h: x.headRefOid ?? null,
      c: x.comments.totalCount, r: x.reviews?.totalCount ?? 0,
      who: last?.author?.login ?? '', body: (last?.body ?? '').replace(/\s+/g, ' ').slice(0, 170),
    };
  }
  return now;
}

const load = () => (existsSync(SNAP) ? JSON.parse(readFileSync(SNAP, 'utf8')) : null);
const mine = b => /^\*{0,2}QA Team/.test(b);
let fails = 0;
let first = true;

async function tick() {
  let now;
  try { now = poll(); fails = 0; } catch (e) {
    fails++;
    if (fails === 3 || fails % 20 === 0) console.log(`WATCH FAILING: gh graphql failed ${fails}x in a row (${String(e.message).split('\n')[0].slice(0, 120)})`);
    return;
  }
  const prev = load();
  if (!prev) {
    console.log(`WATCH ARMED: baseline of ${Object.keys(now).length} items (PRs ${PRS.join(',')}; issues ${ISSUES.join(',')}). Polling every ${EVERY_MS / 1000}s.`);
  } else {
    for (const n of ALL) {
      const a = prev[n], b = now[n];
      if (!b || !a) continue;
      const parts = [];
      if (a.s !== b.s) parts.push(`state ${a.s}->${b.s}`);
      if (a.d !== b.d) parts.push(b.d ? 'now DRAFT' : 'ready for review');
      if (a.h !== b.h) parts.push(`new commits (${(b.h ?? '').slice(0, 7)})`);
      if (a.r !== b.r) parts.push(`reviews ${a.r}->${b.r}`);
      const commentMoved = a.c !== b.c;
      // A comment I posted myself is not news; anything else is.
      if (commentMoved && !(mine(b.body) && a.s === b.s && a.h === b.h && a.r === b.r && a.d === b.d)) parts.push(`comments ${a.c}->${b.c}, last by ${b.who}: "${b.body}"`);
      if (parts.length) console.log(`#${n} ${b.kind} ${parts.join(' | ')}`);
    }
  }
  writeFileSync(SNAP, JSON.stringify(now));
  first = false;
}

await tick();
setInterval(() => { tick().catch(e => console.log('WATCH ERROR: ' + String(e.message).slice(0, 120))); }, EVERY_MS);
