import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeHttpUrl } from '../lib/safeUrl.ts';

/* Coverage for #2113 - the scheme allowlist behind the Arena reasoning links and the news images.
 *
 * A REAL UNIT TEST, which is why the predicate was exported separately: the whole question is what
 * a URL parser does with malformed input, and that is exactly the property a source assertion
 * cannot check and a re-implementation would only agree with me about.
 *
 * THE DEFECT IT CLOSES (#1631, live since `b96393e0`, 2026-05-29): `ReasoningText` matched
 * `[label](url)` in MODEL-WRITTEN text and rendered `<a href={url}>` with no check, so a
 * `javascript:` URL became a clickable link. Deep mode searches the web, so a crafted page could
 * seed the text; the read is stored in history, so it persisted. The news image `src` had the same
 * gap on all three ingest paths - which my own first sweep missed, because I grepped `href=` only
 * and had framed the question as "AI text becoming a link".
 *
 * WHY THE TABLE BELOW IS THE TEST. A scheme check is only as good as the spellings it survives, so
 * the vectors are enumerated rather than summarised: whoever changes this predicate has to argue
 * with each line instead of re-deriving which ones mattered. The grouping is deliberate - the
 * must-pass cases are as important as the must-fail ones, because a predicate that rejects
 * everything is "safe" and useless.
 */

/** [label, input, expected]. `unknown` input type on purpose: the predicate takes `unknown` and
 *  must reject non-strings without coercing them. */
const VECTORS: ReadonlyArray<readonly [label: string, input: unknown, safe: boolean]> = [
  // ── MUST PASS. A predicate that fails these is not usable. ────────────────────────────────
  ['plain https',                'https://example.com/a?b=1#c',          true],
  ['plain http',                 'http://example.com',                   true],
  ['uppercase scheme',           'HTTPS://EXAMPLE.COM',                  true],
  ['embedded credentials',       'http://user:pass@example.com',         true],
  ['port and non-ascii host',    'https://exämple.com:8443/x',           true],

  // ── MUST FAIL: the script-bearing schemes, in every spelling a browser tolerates. ─────────
  ['javascript',                 'javascript:alert(1)',                  false],
  ['javascript mixed case',      'JaVaScRiPt:alert(1)',                  false],
  ['javascript with newline',    'java\nscript:alert(1)',                false],
  ['javascript with tab',        'java\tscript:alert(1)',                false],
  ['javascript with CR',         'java\rscript:alert(1)',                false],
  ['leading whitespace',         '  javascript:alert(1)',                false],
  ['leading NUL',                '\u0000javascript:alert(1)',            false],
  ['percent-encoded scheme',     '%6a%61%76%61script:alert(1)',          false],
  ['vbscript',                   'vbscript:msgbox(1)',                   false],

  // ── MUST FAIL: other non-http schemes. ────────────────────────────────────────────────────
  ['data html',                  'data:text/html,<script>1</script>',    false],
  ['data base64',                'data:text/html;base64,PHN2Zz4=',       false],
  ['blob',                       'blob:https://x/y',                     false],
  ['file',                       'file:///etc/passwd',                   false],
  ['about',                      'about:blank',                          false],
  ['mailto',                     'mailto:a@b.c',                         false],

  // ── MUST FAIL: not an absolute URL at all. ────────────────────────────────────────────────
  ['protocol-relative',          '//evil.example',                       false],
  ['root-relative',              '/evil',                                false],
  ['bare word',                  'evil',                                 false],
  ['empty string',               '',                                     false],

  // ── MUST FAIL: not a string. The `typeof` guard runs BEFORE any coercion, which is what
  //    stops an object with a well-chosen `toString` from smuggling a URL through. ───────────
  ['null',                       null,                                   false],
  ['undefined',                  undefined,                              false],
  ['number',                     12345,                                  false],
  ['object with toString',       { toString: () => 'https://example.com' }, false],
  ['array of one url',           ['https://example.com'],                false],
];

test('U1. every vector behaves, and both verdicts are represented', () => {
  const wrong: string[] = [];
  for (const [label, input, safe] of VECTORS) {
    if (isSafeHttpUrl(input) !== safe) wrong.push(`${label} (expected ${safe})`);
  }
  assert.deepEqual(wrong, [], `vectors disagreeing with the predicate: ${wrong.join(' | ')}`);

  /* VACUITY GUARD. A table where every row expects the same answer would pass against a predicate
     that is a constant, so require both verdicts to be present. */
  assert.ok(VECTORS.some(([, , safe]) => safe), 'no must-PASS vector: a reject-everything predicate would pass');
  assert.ok(VECTORS.some(([, , safe]) => !safe), 'no must-FAIL vector: an accept-everything predicate would pass');
  assert.ok(VECTORS.length >= 25, `the table shrank to ${VECTORS.length} vectors`);
});

test('U2. the allowlist is on the PARSED protocol, which is what makes the variants fall out', () => {
  /* This is the design property worth pinning, not just the outcomes above. `new URL` strips tabs,
     newlines and CRs and lowercases the scheme BEFORE the comparison, so `java\nscript:` is already
     `javascript:` by the time the allowlist sees it. A blacklist would have had to anticipate each
     spelling; this does not need to know they exist.
     Asserted by showing the three mangled spellings agree with the plain one. */
  for (const mangled of ['java\nscript:alert(1)', 'java\tscript:alert(1)', 'JaVaScRiPt:alert(1)']) {
    assert.equal(isSafeHttpUrl(mangled), isSafeHttpUrl('javascript:alert(1)'),
      `${JSON.stringify(mangled)} should reach the same verdict as the plain spelling`);
  }
});

test('U3. SCOPE: this is a scheme check and not a domain check', () => {
  /* Pinned so nobody later mistakes it for a phishing or SSRF guard and relies on it for that.
     A hostile host over https is SAFE by this predicate, correctly - its job is to stop script
     execution from a URL, not to judge who is on the other end. */
  assert.equal(isSafeHttpUrl('https://evil.example/steal'), true,
    'a hostile host over https must still pass: narrowing this predicate to judge domains would '
    + 'give callers a false sense of what it checks');
});
