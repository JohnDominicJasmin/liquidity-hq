import test from 'node:test';
import assert from 'node:assert/strict';
import { etfFlowMillions } from '../lib/etfFlows.ts';

/* #175. The previous ETF integration never succeeded once - 301 failures with
 * last_ok_at NULL - because it was written against a guessed endpoint shape and
 * never verified. These cover the two ways the replacement can go wrong
 * quietly. */

const DOC_RECORD = {
  date: '2024-04-12',
  total_net_inflow: -55066297.0,
  total_value_traded: 4706120449.0,
  total_net_assets: 56216535367.0,
  cum_net_inflow: 13534833596.095,
};

test('the unit is millions, not dollars', async (t) => {
  /* THE ONE THAT LOOKS LIKE DATA. /briefing renders `$${v}M`, so returning
     dollars here shows a 55-million-dollar outflow as "-$55066297M" - fifty-five
     trillion. Nothing errors, nothing logs, and the number is plausible enough
     in shape that it reads as a market event. */
  await t.test("the docs' own example converts correctly", () => {
    assert.equal(etfFlowMillions({ data: [DOC_RECORD] }), -55.066297);
  });

  await t.test('a large inflow stays in millions', () => {
    assert.equal(etfFlowMillions({ data: [{ total_net_inflow: 1_200_000_000 }] }), 1200);
  });

  /* Zero is a real trading day, not missing data. `if (btc)` in the old client
     would have discarded it; the parse must return it. */
  await t.test('zero flow is a value, not an absence', () => {
    assert.equal(etfFlowMillions({ data: [{ total_net_inflow: 0 }] }), 0);
  });

  /* The API returns these as high-precision decimals; some JSON producers emit
     them as strings. */
  await t.test('a numeric string is accepted', () => {
    assert.equal(etfFlowMillions({ data: [{ total_net_inflow: '-55066297.0000' }] }), -55.066297);
  });
});

test('shape tolerance, without guessing', async (t) => {
  await t.test('list under data, bare list, and a bare object all work', () => {
    assert.equal(etfFlowMillions({ data: [DOC_RECORD] }), -55.066297);
    assert.equal(etfFlowMillions([DOC_RECORD]), -55.066297);
    assert.equal(etfFlowMillions(DOC_RECORD), -55.066297);
    assert.equal(etfFlowMillions({ data: DOC_RECORD }), -55.066297);
  });

  await t.test('newest first - the first record wins', () => {
    assert.equal(etfFlowMillions({ data: [{ total_net_inflow: 1e6 }, { total_net_inflow: 9e9 }] }), 1);
  });

  /* THROWS rather than returning null. The caller turns a throw into a health
     failure; a null would be indistinguishable from a genuine no-flow day and
     would have reproduced #175 with a green health table. */
  await t.test('an unusable payload throws instead of reading as no flow', () => {
    for (const bad of [null, undefined, {}, [], { data: [] }, { data: [{}] },
                       { data: [{ total_net_inflow: null }] },
                       { data: [{ total_net_inflow: 'n/a' }] },
                       { error: 'unauthorized' }]) {
      assert.throws(() => etfFlowMillions(bad), /total_net_inflow/,
        `should have thrown for ${JSON.stringify(bad)}`);
    }
  });
});
