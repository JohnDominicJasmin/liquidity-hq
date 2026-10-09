# LiquidityHQ product facts (read before answering anything about the product, payments or copy)

Owner rule, 2026-10-10: **when new information lands, it goes into the docs, not only into a chat or an agent's memory.** Any agent (Claude, Codex, a new session) must be able to start from this file. Update it in the same PR as the change.

Last verified: 2026-10-10. Items marked **(unverified)** came from a chat model or a summary, not from a primary source.

## What the product is
- liquidity-hq.com: a subscription web app for crypto traders. Charts, EMA-based BUY/SELL signal markers (EMA9/20 cross confirmed by EMA50), confluence score, market data (open interest, funding, order flow), AI-written analysis, Telegram and price alerts for Pro.
- It does **not** execute trades, hold or move customer funds, manage money, or give personal advice. A risk disclaimer is on every page.
- State this plainly in every payment-provider application. Do not describe it as only a "charting utility": the BUY/SELL markers exist.

## Audience: worldwide
- Buyers are anywhere: Malaysia, Netherlands, UK, Japan, Australia, US, EU and the rest. The owner lives in the Philippines. That does **not** make this a Filipino product.
- Never propose a country-specific gateway or wallet (GCash, Maya, PayMongo, Xendit). Gateway candidates must accept buyers from most countries.

## Plans and prices (owner final, 2026-10-08)
- $49 monthly, $490 annual ("2 months free"), $20 every 2 weeks. Free tier.
- Signal gate (`lib/signalCoinGate.ts`): signed-out BTC only; Free BTC/ETH/SOL (and signals only on 30m+); Pro and Trial all coins.
- `docs/PRICING_AND_LIMITS.md` may still show the old $35/$350; the code and prod labels are $49/$490/$20.

## Contact
- support@liquidity-hq.com (mailbox active). Shown in the footer, /contact, /terms, /privacy, /about. Label text lives in `lib/labelDefaults.en.json` and the prod table `lhq_labels` (dev: `lhq_dev_labels`).
- The Refund Policy link and page were removed 2026-10-08 (`/refund` redirects to `/terms`). **It must return before real charges**; processors expect it.

## Payments: where we are
Payments are OFF on prod (`isProBuyable` false; /upgrade says "launching soon").

Rejected or banned for our category (primary sources):
- Lemon Squeezy (store application rejected). Polar.sh (form said crypto trading signals tools not allowed, 2026-10-07). Paddle (its list names "trading signals and strategies").
- Stripe does not support Philippines sellers (stripe.com/global country list). A company in a supported country would be needed.
- Do not reword the product to dodge a review. Describe it exactly.

Candidates (none confirmed to approve us):
- **Crypto:** BoomFi (webhook is a recording shell; the unlock is on qa behind `isProBuyable`, verified only on a stand-in DB; BoomFi publishes no sample payloads; its "regulated services unavailable" list includes UK, Malaysia, Netherlands, Quebec, NY/AK/LA, China, Russia and about 30 others, unconfirmed whether it applies to us). MoonPay Commerce (ex-Helio): low complaint volume per Google AI Mode (unverified); not a merchant of record.
- **Fiat (cards, bank):** Whop is the only workable one found. Business "Liquidity-hq" created 2026-10-10; product "LiquidityHQ Pro" CREATED 2026-10-10 with three plans: $49 monthly, $490 yearly, $20 every 14 days (page https://whop.com/liquidity-hq/liquidityhq-pro; payouts active; product review and reserves unknown until first sales). Webhook and API key not yet created (owner creates them after Dev builds the route, issue 1567). Whop is limited merchant of record; reserves up to 100% for up to 180 days; dispute rate under 1 to 2%; payout identity verification COMPLETE 2026-10-10 (Whop email: payout account active). This is NOT a product approval; Whop can still hold funds or set reserves on first sales.
- Avoid, per community reports (unverified): Dodo Payments, PayPro Global, FastSpring, Cryptomus, Sellix card rails, CoinGate (mixed).

## Environments
- Flow: dev -> qa -> staging -> main. Render autoDeploy is off. Prod live: main d3659f1 (tag v2026.10.08).
- Render workspace tea-d6e4ecv5r7bs73be1t10: prod srv-d8aluf6l51nc73e1ijp0, qa srv-d9p42ke1egvs73f8car0, staging srv-d9qskniju40c73brtqgg.
- Supabase: prod qdpwhnvmhqgzijuwopso, dev wdtjhrilakoitfcezxpx. Staging uses the dev database.

## Permission blocks agents hit
- The harness blocks merges to staging/main and Render prod deploys, even with chat approval. The owner runs `! gh pr merge <n> --merge` or adds allow rules. Account creation, ID/bank entry, accepting terms and setting prices on third-party merchant accounts are owner clicks.

## Before answering a question
1. Grep the whole repo, not one folder. 2. Read this file, `docs/HANDOVER.md`, `docs/INFRASTRUCTURE.md`, `docs/OWNER-BACKLOG.md`. 3. Say which source answered. 4. Label any outside claim unverified.

## How the owner wants agents to work (owner order, 2026-10-10)
- **Basic things: decide and do. Do not ask, do not wait for a command.** Examples: reading code and docs, research, drafting copy, writing docs, filing issues, small narrow fixes, commits on a branch, status checks, form steps that are not irreversible.
- **Hard things: ask first.** Merging to main, production deploys, writes to a shared database, spending money, deleting or irreversible actions, anything the owner has not seen that he will see (visuals), account creation, ID/bank entry and accepting terms on third-party accounts.
- **Add everything new to the docs in the same step.** Files in this repo are writable; use them. A fact that exists only in a chat is lost.
- Replies: short, in English, like a message to a colleague. No essays, no re-explaining what was decided.

## Cash-out plan (owner, 2026-10-10)
- Crypto route (BoomFi / MoonPay Commerce): payouts arrive as USDC/USDT in the owner's own wallet. The owner has a personal contact who converts USDT to cash, so a Philippine bank is not on the critical path for crypto sales.
- Whop pays out to a bank or other payout method, not USDT; the cash-out contact does not apply to Whop.
- Keep a record of each conversion (date, amount, rate, counterparty) for BIR income reporting and any source-of-funds question. Income is taxable however it is cashed out; ask an accountant (not legal or tax advice).

## MoonPay Commerce card checkout (Google AI Mode reading of MoonPay help pages, 2026-10-10, unverified by us)
- Buyer pays by card; MoonPay converts to USDC and sends it to the merchant wallet. Merchant never receives fiat.
- Cards: Visa, Mastercard, Maestro (global); Discover US only; Amex and prepaid not confirmed; Apple Pay, Google Pay; PayPal in US/UK/some EU; SEPA, UK Faster Payments, Pix, Interac by region.
- Buyers need an email account and MoonPay KYC on card orders (name, DOB, address, phone, government ID + selfie). Expect drop-off on small subscriptions.
- About 150-160 card countries; 45+ blocked (China, Russia, Iran, Ukraine, ...). UK card checkout restricted. Fees: merchant 2% (trading analytics cannot get the 1% tier), card buyer up to 4.5% (min $3.99). Not a merchant of record: we handle VAT.
- Google's own odds estimate for MoonPay Commerce approving us: 50-60%; BoomFi 85-90%; Whop normal payouts 30-40%. These are a chat model's guesses, not data.
