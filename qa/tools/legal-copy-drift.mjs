#!/usr/bin/env node
/* LEGAL COPY DRIFT: which legal keys are missing, and which are translated more briefly than their
 * own language's norm. Reads a deployed /api/labels; no credentials, no writes, no AI calls.
 *
 *   node qa/tools/legal-copy-drift.mjs [base-url]       default https://liquidity-hq.com
 *
 * WHY IT IS COMMITTED RATHER THAN RUN ONCE (QA Team, 2026-11-07). The 8 missing Terms billing keys
 * will be inserted and the 20 untranslated ones will be translated, and then nothing stops the NEXT
 * section from diverging silently - which is exactly how these did. A one-off script finds the
 * current drift; a committed one makes the question re-askable.
 *
 * ── THE MISTAKE THIS FILE EXISTS TO PREVENT, BECAUSE I MADE IT ────────────────────────────────────
 *
 * My first version measured all 10 SUPPORTED_LOCALES and reported "five locales are byte-identical
 * to English, while we advertise those languages". The measurement was right and the conclusion was
 * wrong: THERE ARE TWO LISTS AND ONLY ONE OF THEM IS AN OFFER.
 *
 *   SUPPORTED_LOCALES   10 codes   validation only - lib/locales.ts says so in as many words,
 *                                  so a preference already stored as 'tr' still RESOLVES
 *   AVAILABLE_LOCALES    4 codes   en ko zh ru - the only ones in any picker
 *
 * vi, pt-BR, tr, es and id have zero rows AND are in neither picker, so English bytes are correct
 * behaviour, not a gap. `ar` is the inverse and the more interesting case: 2,416 rows, fully
 * translated, and deliberately NOT offered because RTL is unimplemented (owner decision, #138).
 *
 * So this script reports against AVAILABLE_LOCALES and prints the rest as context, labelled as not
 * a gap. The lists are IMPORTED rather than copied, so it cannot drift from them the way my
 * conclusion did. Related: a governing doc read halfway is worse than not read, because it supplies
 * confidence without the constraint.
 *
 * ── WHY A RAW LENGTH RATIO IS THE WRONG INSTRUMENT ────────────────────────────────────────────────
 *
 * Korean and Chinese express the same content in far fewer characters and Russian in more, so
 * thresholding on len(locale)/len(en) is a language detector, not a content detector - it flags
 * every CJK string and nothing in Russian. Each key is therefore compared against ITS OWN LOCALE'S
 * median ratio across that locale's translated legal keys.
 *
 * Measured 2026-11-07 on prod: medians ko 0.53, zh 0.33, ar 0.84, ru 1.13. Russian legal text runs
 * LONGER than the English, and the same three keys still flagged there at 0.30x and 0.49x. Four
 * unrelated languages converging on the same three keys is what makes the result trustworthy, and
 * that argument is only available because the ratio was normalised.
 *
 * LENGTH IS A DETECTOR, NOT A VERDICT. It cannot say whether the 781 characters missing from the
 * Korean cookies section carried required meaning. That is the owner's call or a lawyer's. This
 * script points; it does not rule.
 */
import { readFile } from 'node:fs/promises';
import { AVAILABLE_LOCALES, SUPPORTED_LOCALES } from '../../lib/locales.ts';

const BASE = (process.argv[2] ?? 'https://liquidity-hq.com').replace(/\/+$/, '');
/* ── THE KEY SET IS DERIVED FROM THE PAGES, NOT LISTED ────────────────────────────────────────────
 *
 * This was `/^(TERMS|PRIVACY|REFUND|DISCLAIMER)_/` and it was SHORT BY FIVE: `CONSENT_` was absent,
 * so the cookie-consent banner - legal copy on every page - had never been measured. I "fixed" that
 * by adding CONSENT to the list, which repaired five keys and left the failure mode untouched. The
 * other QA session asked the right question: does it DERIVE the set, or can the list go short again?
 *
 * IT COULD. A scan that reports on "every legal key" while "legal" is defined by a hand-written
 * pattern is asserting a completeness it cannot have, and the output looks identical either way -
 * nothing marks the keys the pattern never considered. That all five CONSENT keys turned out fine
 * was luck, not vindication.
 *
 * SO THE SET NOW COMES FROM THE FILES THAT RENDER THE COPY. A legal key is one referenced by a page
 * whose job is legal text. That is the actual definition, and it is self-maintaining: a new section
 * added to /terms is picked up with no edit here, and a whole new legal page fails loudly below
 * rather than silently reducing the scope.
 *
 * THE SEED CANNOT BE ELIMINATED, ONLY MADE VISIBLE AND CHECKED. This is still a list - of files
 * instead of prefixes - and pretending otherwise would repeat the original error one level up. What
 * changes is that a missing FILE is conspicuous (five entries, each a page you can open) where a
 * missing PREFIX was not, and that CONTROL 4 below cross-checks this derivation against an
 * independent keyword sweep of the entire payload. Two derivations that disagree are the signal. */
