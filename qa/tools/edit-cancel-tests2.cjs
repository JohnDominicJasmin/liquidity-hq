const fs = require('fs');
const f = '__tests__/cancelSubscription.test.mts';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(f, 'utf8').split(CR + LF).join(LF);
const blocksRaw = fs.readFileSync(process.argv[2], 'utf8').split(CR + LF).join(LF);
const blocks = {};
for (const part of blocksRaw.split('=====BLOCK ').slice(1)) {
  const name = part.slice(0, part.indexOf('====='));
  blocks[name] = part.slice(part.indexOf('=====') + 6).replace(/^\n/, '');
}
const rep = (from, to) => { const n = s.split(from).length - 1; if (n !== 1) throw new Error(`anchor x${n}: ${from.slice(0, 80)}`); s = s.replace(from, () => to); };
const block = (startMarker, endMarker, name) => {
  const a = s.indexOf(startMarker), b = s.indexOf(endMarker);
  if (a < 0 || b < 0 || b <= a) throw new Error(`block markers: ${startMarker.slice(0, 40)} .. ${endMarker.slice(0, 40)}`);
  s = s.slice(0, a) + blocks[name] + s.slice(b);
};

// imports and stand-in
rep("import { cancelSubscription, isLsApiConfigured } from '../lib/lemonsqueezyApi.ts';", "import { cancelSubscription, isLsApiConfigured } from '../lib/lemonsqueezyApi.ts';\nimport { configuredFlags } from '../lib/configured.ts';");
rep("  lsHangs: false,\n", "  lsHangs: false,\n  lsThrowMessage: undefined as string | undefined,\n");
rep("  world.lsHangs = false;\n", "  world.lsHangs = false;\n  world.lsThrowMessage = undefined;\n");
rep("throw new TypeError('fetch failed (stand-in)');", "throw new TypeError(world.lsThrowMessage ?? 'fetch failed (stand-in)');");
rep("const lsSuccess = (attrs: Record<string, unknown> = { status: 'cancelled', ends_at: '2098-10-08T05:26:55.000000Z' }) =>",
    "const lsSuccess = (attrs: Record<string, unknown> = { status: 'cancelled', cancelled: true, ends_at: '2098-10-08T05:26:55.000000Z', product_name: 'Synthetic Pro - Annual', variant_name: 'Default' }) =>");

// header: what has now been observed
rep(" *   OBSERVED: nothing yet. The first call on qa is the capture; this file changes after it, not before.",
    " *   OBSERVED on qa, 2026-09-26, by the owner's real signed-in cancel: HTTP 200 with the WHOLE subscription object,\n *     status \"cancelled\", cancelled true, ends_at = the renewal date; webhooks cancelled, updated, updated. The\n *     fixtures use those field names with synthetic values. Still unobserved: any error answer.");

// design changes: L1, L2, L5, L7b, L9, L17
rep("assert.deepEqual([r.ok, r.reason, r.status, r.bodyRedacted], [false, 'ls_api_key_unset', 0, '']);", "assert.deepEqual([r.ok, r.reason, r.status], [false, 'ls_api_key_unset', 0]);");
rep("assert.deepEqual([r.ok, r.reason, r.bodyRedacted], [false, 'no_subscription_id', '']);", "assert.deepEqual([r.ok, r.reason], [false, 'no_subscription_id']);");
rep("  assert.match(r.bodyRedacted, /cancelled/, 'a success must carry its (redacted) body for the capture log');",
    "  assert.deepEqual([r.cancelled, r.productName, r.variantName], [true, 'Synthetic Pro - Annual', 'Default']);");
rep("assert.deepEqual([r.ok, r.reason, r.lsStatus], [false, 'ok_but_status_missing', null]);", "assert.deepEqual([r.ok, r.reason, r.lsStatus], [false, 'ok_status_unparsable_body', null]);");
rep("    assert.match(r.bodyRedacted, /stand-in refusal/, 'the body is kept, redacted, in bodyRedacted');",
    "    assert.equal(JSON.stringify(r).includes('stand-in refusal'), false, 'an error body must not be returned');");
rep("assert.deepEqual([r.ok, r.status, r.bodyRedacted], [false, 0, '']);", "assert.deepEqual([r.ok, r.status], [false, 0]);");
rep("http=${status} body=`));", "http=${status} lsStatus=null cancelled=null endsAt=null`));");

block("test('L11.", "test('L12.", 'L11');
block("test('L12.", "test('L13.", 'L12');
block("test('L13.", "test('L14.", 'L13');
block("test('L16.", "test('L17.", 'L16');
block("test('P17.", "test('P18.", 'P17');

// S6 becomes a real test, and the privacy tests stop being todo
const a6 = s.indexOf('/* ── FINDING (re-review of fcdc62ce)');
const b6 = s.indexOf('/* ══ PRIVACY');
if (a6 < 0 || b6 < a6) throw new Error('S6 block');
s = s.slice(0, a6) + blocks.S6 + LF + s.slice(b6);
rep("const PII_PENDING: string | false = 'finding on #1435: the success and failure logs print customer data; the allow-list fix is pending';", "const PII_PENDING: string | false = false;");
rep("/* Runs, is expected to FAIL today (the leak), and turns green when the logs stop printing the object.\n   Flip `PII_PENDING` to false the day the fix lands; it must then pass as ordinary tests. */",
    "/* These were todo tests that failed with the leak (found on the first real cancel, 2026-09-26). The fix landed\n   in the follow-up (b41be0e2) and `PII_PENDING` is false: they are ordinary tests now. */");

s = s + blocks.NEW;
fs.writeFileSync(f, s);
console.log('edited');
