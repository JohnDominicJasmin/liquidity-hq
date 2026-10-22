# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Active crypto traders, worldwide (perps and spot: BTC, ETH, majors and alts). They open LiquidityHQ before entering a trade to read the market, and the pain they bring is getting liquidated or stopped out right before price reverses. Buyers are anywhere (Malaysia, Netherlands, UK, Japan, Australia, US, EU and the rest); the owner being in the Philippines does not make it a Philippine product. Confirmed by the owner, 2026-10-19.

## Product Purpose

A subscription web app (liquidity-hq.com) that helps a trader read the market faster: "A crypto trading dashboard built around liquidity: where stops cluster, how crowded funding positioning is, and where the estimated liquidation zones sit" (About page). The decisions stay with the trader. Success is a trader who checks the read before trading, stays, and pays for Pro.

## Positioning

Liquidity-first, confirmed by the owner 2026-10-19: built around where stops and liquidation clusters sit and how crowded funding is, plus an AI read (LiquidityAI) that gives a plain directional verdict (Bullish, Lean bullish, Bearish, Lean bearish, Wait) with a confidence score and the signals behind it, and is allowed to say "wait". Quick Research reads local chart data only (no web search); Deep Research searches the live web and X for catalysts.

## Operating Context

- Pages: Dashboard, Arena (the AI read), Briefing, Scanners (squeeze scanner and others), Markets, Funding, Liquidation map, Correlation, Economic calendar, News, Research, Alerts, Journal, Calculator, Live tracking, Hours, Learn, Playbook, Upgrade, Settings.
- Signals: EMA-based Buy/Sell markers (EMA9/20 cross confirmed by EMA50) on the chart, a Confluence Score, multi-timeframe alignment, S/R and realized liquidation-cluster levels, market data (open interest, funding, order flow, GEX).
- Alerts: price alerts and Telegram alerts (Pro).
- Used on desktop and phone browsers.

## Capabilities and Constraints

- Plans: Free; Pro at $49 per month, $490 per year, or $20 every 2 weeks. Free: 5 Quick + 3 Deep AI analyses a day; Pro: 30 Quick + 10 Deep. Signal access: signed-out BTC only; Free BTC/ETH/SOL on 30m and higher; Pro all coins and timeframes.
- Payments: Whop only (owner decision 2026-10-17); off on production until the first verified payment. All sales final, no refunds.
- The product does not execute trades, hold or move funds, manage money, or give personal advice. A risk disclaimer is on every page.
- Copy lives in the production labels table, not only in code: rows exist for English, Korean, Chinese, Russian and Arabic. English, Korean, Chinese and Russian are offered in the language picker; Arabic is translated but held back until right-to-left layout is implemented. Any copy change needs a row per language.
- Production's Arena page is the approved layout. A terminal-style Arena redesign was built and rejected three times; keep it (owner, confirmed 2026-10-19).
- Backtest win/loss stats are hidden behind a flag.

## Brand Commitments

- Name: LiquidityHQ. AI features are branded LiquidityAI.
- Tagline in the footer: "Market intelligence for active crypto traders".
- Support: support@liquidity-hq.com.
- Voice: plain and specific; say only what exists (no lines about features or setups the product lacks).

## Evidence on Hand

- Real product screens and real AI reads (Quick and Deep, BTC 1h, 2026-10-19) captured from the live site.
- No customers, revenue, testimonials, logos, press or usage statistics yet. Do not fabricate any.
- No accuracy or returns evidence. The app's own anti-chop note cites a 3-year backtest with a thin edge (profit factor 1.13 raw, 0.98 filtered); never present signals as profitable.

## Product Principles

1. Honest over hype: no accuracy, profit or returns claims, no invented proof, "not financial advice" everywhere (owner, confirmed 2026-10-19).
2. Liquidity first: show where stops and liquidations sit before anything else.
3. The read can say "wait": a clear verdict with its reasons beats a confident guess.
4. Worldwide by default: no country-specific wording, payment methods or assumptions; every string ships in every offered language (owner, confirmed 2026-10-19).
5. Keep what the owner approved: the production Arena layout is the reference, not a starting point for reinvention.

## Accessibility & Inclusion

The codebase targets WCAG AA contrast (4.5:1 for text) and records contrast fixes in its CSS. Arabic users are blocked until RTL support exists.
