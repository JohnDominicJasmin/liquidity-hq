# liquidity-hq
Personal crypto trading intelligence platform — live prices, liquidity clusters, session windows, breaking news alerts, and AI signals powered by Grok.



# Liquidity HQ

Personal crypto trading intelligence platform built for retail traders who want an edge.

## Features

- **Live Tickers** — Real-time prices for BTC, ETH, SOL, XRP, BNB, HYPE, NEAR, ZEC via Binance WebSocket + Bybit
- **Trade Scanner** — GO/NO-GO scanner with live Bybit funding rate auto-load
- **Session Windows** — Live PHT clock with God Tier, Prime, London, Dead Zone detection
- **Liquidity Bible** — 55 searchable trading secrets (Hunt, Trap, Timing, Psychology)
- **Cluster Tracker** — Log liquidation levels from Coinglass, auto-detects raids
- **AI Arena** — Grok-4.3 powered news signal engine (LONG/SHORT/FLAT + reasoning)
- **Breaking News** — Multi-source real-time alerts with browser push notifications

## Tech Stack

- Next.js 14 (App Router)
- Tailwind CSS
- Supabase (clusters, signal history)
- Grok API (xAI) — grok-4.3
- PWA (installable on mobile)
- Deployed on Render

## Data Sources

| Data | Source |
|---|---|
| BTC, ETH, SOL, XRP, BNB, NEAR, ZEC | Binance WebSocket |
| HYPE/USDT | Bybit REST API |
| Funding Rates + OI | Bybit Public API |
| Fear & Greed | Alternative.me |
| BTC Dominance | CoinGecko |
| Breaking News | Finnhub + CryptoPanic + CryptoCompare + Messari |

## Setup

```bash
npm install
cp .env.example .env.local
# Add your Supabase URL and anon key
npm run dev
```

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

## Disclaimer

For personal use only. Not financial advice.
