# Owner backlog — the real priority list

**Given by the owner on 2026-09-20, verbatim items below; state refreshed by PM/DevOps on 2026-10-21.** This is the list the
team works from. It outranks anything PM/DevOps has queued. On 2026-10-21 the owner said "work also on the backlogs":
the team works it alongside the open issues, in the order under "Order of work" below.

**The owner's standing rule:** what makes users pay comes first — reliable data,
signals, decision-making, macro and technicals — plus payments, getting users,
and the site staying up under traffic. UI audits and polish are `priority: low`
and only run in a window the owner grants.

## The list, tagged (state as of 2026-10-21)

| # | Item (owner's words, condensed) | Priority | Tracked | State 2026-10-21 |
|---|---|---|---|---|
| 1 | **Work on the payment gateway** | **critical** | #1567, #861 | **Whop only** (owner, 2026-10-17; Lemon Squeezy, Polar and Paddle rejected us). On the qa test site, not production: webhook unlock (#1599), pay-before-signup recovery (#1607), checkout embedded on /upgrade with the account email locked (#1610). QA testing the qa build. |
| 2 | **Real payment end-to-end** — prove a purchase grants Pro | **critical** | #1567 | **Not done.** The hidden $1 test plan exists; qa's Whop table had 0 rows at 2026-10-20 17:00 UTC. qa has no `WHOP_PLAN_ID_*` set, so a real payment there records but never grants (by design). A no-money grant test needs the Whop Sandbox (owner sets it up). |
| 3 | **Ability to cancel a plan** | **critical** | — | **Covered for Whop, in code:** the buyer cancels in their Whop account; each paid payment extends Pro to the end of the paid period, and with no renewal `lib/paidPeriod.ts` returns the account to Free 48 h after that end (cancel keeps paid time). Not yet exercised with a real Whop subscription. |
| 4 | **Lemon Squeezy account details** | — | — | **Obsolete**: Lemon Squeezy rejected the store. |
| 5 | **Redistribution rights for the exchange data** | **high** | #1116 (closed), #861 | **Open gap.** Finnhub's Free plan forbids business use (read 2026-09-27); Bybit and CoinGlass terms still unread. Decide before selling: paid Finnhub plan, written permission, or drop Finnhub. |
| 6 | **Traffic readiness: paid tier + caching before any marketing push** | **high** | #1397, #1404 | Production runs Render **Starter: 0.5 CPU, 512 MB, 1 instance, Singapore** (Render API, 2026-10-20). Next tier, Standard: 1 CPU, 2 GB, $25/month. The only load figure (2026-09-23: ~11 upstream calls and ~0.6 CPU-seconds per page load) predates the #1471 prerender fix, so it is stale. **Re-measure, then decide the tier.** |
| 7 | **Load / stress testing** | **high** | #1397 | Never measured on a production-like tier. Staging is on the free plan, so it gives a lower bound only. |
| 8 | **Error and product tracking** | **high** | #1398 (closed) | Error tracking proven. Production reports PostHog and Sentry configured (`/api/version`, 2026-10-20). PostHog only records visitors who accept the cookie banner; whether UTM sources show in its reports is **unconfirmed** (Marketing needs it). |
| 9 | **Sign-in shows a gibberish domain** | **high** | #1411 | Needs Supabase **Pro ($25/month) + custom domain add-on ($10/month)** (supabase.com/pricing, 2026-10-21). Pro also brings 7-day daily backups (production has none) and leaked-password protection. Owner decision. |
| 10 | **Marketing: posting to X on the owner's behalf**, plus manual Reddit threads | **high** | #1591 | Marketing seat drafts daily; the owner posts or approves each post. **Official accounts not decided** (owner). |
| 11 | **Marketing / distribution / research team (new seat)** | **high** | — | **Done 2026-10-21**: Claude Cowork, folder `Documents\LiquidityHQ-Marketing`. First output: research notes, a 14-account follow list, drafts for 10-22 to 10-24. |
| 12 | **Customer support presence** | **medium** | #1549 | support@liquidity-hq.com is live and `/contact` answers 200 on production. #1549 to be checked and closed out. |
| 13 | **Team office email** (beyond support@) | **medium** | — | Not started; owner. |
| 14 | **Arena on-the-fly indicator work sound?** | **medium** | #1347 | Unchanged: 10 of 16 fixed and live, rest parked. |
| 15 | **Cross-browser testing** | **medium** | — | Not started. QA: add Firefox and WebKit to the Playwright run. |
| 16 | **Testimonial section** | **medium** | — | Blocked: no users yet, and nothing is ever faked. |
| 17 | **Visual regression** | **low** | — | Parked. |
| 18 | **Vela chart prototype with our BUY/SELL markers** (owner liked its smoothness, 2026-10-13) | **low** | #1570 | Backlog only. See note below. |

