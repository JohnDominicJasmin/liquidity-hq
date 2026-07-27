// Public glossary content for /learn (Tier 2 #14). Written as standalone
// reference entries - NOT extracted from the in-context <Tip> tooltips
// scattered across the app, which assume surrounding UI and read as
// fragments outside it. Slugs exist now so a future per-term page
// (/learn/[slug]) is a data change, not a rewrite.

export interface GlossaryEntry {
  slug: string;
  term: string;
  definition: string;
}

export interface GlossaryCategory {
  key: string;
  label: string;
  entries: GlossaryEntry[];
}

export const GLOSSARY: GlossaryCategory[] = [
  {
    key: 'momentum',
    label: 'Momentum & Technicals',
    entries: [
      {
        slug: 'rsi',
        term: 'RSI (Relative Strength Index)',
        definition: 'A 0-100 momentum gauge built from recent gains vs. losses. Above roughly 70 is considered overbought (exhaustion, a reversal down becomes more likely); below 30 is oversold (a bounce becomes more likely). It measures how stretched a move is, not where price is headed next - a strong trend can stay overbought for a long time.',
      },
      {
        slug: 'ema-ribbon',
        term: 'EMA Ribbon',
        definition: 'A set of exponential moving averages (fast, mid, slow) plotted together. When they fan out in order and price holds above or below all of them, that\'s a clean trend. When they tangle together, price is choppy and directionless. A "ribbon strategy" waits for price to pull back into the ribbon\'s value zone with the trend still intact before entering.',
      },
      {
        slug: 'choppiness-index',
        term: 'Choppiness Index',
        definition: 'A 0-100 score for whether a market is trending or range-bound, independent of direction. High readings mean price is moving a lot but not covering real ground (whipsaw risk); low readings mean price is genuinely trending. Used as a warning label on other signals, not a standalone trade trigger.',
      },
      {
        slug: 'vwap',
        term: 'VWAP (Volume-Weighted Average Price)',
        definition: 'The average price an asset has traded at today, weighted by how much volume traded at each price. Price above VWAP is a mild bullish tell (buyers are in control of the session average); below is bearish. Often used as a dynamic support/resistance line intraday.',
      },
    ],
  },
  {
    key: 'order-flow',
    label: 'Order Flow & Positioning',
    entries: [
      {
        slug: 'open-interest',
        term: 'Open Interest (OI)',
        definition: 'The total number of futures/perpetual contracts currently open (not yet closed). Rising OI with rising price means new money is entering long - a real trend. Rising OI with falling price means new shorts are piling in. Falling OI means positions are closing, not opening - a weaker, more fragile move either direction.',
      },
      {
        slug: 'cvd',
        term: 'CVD (Cumulative Volume Delta)',
        definition: 'A running total of aggressive buy volume minus aggressive sell volume (market orders that took liquidity, not passive limit orders). When price rises but CVD is flat or falling, buyers are running out of steam even though price hasn\'t caught up yet - a bearish divergence worth watching.',
      },
      {
        slug: 'long-short-ratio',
        term: 'Long/Short Ratio',
        definition: 'The split between long and short positions currently open on an exchange, usually shown as a percentage. A heavy skew toward one side (e.g. 65%+ long) means the crowd is crowded into one trade - which is exactly the setup that gets liquidated when price moves the other way.',
      },
      {
        slug: 'funding-rate',
        term: 'Funding Rate',
        definition: 'A periodic payment (typically every 8 hours) between long and short traders on a perpetual futures contract, designed to keep its price tethered to the spot price. Positive funding means longs pay shorts (the market is long-heavy); negative means shorts pay longs (short-heavy). Extreme funding in either direction signals an overcrowded, fragile position that\'s expensive to hold.',
      },
      {
        slug: 'liquidation',
        term: 'Liquidation',
        definition: 'The forced closure of a leveraged position when losses eat through the trader\'s margin. Exchanges do this automatically to prevent the account from going negative. A cluster of liquidations at nearby price levels can cascade - each forced close pushes price further, triggering the next cluster.',
      },
      {
        slug: 'squeeze-score',
        term: 'Squeeze / Flush Score',
        definition: 'A composite 0-100 score blending funding rate and long/short ratio to estimate how overcrowded one side of the market is. A high score on the short side means shorts are overpaying and overcrowded - fuel for a squeeze (a sharp move up that forces them to buy back). A high score on the long side signals the mirror case: a flush risk to the downside.',
      },
      {
        slug: 'whale-trade',
        term: 'Whale Trade',
        definition: 'A single large trade (this app flags trades above a per-coin dollar threshold, e.g. $5M+ on BTC) that\'s big enough to move markets or signal institutional intent on its own, distinct from the steady flow of smaller retail orders.',
      },
      {
        slug: 'accumulation',
        term: 'Accumulation',
        definition: 'A pattern where large players appear to be steadily building a position - typically open interest and price both rising while the move stays orderly rather than explosive, suggesting size is being absorbed rather than chased.',
      },
      {
        slug: 'distribution',
        term: 'Distribution',
        definition: 'The mirror of accumulation: price still grinding up, but flow underneath (order book imbalance, weakening taker-buy ratio, open interest unwinding even as price rises) suggests large players are quietly selling into strength rather than adding. A classic pattern before a local top.',
      },
      {
        slug: 'carry-arb',
        term: 'Carry Arbitrage',
        definition: 'A delta-neutral trade that profits purely from an extreme funding rate: go long spot and short the equivalent perpetual (or vice versa when funding is very negative), collecting the funding payment without taking on directional price risk.',
      },
    ],
  },
  {
    key: 'sentiment',
    label: 'Sentiment & Macro',
    entries: [
      {
        slug: 'fear-greed-index',
        term: 'Fear & Greed Index',
        definition: 'A 0-100 sentiment gauge built from volatility, momentum, social activity, and other inputs. Low readings (extreme fear) often mark points of maximum pessimism and historically precede bounces; high readings (extreme greed) mark euphoria and often precede pullbacks. A contrarian tool, not a timing tool.',
      },
      {
        slug: 'btc-dominance',
        term: 'BTC Dominance',
        definition: 'Bitcoin\'s share of the total crypto market capitalization. Rising dominance usually means capital is rotating out of altcoins and into Bitcoin (a "risk-off" tell within crypto); falling dominance often accompanies altcoin outperformance ("alt season").',
      },
      {
        slug: 'dxy',
        term: 'DXY (US Dollar Index)',
        definition: 'A measure of the US dollar\'s strength against a basket of other major currencies (heavily weighted toward the Euro and Yen). A strong dollar is generally a headwind for crypto and other risk assets; a weakening dollar is generally supportive. The composition matters - dollar weakness driven by yen strength (a carry-trade unwind) behaves very differently than dollar weakness from broad risk appetite.',
      },
      {
        slug: 'contrarian-signal',
        term: 'Contrarian Signal',
        definition: 'A setup where the crowd is positioned so heavily one way (via funding, long/short ratio, or sentiment) that the more likely outcome is the opposite of what the crowd expects - because an overcrowded trade is exactly the fuel for a squeeze or flush against it.',
      },
      {
        slug: 'confluence',
        term: 'Confluence',
        definition: 'When multiple independent signals point the same direction at the same time (e.g. RSI oversold, funding negative, and a support cluster all aligning). Confluence doesn\'t guarantee a move, but agreement across unrelated signals is a stronger basis for a trade than any single signal alone.',
      },
    ],
  },
  {
    key: 'risk',
    label: 'Risk & Position Sizing',
    entries: [
      {
        slug: 'leverage',
        term: 'Leverage',
        definition: 'Borrowed exposure that lets a trader control a larger position than their actual collateral (margin) would otherwise allow. Higher leverage means smaller price moves cause bigger percentage swings in the account - it amplifies both gains and losses, and moves the liquidation price closer to entry.',
      },
      {
        slug: 'notional-value',
        term: 'Notional Value',
        definition: 'The full size of a leveraged position (margin × leverage), before accounting for the collateral actually put up. Profit and loss are calculated against the notional value, not the margin - which is exactly why leverage amplifies returns in both directions.',
      },
      {
        slug: 'maintenance-margin',
        term: 'Maintenance Margin',
        definition: 'The minimum percentage of a position\'s notional value an exchange requires to be kept as collateral at all times. If the account\'s margin falls below this level, the position gets liquidated. SET by the exchange per asset and often tiered by position size.',
      },
      {
        slug: 'risk-reward-ratio',
        term: 'R:R Ratio (Risk:Reward)',
        definition: 'How much a trade stands to make relative to how much it risks, expressed as a multiple (e.g. 2R means the target profit is twice the distance to the stop-loss). A trade needs a lower win rate to be profitable long-term the higher its R:R - the two numbers only mean something together, not separately.',
      },
      {
        slug: 'expected-value',
        term: 'Expected Value (EV)',
        definition: 'The average outcome per trade if the same setup were taken many times, calculated as (win rate × average win) minus (loss rate × average loss). A positive EV means the math favors taking the trade over a large enough sample, even if any single instance can still lose.',
      },
      {
        slug: 'breakeven-win-rate',
        term: 'Breakeven Win Rate',
        definition: 'The minimum win rate a given risk:reward ratio needs just to break even long-term. A 2R setup needs to win only about 33% of the time to break even; a 1R setup needs 50%. Win below this rate and the setup loses money even with more wins than losses lost to a wider stop.',
      },
      {
        slug: 'roe',
        term: 'ROE (Return on Equity)',
        definition: 'Profit or loss expressed as a percentage of the actual margin (collateral) put up, rather than the full notional position size. Because leverage multiplies exposure, ROE is typically a much larger percentage swing than the underlying price move itself.',
      },
    ],
  },
  {
    key: 'lhq',
    label: 'LiquidityHQ Concepts',
    entries: [
      {
        slug: 'raid-probability-meter',
        term: 'Raid Probability Meter (RPM)',
        definition: 'A proprietary 0-100 score blending session timing, day of week, Fear & Greed, funding rate, and order-book wall proximity to estimate how likely a "raid" - price being pushed into a cluster of stop-losses or liquidations to grab that liquidity - is right now.',
      },
      {
        slug: 'smart-money-score',
        term: 'Smart Money Score',
        definition: 'A composite read of current market positioning (order flow, funding, open interest trend, and related signals together) distilled into a single bullish-to-bearish score, meant to approximate what informed/institutional flow appears to be doing right now.',
      },
      {
        slug: 'alert-outcome-tracking',
        term: 'Alert Outcome Tracking',
        definition: 'LiquidityHQ logs the price at the moment each directional alert fires, then checks back 24 and 48 hours later to record whether price actually moved the way the alert implied - misses included. It\'s the honest track record behind each alert type, not a backtest or a cherry-picked highlight reel.',
      },
      {
        slug: 'session-windows',
        term: 'Session Windows (God Tier, Prime, London, Dead Zone)',
        // Stated in UTC, not a specific reader's local time - these are the exact
        // windows lib/session.ts enforces, and UTC is the one description that
        // reads correctly for every reader instead of only one country's. This
        // definition used to say "Sunday night into Monday" and "early morning"
        // for God Tier/Prime, which is only true from Philippine time (UTC+8) -
        // God Tier (Sun 15:00-19:00 UTC) is Sunday AFTERNOON in New York and
        // London, not Sunday night.
        definition: 'Recurring UTC windows in the trading day/week that have historically shown different raid/liquidity behavior: "God Tier" (Sunday 15:00-19:00 UTC) and "Prime" (daily 18:00-21:00 UTC) see more historical raid activity, "London" (weekdays 07:00-10:00 UTC) covers the London open, and the "Dead Zone" (weekdays 04:00-07:00 UTC) tends to be quiet, low-quality chop. See the Hours page to check these against your own local time.',
      },
    ],
  },
];

export const GLOSSARY_FLAT: GlossaryEntry[] = GLOSSARY.flatMap(c => c.entries);
