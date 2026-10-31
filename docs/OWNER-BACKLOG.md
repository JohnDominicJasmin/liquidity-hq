# Owner backlog — the real priority list

**Given by the owner on 2026-09-20, verbatim items below; state refreshed by PM/DevOps on 2026-10-21, and again that
afternoon (UTC) with the day's owner decisions (table below).** This is the list the
team works from. It outranks anything PM/DevOps has queued. On 2026-10-20 (17:07 UTC) the owner said "work also on the backlogs":
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
| 5 | **Redistribution rights for the exchange data** | **high** | #1649, #1116 (closed), #861 | **Open gap, parked by the owner until after launch** (2026-10-21 09:36 UTC, option B): the written permission requests to the exchanges wait until after launch, and no paid licensed data source is bought now. PM's research (#1649): the terms of Bybit, OKX, Bitget, Kraken, Coinbase and Deribit restrict commercial use or redistribution of their market data without written permission; Hyperliquid's terms have no such clause (a PM reading, not legal advice). Finnhub's Free plan forbids business use (read 2026-09-27). |
| 6 | **Traffic readiness: paid tier + caching before any marketing push** | **high** | #1397, #1404, #1567 | Production runs Render **Starter: 0.5 CPU, 512 MB, 1 instance, Singapore** (Render API, 2026-10-20). Next tier, Standard: 1 CPU, 2 GB, $25/month. The only load figure (2026-09-23: ~11 upstream calls and ~0.6 CPU-seconds per page load) predates the #1471 prerender fix, so it is stale. **Re-measure, then decide the tier.** **Owner, 2026-10-21 08:53 UTC (#1567):** organic marketing may start now; **no big push** (ads, influencers, giveaways) until three server fixes ship: the server-side login checks (#1653 in release v2026.10.21, #1657 in the next), the memory leak (#1653: QA measured the heap flat at 94-105 MB over 40 min of signed-in load, against 84 → 246 MB and a crash before), and the liquidation page's 5,000-row download (#1632). |
| 7 | **Load / stress testing** | **high** | #1397 | Never measured on a production-like tier. Staging is on the free plan, so it gives a lower bound only. |
| 8 | **Error and product tracking** | **high** | #1398 (closed) | Error tracking proven. Production reports PostHog and Sentry configured (`/api/version`, 2026-10-20). PostHog only records visitors who accept the cookie banner; whether UTM sources show in its reports is **unconfirmed** (Marketing needs it). |
| 9 | **Sign-in shows a gibberish domain** | **high** | #1411 | Needs Supabase **Pro ($25/month) + custom domain add-on ($10/month)** (supabase.com/pricing, 2026-10-21). Pro also brings 7-day daily backups (production has none) and leaked-password protection. **Owner, 2026-10-21 08:53 UTC (#1567, #1411): Supabase Pro is bought on the day Whop payments go live** (backups for payment records); the custom sign-in domain (+$10) stays later. |
| 10 | **Marketing: posting to X on the owner's behalf**, plus manual Reddit threads | **high** | #1591 | Marketing seat drafts daily; the owner posts or approves each post. Soft launch is organic: replies on high-follower crypto accounts that point people to the site, no paid push yet (item 6). **Official accounts not decided** (owner); the owner's yes/no on the reply plan is open. |
| 11 | **Marketing / distribution / research team (new seat)** | **high** | — | **Done 2026-10-21**: Claude Cowork, folder `Documents\LiquidityHQ-Marketing`. First output: research notes, a 14-account follow list, drafts for 10-22 to 10-24. |
| 12 | **Customer support presence** | **medium** | #1549 | support@liquidity-hq.com is live and `/contact` answers 200 on production. #1549 to be checked and closed out. |
| 13 | **Team office email** (beyond support@) | **medium** | — | Not started; owner. |
| 14 | **Arena on-the-fly indicator work sound?** | **medium** | #1347 | Unchanged: 10 of 16 fixed and live, rest parked. |
| 15 | **Cross-browser testing** | **medium** | — | Not started. QA: add Firefox and WebKit to the Playwright run. |
| 16 | **Testimonial section** | **medium** | — | Blocked: no users yet, and nothing is ever faked. |
| 17 | **Visual regression** | **low** | — | Parked. |
| 18 | **Vela chart prototype with our BUY/SELL markers** (owner liked its smoothness, 2026-10-13) | **low** | #1570 | Backlog only. See note below. |

