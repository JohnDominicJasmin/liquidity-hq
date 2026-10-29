/* WHICH LABEL KEYS THE DATABASE IS OVERRIDING, ON ANY DEPLOYED HOST, WITHOUT CREDENTIALS. #675.
 *
 * usage:  node --import ./qa/alias-register.mjs qa/tools/label-overrides.mjs [host] [--all]
 *         host defaults to https://liquidity-hq.com
 *
 * A row in `lhq_labels` silently beats the shipped default in `lib/labelDefaults.en.json`, so a label fix
 * can be merged, deployed and verified on staging and still not appear in production. Nothing in the build,
 * the deploy or /api/version reveals it. The owner found his own rejected wording live weeks after the fix
 * shipped, and 30 of them were found by hand this week.
 *
 * ── WHAT THIS DOES NOT DO: REIMPLEMENT THE DETECTOR, BECAUSE ONE ALREADY SHIPPED ─────────────────────────
 *
 * `lib/labelOverrides.ts` has the comparison, it is pure, and `__tests__/labelOverrides.test.mts` already
 * covers it. `GET /api/ops/label-overrides` already exposes it. This file writes NO comparison logic of its
 * own - it imports `diffLabels` and `summarise`.
 *
 * The gap was never the detector. It is that the ops route is `withOwner`-gated, so nobody on the team can
 * call it, which is why the last two answers came from throwaway scripts. This reaches the same answer
 * through the PUBLIC endpoint: `/api/labels?locale=en` is unauthenticated by design and serves the DB rows
 * for `en` and nothing else - no shipped defaults are layered in server-side (route.ts:110-116) - so it IS
 * the row set the ops route reads, minus the caveats below.
 *
 * ── THE FAIL-OPEN TRAP, WHICH IS WHY THIS REFUSES TO ANSWER RATHER THAN ANSWERING WELL ───────────────────
 *
 * `/api/labels` fails open to `{}` on any error - a deliberate choice so a database blip shows visible keys
 * instead of a 500. For THIS tool that is the most dangerous possible response: an empty payload means every
 * key reads as `defaultOnly` and the summary says ZERO OVERRIDDEN, which is the single most reassuring wrong
 * answer available. It would be read as "the database overrides nothing" at exactly the moment nothing can
 * be measured. So a payload that is implausibly small is a REFUSAL, not a result.
 *
 * ── TWO CAVEATS THAT DO NOT INVALIDATE IT, STATED RATHER THAN DISCOVERED ─────────────────────────────────
 *
 * 0. ENGLISH ONLY, AND THE REPORT SAYS SO IN ITS OWN OUTPUT. `lib/labelDefaults.en.json` is the only
 *    defaults file that exists - there is no per-locale equivalent - so a drifted non-English row has
 *    nothing in the repository to be compared against and is INVISIBLE to this tool.
 *
 *    This is not hypothetical and it is why the scope is printed rather than documented. The run that found
 *    `ARENA_SCANNER_COL_24H` reported ONE override. The same revert had also changed `ru` - live `24ч`
 *    against `20261022d`'s `24 часа` - and this tool could not see it; Dev found it by hand. A clean English
 *    run read as a clean run. So the footer counts the rows that were compared against NOTHING, per locale:
 *    `en` is measured, `ko`/`zh`/`ar`/`ru` carry roughly 2,416 rows each and are not.
 *
 *    `ar` counts even though no picker offers it (`AVAILABLE_LOCALES` excludes it for RTL, #138): its rows
 *    are live and anyone who chose Arabic before it was withdrawn still renders them.
 *
 *    AND THE FOOTER'S NUMBERS ARE THIS RUN'S, not a re-confirmation of anything. `lib/locales.ts:24` cites
 *    2,416 rows per locale from 2026-08-03; the counts here are 2373/2422/2422/2390 and do not match it.
 *    The five zeros DO agree with it, and that agreement means only that nobody has re-measured in 86 days -
 *    an old figure holding on one column is not evidence for its others.
 *
 * 1. `OPS_*` KEYS ARE INVISIBLE HERE. The route strips all 195 of them before caching (#1632 item 15), so
 *    they are excluded from BOTH sides and counted, rather than silently reported as unstored. The blind
 *    spot is benign and the reason is worth knowing: /ops renders its copy from the build-time snapshot, so
 *    an overridden `OPS_*` row does not reach the admin console anyway - it is not a #675 risk. An
 *    owner-run call to the ops route is still the only way to see them.
 * 2. UP TO ~60s STALE. TTL_MS is 60s in-memory and the edge carries `s-maxage=60`. A row written seconds ago
 *    may not appear yet. Re-run rather than concluding.
 *
 * ── THE §7 COLUMN, WHICH IS THE HOLE THIS CLOSES ─────────────────────────────────────────────────────────
 *
 * OWNER-RULES §7 requires a phone-width measurement before a label row is written, and its two live
 * triggers are mechanical: the key has no entry in the candidate list, OR the entry's value does not match
 * the string actually being written. The in-repo gate can enforce everything about a candidate EXCEPT those
 * two, because the repo cannot see a DB write. THIS CAN, against what is really live:
 *
 *   - NEVER MEASURED: a key the database overrides that has no entry in `qa/labelCandidates.ts`.
 *   - MEASURED, BUT NOT THIS STRING: a key with an entry whose `now` differs from the live value. §7's own
 *     words: "for an already-registered key you could change the label, run the spec exactly as instructed,
 *     and watch it go green on the OLD string."
 *
 * NO LENGTH COMPARISON. An earlier version of this file flagged "stored value LONGER than the default",
 * which is one of the two triggers §7 records as tried and wrong - character count substitutes for pixels,
 * and a shorter string of wide glyphs can be wider in a proportional uppercased letter-spaced font.
 *
 * `expectOverflow` is the declared exception to the second clause: those cells deliberately pin a string
 * that was REVERTED, so the candidate differing from the live value is the point rather than a finding. */
