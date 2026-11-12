/* Types for the shared synthetic market-data generator (qa/syntheticMarket.mjs). Hand-written
 * because the generator is plain .mjs - without this, importing it from a .ts fixture is an
 * implicit `any` and fails `tsc` under the project's noImplicitAny. */
export declare const IV_MS: Record<string, number>;
export declare function basePrice(symRaw: string): number;
/** The venue-shaped REST body for a URL we synthesize, or null for one we do not. */
export declare function synthUpstream(url: string): string | null;
/** The `data` payload of a Binance combined-stream @ticker frame for one symbol. */
export declare function synthTickerData(symUpper: string, nowMs?: number): {
  e: string; E: number; s: string; c: string; P: string; h: string; l: string; o: string; v: string; q: string;
};
/** A full combined-stream frame string: `{"stream":"btcusdt@ticker","data":{...}}`. */
export declare function synthCombinedFrame(symUpper: string, nowMs?: number): string;
