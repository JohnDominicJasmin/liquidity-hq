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

/* One naming convention, settled 2026-08-09: expand the component's
   abbreviation, keep the class untouched. #131 shipped `tj-field` next to
   `grok-panel`, which is two conventions in one PR - renamed here while nothing
   consumes them yet. */
const PAIRS: Array<{ cls: string; testId: string }> = [
  { cls: 'login-error',   testId: 'login-error'        },
  { cls: 'st-page',       testId: 'settings-page'      },
  { cls: 'smod-panel',    testId: 'settings-modal'     },
  { cls: 'tj-field',      testId: 'journal-field'      },
  { cls: 'tj-edit-form',  testId: 'journal-edit-form'  },
  { cls: 'tj-inp',        testId: 'journal-input'      },
  { cls: 'tj-tab',        testId: 'journal-tab'        },
  { cls: 'tj-edit-btn',   testId: 'journal-edit'       },
  { cls: 'gchat-panel',   testId: 'grok-panel'         },
  { cls: 'gchat-msgs',    testId: 'grok-messages'      },
  { cls: 'gchat-fab',     testId: 'grok-launcher'      },
  { cls: 'pb-star',       testId: 'playbook-star'      },
];

/* NOT in PAIRS, and the reason is the argument for this whole issue.
 *
 * These two classes are STYLING, reused by elements that mean different
 * things - so a 1:1 count against the class would be asserting the wrong
 * relationship, and attaching the testid everywhere the class appears would
 * carry the ambiguity straight into the new attribute.
 *
 *   .login-email-input  - also on components/PasswordField.tsx. On /login in
 *                         password mode, `input.login-email-input` therefore
 *                         matches the email field AND the password field.
 *   .st-toggle          - also on /alerts (page.tsx:1054), a different control
 *                         that shares the look.
 *
 * The testid goes on the semantic element only, and the count is asserted
 * directly. */
const SEMANTIC_ONLY: Array<{ testId: string; count: number; absentFrom?: string }> = [
  { testId: 'login-email',     count: 3, absentFrom: 'components/PasswordField.tsx' },
  { testId: 'settings-toggle', count: 1, absentFrom: 'app/alerts/page.tsx' },
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

/* The two selectors that are styling, not meaning. Asserted by count rather
   than parity, plus an explicit absence: the point is that the testid lands on
   the element the spec MEANS, and not on the unrelated element that happens to
   share the class. */
test('a shared styling class does not spread its test hook', async (t) => {
  for (const { testId, count, absentFrom } of SEMANTIC_ONLY) {
    await t.test(`[data-testid="${testId}"] appears exactly ${count}x`, () => {
      const found = files.reduce(
        (n, src) => n + (src.match(new RegExp(`data-testid="${testId}"`, 'g'))?.length ?? 0), 0);
      assert.equal(found, count,
        `expected ${count} element(s) with data-testid="${testId}", found ${found}. ` +
        `Either a semantic element lost its hook, or the hook was copied onto one ` +
        `that merely shares the styling class.`);
    });

    if (absentFrom) {
      await t.test(`and never in ${absentFrom}`, () => {
        const src = stripComments(
          readFileSync(fileURLToPath(new URL('../' + absentFrom, import.meta.url)), 'utf8'));
        assert.doesNotMatch(src, new RegExp(`data-testid="${testId}"`),
          `${absentFrom} shares the styling class but is a different control - ` +
          `giving it this hook reintroduces the ambiguity the hook exists to remove`);
      });
    }
  }
});
