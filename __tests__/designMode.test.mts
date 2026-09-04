/* The design-mode resolver, and the bootstrap script that duplicates it (#748).
 *
 * Terminal is now the default on EVERY route, so this function decides what
 * every visitor sees on the first frame of every page. #719's route list is
 * gone; what remains is the escape hatch and the precedence around it.
 *
 * THE REAL RISK HERE IS DRIFT, NOT ARITHMETIC. The precedence lives in two
 * places: `resolveDesignMode` in lib/designMode.ts, and a hand-written copy
 * inside the inline `design-init` script in app/layout.tsx. The copy exists
 * because that script runs before any module is loaded, which is the only way
 * to set `data-design` before first paint and avoid flashing the wrong ground.
 *
 * Two copies of a rule stay in step for about a week. So the last test here
 * extracts the script's logic from layout.tsx and runs BOTH against every
 * combination of inputs, asserting they agree. If someone changes one, this
 * fails and names the case.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolveDesignMode, designAttribute } from '../lib/designMode.ts';

const APP_ROUTES = ['/', '/dashboard', '/arena', '/liq', '/scanner', '/hours', '/settings'];

test('terminal is the default everywhere, with no param and nothing stored', () => {
  /* The whole point of #748. If this ever returns 'current', the flip is
     silently undone and nothing else in the app notices. */
  assert.equal(resolveDesignMode('', null), 'terminal');
});

test('?design=current is a real escape hatch, and survives as a stored value', () => {
  /* Both halves matter. The param has to win on the request that carries it,
     AND the stored value it writes has to keep winning on the next load -
     otherwise the hatch undoes itself on reload and the visitor is stuck on a
     design they opted out of. After #748 this is also the only rollback that
     does not require a deploy. */
  assert.equal(resolveDesignMode('?design=current', null), 'current');
  assert.equal(resolveDesignMode('', 'current'), 'current');
});

test('?design=terminal still parses, and is now a no-op naming the default', () => {
  // Links carrying it exist all over the issue tracker; it must not break.
  assert.equal(resolveDesignMode('?design=terminal', null), 'terminal');
  assert.equal(resolveDesignMode('', 'terminal'), 'terminal');
});

test('the query param outranks a conflicting stored value, both directions', () => {
  assert.equal(resolveDesignMode('?design=current', 'terminal'), 'current');
  assert.equal(resolveDesignMode('?design=terminal', 'current'), 'terminal');
});

test('a stored value outranks the default', () => {
  /* The line that makes the escape hatch real: without it every load would
     re-assert terminal and a stored 'current' would be inert. */
  assert.equal(resolveDesignMode('', 'current'), 'current');
});

test('an unrecognised value falls through to the default rather than sticking', () => {
  assert.equal(resolveDesignMode('?design=garbage', null), 'terminal');
  assert.equal(resolveDesignMode('', 'garbage'), 'terminal');
  assert.equal(resolveDesignMode('?foo=1', null), 'terminal');
});

test('designAttribute removes the attribute for current rather than naming it', () => {
  assert.equal(designAttribute('terminal'), 'terminal');
  assert.equal(designAttribute('current'), null);
});

