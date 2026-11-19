import test from 'node:test';
import assert from 'node:assert/strict';
import { STRATEGIES } from '../lib/strategies/index.ts';
import { squeezeCall, squeezeFixture, type SqueezeLive } from '../qa/fixtures/strategyFixtures2.ts';

/* #2598 REVISION 2, THE APP AGAINST QA'S ORACLE (qa/fixtures/strategyFixtures2.ts squeezeCall, written from the PR's written rule, not from the detector):
 *   funding extreme for the coin AND open interest extreme for the coin AND the first close through the last swing against the crowd (last 2 candles); a liquidation cluster is only a note; a WAIT names the first condition not met;
 *   a missing funding class or OI answer is no reading. Same candles, same live values, both sides; every cell must agree on the verdict, entry, stop and target, the note, and the WAIT reason. */
const def = STRATEGIES.find(s => s.id === 'funding_oi_squeeze')!;
const WAIT_KEY: Record<string, string> = { funding: 'STRAT_SQUEEZE_WAIT_FUNDING', oi: 'STRAT_SQUEEZE_WAIT_OI', trigger: 'STRAT_SQUEEZE_WAIT_TRIGGER', noLive: 'STRAT_SQUEEZE_NO_LIVE' };

function app(candles: ReturnType<typeof squeezeFixture>['candles'], live: SqueezeLive) {
  const r = def.detect(candles as never, { coin: 'btc', tf: '1h', tfMs: 3_600_000, ...(live.fundingClass ? { fundingClass: live.fundingClass, fundingPct: 0.04 } : {}), ...(live.oiExtreme != null ? { oiExtreme: live.oiExtreme, oiChange6Pct: 4 } : {}), liqLevels: live.clusters } as never);
  return r;
}
const cells: Array<[string, 'long' | 'short', 'through' | 'inside' | 'already', Partial<SqueezeLive>]> = [];
for (const crowd of ['long', 'short'] as const) for (const trig of ['through', 'inside', 'already'] as const) {
  cells.push([`${crowd}/${trig}/all conditions`, crowd, trig, {}]);
  cells.push([`${crowd}/${trig}/funding not extreme`, crowd, trig, { fundingClass: 'none' }]);
  cells.push([`${crowd}/${trig}/OI not extreme`, crowd, trig, { oiExtreme: false }]);
  cells.push([`${crowd}/${trig}/no OI answer`, crowd, trig, { oiExtreme: null }]);
  cells.push([`${crowd}/${trig}/no funding class`, crowd, trig, { fundingClass: null }]);
  cells.push([`${crowd}/${trig}/no cluster at all`, crowd, trig, { clusters: [] }]);
}
for (const [name, crowd, trig, over] of cells) {
  test(`SA ${name}: the app and the oracle agree`, () => {
    const fx = squeezeFixture(crowd, trig), px = fx.price;
    const cls = crowd === 'long' ? 'longs_heavy' as const : 'shorts_heavy' as const;
    const live: SqueezeLive = { fundingClass: cls, oiExtreme: true, clusters: [crowd === 'long' ? px * 0.99 : px * 1.01], ...over };
    const o = squeezeCall(fx.candles, live, []), r = app(fx.candles, live);
    const word = r.verdict === 'buy' ? 'BUY' : r.verdict === 'sell' ? 'SELL' : 'WAIT';
    assert.equal(word, o.verdict, `verdict: app ${word}, oracle ${o.verdict}${o.wait ? ' (' + o.wait + ')' : ''}`);
    if (o.verdict === 'WAIT') {
      const key = def.reasonKeyFor?.(r) ?? 'STRAT_SQUEEZE_WAIT';
      assert.equal(key, WAIT_KEY[o.wait!], `the WAIT names the first condition not met: oracle ${o.wait}, app reason key ${key}`);
    } else {
      assert.equal(r.params.entry, o.entry, 'entry'); assert.equal(r.params.stop, o.stop, 'stop');
      assert.equal(r.params.target ?? null, o.target ?? null, 'target (no cluster-beyond and no S/R in this fixture: both none, or the cluster beyond)');
      assert.equal(!!r.params.liq, !!o.liq, 'the cluster note appears only for a cluster within 1.5% on the crowded side');
    }
  });
}

test('SB. a liquidation cluster never creates, removes or changes a signal: with and without clusters the call is identical (the note aside)', () => {
  for (const crowd of ['long', 'short'] as const) {
    const fx = squeezeFixture(crowd, 'through'), px = fx.price, cls = crowd === 'long' ? 'longs_heavy' as const : 'shorts_heavy' as const;
    const base = { fundingClass: cls, oiExtreme: true };
    const withC = app(fx.candles, { ...base, clusters: [crowd === 'long' ? px * 0.99 : px * 1.01] }), without = app(fx.candles, { ...base, clusters: [] });
    assert.equal(withC.verdict, without.verdict); assert.equal(withC.params.entry, without.params.entry); assert.equal(withC.params.stop, without.params.stop);
    assert.equal(withC.params.liq, true); assert.equal(without.params.liq, undefined);
  }
});