import { readFileSync } from 'node:fs';
import { diffLabels, summarise } from '@/lib/labelOverrides';
import { CANDIDATES } from '@/qa/labelCandidates';
import { SUPPORTED_LOCALES } from '@/lib/locales';

const HOST = (process.argv.find((a) => a.startsWith('http')) ?? 'https://liquidity-hq.com').replace(/\/$/, '');
const SHOW_ALL = process.argv.includes('--all');
const IS_OPS = (k) => k.startsWith('OPS_');

/* A payload smaller than this cannot be the real catalogue. Production measured 2,651 keys on 2026-10-27
   (#1632 item 15, which also removed 195 of them), so 1,000 is far below any healthy response and far above
   a fail-open `{}` or a single clamped PostgREST page returning nothing. */
const MIN_PLAUSIBLE_KEYS = 1000;

const res = await fetch(`${HOST}/api/labels?locale=en`, { cache: 'no-store', signal: AbortSignal.timeout(90_000) });
if (!res.ok) { console.error(`REFUSING TO ANSWER: ${HOST}/api/labels returned HTTP ${res.status}`); process.exit(2); }
const payload = await res.json();
const allKeys = Object.keys(payload ?? {});

if (allKeys.length < MIN_PLAUSIBLE_KEYS) {
  console.error(`REFUSING TO ANSWER: /api/labels returned ${allKeys.length} keys, under the ${MIN_PLAUSIBLE_KEYS} floor.`);
  console.error('That route FAILS OPEN to {} on any error, and an empty payload would report ZERO overrides -');
  console.error('"the database overrides nothing" at the exact moment nothing can be measured. Re-run.');
  process.exit(2);
}

const defaultsRaw = JSON.parse(readFileSync(new URL('../../lib/labelDefaults.en.json', import.meta.url), 'utf8'));

/* Both sides lose OPS_*, so the exclusion is symmetric and cannot manufacture a finding in either
   direction. Counted out loud: an exclusion nobody can see is one nobody can check. */
const dbRows = allKeys.filter((k) => !IS_OPS(k)).map((k) => ({ key: k, value: String(payload[k]) }));
const defaults = Object.fromEntries(Object.entries(defaultsRaw).filter(([k]) => !IS_OPS(k)));
const opsExcluded = {
  fromPayload: allKeys.filter(IS_OPS).length,
  fromDefaults: Object.keys(defaultsRaw).filter(IS_OPS).length,
};

const rows = diffLabels(dbRows, defaults);
const counts = summarise(rows);
const overridden = rows.filter((r) => r.kind === 'overridden');
const orphans = rows.filter((r) => r.kind === 'orphan');

const byKey = new Map(CANDIDATES.map((c) => [c.key, c]));
/* §7's two live clauses, applied to what is actually serving. No length comparison - see the header. */
const neverMeasured = overridden.filter((r) => !byKey.has(r.key));
const wrongString = overridden
  .map((r) => ({ r, c: byKey.get(r.key) }))
  .filter(({ r, c }) => c && !c.expectOverflow && c.now !== r.dbValue);

console.log(`SCOPE           locale=en ONLY. A drifted non-English row cannot be seen from here.`);
console.log(`host            ${HOST}`);
console.log(`payload         ${allKeys.length} keys (floor ${MIN_PLAUSIBLE_KEYS})`);
console.log(`OPS_* excluded  ${opsExcluded.fromPayload} from the payload, ${opsExcluded.fromDefaults} from the defaults`);
console.log(`compared        ${dbRows.length} stored rows against ${Object.keys(defaults).length} shipped defaults`);
console.log(`\noverridden      ${counts.overridden}   <- #675: a deploy that silently does nothing`);
console.log(`orphan          ${counts.orphan}   <- row whose key no longer exists in code`);
console.log(`defaultOnly     ${counts.defaultOnly}   <- normal, counted not listed`);

if (overridden.length) {
  console.log(`\n=== OVERRIDDEN (${overridden.length}) ===`);
  for (const r of (SHOW_ALL ? overridden : overridden.slice(0, 40))) {
    console.log(`  ${r.key}`);
    console.log(`    db   "${r.dbValue}"`);
    console.log(`    code "${r.codeDefault}"`);
  }
  if (!SHOW_ALL && overridden.length > 40) console.log(`  ... ${overridden.length - 40} more, pass --all`);
}

