/* LIQUIDATION PRICES ARE PER-TOKEN, WHATEVER THE VENUE LISTS (PM, 2026-11-20, #1651: "liquidation events in mixed contract units").
 *
 * The exchanges quote 1000x contracts per 1000 tokens (1000PEPEUSDT) and some coins differently on each venue: sats is 10000x on Bybit and 1000x on Binance, tag / toshi / turbo are 1000x on Bybit and per-token on Binance. A liquidation row keeps the price the venue reported, so one coin's rows (and
 * its clusters) mixed two scales. Every price is converted to PER-TOKEN at the point it enters the browser's liquidation feed: a live message by its own symbol (symbolDenominationFactor), a stored row (lhq_liq_events keeps the raw price, the coin and the venue) by the coin's listing on that venue.
 * The Arena then converts clusters to the chart's unit where it draws them (arenaPriceUnit, lib/coins.ts). Stored rows are not rewritten. */
import { coinRow, symbolDenominationFactor } from './coins.ts';

/** The multiplier that takes a STORED liquidation row's price to per-token: the denomination of the symbol the coin has on the venue that reported it ('BB' Bybit, 'BN' Binance). 1 when the coin or the symbol is unknown. */
export function liqPerTokenFactor(coin: string, source: string): number {
  const row = coinRow(coin.toLowerCase());
  const sym = source === 'BB' ? row?.bybit : source === 'BN' ? row?.binance : null;
  return sym ? symbolDenominationFactor(sym) : 1;
}
