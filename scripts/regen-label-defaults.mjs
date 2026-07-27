#!/usr/bin/env node
/**
 * Regenerates lib/labelDefaults.en.json - the static English label snapshot
 * that LabelsProvider seeds its initial state with (see the raw-key-flash
 * section in pendings/I18N_MIGRATION.md).
 *
 * This replaces the bare `curl -o lib/labelDefaults.en.json` the process used
 * to document. curl happily writes whatever it receives, so when the dev
 * server answered mid-recompile with `{}`, it silently truncated the snapshot
 * from 2,436 keys to zero. Nothing failed, nothing warned, and the damage only
 * surfaced by chance on the next diff - a blanked snapshot means every label
 * on every page falls back to a raw KEY_NAME on first paint, which is the exact
 * bug the file exists to prevent.
 *
 * Everything here refuses to write rather than write something wrong.
 *
 *   node scripts/regen-label-defaults.mjs            # against localhost:3000
 *   node scripts/regen-label-defaults.mjs --url ...  # against another origin
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = resolve(HERE, '..', 'lib', 'labelDefaults.en.json');

// If the fresh copy has fewer than this share of the current key count, treat
// it as truncated. Deleting labels is rare and deliberate; losing them to a
// half-booted server is not. --allow-shrink is the escape hatch.
const MIN_KEEP_RATIO = 0.9;
// A few keys that must exist in any real response, as a shape check on top of
// the count check - a response could be large and still be the wrong thing.
const CANARY_KEYS = ['HOURS_TITLE', 'UPGRADE_FREE_FEATURE_AI_CHAT', 'NAV_DASHBOARD'];

const args = process.argv.slice(2);
const urlArg = args.indexOf('--url');
const origin = urlArg !== -1 ? args[urlArg + 1] : 'http://localhost:3000';
const allowShrink = args.includes('--allow-shrink');

function die(msg) {
  console.error(`\n  refusing to write ${TARGET}\n  ${msg}\n`);
  process.exit(1);
}

const endpoint = `${origin.replace(/\/$/, '')}/api/labels?locale=en`;

let res;
try {
  res = await fetch(endpoint);
} catch (e) {
  die(`could not reach ${endpoint} - is the dev server running?\n  ${e.message}`);
}
if (!res.ok) die(`${endpoint} returned HTTP ${res.status}`);

let fresh;
try {
  fresh = JSON.parse(await res.text());
} catch (e) {
  die(`${endpoint} did not return valid JSON - ${e.message}`);
}

if (fresh === null || typeof fresh !== 'object' || Array.isArray(fresh)) {
  die(`expected a JSON object of labels, got ${Array.isArray(fresh) ? 'an array' : typeof fresh}`);
}

const freshCount = Object.keys(fresh).length;
if (freshCount === 0) {
  die('the labels API returned an empty object - this is what silently blanked the snapshot before. The server was most likely still recompiling; wait for it to settle and re-run.');
}

const missingCanaries = CANARY_KEYS.filter(k => !(k in fresh));
if (missingCanaries.length) {
  die(`response is missing keys that always exist: ${missingCanaries.join(', ')}`);
}

let current = {};
try {
  current = JSON.parse(readFileSync(TARGET, 'utf8'));
} catch {
  console.warn('  note: no readable existing snapshot - treating this as a first write');
}
const currentCount = Object.keys(current).length;

if (currentCount > 0 && freshCount < currentCount * MIN_KEEP_RATIO && !allowShrink) {
  die(
    `fresh response has ${freshCount} keys but the current snapshot has ${currentCount}.\n` +
    `  That is a drop of ${(100 - (freshCount / currentCount) * 100).toFixed(1)}%, which usually means a\n` +
    `  partial response rather than an intentional deletion.\n` +
    `  If the shrink is real, re-run with --allow-shrink.`
  );
}

const added   = Object.keys(fresh).filter(k => !(k in current));
const removed = Object.keys(current).filter(k => !(k in fresh));
const changed = Object.keys(fresh).filter(k => k in current && current[k] !== fresh[k]);

if (!added.length && !removed.length && !changed.length) {
  console.log(`\n  snapshot already up to date (${freshCount} keys) - nothing written\n`);
  process.exit(0);
}

writeFileSync(TARGET, JSON.stringify(fresh));

console.log(`\n  wrote ${freshCount} keys to lib/labelDefaults.en.json (was ${currentCount})`);
const list = (name, keys) => {
  if (!keys.length) return;
  console.log(`  ${name} (${keys.length}):`);
  keys.slice(0, 20).forEach(k => console.log(`    ${k}`));
  if (keys.length > 20) console.log(`    ... and ${keys.length - 20} more`);
};
list('added', added);
list('changed', changed);
list('removed', removed);
console.log('');
