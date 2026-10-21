# Full platform audit, 2026-10-20/21

**Ordered by the owner:** "audit the whole application, all the features, all the pages, make sure everything is working… and also a security check… the possible attacks, hacking incident, or trying to sabotage the platform", then "make sure data on screen is correct and result from AI is correct".

This file is the index. Every finding lives on a GitHub tracker with its evidence; this page says what was checked, how, and where the results are. Production during the audit: `b999f8c` (v2026.10.17). Test site: `qa` `193ac57`.

## Parts, method, and where the results are

| Part | Method | Result | Tracker |
|---|---|---|---|
| Data freshness (API level) | 75 values on 5 coins fetched from our API and from Binance/Bybit/Coinbase back to back; code map of every source, interval and cache | No wrong value; most panels polled (minutes to ~95 min), no age shown | #1626, `docs/audits/data-reliability-2026-10-20.md` |
| Economic calendar | Every event vs bls.gov, bea.gov, federalreserve.gov | CPI, NFP, GDP, PCE on wrong dates/times; FOMC right. Fixed on dev (QA: 96/96 rows match) | #1625 (PR #1628) |
| On-screen values | Rendered page values vs source within 1-2 s; Buy/Sell markers recomputed from the same candles | Binance prices exact; funding, OI, long/short, F&G, dominance, DXY, ETF flow, news ages correct; **all 41 markers correct**. Wrong: klines cache serves pre-close candles after the close (ribbon, SL/TP wrong up to an hour); browsers show the previous poll (up to ~16 min on Bybit-only coins); RSI is not standard (owner chose standard Wilder RSI); order wall always "tight"; TP "2:1" vs the wrong entry | #1626 part 2 |
| Payments and plans | Code audit of every path that sets or reads plan/role/trial/period | Whop unlock sound. GO-LIVE: Pro never ended outside AI routes; trial got all-coin server signals; settings-type refusals unrecoverable; ops Grant Pro; trial email said "not on sale". 4 of 5 merged, 5th in review | #1630 |
| AI | Code audit of gates, counters, caps, prompts | Gates/limits/caps sound. No "not financial advice" on AI output; empty answer shown as FLAT 0%; quota spent on failures; unbounded inputs. Owner: Ask LiquidityAI must not auto-send | #1631 |
| Security (code) | Read-only review of every route, RLS, webhooks, headers, secrets | 1 High (own `telegram_chat_id` writable), 4 Medium, 9 Low | #1632 part 1 |
| Attacks and sabotage | Read-only review + research (`npm audit`, GitHub advisories) | No Critical; 3 High (DB fill to read-only, global AI breaker blocks Pro, klines range bypasses cache -> exchange IP ban), 13 Medium incl. Next.js 16.2.6 advisory (fixed 16.4.1), 9 Low; owner settings checklist | #1632 part 2 |
| Live site sweep | ~107 GETs signed out: pages, links, headers, legal text, SEO, JS weight, locales | 40 pages 200, 0 errors, 0 broken links. Privacy names Lemon Squeezy; Terms lack billing (owner approved wording); share image 404 (fixed on dev); Playbook "almost always" claims; landing HTML empty for crawlers | #1633 |
| Every page in a browser | PM pass on qa (as the owner's Free session, read-only) + QA's full regression with signed-out/Free/trial/Pro accounts, 1280 and 390 | PM: 0 console errors, 30+ pages pass; fails listed. QA: in progress | #1640 |
| Server health | Render metrics, events, logs | Memory crept 360 -> 448 MB of 512 (caches now bounded on dev); one crash 10-16 (exit 134); health check set 10-20 | #1397 |
| Supabase advisors (dev) | Security advisor | No ERROR; leaked-password protection off (needs Pro plan, owner: later) | #1632 |

## Owner decisions taken during the audit (first-hand to PM)
- Supabase Pro + custom sign-in domain: later (refined 2026-10-21 08:53 UTC: Pro on the day payments go live, #1567). Render health check: set (by the owner). Render tier: later.
- Trial gets every server-sent alert, BTC/ETH/SOL only.
- Expired-Pro test: QA changes one row on a spare test account (no new logins).
- Standard Wilder RSI on closed candles everywhere.
- Migration `20261021e` (security DDL) on the dev database after QA's run.
- Ask LiquidityAI opens the chat; nothing is sent until the user presses Send.
- Terms billing wording approved; phone checkout look approved.

## Not covered, and why
- Production database contents (news, liquidation and alert history) and production Supabase/Render settings: agents cannot read them; the settings checklist is on #1632 for the owner.
- Google sign-in end to end: uses Google's production sign-in page.
- A real payment: none has reached the test site; the Whop sandbox is not set up.
