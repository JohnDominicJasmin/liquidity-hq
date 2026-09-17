#!/usr/bin/env node
// Counts failed QA rounds on a pull request, so a PR that keeps bouncing between
// Dev and QA gets frozen and escalated instead of looping. Read-only: it never
// comments, labels or merges. When it trips, the PM does those by hand.
//
// A failed round is a PR comment whose body starts with `**QA: not ready`
// (case-insensitive). That marker is the convention in docs/WORK-QUEUE.md
// ("Three failed QA rounds"). Free-text verdicts are deliberately NOT counted.
// On 2026-09-12 a search of the last 40 PRs found the phrase "QA Rejected" zero
// times, and QA writing its verdicts a dozen different ways. A counter that
// guesses at wording either never trips, or trips on "retracting my merge word".
//
// Usage:      node scripts/qa-rounds.mjs <PR number> [--limit 3]
// Exit codes: 0 under the limit, 3 at or over it, 1 on bad input or a gh failure.

import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const pr = args.find(a => /^\d+$/.test(a));
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : 3;

if (!pr || !Number.isInteger(limit) || limit < 1) {
  console.error('Usage: node scripts/qa-rounds.mjs <PR number> [--limit 3]');
  process.exit(1);
}

let data;
try {
  const out = execFileSync('gh', ['pr', 'view', pr, '--json', 'number,title,state,comments'], { encoding: 'utf8' });
  data = JSON.parse(out);
} catch (e) {
  console.error(`gh pr view ${pr} failed: ${e.message}`);
  process.exit(1);
}

const FAIL_MARKER = /^\*\*QA:\s*not ready/i;
const isQaVerdict = body => /^\*\*QA\b/.test(body.trim());

const qaComments = data.comments.filter(c => isQaVerdict(c.body));
const failed = qaComments.filter(c => FAIL_MARKER.test(c.body.trim()));

console.log(`#${data.number} ${data.title} (${data.state})`);
console.log(`QA comments: ${qaComments.length}. Failed rounds (start with "**QA: not ready"): ${failed.length} of ${limit}.`);
for (const c of qaComments) {
  const firstLine = c.body.trim().split('\n')[0].slice(0, 110);
  const tag = FAIL_MARKER.test(c.body.trim()) ? 'FAIL' : '    ';
  console.log(`  ${c.createdAt}  ${tag}  ${firstLine}`);
}

if (failed.length >= limit) {
  console.log(`\nLIMIT REACHED: ${failed.length} failed QA rounds on #${data.number}.`);
  console.log('Freeze this PR, not the team. Say so on the PR, add it to docs/OWNER-BLOCKERS.md,');
  console.log('and move Dev and QA to their next items in docs/WORK-QUEUE.md.');
  process.exit(3);
}

console.log('\nUnder the limit.');