**Item 18 note.** Vela = github.com/LuxAlgo/Vela, open-source charting library (TypeScript, own WebGL renderer, Apache 2.0 with a required visible "Vela" attribution/watermark; checked from the repo page 2026-10-13). It ships 70+ indicators but **no buy/sell signals**; our EMA9/20 + EMA50 markers would have to be drawn by us. Whether Vela's plugin SDK can draw custom markers is **unverified**. We use `klinecharts` today, so a swap touches every chart page. Plan: prototype on a separate branch, one page only, no replacement. The owner approves screenshots before anything merges (Arena redesign was rejected 3 times). Licence and watermark need a check before use in a paid product.

**Found during the refresh written 2026-10-20 ~17:00 UTC (early 2026-10-21 in Manila), and fixed the same hour:** production had **no health check path** on Render (`healthCheckPath` empty), so Render only checked that the port accepted a connection: an app that is up but hanging still counted as healthy. **The owner set it to `/api/version` on 2026-10-20 at 17:16 UTC; PM verified via the Render API** (`healthCheckPath: "/api/version"`, service not suspended, `/api/version` 200 in ~0.2 s). Render now stops routing to, and restarts, an instance that stops answering (render.com/docs/health-checks). Owner decisions the same hour: Supabase Pro + custom domain (item 9) **later** (refined 2026-10-21 08:53 UTC: Pro on the day payments go live); Render tier (item 6) **later**, after QA's measurement.

## Whop go-live concerns (added 2026-10-11, refreshed 2026-10-21)

