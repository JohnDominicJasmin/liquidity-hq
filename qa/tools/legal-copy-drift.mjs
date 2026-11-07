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
import { AVAILABLE_LOCALES, SUPPORTED_LOCALES } from '../../lib/locales.ts';

const BASE = (process.argv[2] ?? 'https://liquidity-hq.com').replace(/\/+$/, '');
const PREFIX = /^(TERMS|PRIVACY|REFUND|DISCLAIMER)_/;
const SHORT_FACTOR = 0.65;   // flag below this multiple of the locale's own median
const MIN_EN_CHARS = 120;    // short labels have too much ratio noise to judge

/* Keys the Terms page renders that are the current known absence. Named explicitly so a run reports
   whether they are STILL missing rather than leaving it to a reader to notice. */
const KNOWN_ABSENT = [
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

  const legalKeys = Object.keys(en).filter((k) => PREFIX.test(k)).sort();
  console.log(`\nlegal keys in the served payload: ${legalKeys.length}`);

  /* ── CONTROL 3: THE ONE THAT FOUND THE REAL FINDING. Asserting that the keys under investigation
     are in my own key set reported 0 of 8 - they are in labelKeys.ts and labelDefaults.en.json but
     absent from the served payload, so the page falls back to bundled English. Without this the
     script would have reported "zero translations" for eight keys it had silently dropped from its
     own list: a true-looking answer reached by not looking. */
  const absent = KNOWN_ABSENT.filter((k) => !(k in en));
  console.log(`CONTROL  known-absent keys still missing from the payload: ${absent.length}/${KNOWN_ABSENT.length}`);
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
  let flagged = 0;
  for (const l of offered) {
    for (const k of [...translated[l]].sort()) {
      const e = String(en[k]), s = String(payloads[l][k]);
      if (e.length < MIN_EN_CHARS) continue;
      const r = s.length / e.length;
      if (r < SHORT_FACTOR * med[l]) {
        flagged++;
        console.log(`  ${l}  ${k}`);
        console.log(`      en ${e.length} -> ${s.length} chars   ratio ${r.toFixed(2)} vs ${l} median ${med[l].toFixed(2)}`);
      }
    }
  }
  if (!flagged) console.log('  none');

  console.log(`\nflagged-short: ${flagged}   english-everywhere: ${zero.length}   no-rows-at-all: ${absent.length}`);
  console.log('Length is a detector. Whether a short translation omits REQUIRED content is the owner\'s call.');
}

main().catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
