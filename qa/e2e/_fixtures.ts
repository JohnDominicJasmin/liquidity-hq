import { readFileSync } from 'fs';
import { join } from 'path';
import type { Page, Route } from '@playwright/test';

/* Controllable market data — the thing `qa/TEST_GAPS.md` §1 says the suite has
 * never had.
 *
 * Every test in this suite runs against whatever the live market is doing, so
 * the product's own domain logic has never been asserted against a KNOWN input.
 * A green run means "nothing crashed given today's prices".
 *
 * This intercepts at the THIRD-PARTY boundary where it can, because Binance and
 * Bybit publish their payload shapes and we do not change them. Our own `/api`
 * shapes are ours to refactor, and pinning tests to them would turn every
 * internal change into a test failure. `/api/funding` is stubbed as well because
 * it is served from a route handler — the browser never sees the upstream call,
 * so there is no third-party request to intercept for that one.
 *
 * Recorded from production 2026-08-08. See `qa/FIXTURES.md` for the full
 * endpoint enumeration and why only some are recorded so far.
 */

const DIR = join(process.cwd(), 'qa', 'fixtures');

function load(name: string): { _url: string; _status: number; body: unknown } {
  return JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8'));
}

/** A scenario transforms a recorded payload into the market state under test. */
export type Scenario = 'as-recorded' | 'funding-positive' | 'funding-negative' | 'upstream-500';

type FundingBody = { data: Array<{ coin: string; binance: number; bybit: number; nextFundingMs: number }>; ts: number };

/** Flip every funding rate negative, preserving magnitude and shape.
 *
 *  Magnitude is preserved deliberately: a scenario that also changes how LARGE
 *  the number is tests two things at once, and a failure would not say which. */
function fundingNegative(body: FundingBody): FundingBody {
  return {
    ...body,
    data: body.data.map(d => ({
      ...d,
      binance: -Math.abs(d.binance),
      bybit: -Math.abs(d.bybit),
    })),
  };
}

type BinanceFundingRow = { symbol: string; fundingTime: number; fundingRate: string; markPrice: string; rateType: string };

/** Binance's own funding history, negated.
 *
 *  This is the one that actually reaches the screen. `/api/funding` is a
 *  different surface, and transforming only that produced a `funding-negative`
 *  scenario where the rendered rates were unchanged — the test passed against
 *  the recorded payload's own mix of signs (9 of 42 rows are already negative)
 *  and proved nothing. Caught by a negative control, not by the test. */
function binanceFundingSigned(rows: BinanceFundingRow[], sign: -1 | 1): BinanceFundingRow[] {
  return rows.map(r => {
    const mag = Math.abs(parseFloat(r.fundingRate)) || 0.0001; // never 0: sign must be observable
    return { ...r, fundingRate: (sign * mag).toFixed(8) };
  });
}

/** Serve recorded market data instead of the live market.
 *
 *  Returns `count` (routes fulfilled) and `byKey` (which ones), so a spec can
 *  FAIL when the endpoint UNDER TEST was not intercepted. `count > 0` alone is
 *  not enough: it was satisfied by an unrelated route while the values on screen
 *  still came from elsewhere. */
export async function installMarketFixtures(page: Page, scenario: Scenario = 'as-recorded') {
  const served: { count: number; byKey: Record<string, number> } = { count: 0, byKey: {} };

  const fulfil = async (route: Route, name: string, transform?: (b: unknown) => unknown) => {
    const fx = load(name);
    served.count++;
    served.byKey[name] = (served.byKey[name] ?? 0) + 1;
    if (scenario === 'upstream-500') {
      // Upstream failure is a first-class scenario: TEST_GAPS §1 notes the app's
      // behaviour when its data source fails has never been tested, and it is
      // the failure most likely to happen in public.
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"upstream"}' });
    }
    const body = transform ? transform(fx.body) : fx.body;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  };

  const sign: -1 | 1 | null =
    scenario === 'funding-negative' ? -1 : scenario === 'funding-positive' ? 1 : null;
  const neg = scenario === 'funding-negative';

  await page.route('**/api/funding**', r =>
    fulfil(r, 'lhq-funding', neg ? (b) => fundingNegative(b as FundingBody) : undefined));
  await page.route('**/api/market/rsi**', r => fulfil(r, 'lhq-market-rsi'));
  await page.route('**/api/market/snapshot**', r => fulfil(r, 'lhq-market-snapshot'));
  await page.route('**fapi.binance.com/fapi/v1/fundingRate**', r =>
    fulfil(r, 'binance-fundingRate', sign ? (b) => binanceFundingSigned(b as BinanceFundingRow[], sign) : undefined));
  await page.route('**api.bybit.com/v5/market/kline**', r => fulfil(r, 'bybit-kline'));
  await page.route('**api.bybit.com/v5/market/open-interest**', r => fulfil(r, 'bybit-open-interest'));

  return served;
}

/** The funding values a `funding-negative` run should put on screen, so a spec
 *  asserts against the fixture rather than against a hardcoded guess. */
export function expectedNegativeFunding(): { coin: string; binance: number }[] {
  const fx = load('lhq-funding').body as FundingBody;
  return fundingNegative(fx).data.map(d => ({ coin: d.coin, binance: d.binance }));
}
