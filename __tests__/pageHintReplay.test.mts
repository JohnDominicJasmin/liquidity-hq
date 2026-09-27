/* #1113 option 4 (owner-approved look, e27f6d8e): PageHint used to disappear for good once dismissed - the
 * only way back for someone who skipped it and later wanted it was a new device/incognito session (a fresh
 * localStorage). It now collapses to a small "? How this page works" chip instead of unmounting, so a
 * returning visitor starts collapsed rather than gone and can reopen it.
 *
 * Structure only, same limit as every component file tonight - `state` is closure-local React state, no
 * exported function, no DOM test library in this repo. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const source = stripComments(read('components/PageHint.tsx'));

function anchorOnce(src: string, needle: string, label: string): number {
  const n = src.split(needle).length - 1;
  assert.equal(n, 1, `${label}: anchor occurs ${n} time(s), expected exactly 1 - re-read the current source`);
  return src.indexOf(needle);
}

test('S1. the state type has three values - pending, show, collapsed - not the old pending/show/hide', () => {
  anchorOnce(source, "useState<'pending' | 'show' | 'collapsed'>('pending')", 'the state type declaration');
});

test('S2. mount reads the seen-marker: present -> collapsed (not gone), absent -> show; a storage error still falls back to show', () => {
  const at = anchorOnce(source,
    "try {\n      setState(localStorage.getItem(key) ? 'collapsed' : 'show');\n    } catch {\n      setState('show');\n    }",
    'the mount effect');
  assert.ok(at > 0);
});

test('S3. dismiss() sets the seen-marker AND transitions to collapsed - never to a state that unmounts the hint entirely', () => {
  anchorOnce(source, "function dismiss() {\n    try { localStorage.setItem(key, '1'); } catch {}\n    setState('collapsed');\n  }", 'dismiss()');
});

test('S4. reopen() goes back to show WITHOUT touching localStorage - the seen-marker stays set, so a later reload still starts collapsed, not showing the full banner unprompted', () => {
  const at = anchorOnce(source, 'function reopen() {', 'reopen()');
  const body = source.slice(at, source.indexOf('}', at) + 1);
  assert.match(body, /setState\('show'\)/, 'reopen does not set state to show');
  assert.doesNotMatch(body, /localStorage/, 'reopen touches localStorage - the seen-marker should be untouched so a reload starts collapsed again');
});

test('S5. collapsed is an early return that renders the replay chip - not null, which is the exact regression this fix removes (the hint used to be gone for good)', () => {
  const at = anchorOnce(source, "if (state === 'collapsed') {", 'the collapsed branch');
  const block = source.slice(at, source.indexOf('\n  }\n\n  return (', at));
  assert.match(block, /onClick=\{reopen\}/, 'the collapsed chip does not call reopen');
  assert.match(block, /aria-label=\{t\('PAGE_HINT_REPLAY_LABEL'\)\}/, 'the collapsed chip has no accessible label');
  assert.doesNotMatch(block, /return null/, 'the collapsed branch still returns null somewhere - the old "gone for good" behaviour is back');
});

test('S6. the collapsed chip is a real tap target (min 24px) and shows the replay label as visible text too, not just the aria-label', () => {
  const at = source.indexOf("if (state === 'collapsed') {");
  const block = source.slice(at, source.indexOf('\n  }\n\n  return (', at));
  assert.match(block, /minHeight:\s*24/, 'no minimum tap-target height on the collapsed chip');
  const textCount = [...block.matchAll(/t\('PAGE_HINT_REPLAY_LABEL'\)/g)].length;
  assert.ok(textCount >= 2, `expected the replay label used at least twice (aria-label + visible text), found ${textCount}`);
});

test('S7. the collapsed early return sits BEFORE the component\'s own final `return (` - after it would make the check unreachable dead code, and a collapsed visitor would fall through to the full hint every time', () => {
  const collapsedAt = anchorOnce(source, "if (state === 'collapsed') {", 'the collapsed check');
  const finalReturnAt = source.lastIndexOf('\n  return (');
  assert.ok(finalReturnAt > 0, 'the component\'s final return ( was not found');
  assert.ok(collapsedAt < finalReturnAt, 'the collapsed check sits after (or is not before) the final return - it would never run');
});

test('S8. the main hint\'s visibility toggle only distinguishes pending from show (collapsed never reaches it, since it already returned)', () => {
  anchorOnce(source, "visibility: state === 'pending' ? 'hidden' : 'visible'", 'the visibility toggle');
});

/* ── labels ── */

const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;

test('L1. PAGE_HINT_REPLAY_LABEL is registered, alongside the pre-existing PAGE_HINT_DISMISS_LABEL, with a non-empty default', () => {
  const keys = read('lib/labelKeys.ts');
  assert.ok(keys.includes("'PAGE_HINT_DISMISS_LABEL', 'PAGE_HINT_REPLAY_LABEL',"), 'PAGE_HINT_REPLAY_LABEL is not registered next to PAGE_HINT_DISMISS_LABEL in lib/labelKeys.ts');
  assert.ok(typeof defaults.PAGE_HINT_REPLAY_LABEL === 'string' && defaults.PAGE_HINT_REPLAY_LABEL.trim().length > 0);
});

test('L2. the migration\'s live and commented-dev rows both equal the shipped default, exactly', () => {
  const sql = read('supabase/migrations/20260927d_labels_page_hint_replay.sql');
  const rows = (commented: boolean) => {
    const out: Record<string, string> = {};
    for (const raw of sql.split('\n')) {
      const line = raw.trim();
      const isCommentRow = line.startsWith("-- ('");
      const isLiveRow = line.startsWith("('");
      if (commented ? !isCommentRow : !isLiveRow) continue;
      const bare = commented ? line.slice(3) : line;
      const parts = bare.replace(/^\('/, '').replace(/'\)[,;]?\s*$/, '').split("','");
      if (parts.length === 3 && parts[1] === 'en') out[parts[0]] = parts[2].split("''").join("'");
    }
    return out;
  };
  const live = rows(false), dev = rows(true);
  assert.ok(live.PAGE_HINT_REPLAY_LABEL, 'the live block has no row for this key');
  assert.equal(live.PAGE_HINT_REPLAY_LABEL, dev.PAGE_HINT_REPLAY_LABEL, 'the commented dev block has drifted from the live block');
  assert.equal(live.PAGE_HINT_REPLAY_LABEL, defaults.PAGE_HINT_REPLAY_LABEL, 'migration and shipped default differ');
});