const LEGAL_SOURCES = [
  'app/(main)/terms/page.tsx',
  'app/(main)/privacy/page.tsx',
  'app/(main)/refund/page.tsx',
  'app/(main)/disclaimer/page.tsx',
  'components/CookieConsent.tsx',
];

/* Independent of LEGAL_SOURCES on purpose: this sweeps EVERY key in the payload for a legal-ish
   word and is used only to contradict the derivation, never to build it. If it finds a key the
   pages do not reference, either a legal surface is missing from LEGAL_SOURCES or a stale key is
   lying around - both worth knowing, and neither visible from the derivation alone. */
/* MATCHED PER UNDERSCORE-DELIMITED TOKEN, not as a substring. The first version was a bare regex
   over the whole key and it reported AUTH_TERMINAL_LIVE_TAG as legal-ish, because TERMINAL contains
   TERM. One false positive in a 16-row control output is enough to make a reader discount the other
   fifteen, and those fifteen were real. */
const LEGALISH_TOKENS = new Set([
  'TERM', 'TERMS', 'PRIVACY', 'REFUND', 'REFUNDS', 'DISCLAIMER', 'CONSENT', 'COOKIE', 'COOKIES',
  'GDPR', 'LEGAL', 'LIABILITY', 'WARRANTY', 'INDEMNIFICATION', 'WITHDRAWAL',
]);
const isLegalish = (key) => key.split('_').some((t) => LEGALISH_TOKENS.has(t));

/* 0.70, RAISED FROM 0.65 ON MEASUREMENT, not on taste. A full ranked run on prod 2026-11-08 shows a
   genuine cliff among substantive bodies (en >= 120 chars):

     0.24 0.27 0.30 0.30 0.33 0.43 0.56 0.60 0.68   <- 3 distinct keys x 3 locales
     ------------------------------- gap 0.08 ------------------------------
     0.76 0.83 0.83 0.84 0.86 ...                   <- everything else

   At 0.65 the line fell INSIDE one of those keys: PRIVACY_SECTION_INFO_COLLECTED_BODY flagged on
   ko (0.60) and zh (0.56) but not ru (0.68), so the same defect was reported in two locales and
   hidden in the third. 0.70 captures all nine pairs and still excludes the next-nearest key at
   0.76. If a future run reports something between 0.70 and 0.76, read it as the cliff having moved
   rather than as a new finding, and re-run the ranked view before trusting either. */
const SHORT_FACTOR = 0.70;

/* Short labels cannot be judged by ratio: "Changes" is 7 characters and its Korean is 2, which is
   normal CJK brevity rather than lost content. VERIFIED THAT THIS CUTOFF IS NOT HIDING BODIES: of
   the 22 locale-key pairs it excluded on 2026-11-08, every one was a TITLE, EYEBROW or button label
   of 6-27 English characters. Zero bodies were excluded. The run prints the excluded count so the
   cutoff is visible rather than silent - a filter nobody can see is indistinguishable from a
   finding nobody found. */
const MIN_EN_CHARS = 120;

/* Keys the Terms page renders that are the current known absence. Named explicitly so a run reports
   whether they are STILL missing rather than leaving it to a reader to notice. */
const KNOWN_ABSENT_PIN = [
  'TERMS_SECTION_SUBSCRIPTIONS_TITLE', 'TERMS_SECTION_SUBSCRIPTIONS_BODY',
  'TERMS_SECTION_BILLING_TITLE', 'TERMS_SECTION_BILLING_BODY',
  'TERMS_SECTION_CANCELLATION_TITLE', 'TERMS_SECTION_CANCELLATION_BODY',
  'TERMS_SECTION_REFUNDS_TITLE', 'TERMS_SECTION_REFUNDS_BODY',
];

const fetchLocale = async (l) => {
  const res = await fetch(`${BASE}/api/labels?locale=${encodeURIComponent(l)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${l}: HTTP ${res.status} from ${BASE}/api/labels`);
  return res.json();
};

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

