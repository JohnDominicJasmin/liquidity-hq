/* #1410 / #1486: the app asks for notification permission only when a person
 * clicks something that is about notifications - never on page load.
 *
 * MEASURED before the fix, on staging (c67a61b), cross-browser run of
 * 2026-09-30: components/NewsProvider.tsx called Notification.requestPermission()
 * in a mount effect, so the first page anyone opened - signed out included -
 * asked for permission before the visitor had done anything. Firefox refused it
 * on 14 of 14 loads ("The Notification permission may only be requested from
 * inside a short running user-generated event handler"); Chromium-based
 * browsers show the prompt to a first-time visitor.
 *
 * SOURCE PINS. They find every call in app/, components/ and lib/ and require
 * each one to sit inside a named click handler that a button calls. They do not
 * show that no prompt appears in a browser - that is the signed-out first visit
 * on qa after promotion (Chromium and Firefox), per PM on #1410. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/^﻿/, '').split(/\r?\n/).join('\n');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel);
    }
  };
  for (const d of ['app', 'components', 'lib']) walk(d);
  return out;
}

/** Every requestPermission( call outside comments, with the name of the function it sits in. */
function calls() {
  const found: Array<{ file: string; fn: string; inEffect: boolean }> = [];
  for (const file of sourceFiles()) {
    const src = code(file);
    for (const m of src.matchAll(/\bNotification\.requestPermission\(/g)) {
      const before = src.slice(0, m.index);
      // The nearest enclosing named function: `function X(` or `const X = async (` / `const X = (`.
      const decls = [...before.matchAll(/(?:async\s+)?function\s+(\w+)\s*\(|const\s+(\w+)\s*=\s*(?:async\s*)?\(/g)];
      const last = decls[decls.length - 1];
      const fn = last ? (last[1] ?? last[2]) : '(module)';
      const effectAt = before.lastIndexOf('useEffect(');
      found.push({ file, fn, inEffect: effectAt > (last?.index ?? -1) });
    }
  }
  return found;
}

test('CONTROL: the sweep sees the tree and finds calls when they exist', () => {
  const files = sourceFiles();
  assert.ok(files.length > 150 && files.includes('components/NewsProvider.tsx'), `the walk is not seeing the tree (${files.length} files)`);
  assert.ok(calls().length > 0, 'no requestPermission call found anywhere - the pattern no longer matches the two known click handlers');
});

test('N1. NewsProvider - mounted on every page - asks for no permission at all', () => {
  assert.equal(/\brequestPermission\s*\(/.test(code('components/NewsProvider.tsx')), false,
    'components/NewsProvider.tsx calls requestPermission again. It wraps every page, so this is the on-load prompt Firefox refused on 14 of 14 loads (#1410)');
  assert.equal(/_notifRequested/.test(code('components/NewsProvider.tsx')), false, 'the module-level "already asked" flag is back - it only existed for the on-load request');
});

test('N2. every permission request in the app sits in one of the two known click handlers, and none in an effect', () => {
  const found = calls();
  assert.deepEqual(found.map((c) => `${c.file}#${c.fn}`).sort(), ['app/arena/page.tsx#enableNotifications', 'app/settings/page.tsx#handlePushToggle'],
    `permission is requested from somewhere new: ${found.map((c) => `${c.file}#${c.fn}`).join(', ')}. A new call site needs a click behind it and an entry here`);
  for (const c of found) assert.equal(c.inEffect, false, `${c.file}#${c.fn}: the request sits inside a useEffect - that runs without a click`);
});

test('N3. both handlers are called from a click, not from a render or an effect', () => {
  const arena = code('app/arena/page.tsx');
  assert.match(arena, /onClick=\{e => \{ e\.stopPropagation\(\); enableNotifications\(\); \}\}/, 'the Arena bell no longer calls enableNotifications on click');
  const arenaCalls = [...arena.matchAll(/\benableNotifications\(\)/g)].length;
  assert.equal(arenaCalls, 2, `enableNotifications() is called ${arenaCalls} times - expected the bell's click and its Enter/Space key handler only`);
  assert.match(arena, /onKeyDown=\{e => \{ if \(e\.key === 'Enter' \|\| e\.key === ' '\) \{ e\.stopPropagation\(\); enableNotifications\(\); \} \}\}/, 'the keyboard path to the bell changed');
  const settings = code('app/settings/page.tsx');
  assert.match(settings, /onClick=\{handlePushToggle\}/, 'Settings\' push toggle no longer calls handlePushToggle on click');
  assert.equal([...settings.matchAll(/\bhandlePushToggle\b/g)].length, 2, 'handlePushToggle is referenced somewhere other than its declaration and the toggle\'s onClick');
});

test('N4. a news notification still shows when permission was already granted - removing the prompt did not remove the feature', () => {
  const src = code('components/NewsProvider.tsx');
  assert.match(src, /Notification\.permission === 'granted'/, 'NewsProvider no longer checks for an existing grant before showing a news notification');
  assert.match(src, /new Notification\(/, 'NewsProvider no longer shows a news notification at all');
});
