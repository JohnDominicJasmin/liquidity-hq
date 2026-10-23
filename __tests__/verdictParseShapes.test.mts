/* #1721: WHICH SHAPES OF VERDICT LINE does the app accept, and which does it refuse?
 *
 * Deep Research returns 502 BAD_ANSWER on every call - three of three on 2026-10-23, both phrasings, on two builds, with a cause that
 * predates the batch under test. `0d63309b` is not the regression: it REPLACED a silent coercion (an unreadable answer was parsed as
 * FLAT at 0% and shown as a "Wait" the model never said) with an honest refusal, so the 502 is that refusal becoming visible.
 *
 * THE CANDIDATE THIS FILE PINS. `SIGNAL_LINE` and `CONFIDENCE_LINE` put `\*{0,2}` immediately after the colon and BEFORE `\s*`, so
 * asterisks are tolerated only when they precede the whitespace. A bolded LABEL parses; a bolded VALUE does not - and bolding the value
 * is one of the most ordinary things an LLM does to a labelled field. If the model's formatting drifted that way, parseVerdict refuses,
 * the restate asks again, the model bolds again, and every call 502s with the restate genuinely running and genuinely failing.
 *
 * WHAT THESE TESTS ARE AND ARE NOT. They prove what the PARSER accepts. They do not prove what the MODEL sends - that needs the
 * `head="..."` log Dev added in `d4d9efdb`, and one real failure closes it at no cost. So the two value-bolded cases are marked `todo`
 * rather than failing the suite: the repo's own red-by-design pattern (see A7 in arenaCoinLadder), which keeps a known gap visible on
 * every run without breaking the gate for whoever is fixing it. When the log confirms the shape, drop `todo` and the fix turns them green.
 *
 * NO BILLED CALLS AND NO NETWORK: this imports the parser and feeds it strings. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVerdict } from '../lib/grok.ts';

/** A full answer in the shape the prompt asks for, with the verdict lines substituted in. */
const answer = (signalLine: string, confLine: string) =>
  `${signalLine}\n${confLine}\nREASONING: the structure favours longs above 80,900 and the 4h ribbon is expanding.`;

/* ── shapes that MUST parse: the contract, plus the markdown the model already emits ───────────────────────────── */

const ACCEPTED: Array<[string, string, string]> = [
  ['plain, exactly as the prompt asks', 'SIGNAL: BULLISH', 'CONFIDENCE: 62'],
  ['label bolded', '**SIGNAL:** BULLISH', '**CONFIDENCE:** 62'],
  ['whole line bolded', '**SIGNAL: BULLISH**', '**CONFIDENCE: 62**'],
  ['markdown heading prefix', '### SIGNAL: BULLISH', '### CONFIDENCE: 62'],
  ['lowercase label', 'Signal: BULLISH', 'Confidence: 62'],
  ['extra whitespace after the colon', 'SIGNAL:    BULLISH', 'CONFIDENCE:    62'],
  ['a two-word signal', 'SIGNAL: LEAN BEARISH', 'CONFIDENCE: 44'],
  ['confidence at the boundary', 'SIGNAL: FLAT', 'CONFIDENCE: 100'],
];

for (const [label, sig, conf] of ACCEPTED) {
  test(`V-ok: ${label}`, () => {
    const v = parseVerdict(answer(sig, conf));
    assert.ok(v, `refused a shape the app must accept:\n  ${sig}\n  ${conf}`);
    assert.ok(['BULLISH', 'LEAN BEARISH', 'FLAT'].includes(v.signal), `unexpected signal ${v.signal}`);
    assert.equal(typeof v.confidence, 'number');
  });
}

/* ── shapes that MUST be refused: a refusal is the honest answer, a coerced verdict is the bug #1651 item 3 removed ── */

const REFUSED: Array<[string, string]> = [
  ['the model says it cannot read its own answer', 'UNREADABLE'],
  ['a signal with no confidence line at all', 'SIGNAL: BULLISH\nREASONING: ...'],
  ['a confidence with no signal line at all', 'CONFIDENCE: 62\nREASONING: ...'],
  ['prose with neither line', 'BTC looks constructive above 80,900 but I would wait for the retest.'],
  ['a signal outside the five values', 'SIGNAL: MOON\nCONFIDENCE: 99'],
  ['a confidence over 100', 'SIGNAL: BULLISH\nCONFIDENCE: 140'],
];

for (const [label, text] of REFUSED) {
  test(`V-no: ${label}`, () => {
    assert.equal(parseVerdict(text), null, `accepted something it must refuse:\n  ${text.replace(/\n/g, ' | ')}`);
  });
}

/* ── THE KNOWN GAP (#1721). `todo` on purpose: see the header. ─────────────────────────────────────────────────── */

test('V-gap: a bolded VALUE on the signal line', { todo: '#1721: SIGNAL: **BULLISH** is refused - \\*{0,2} sits before \\s*, so asterisks after the space are not matched' }, () => {
  const v = parseVerdict(answer('SIGNAL: **BULLISH**', 'CONFIDENCE: 62'));
  assert.ok(v, 'SIGNAL: **BULLISH** was refused');
});

test('V-gap: a bolded VALUE on the confidence line', { todo: '#1721: CONFIDENCE: **62** is refused for the same reason' }, () => {
  const v = parseVerdict(answer('SIGNAL: BULLISH', 'CONFIDENCE: **62**'));
  assert.ok(v, 'CONFIDENCE: **62** was refused');
});

test('V-gap: both values bolded, which is what a markdown-formatting model would actually send', { todo: '#1721: the whole-verdict case' }, () => {
  const v = parseVerdict(answer('**SIGNAL:** **BULLISH**', '**CONFIDENCE:** **62**'));
  assert.ok(v, 'a fully markdown-formatted verdict was refused');
});

/* ── and the thing the fix must NOT do ──────────────────────────────────────────────────────────────────────────── */

test('V-strict: whatever shape is added, UNREADABLE must still be refused', () => {
  /* The fix for the gap above is to tolerate more markdown. The failure mode of that fix is tolerating too much and reading a verdict
     out of an answer that states none - which is the coercion 0d63309b removed, reintroduced through the back door. */
  for (const text of ['UNREADABLE', '**UNREADABLE**', 'SIGNAL: UNREADABLE\nCONFIDENCE: 0', 'I could not reach a verdict.']) {
    assert.equal(parseVerdict(text), null, `read a verdict out of: ${text.replace(/\n/g, ' | ')}`);
  }
});