async function main() {
  console.log(`legal-copy-drift against ${BASE}\n`);

  /* ── CONTROL 1: the two lists must still be different, and AVAILABLE a subset of SUPPORTED.
     If someone collapses them, every conclusion below changes meaning and this says so loudly
     rather than silently reporting against the wrong set. */
  const notSubset = AVAILABLE_LOCALES.filter((l) => !SUPPORTED_LOCALES.includes(l));
  if (notSubset.length) throw new Error(`AVAILABLE_LOCALES has codes absent from SUPPORTED_LOCALES: ${notSubset.join(', ')}`);
  const offeredOnly = SUPPORTED_LOCALES.filter((l) => !AVAILABLE_LOCALES.includes(l));
  console.log(`CONTROL  AVAILABLE_LOCALES (offered): ${AVAILABLE_LOCALES.join(' ')}`);
  console.log(`CONTROL  SUPPORTED-only (validation, NOT offered - English here is correct): ${offeredOnly.join(' ') || 'none'}`);
  if (!offeredOnly.length) {
    console.log('NOTE: the two lists are now identical. Every locale is offered, so the "not a gap"\n' +
      '      carve-out below no longer applies and English fallbacks ARE findings.');
  }

  const payloads = {};
  for (const l of SUPPORTED_LOCALES) payloads[l] = await fetchLocale(l);
  const en = payloads.en;

  /* ── CONTROL 2: whole-payload identity, before any per-key work. Coarse, cheap, and it catches a
     wholly unseeded locale that per-key analysis would report 2,500 times instead of once. */
  const enJson = JSON.stringify(en);
  const identical = SUPPORTED_LOCALES.filter((l) => l !== 'en' && JSON.stringify(payloads[l]) === enJson);
  console.log(`\nwhole-payload identical to en: ${identical.join(' ') || 'none'}`);
  const identicalOffered = identical.filter((l) => AVAILABLE_LOCALES.includes(l));
  if (identicalOffered.length) {
    console.log(`  *** ${identicalOffered.join(', ')} IS OFFERED IN A PICKER AND HAS NO TRANSLATIONS AT ALL. ***`);
  } else {
    console.log('  none of them are offered, so this is expected rather than a gap');
  }

  /* Derive the key set from the files that render legal copy. `defaults` is the full declared set,
     so a key the pages reference but the DATABASE lacks still appears here - which is how the
     no-rows-at-all case is FOUND rather than remembered. */
  const defaults = JSON.parse(await readFile(new URL('../../lib/labelDefaults.en.json', import.meta.url), 'utf8'));
  const referenced = new Set();
  const perFile = [];
  for (const rel of LEGAL_SOURCES) {
    let src;
    try {
      src = await readFile(new URL(`../../${rel}`, import.meta.url), 'utf8');
    } catch {
      /* A legal page that moved or was renamed must STOP the run. Silently scanning four files
         instead of five is the exact failure this derivation replaced. */
      throw new Error(`LEGAL_SOURCES names ${rel}, which does not exist. A legal surface has moved - ` +
        'fix the path rather than letting the scan quietly cover less.');
    }
    const found = [...new Set([...src.matchAll(/'([A-Z][A-Z0-9_]{3,})'/g)].map((m) => m[1]))]
      .filter((k) => k in defaults);
    for (const k of found) referenced.add(k);
    perFile.push(`${rel.replace(/^.*\//, '')} ${found.length}`);
  }
  const legalKeys = [...referenced].sort();
  console.log(`\nlegal keys DERIVED from ${LEGAL_SOURCES.length} source files: ${legalKeys.length}   (${perFile.join(', ')})`);

  /* ── CONTROL 4: the independent keyword sweep must not find a legal-ish key the pages do not
     reference. This is the control that the old hand-written prefix could never have, because the
     prefix WAS the definition - nothing existed to disagree with it. */
  const sweep = Object.keys(defaults).filter(isLegalish);
  const unreferenced = sweep.filter((k) => !referenced.has(k));
  console.log(`CONTROL  keyword sweep over all ${Object.keys(defaults).length} declared keys found ${sweep.length} legal-ish; ` +
    `${unreferenced.length} are NOT referenced by any file in LEGAL_SOURCES`);
  if (unreferenced.length) {
    console.log('  Either a legal surface is missing from LEGAL_SOURCES, or these are stale keys:');
    for (const k of unreferenced) console.log(`    ${k}`);
  }

  /* ── CONTROL 3: THE ONE THAT FOUND THE REAL FINDING. Asserting that the keys under investigation
     are in my own key set reported 0 of 8 - they are in labelKeys.ts and labelDefaults.en.json but
     absent from the served payload, so the page falls back to bundled English. Without this the
     script would have reported "zero translations" for eight keys it had silently dropped from its
     own list: a true-looking answer reached by not looking. */
  /* DERIVED, not recalled: a key the legal pages render that the served payload does not carry has
     no database row in any locale, and falls back to the bundled English default. The pin below is
     only a regression check that the eight known ones are still among them. */
  const absent = legalKeys.filter((k) => !(k in en));
  const pinStillAbsent = KNOWN_ABSENT_PIN.filter((k) => absent.includes(k));
  console.log(`\nkeys the legal pages render with NO ROW IN ANY LOCALE: ${absent.length} (derived)`);
  console.log(`CONTROL  of the 8 pinned on 2026-11-07, still absent: ${pinStillAbsent.length}/${KNOWN_ABSENT_PIN.length}`);
  if (absent.length > KNOWN_ABSENT_PIN.length) {
    console.log(`  *** ${absent.length - KNOWN_ABSENT_PIN.length} MORE than the pin - new keys shipped without rows. ***`);
  }
  if (absent.length) {
    console.log('  NO DATABASE ROWS IN ANY LOCALE - rendered from lib/labelDefaults.en.json, so English');
    console.log('  on every offered locale. This needs an INSERT, not a translation:');
    for (const k of absent) console.log(`    ${k}`);
  } else {
    console.log('  all present now - they have rows. Check their TRANSLATIONS in the table below.');
  }

  /* Per-locale coverage and the short-outlier scan, over OFFERED non-English locales. */
  const offered = AVAILABLE_LOCALES.filter((l) => l !== 'en');
  const translated = {}, ratios = {};
  for (const l of offered) { translated[l] = new Set(); ratios[l] = []; }
  for (const k of legalKeys) {
    const e = String(en[k] ?? '');
    for (const l of offered) {
      const v = payloads[l][k];
      if (v == null || String(v) === e) continue;   // identical to en == falling back, not translated
      translated[l].add(k);
      if (e.length > 40) ratios[l].push(String(v).length / e.length);
    }
  }
  const med = Object.fromEntries(offered.map((l) => [l, median(ratios[l])]));

  console.log('\n=== COVERAGE, offered locales only');
  for (const l of offered) {
    console.log(`  ${l.padEnd(5)} ${String(translated[l].size).padStart(3)}/${legalKeys.length} translated   median ratio ${med[l].toFixed(2)}`);
  }

  const zero = legalKeys.filter((k) => offered.every((l) => !translated[l].has(k)));
  console.log(`\n=== ENGLISH ON EVERY OFFERED LOCALE (has an en row, no translations): ${zero.length}`);
  for (const k of zero) console.log(`  ${k}`);

  console.log('\n=== SHORTER THAN THE LOCALE\'S OWN NORM (candidate omitted content, NOT a verdict)');
  let flagged = 0, excludedShort = 0, nearMiss = 0;
  const bodiesExcluded = [];
  for (const l of offered) {
    for (const k of [...translated[l]].sort()) {
      const e = String(en[k]), s = String(payloads[l][k]);
      const rel = (s.length / e.length) / med[l];
      if (e.length < MIN_EN_CHARS) {
        /* Counted and surfaced, not silently dropped. A body landing here would mean the cutoff is
           hiding something it was never meant to hide, so those are named individually. */
        if (rel < SHORT_FACTOR) {
          excludedShort++;
          if (/_BODY$/.test(k)) bodiesExcluded.push(`${l} ${k} (en ${e.length}c, rel ${rel.toFixed(2)})`);
        }
        continue;
      }
      if (rel < SHORT_FACTOR) {
        flagged++;
        console.log(`  ${l}  ${k}`);
        console.log(`      en ${e.length} -> ${s.length} chars   rel ${rel.toFixed(2)} of ${l} median ${med[l].toFixed(2)}`);
      } else if (rel < SHORT_FACTOR + 0.10) {
        /* The band just above the line. On 2026-11-08 it held exactly ONE member - zh
           DISCLAIMER_SECTION_BACKTESTS_BODY at 0.76, the nearest key above the cliff. So this
           count is 1 in a healthy run, not 0; a value of 2 or more means something new has moved
           into the gap and the ranked view should be re-read before trusting the flagged list. */
        nearMiss++;
      }
    }
  }
  if (!flagged) console.log('  none');
  console.log(`\n  below the line but under the ${MIN_EN_CHARS}-char floor (titles/labels, normal CJK brevity): ${excludedShort}`);
  if (bodiesExcluded.length) {
    console.log('  *** A _BODY KEY IS BEING EXCLUDED BY THE CHAR FLOOR - the floor was sized for titles: ***');
    for (const b of bodiesExcluded) console.log(`      ${b}`);
  }
  console.log(`  in the ${SHORT_FACTOR}-${(SHORT_FACTOR + 0.10).toFixed(2)} band just above the line: ${nearMiss}` +
    (nearMiss > 1 ? '  *** was 1 on 2026-11-08 - something new is in the gap, re-read the ranked view ***' : '  (1 is the known baseline: zh DISCLAIMER_SECTION_BACKTESTS_BODY at 0.76)'));

  console.log(`\nflagged-short: ${flagged}   english-everywhere: ${zero.length}   no-rows-at-all: ${absent.length}`);
  console.log('Length is a detector. Whether a short translation omits REQUIRED content is the owner\'s call.');
}

main().catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