**Item 18 note.** Vela = github.com/LuxAlgo/Vela, open-source charting library (TypeScript, own WebGL renderer, Apache 2.0 with a required visible "Vela" attribution/watermark; checked from the repo page 2026-10-13). It ships 70+ indicators but **no buy/sell signals**; our EMA9/20 + EMA50 markers would have to be drawn by us. Whether Vela's plugin SDK can draw custom markers is **unverified**. We use `klinecharts` today, so a swap touches every chart page. Plan: prototype on a separate branch, one page only, no replacement. The owner approves screenshots before anything merges (Arena redesign was rejected 3 times). Licence and watermark need a check before use in a paid product.

**Found during the 2026-10-21 refresh:** production has **no health check path** set on Render (`healthCheckPath` empty), so Render only checks that the port accepts a connection: an app that is up but hanging still counts as healthy. Setting it to `/api/version` makes Render stop routing to, and restart, an instance that stops answering (render.com/docs/health-checks). Free; an owner click on the production service.

## Whop go-live concerns (added 2026-10-11, refreshed 2026-10-21)

| # | Item | Status 2026-10-21 |
|---|---|---|
| W1 | No real payment yet | open: the $1 test plan exists; nothing recorded on qa yet |
| W2 | App unlock (webhook, grant Pro, checkout) | built and on qa (#1599, #1607, #1610); not on production |
| W3 | Refund / return policy page before real charges | #1571: code merged to `dev`; its label migration `20261017b` is not applied anywhere (owner decision pending) |
| W4 | Whop may ask for business documents; threshold unknown | open, unchanged |
| W5 | Chargebacks fall on the seller | known |
| W6 | Whop Websites migration job | closed |
| W7 | Product description lists features; owner to confirm they are Pro-only | open |
| W8 | Crypto at Whop checkout not seen in a real checkout | unverified |
| W9 | "$25 / Save 20%" on the $20 plan | closed: Whop's automatic comparison, no setting (2026-10-19) |
| W10 | Philippine tax / BIR registration: ask an accountant | not started |

## Order of work (PM, 2026-10-21)

1. **Payments, end to end** (1, 2, W1-W3): QA finishes the qa build; one real payment recorded; the production setup batch and release go to the owner together.
2. **Core data first** (owner rule): #1617 (one OI window for every page and the AI read), then #1594 (daily health check), then #1593 (alert quality).
3. **Before any paid or large marketing push** (6, 7): re-measure CPU and upstream calls per page load, then the owner decides the Render tier with the number in hand. Organic posting with zero followers can start before this.
4. **Owner money decisions, batched** (5, 9, health check path): one message with costs and a recommendation.
5. Then 15 (cross-browser, QA), 12 close-out, and the owner-visible queue (#1601, #1600, #1595, #1603).

## Not on this list, and that is deliberate

The UI audit (58 findings), the Arena audit leftovers, UI polish, the Russian
menu and the old design switch are all `priority: low` and parked. Built work
for them sits in open PRs, unmerged, until the owner grants a window.
