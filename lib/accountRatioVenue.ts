/* ONE NUMBER, ONE VENUE (#1651, PM decision 2026-11-17). The store keeps the long / short ACCOUNT ratio PER VENUE, never in one shared field: Binance's global account ratio (`bnLongRatio` / `bnShortRatio`, period 1h, from the market snapshot) and Bybit's account ratio (`longRatio` / `shortRatio`, period 1h, from the Bybit fan-out). A surface that shows ONE number uses Binance and says so; a coin Binance does not list falls back to Bybit and says Bybit. A page that shows both (/liq) keeps both, labelled. */
export interface AccountRatio { long: number; short: number; venue: 'Binance' | 'Bybit' }
interface RatioFields { bnLongRatio?: number | null; bnShortRatio?: number | null; longRatio?: number | null; shortRatio?: number | null }
export function accountRatio(c: RatioFields | null | undefined): AccountRatio | null {
  if (!c) return null;
  if (c.bnLongRatio != null && c.bnShortRatio != null) return { long: c.bnLongRatio, short: c.bnShortRatio, venue: 'Binance' };
  if (c.longRatio != null && c.shortRatio != null) return { long: c.longRatio, short: c.shortRatio, venue: 'Bybit' };
  return null;
}