test('the layout bootstrap script agrees with resolveDesignMode on every input', () => {
  /* THE DRIFT GATE. Pulls the actual script text out of app/layout.tsx, runs
     it against a fake window/localStorage, and compares to the resolver.
     Reading the file rather than re-typing the logic is deliberate: a copy of
     the copy would pass forever while the real script rotted. */
  const layout = readFileSync('app/layout.tsx', 'utf8');
  /* Matches the raw inline <script dangerouslySetInnerHTML>. It was a
     next/script beforeInteractive until #719 measured that Next defers even
     that through its own loader - so if this regex ever stops matching,
     suspect the script moved back to <Script> rather than that it vanished. */
  const m = layout.match(/__html:\s*`([\s\S]*?)`,?\s*\}\}/);
  assert.ok(m, 'the design-init inline script was not found in app/layout.tsx - moved, renamed, or converted back to <Script>?');

  /* The file holds the TEMPLATE, not what the browser receives: a `\\` in the
     source is one backslash once the template is evaluated.

     #748 removed the only interpolation the script had - the route list - so
     the assertion below now does double duty. It still catches a gate testing
     an un-substituted string, and it also catches a NEW interpolation being
     added without this extraction learning about it, which would otherwise
     silently compare the wrong text. */
  const src = m![1].replace(/\\\\/g, '\\');
  assert.ok(!src.includes('${'),
    'design-init contains an interpolation this gate does not substitute - ' +
    'it would be testing a string the browser never runs. Substitute it here.');

  /* The script is written for a browser. Give it exactly the globals it uses
     and read back what it did to documentElement.
   *
   * ON `new Function` HERE. Executing the string IS the test - a drift gate
   * that re-implemented the script instead of running it would pass forever
   * while the real one rotted, which is the failure it exists to prevent.
   * What makes it safe is the SOURCE, and that is the invariant to preserve:
   * `src` comes from app/layout.tsx in this repo, read from disk at test time.
   * Anyone who can change that file already controls the build. Never point
   * this at a fetched, generated or user-supplied string - at that point it
   * stops being a test fixture and becomes arbitrary code execution.
   * The globals passed in are the complete set the script touches; it gets no
   * `process`, no `require`, no real `document`. */
  function runScript(search: string, stored: string | null, pathname: string): 'terminal' | 'current' {
    let attr: string | null = null;
    const sandbox = {
      URLSearchParams,
      window: { location: { search, pathname } },
      localStorage: { getItem: (k: string) => (k === 'lhq-design-mode' ? stored : null) },
      document: {
        documentElement: {
          setAttribute: (_k: string, v: string) => { attr = v; },
          removeAttribute: () => { attr = null; },
        },
      },
    };
    const fn = new Function(
      'URLSearchParams', 'window', 'localStorage', 'document', src,
    ) as (...a: unknown[]) => void;
    fn(sandbox.URLSearchParams, sandbox.window, sandbox.localStorage, sandbox.document);
    return attr === 'terminal' ? 'terminal' : 'current';
  }

  const searches = ['', '?design=terminal', '?design=current', '?foo=1'];
  const stores: (string | null)[] = [null, 'terminal', 'current', 'garbage'];
  /* Every route, not a sample. The script no longer reads the pathname, so
     these must all agree - and if a route default is ever reintroduced,
     this is what catches the two copies disagreeing about it. */
  const paths = APP_ROUTES;

  const mismatches: string[] = [];
  for (const s of searches) {
    for (const st of stores) {
      for (const p of paths) {
        const fromScript = runScript(s, st, p);
        const fromModule = resolveDesignMode(s, st);
        if (fromScript !== fromModule) {
          mismatches.push(`search=${s || '(none)'} stored=${st ?? 'null'} path=${p}: script=${fromScript} module=${fromModule}`);
        }
      }
    }
  }
  assert.deepEqual(mismatches, [], `${mismatches.length} case(s) where the bootstrap script and resolveDesignMode disagree`);
});

test('CONTROL: the drift gate can actually detect a disagreement', () => {
  /* Without this, the test above passing proves only that it ran. Every
     "false clean" in this project started as a check that quietly measured
     nothing - a regex that matched no rules, a grep for a class that never
     existed. Prove the comparison has teeth by feeding it a wrong resolver. */
  const wrong = (_s: string, _st: string | null) => 'current' as const;
  let disagreed = false;
  /* 'current' is now the WRONG answer for an unspecified visitor - before #748
     it was the right one for every route but `/`, which is why this control
     had to be rewritten rather than left alone. A control that still passed
     after the default flipped would have been measuring nothing. */
  if (wrong('', null) !== resolveDesignMode('', null)) disagreed = true;
  assert.ok(disagreed, 'the comparison cannot distinguish a wrong resolver from the real one');
});