if (orphans.length) {
  console.log(`\n=== ORPHAN (${orphans.length}) - key renamed, row left behind ===`);
  for (const r of (SHOW_ALL ? orphans : orphans.slice(0, 20))) console.log(`  ${r.key} = "${r.dbValue}"`);
  if (!SHOW_ALL && orphans.length > 20) console.log(`  ... ${orphans.length - 20} more, pass --all`);
}

console.log(`\n=== §7 CLAUSE 1 - OVERRIDDEN AND NEVER MEASURED AT 390px (${neverMeasured.length}) ===`);
if (!neverMeasured.length) {
  console.log('  none - every overridden key has an entry in qa/labelCandidates.ts');
} else {
  console.log('  Live, different from what the code ships, and no phone-width cell. Add a candidate and run');
  console.log('  label-length-390 before the next write to them (docs/OWNER-RULES.md §7).');
  for (const r of neverMeasured) {
    console.log(`  ${r.key}`);
    console.log(`    db   "${r.dbValue}"`);
    console.log(`    code "${r.codeDefault}"`);
  }
}

console.log(`\n=== §7 CLAUSE 2 - MEASURED, BUT NOT THE STRING THAT IS LIVE (${wrongString.length}) ===`);
if (!wrongString.length) {
  console.log('  none - every registered candidate injects the value the database actually serves');
} else {
  console.log('  The cell would run and go green on a string nobody ships. Update the candidate\'s `now` to');
  console.log('  the value being written, or mark it expectOverflow if it pins a reverted string.');
  for (const { r, c } of wrongString) {
    console.log(`  ${r.key}`);
    console.log(`    live      "${r.dbValue}"`);
    console.log(`    candidate "${c.now}"`);
  }
}

/* ── WHAT WAS NOT MEASURED, COUNTED RATHER THAN MENTIONED ─────────────────────────────────────────────────
 *
 * Everything above concerns `en`. This footer exists because the first run of this tool reported "1
 * override" on a revert that had touched TWO locales, and the English answer read as the whole answer.
 *
 * A key is locale-specific when that locale's payload differs from English for it - `/api/labels?locale=L`
 * layers L over en, so equality with en means "not translated", not "agrees with the default". None of
 * these rows is compared against anything, because no per-locale defaults file exists. */
const nonEnglish = SUPPORTED_LOCALES.filter((l) => l !== 'en');
const uncompared = [];
for (const loc of nonEnglish) {
  try {
    const r = await fetch(`${HOST}/api/labels?locale=${loc}`, { cache: 'no-store', signal: AbortSignal.timeout(90_000) });
    if (!r.ok) { uncompared.push({ loc, rows: null, note: `HTTP ${r.status}` }); continue; }
    const p = await r.json();
    const keys = Object.keys(p ?? {});
    /* Same fail-open floor as above: a `{}` would report ZERO translated rows, which would understate the
       blind spot in exactly the reassuring direction. */
    if (keys.length < MIN_PLAUSIBLE_KEYS) { uncompared.push({ loc, rows: null, note: `only ${keys.length} keys - unreadable` }); continue; }
    uncompared.push({ loc, rows: keys.filter((k) => !IS_OPS(k) && p[k] !== payload[k]).length, note: '' });
  } catch (e) {
    uncompared.push({ loc, rows: null, note: e instanceof Error ? e.message : String(e) });
  }
}

const totalUncompared = uncompared.reduce((n, u) => n + (u.rows ?? 0), 0);
console.log(`\n=== NOT MEASURED BY THIS RUN: ${totalUncompared} non-English rows across ${nonEnglish.length} locales ===`);
console.log('  No per-locale defaults file exists, so these have nothing in the repository to differ FROM.');
console.log('  Counted as "value differs from English", which is a LOWER BOUND on rows in the table: a');
console.log('  translation that happens to equal English - a ticker, a brand - is indistinguishable here');
console.log('  from an untranslated key.');
console.log('  The counts above are from THIS run. lib/locales.ts:24 says 2,416 each, measured 2026-08-03;');
console.log('  these numbers are not that, and agreement on the five zeros is not confirmation of the rest -');
console.log('  it means that figure has not been re-checked in 86 days.');
for (const u of uncompared) {
  const n = u.rows === null ? '  ?' : String(u.rows).padStart(5);
  console.log(`  ${u.loc.padEnd(6)} ${n} locale-specific rows${u.note ? `   (${u.note})` : ''}`);
}
console.log('  A locale at 0 has no rows at all (vi/pt-BR/tr/es/id were seeded with none, lib/locales.ts:24).');
console.log('  `ar` is translated but withdrawn from every picker (#138, RTL) - its rows still render for');
console.log('  anyone who chose it before, so it is a blind spot rather than dead weight.');

/* Exit 0 whatever is found: this is a report, not a gate. Only a measurement that could not be taken is a
   non-zero exit, so "it ran and found overrides" is never confused with "it could not read the catalogue". */