| # | Item | Status 2026-10-21 |
|---|---|---|
| W1 | No real payment yet | open: the $1 test plan exists; nothing recorded on qa yet |
| W2 | App unlock (webhook, grant Pro, checkout) | built (#1599, #1607, #1610, #1643); in release v2026.10.21, which QA passed on 2026-10-21, but **switched off on production**: production has no Whop variables, so /upgrade shows the coming-soon block and the webhook refuses everything (PM read production's Render environment, names only, 2026-10-21 ~14:17 UTC; #1654). Go-live sets the three checkout links, the webhook secret, the company id and the plan ids **together** (#1567), never the links alone |
| W3 | Refund / return policy page before real charges | `/refund` was withdrawn on 2026-10-17 and redirects to `/terms`. The refund rules belong in the Terms billing section, whose wording the owner approved on 2026-10-21 (~04:10 UTC, #1633). Separately, #1571's Privacy wording that names Whop (migration `20261017b`) ships with release v2026.10.21 |
| W4 | Whop may ask for business documents; threshold unknown | open, unchanged |
| W5 | Chargebacks fall on the seller | known |
| W6 | Whop Websites migration job | closed |
| W7 | Product description lists features; owner to confirm they are Pro-only | open |
| W8 | Crypto at Whop checkout not seen in a real checkout | unverified |
| W9 | "$25 / Save 20%" on the $20 plan | closed: Whop's automatic comparison, no setting (2026-10-19) |
| W10 | Philippine tax / BIR registration: ask an accountant | not started |

## Owner decisions, 2026-10-21 (first-hand to PM)

Each one is recorded in full on the issue named; this table is the index. Times are UTC. Corrected and completed
the same day after PM's audit of every owner message in the compacted PM chat: four items had existed only in the
chat (the soft launch, the tools answer, "render service paid", the Korea concern), and four times had been stamped
1-6 minutes late. Also found: the owner's 2026-10-20 15:12 UTC "turn on waitlist" (Whop) was not carried out and
was put back to him on 2026-10-21 (#1567).

| Time | Decision | Recorded |
|---|---|---|
| 04:05 | Approved the #1606 checkout look (phone-width embed + one-sentence copy) and the Terms billing wording | #1606, #1633 |
| 04:43 | Trial users get every server-sent alert type, on BTC/ETH/SOL only | #1630 |
| 04:50 | The expired-Pro test uses the spare test account; no new logins | #1630 |
| 05:11 | Standard Wilder RSI(14) on closed candles, everywhere | #1626 |
| 05:18 | Ask LiquidityAI opens the chat and never sends on click | #1631 |
| ~05:23 | Security migration `20261021e` on the dev database after QA's run | #1644 |
| 08:53 | No Supabase upgrade now; Pro on the day payments go live; organic marketing now, no big push until three server fixes | #1567, #1411 |
| 08:53 | Soft launch: organic replies in discussions under high-follower crypto accounts, pointing people to the site (PM's reply plan waits for his yes) | #1591 |
| 08:54 | The label migrations' dev sections applied in the same database window | #1644 |
| 08:58 | All coins: no fixed number, every coin on the market | #1600 |
| ~09:05 | Exchange data must never be blocked by Binance: Bybit first, one shared breaker, request budgets | #1649 |
| 09:10 | The AI correctness fixes (E, B, C, A+D) approved as planned | #1631 |
| 09:10 | Data integrity guardrails: "We cannot fuck those up. Add a guardrail" | #1651 |
| 09:16 | Question: which tools or architecture layer (n8n?) protect the data. Answer: none new; add Zod, an outside uptime alert, Dependabot | #1651 |
| 09:26 | Dependabot alerts switched on ("do it for me") | #1632 |
| 09:36 | Exchange permission requests wait until after launch; no paid licensed source now (option B) | #1649 |
| 09:43 | Uptime alerts on cron-job.org ("cron-job.org go there") | #1594 |
| 09:47 | The Whop panel's translated labels (R12) on the dev database | #1640 |
| 09:50 | "render service paid": the Render payment-failed banner is gone (PM checked) | #1397 |
| 11:16-11:19 | Concern: Korea's block of 27 unregistered exchanges may shrink futures trading; PM's assessment, two marketing cautions and a "Korea premium" panel idea | #1592 |
| ~14:00 | Hyperliquid, option A: third backup source and funding comparison (#1649 phase 4); real liquidation levels filed as a proposal for Dev's estimate (Dev: about 5-6 days, no database in a first version) | #1649, #1662 |

## Waiting on the owner (PM, 2026-10-21 ~14:45 UTC)

One list, so nothing waits in a chat. Recommendation first in each.

| # | What | PM recommends | Where |
|---|---|---|---|
| 1 | Release v2026.10.21 to production (QA signed off; two database changes that touch no existing data, label rows, no env change, payments stay off) | Approve now | #1654, #1663 |
| 2 | Whop: anyone can buy on the public page today, but production cannot unlock Pro until go-live | Waitlist on the three Pro plans until go-live (his own 2026-10-20 call); the hidden $1 test plan stays | #1567 |
| 3 | The official X account, and a yes/no on the reply plan | Create the brand account; approve the plan | #1591 |
| 4 | The $1 Whop test payment (hidden test plan) | Do it when convenient. It can confirm the automatic unlock only **on the qa test site**, which holds the Whop webhook secret today, for an account with the same email (where the webhook points is set in his Whop dashboard). Production cannot unlock until go-live (row 2; "webhook pointed at the production URL" is still unchecked on #1567), so liquidity-hq.com would show no Pro | #1567 |
| 5 | Two-step login (authenticator app, not SMS) on GitHub, Render, Supabase, Whop, Hostinger, Google, Brevo, xAI, Telegram | Turn it on; account takeover is the biggest real risk | #1632 |
| 6 | Email domain: Brevo is not verified on liquidity-hq.com and anti-spoofing is off | Sign in to Brevo and Hostinger in Chrome; PM does the records with him | #1632 |
| 7 | Pin the Node version on Render (`NODE_VERSION`, an env-var change on each service) | Pin to the version Render uses today (24.14.1) | #1649 |
| 8 | Marketing wording: he asked Marketing to "scrape" which accounts to follow; PM wrote "research by hand, not bulk scraping" (automated scraping breaks X/Facebook rules) | Confirm the hand-research wording | Marketing `START-HERE.md` |
| 9 | The Impeccable design-tool hooks run in all three seats: at the start of every session, after every file edit, and at the end of every reply | His call: keep or remove | owner's Claude settings |
| 10 | Three visual fails from QA's regression (R6 `/learn` light theme, R7 `/hours` labels, R8 `/liq` stats grid) | A look when convenient; low priority | #1640 |
| 11 | Optional: Supabase dashboard checks (usage; Auth rate limits) | When convenient | #1567 |

## Order of work (PM, updated 2026-10-21 afternoon UTC)

**Amended 2026-10-30 13:26 UTC, and the list below is otherwise nine days old — read it as shape,
not as state.** Item 1 shipped (v2026.10.21, and four releases after it). **One row is new:**
`#1818` Phase 0, the deterministic half of the chart-structure feature, on the owner's direct
order. It slots in alongside items 2-4 rather than ahead of them, and it is one file of pure
functions, so it does not stop the reliability work.

1. **Release v2026.10.21** (#1654): the out-of-memory crash fix (sign-in tokens checked locally; #1657's lighter checks follow in the next release), the candle-cache and RSI fixes, the security limits, the image-optimizer advisory closed. QA passed it on 2026-10-21; it goes to production with the owner's approval (two database migrations and the label rows; no env change; payments stay off).
2. **AI correctness** (#1631): E+B+C with the nominal 10-year yield, then A+D (Deep citations, our own dated data).
3. **Exchange data never blocked** (#1649): phase 2 (Bybit stream), phase 3 (OKX + our own snapshots), phase 4 (Hyperliquid as third source); Dev's estimate for #1662 at a natural break.
4. **Core data** (owner rule), alongside: the guardrails (#1651; the PR template's data checklist is already in force, #1652), #1617 (one OI window), #1594 (daily health check), #1593 (alert quality).
5. **All coins** (#1600), after the server fixes, without more upstream calls per minute.
6. **Next.js / dependency bump** (Dependabot: 59 alerts at 2026-10-21 09:55 UTC; the critical image-optimizer ones are closed by #1655 in release v2026.10.21), next release.
7. **Payments go-live** (1, 2, W1-W3), when the owner is ready: his $1 test; the Whop variables set together on production; Supabase Pro the same day.
8. **Before any big marketing push** (6, 7): the three server fixes live, then re-measure CPU and upstream calls per page load, then the owner decides the Render tier with the number in hand.
9. Then 15 (cross-browser, QA), 12 close-out, the owner-visible queue (#1601, #1595, #1603), and the three visual fails from QA's 2026-10-21 regression (#1640: R6 `/learn` ignores the light theme, R7 `/hours` labels collide, R8 `/liq` stats grid squeezed) for the owner's look.

## Owner decisions, 2026-10-31 (first-hand to PM)

| What he decided | His words | What it changed |
|---|---|---|
| **The chart-drawing deep research is built on Claude, NOT Grok — subject to a head-to-head first.** | *"for deep research will do it"*, then *"yes, set up the head-to-head test"* after being told there is no provable reason Claude is better. | `#1818` gains a bake-off before any build: 12 committed candle windows, both engines return coordinates, scored by `lib/chartStructures.ts` rather than by eye. **Decision rule fixed before the run** — fewest fabrications on the structureless group wins; fit quality breaks a tie; cost breaks that; **a tie builds on Grok**, which is already wired and validated. |
| **The shipped deep analysis and Ask-AI search STAY on Grok.** | *"grok is better because it has access to X posts"* | Correct, and verified rather than accepted: `app/api/grok/route.ts:296-306` attaches `searchTools(xWindow)` when `type === 'deep'`, and `grok-chat` search mode does the same. **Claude cannot see X at all.** The split is by input, not by feature: *what people are saying* goes to Grok, *our own numbers* can go to Claude. |
| **The $100 Claude credit is part of his Max plan and refills.** | *"it's part of my Claude Max plan... I will have another one in next few days"* | Usable budget for the over-ceiling features. **Recorded with its risk: do not let a feature's economics depend on a promotional grant** — if it stops, the cost lands on him at full rate, so anything built on it must be switchable back. |

**What this decision exposed, and it is a live business fact rather than a note.** Production's own
AI call log says **three of six AI features already cost more per answer than his $0.0085 ceiling**:
deep analysis **$0.0238**, Ask-AI search **$0.0271**, quick read **$0.0117**. Macro, chat and dry
powder are under. Total ever spent is $0.59 — **that is low traffic, not low unit cost.** Input size
is the driver: deep sends ~15,000 tokens in and gets ~1,400 back. **Prompt caching is OFF on the
Claude account**, so the first Claude figure the bake-off produces is an upper bound, not a running
cost.

**One owner action outstanding:** an Anthropic API key as an environment variable. **Neither PM nor
Dev handles it.** The Grok half of the bake-off runs without it.

**One naming hazard, cheap now and expensive later:** "deep analysis" already ships and means the
X-powered one; this proposal is also called "deep research". **Two buttons, different jobs, one
word.** Rename the new one before it ships.

## Owner decisions, 2026-10-30 (first-hand to PM)

| What he decided | His words | What it changed |
|---|---|---|
| **Start the deep-research chart-drawing feature.** Phase 0 only; phases 1-4 stay sequenced. | *"start it"* (13:19 UTC), after asking *"what happened to my proposal about deep research thing?"* | `#1818` moved from `priority: low` / not-scheduled to `priority: medium` / Phase 0 assigned. Dev writes `lib/chartStructures.ts` (pure functions, no UI, no AI, no network); QA writes the fixtures. Spec `docs/proposals/ai-chart-structures.md`. The `priority: high` reliability work (#1631, #1649, #1651) is NOT cancelled. |
| **Run CI only where it is needed.** | *"Keep only the real code, test, change, and release... The changes to documents and rechecking after each merge, skip it... run once before release."* | Docs-only PRs skip the full checks. `dev` merges stop re-running them; the merged head is built once before promotion. Rule: `docs/OWNER-RULES.md` section 12. |
| **Deploy the release without him IF the regression is flawless.** | Shown the risk in writing and chose it: *"Deploy it if testing is fully clean."* | **Any failure or any gap holds it until he wakes.** QA's sign-off becomes the deploy decision rather than an input to it. |
| **CI spend: the free $12, then up to $5 on his card, hard stop.** | *"save every penny on the GitHub run... Run when it's needed."* Two days consumed 80% of a month. | Docs-only PRs and per-merge rechecks stop running checks (#1848). Measured 8.5 min/run; 605 of the wasted minutes were browser tests that were all cancelled. |
| **Build a nightly database backup.** | Asked why it had not moved after raising it the day before. | **It was never blocked by funding.** 32 MB database, free export on the existing cron-authed pattern. Not done until a restore is proven. |
| **Ship as many coins as both exchanges carry.** | Second time of asking: *"coins availability should be done like days ago."* | Being built, not scoped. 50 today. |

## Open, PM recommendation only - he has NOT ruled

| What | His words | Where it stands |
|---|---|---|
| **Google AdSense** | *"can we have adsense also for our website?"* - he asked, PM recommended against it, **he has not answered.** Silence is not a decision. | Nothing built. **The traffic figure behind the recommendation was never measured** - real page views were not read, so "single-digit dollars a month" is an estimate, not a measurement. Reasons given: ads undercut a $49 product, leak visitors off the pricing page, put competitor and token ads beside our own signals, and the category is restricted by Google. |

**Every row in the table above is his, first-hand.** The AdSense item is NOT, which is why it now sits
in its own section below rather than in a table headed "What he decided" - QA's catch, and the
distinction matters: a recommendation filed among decisions closes a question he still holds.

## Not on this list, and that is deliberate

The UI audit (58 findings), the Arena audit leftovers, UI polish, the Russian
menu and the old design switch are all `priority: low` and parked. Built work
for them sits in open PRs, unmerged, until the owner grants a window.

---

## Supabase Pro — BACKLOG, owner 2026-10-29. Do not re-raise.

**His words: *"postpone it"*, then *"You put it on backlog and we'll work on it later."*** That is a
decision, not a deferral waiting for a nudge.

**What it would buy, so nobody has to reconstruct it:** daily backups of the subscriber and payment
records (there are none today, at all), leaked-password protection, and headroom on the dev
project's compute. **~$35/month** — $25 plan + $20 compute for two projects − $10 included credit.
The $25 figure that circulated is the plan fee alone and is wrong for this account.

**NO TRIGGER CONDITION IS ATTACHED, and that is deliberate.** The previous version of this item
carried one — *"Pro is bought the day Whop payments go live"* — which came true on 2026-10-28 and
**nothing noticed for two days**, so it surfaced as an unexplained $35 charge he had to be talked
through twice. A written condition does not fire. This returns when **he** raises it, or when
somebody reviews this file on purpose.

**The operational rule that stands in its place, and it is not optional:** no destructive migration
on production. No `drop`, no `alter ... type`, no data-rewriting backfill. Additive only — add a
column, add a table, add a policy — because that is reversible by dropping what was added. **With
no backups there is no other undo.**

**How to explain it if it ever comes up again:** lead with what breaks, never the vendor. "Supabase
Pro" means nothing at founder level; "your subscriber records cannot be recovered if something
corrupts them" does. He asked *"what the fuck is this $35 for"* twice because the first two
explanations named a company and a feature instead of a consequence.
