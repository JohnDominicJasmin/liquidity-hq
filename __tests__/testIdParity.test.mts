import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* #52 — QA's a11y specs select by CSS class, which nobody owes them stability
 * on. These `data-testid` attributes are the stable hook.
 *
 * The reason this file exists is what happens NEXT. The attributes are only
 * useful while they stay attached to every element carrying the class, and the
 * specs that use them do not fail when one is missing - they measure LESS:
 *
 *   expect(pairs.length, 'no .tj-field label/control pairs found').toBeGreaterThan(0)
 *
 * Four fields today. Add a fifth without the attribute and that assertion still
 * passes on the other four, having silently stopped covering the new one. Same
 * shape as #108, where a fix addressed only the classes a failing test named.
 *
 * So this asserts PARITY: as many elements carry the class as carry the testid.
 *
 * WHAT THIS DOES NOT CHECK, stated rather than implied: that the two sit on the
 * SAME element. Verifying that means parsing JSX opening tags, and `onClick={()
 * => ...}` puts a `>` inside the tag, so a regex either truncates or needs a
 * parser. Counting catches the case that actually happens - an element added
 * without the attribute - and cannot fail spuriously. The pairing is a review
 * concern, once, at the point the attribute is added. */

const PAIRS: Array<{ cls: string; testId: string }> = [
  { cls: 'login-error',  testId: 'login-error'   },
  { cls: 'st-page',      testId: 'settings-page' },
  { cls: 'tj-field',     testId: 'tj-field'      },
  { cls: 'tj-edit-form', testId: 'tj-edit-form'  },
  { cls: 'gchat-panel',  testId: 'grok-panel'    },
  { cls: 'gchat-msgs',   testId: 'grok-messages' },
];

/** Every .tsx under app/ and components/ - not a fixed file list, so a NEW file
 *  introducing one of these classes is covered without anyone updating this. */
function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) sources(`${dir}/${e.name}`, out);
    else if (e.name.endsWith('.tsx')) out.push(`${dir}/${e.name}`);
  }
  return out;
}

const files = [
  ...sources(fileURLToPath(new URL('../app', import.meta.url))),
  ...sources(fileURLToPath(new URL('../components', import.meta.url))),
].map(f => stripComments(readFileSync(f, 'utf8')));

/* Comments come out first. `app/login/page.tsx` documents the bug it fixed by
   quoting the markup - `<div className="login-error">` - inside a comment, and
   a scanner counts that as a seventh element. It did, on the first run.

   Second time today a source-scanning test has read prose as code. Worth doing
   this by default in anything that greps source for structure. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/* Reads the class list out of className="a b" and className={`a${...} b`}, so a
   class is counted as a class rather than as a substring - '.tj-field' must not
   match a comment mentioning it, and 'st-page' must not match 'st-page-header'. */
const CLASS_ATTR = /className=(?:"([^"]*)"|\{`([^`]*)`)/g;

function countClass(src: string, cls: string): number {
  let n = 0;
  for (const [, quoted, templated] of src.matchAll(CLASS_ATTR)) {
    const raw = quoted ?? templated ?? '';
    // Template literals interpolate: `gchat-panel${open ? ' gchat-open' : ''}`.
    // Splitting on ${...} leaves the literal class names either side.
    const names = raw.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean);
    if (names.includes(cls)) n++;
  }
  return n;
}

test('every element carrying a spec-selected class carries its data-testid', async (t) => {
  for (const { cls, testId } of PAIRS) {
    await t.test(`.${cls} -> [data-testid="${testId}"]`, () => {
      const withClass = files.reduce((n, src) => n + countClass(src, cls), 0);
      const withTestId = files.reduce(
        (n, src) => n + (src.match(new RegExp(`data-testid="${testId}"`, 'g'))?.length ?? 0), 0);

      assert.ok(withClass > 0, `.${cls} is gone from the source - QA's spec selects it`);
      assert.equal(
        withTestId, withClass,
        `${withClass} element(s) carry .${cls} but ${withTestId} carry ` +
        `data-testid="${testId}". An element was added or removed without its ` +
        `test hook; the a11y spec will measure less rather than fail.`,
      );
    });
  }
});
