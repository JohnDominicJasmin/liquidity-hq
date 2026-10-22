# Data reliability audit, 2026-10-20

**Asked by the owner:** "How reliable is our data? The news, every data on the screen... is it real time or has a delay?"
**Scope:** production (`b999f8c`), read 2026-10-20 18:00-18:25 UTC. Two independent instruments: (1) a code map of every on-screen number (source, transport, refresh interval, caches, failure behaviour), (2) live measurement of production against the upstream sources at the same moment. Spot-checks of the top findings re-read in code by PM.
**Not measured:** news, liquidation history and alert history are read by the browser straight from Supabase; reading them outside a browser was refused by the harness (credential use), so news freshness was measured on the rendered `/news` page instead. Liquidation and alert history: not measured.

## Verdict

- **The numbers we show are the exchanges' numbers.** 75 values (price, funding, open interest, long/short) on BTC, ETH, SOL, XRP, TIA matched Binance, Bybit and Coinbase; every gap was explained by our cache age, the largest 0.23% on TIA after 26 s. No wrong value was found among what was measured.
- **Only a few things are truly live:** prices of Binance-listed coins (~1 s), chart candles, the `/liq` liquidation and whale feeds, and the news ticker (The Block item published 18:14:28 was on `/news` by 18:20).
- **Everything else is polled, minutes to ~95 minutes old, and almost nothing tells the user how old it is.**
- **Several panels show a definite value when the data is unknown or wrong**, and one feed is plainly wrong: the economic calendar (#1625).

## What the user sees, and how old it can be

| Data | Real time? | Worst-case age | Age shown? |
|---|---|---|---|
| Price, Binance-listed coins | Yes (websocket) | ~1-2 s; ~60 s on fallback | No; fallback silent |
| Price, Bybit-only coins (HYPE, PEPE, BONK, XAU, SPX) | No | **~8.5 min** | No |
| Chart candles, Buy/Sell markers | Yes / at candle close | seconds / one candle | Yes, honest status dot |
| Funding, open interest ($) | No | ~8.5 min | No |
| OI 1h % | No | ~8 min | No |
| Long/short ratio (Bybit) | No | **~95 min** | No (route sends age, client drops it) |
| RSI 1h/4h, multi-timeframe | No | ~18 min | No |
| CVD, whale alerts | Sampled (last 200 trades / 5 min) | ~6 min; whale time = detection time | Wrong time shown |
| Liquidation feed, whale trades (`/liq`) | Yes | seconds | Yes |
| Liquidation map | Model (leverage tiers x OI x long/short) | inputs up to ~95 min | "LIVE" badges |
| GEX / max pain | No | ~16 min | No |
| Macro (DXY, SPX, gold, oil, yields) | No | ~11 min + Yahoo delay | No; failures keep last value forever |
| Fear & Greed, ETF flows | Daily figures | a day+ | No |
| Economic calendar | No | dates **wrong** (#1625) | No; failure shows "No upcoming events" |
| News + Breaking ticker | Near real time | publisher delay + 1 min | Yes ("Xm ago") |
| Price alerts (Telegram) | No | checked every 5 min | — |

## Findings, worst first (tracked on the tracker issue)

1. **Economic calendar dates wrong** (CPI Nov 12 vs official Nov 10; NFP 14:30 vs 13:30 UTC and Jan 1 vs Jan 8; GDP Oct 26 vs Oct 29; PCE Oct 30/Nov 27/Dec 25 vs Oct 29/Nov 25/Dec 23). FOMC correct. A failed fetch shows "No upcoming high-impact events". **#1625, high.**
2. **Price alerts never fire on Bybit-only coins** (the server price fetch loops only Binance-listed coins, `app/api/telegram/alert/route.ts:556`), and the 5-minute check misses wicks that cross and come back.
3. **Bybit-only coins show ~8.5-minute-old prices as live** (`MarketProvider.tsx` 8-min `fetchBybit`), while their chart is live, so header and chart can disagree.
4. **AI prompt gets ETF outflows as inflows**: the minus sign is dropped (`GrokChat.tsx:245`, `'+'`-only prefix then `Math.abs`).
5. **Long/short up to ~95 min old, and unknown becomes 50%** (`LiqTerminal.tsx:338, 442`); the liquidation model then assumes 50/50.
6. **"BREAKING" fires on substrings**: `'war'` matches "toward", "award", "software" (`lib/classify.ts:60`); the ticker is also dominated by general world news (6 NBC, 4 Al Jazeera items vs 2 per crypto outlet on the first screen at 18:20).
7. **AI inputs mix moments**: basis compares an up-to-8-min-old perp price with live spot; Coinbase premium compares USD with USDT 30 s apart, then labels it "US institutional buying".
8. **AI prompt states absence as fact** ("None in last 4h" cascades from a buffer that only covers this tab's lifetime; equal stablecoin readings read as "burning (bearish)"), and carries no data ages.
9. **Liquidation map is a model but badged "LIVE" / "LIVE DATA"**; cluster history depends on visitors' browsers writing `liq_events`.
10. **No freshness indicator anywhere for polled data**: the websocket status is computed but never rendered; Markets says "{count} coins live" regardless.
11. **Macro values keep the last good number forever** when Yahoo fails, silently.
12. Low: passthrough proxy types send `s-maxage=300` though the code caches 30-60 s (harmless while Cloudflare does not cache); the snapshot `ts` is the request time.

**Already fixed on `dev`, not yet released:** unknown funding shown as "Neutral"; unknown OI shown as "Flat"; OI trend label on a different window from the number beside it (#1613, #1617).

## Done well
Chart candles (live socket, stall detection, gap backfill, honest dot), signal markers (closed candles only), news ages, the `/liq` feed dots, the AI read's "x min ago".
