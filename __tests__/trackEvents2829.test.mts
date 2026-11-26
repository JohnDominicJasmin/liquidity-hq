/* QA: PR #2829 (#1413 owner item 80). The two tracking events are sent, once, from the reader's own actions.
 *   K1 coin_switched: only on a real change, in selectCoin and in the Arena scanner; the account's default coin sends nothing
 *   K2 alert_created: after the save succeeded on /alerts and on the Arena, with coin and direction */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const provider = read('components/MarketProvider.tsx');
const arena = read('app/(main)/arena/page.tsx');
const alerts = read('app/(main)/alerts/page.tsx');
const count = (s: string, part: string) => s.split(part).length - 1;

test('K1. coin_switched', () => {
  assert.ok(provider.includes('if (c !== storeRef.current.selectedCoin) track.coinSwitched(c);'));
  assert.equal(count(provider, 'track.coinSwitched('), 1);
  assert.ok(arena.includes('if (c !== selectedCoin) track.coinSwitched(c);\n                    setSelectedCoin(c);'));
  assert.equal(count(arena, 'track.coinSwitched('), 1);
  const dflt = arena.indexOf('setSelectedCoin(settings.default_coin as CoinId);');
  assert.ok(dflt > 0, 'CONTROL: the default-coin line');
  assert.equal(arena.slice(dflt - 600, dflt + 200).includes('coinSwitched'), false);
});

test('K2. alert_created only after a successful save', () => {
  for (const [src, call, refused] of [[alerts, 'track.alertCreated(paCoin, paDir);', 'if (!res.ok)'], [arena, 'track.alertCreated(selectedCoin, alertDir);', 'if (!res.ok) {']] as const) {
    assert.equal(count(src, 'track.alertCreated('), 1);
    const at = src.indexOf(call);
    const post = [...src.slice(0, at).matchAll(/method:\s+'POST'/g)].pop()?.index ?? -1;
    assert.ok(at > 0 && post > 0, call);
    assert.ok(src.slice(post, at).includes(refused), 'the event is not behind the refusal check');
  }
  const lib = read('lib/analytics.ts');
  assert.ok(lib.includes("capture('coin_switched', { coin })") && lib.includes("capture('alert_created', { coin, condition })"));
});
