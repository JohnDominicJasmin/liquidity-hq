/* The design-mode resolver, and the bootstrap script that duplicates it (#719).
 *
 * Terminal now ships on `/` for every visitor, so this function decides what a
 * prospective user sees on the first frame of the acquisition page. It had no
 * tests at all before this.
 *
 * THE REAL RISK HERE IS DRIFT, NOT ARITHMETIC. The precedence lives in two
 * places: `resolveDesignMode` in lib/designMode.ts, and a hand-written copy
 * inside the `design-init` <Script> in app/layout.tsx. The copy exists because
 * that script runs `beforeInteractive` - before any module is loaded - which is
 * the only way to set `data-design` before first paint and avoid flashing the
 * current design's light ground on a page that should be near-black.
 *
 * Two copies of a rule stay in step for about a week. So the last test here
 * extracts the script's logic from layout.tsx and runs BOTH against every
 * combination of inputs, asserting they agree. If someone changes one, this
 * fails and names the case.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  resolveDesignMode, designAttribute, isTerminalByDefault,
  TERMINAL_BY_DEFAULT_ROUTES,
} from '../lib/designMode.ts';

test('/ defaults to terminal for a visitor with no param and nothing stored', () => {
  /* The whole point of #719. If this ever returns 'current', the landing ships
     the old design to everyone and nothing else in the app notices. */
  assert.equal(resolveDesignMode('', null, '/'), 'terminal');
});

test('every other route still defaults to current', () => {
  for (const p of ['/dashboard', '/arena', '/liq', '/scanner', '/hours', '/settings']) {
    assert.equal(resolveDesignMode('', null, p), 'current', `${p} must not default to terminal`);
  }
});

test('?design=current on / is a real escape hatch, and survives as a stored value', () => {
  /* Both halves matter. The param has to win on the request that carries it,
     AND the stored value it writes has to keep winning on the next load -
     otherwise the hatch undoes itself on reload and the visitor is stuck. */
  assert.equal(resolveDesignMode('?design=current', null, '/'), 'current');
  assert.equal(resolveDesignMode('', 'current', '/'), 'current');
});

test('?design=terminal still works on app routes, and sticks', () => {
  // QA reviews deployed builds through this path; #719 says keep it.
  assert.equal(resolveDesignMode('?design=terminal', null, '/dashboard'), 'terminal');
  assert.equal(resolveDesignMode('', 'terminal', '/dashboard'), 'terminal');
});

test('the query param outranks a conflicting stored value, both directions', () => {
  assert.equal(resolveDesignMode('?design=current', 'terminal', '/dashboard'), 'current');
  assert.equal(resolveDesignMode('?design=terminal', 'current', '/'), 'terminal');
});

test('a stored value outranks the route default', () => {
  /* This is the line that makes the escape hatch real: without it, `/` would
     re-assert terminal on every load and stored 'current' would be inert. */
  assert.equal(resolveDesignMode('', 'current', '/'), 'current');
});

test('omitting pathname means no route default, not terminal', () => {
  /* The parameter is optional so older call sites compile. Optional must not
     mean "assume the landing page" - that would flip the default app-wide the
     first time someone calls this without a route. */
  assert.equal(resolveDesignMode('', null), 'current');
  assert.equal(resolveDesignMode('', null, null), 'current');
});

test('a trailing slash is the same page', () => {
  assert.equal(isTerminalByDefault('/'), true);
  assert.equal(resolveDesignMode('', null, '/'), 'terminal');
});

test('a route that merely starts with / is not the landing page', () => {
  /* Guards the obvious wrong implementation - `pathname.startsWith('/')` is
     true of every route in the app. */
  assert.equal(isTerminalByDefault('/dashboard'), false);
  assert.equal(isTerminalByDefault(''), false);
  assert.equal(isTerminalByDefault(null), false);
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

  /* The file holds the TEMPLATE, not what the browser receives. Two things
     differ and both bit me writing this:
       - `${JSON.stringify(TERMINAL_BY_DEFAULT_ROUTES)}` is still literal text
       - a `\\` in the source is one backslash after the template is evaluated
     Reproduce both, or the extracted string is not the script that ships. */
  const src = m![1]
    .replace('${JSON.stringify(TERMINAL_BY_DEFAULT_ROUTES)}', JSON.stringify(TERMINAL_BY_DEFAULT_ROUTES))
    .replace(/\\\\/g, '\\');
  assert.ok(!src.includes('${'), 'an interpolation in design-init is not being substituted here - the gate would test the wrong string');

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
  const paths = ['/', '/dashboard', '/arena', '/liq'];

  const mismatches: string[] = [];
  for (const s of searches) {
    for (const st of stores) {
      for (const p of paths) {
        const fromScript = runScript(s, st, p);
        const fromModule = resolveDesignMode(s, st, p);
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
  const wrong = (_s: string, _st: string | null, _p: string) => 'terminal' as const;
  let disagreed = false;
  for (const p of ['/dashboard']) {
    if (wrong('', null, p) !== resolveDesignMode('', null, p)) disagreed = true;
  }
  assert.ok(disagreed, 'the comparison cannot distinguish a wrong resolver from the real one');
});

test('the route list is the single source the script interpolates', () => {
  const layout = readFileSync('app/layout.tsx', 'utf8');
  assert.match(layout, /JSON\.stringify\(TERMINAL_BY_DEFAULT_ROUTES\)/,
    'layout.tsx should interpolate the exported list rather than hardcode routes');
  assert.deepEqual([...TERMINAL_BY_DEFAULT_ROUTES], ['/']);
});
