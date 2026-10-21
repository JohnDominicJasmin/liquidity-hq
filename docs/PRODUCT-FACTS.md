# LiquidityHQ product facts (read before answering anything about the product, payments or copy)

Owner rule, 2026-10-10: **when new information lands, it goes into the docs, not only into a chat or an agent's memory.** Any agent (Claude, Codex, a new session) must be able to start from this file. Update it in the same PR as the change.

Last verified: 2026-10-10; prices, payments state, environments and permissions re-checked 2026-10-21. Items marked **(unverified)** came from a chat model or a summary, not from a primary source. **Sections are dated, and when two disagree the later decision wins.** Payments: **Whop only since 2026-10-17**; the 2026-10-10 sections on MoonPay, BoomFi and "all three gateways" are history.

## What the product is
- liquidity-hq.com: a subscription web app for crypto traders. Charts, EMA-based BUY/SELL signal markers (EMA9/20 cross confirmed by EMA50), confluence score, market data (open interest, funding, order flow), AI-written analysis, Telegram and price alerts for Pro.
- It does **not** execute trades, hold or move customer funds, manage money, or give personal advice. A risk disclaimer is on every page.
- State this plainly in every payment-provider application. Do not describe it as only a "charting utility": the BUY/SELL markers exist.

## Audience: worldwide
- Buyers are anywhere: Malaysia, Netherlands, UK, Japan, Australia, US, EU and the rest. The owner lives in the Philippines. That does **not** make this a Filipino product.
- Never propose a country-specific gateway or wallet (GCash, Maya, PayMongo, Xendit). Gateway candidates must accept buyers from most countries.

## Plans and prices (owner final, 2026-10-08)
- $49 monthly, $490 annual ("2 months free"), $20 every 2 weeks. Free tier.
- Signal gate (`lib/signalCoinGate.ts`; trial split from paid on 2026-10-20, #1596): signed-out BTC only; **Free and free trial** BTC/ETH/SOL (Free signals on 30m and slower only, `lib/limits.ts`); **paid Pro** every coin. A trial gets other Pro features but not the coin ladder; trial alerts are BTC/ETH/SOL only too (owner, 2026-10-21 04:43 UTC, #1630).
- Checked 2026-10-21: the English defaults on `dev` (`lib/labelDefaults.en.json`: `UPGRADE_PRICE_*`, `UPGRADE_CHECKOUT_BUTTON_CTA`, `FAQ_Q_PRO_PRICE_A`) and production's `lhq_labels` (en) both say $49/$490/$20; no $35/$350 is left in either. `docs/PRICING_AND_LIMITS.md` carries no dollar prices.

## Contact
- support@liquidity-hq.com (mailbox active). Shown in the footer, /contact, /terms, /privacy, /about. Label text lives in `lib/labelDefaults.en.json` and the prod table `lhq_labels` (dev: `lhq_dev_labels`).
- The Refund Policy link and page were removed 2026-10-08 (`/refund` redirects to `/terms`). **It must return before real charges**; processors expect it. Since the owner's 2026-10-17 ruling (all sales final, below), the refund rules go in the Terms billing section, whose wording the owner approved on 2026-10-21 (#1633).

## Payments: where we are
Payments are OFF on prod (`isProBuyable` false; /upgrade says "launching soon"). **2026-10-21:** production has no Whop variables at all (names read on Render ~14:17 UTC), so nothing can be bought or granted there; release v2026.10.21 ships the Whop code switched off. Go-live sets the three checkout links, `WHOP_WEBHOOK_SECRET`, `WHOP_COMPANY_ID` and the plan ids together, never the links alone (#1567), and Supabase Pro is bought the same day (owner, 2026-10-21).

Rejected or banned for our category (primary sources):
- Lemon Squeezy (store application rejected). Polar.sh (form said crypto trading signals tools not allowed, 2026-10-07). Paddle (its list names "trading signals and strategies").
- Stripe does not support Philippines sellers (stripe.com/global country list). A company in a supported country would be needed.
- Do not reword the product to dodge a review. Describe it exactly.

Candidates as of 2026-10-10 (none confirmed to approve us). **Superseded by the 2026-10-17 decision, Whop only (below); kept as history.** The Whop details here are the 2026-10-10 state: the webhook route has since been built (#1567) and its secret set on qa (2026-10-19/20 section).
- **Crypto:** BoomFi (webhook is a recording shell; the unlock is on qa behind `isProBuyable`, verified only on a stand-in DB; BoomFi publishes no sample payloads; its "regulated services unavailable" list includes UK, Malaysia, Netherlands, Quebec, NY/AK/LA, China, Russia and about 30 others, unconfirmed whether it applies to us). MoonPay Commerce (ex-Helio): low complaint volume per Google AI Mode (unverified); not a merchant of record.
- **Fiat (cards, bank):** Whop is the only workable one found. Business "Liquidity-hq" created 2026-10-10; product "LiquidityHQ Pro" CREATED 2026-10-10 with three plans: $49 monthly, $490 yearly, $20 every 14 days (page https://whop.com/liquidity-hq/liquidityhq-pro; payouts active; product review and reserves unknown until first sales). Webhook and API key not yet created (owner creates them after Dev builds the route, issue 1567). Whop is limited merchant of record; reserves up to 100% for up to 180 days; dispute rate under 1 to 2%; payout identity verification COMPLETE 2026-10-10 (Whop email: payout account active). This is NOT a product approval; Whop can still hold funds or set reserves on first sales.
- Avoid, per community reports (unverified): Dodo Payments, PayPro Global, FastSpring, Cryptomus, Sellix card rails, CoinGate (mixed).

## Environments
- Flow: dev -> qa -> staging -> main. Render autoDeploy is off. Prod live: read `https://liquidity-hq.com/api/version`, never this line. On 2026-10-21 it served `b999f8c` (tag `v2026.10.17`); release v2026.10.21 was waiting for the owner's approval (#1654).
- Render workspace tea-d6e4ecv5r7bs73be1t10: prod srv-d8aluf6l51nc73e1ijp0, qa srv-d9p42ke1egvs73f8car0, staging srv-d9qskniju40c73brtqgg.
- Supabase: prod qdpwhnvmhqgzijuwopso, dev wdtjhrilakoitfcezxpx. Staging uses the dev database.

## Permission blocks agents hit
- Allow rules for `gh pr merge`, the GitHub merges API, Render `trigger_deploy` and Supabase `execute_sql` are saved in the owner's `~/.claude/settings.json` (since 2026-10-17; re-read 2026-10-21). They stop the tool prompt only: **the owner's approval is still required for every production release and every shared-database write.** Never ask the owner to type a merge command. Account creation, ID/bank entry, accepting terms and setting prices on third-party merchant accounts are owner clicks.

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

## Payment requirements (owner, 2026-10-10) - the only two ways
1. **Fiat:** credit or debit card, or money from a bank. Provider: Whop (cards and bank methods).
2. **Crypto:** the user pays from their own exchange balance (Bybit, Binance) by sending USDT/USDC to our payment address. (Providers below superseded 2026-10-17: Whop only; Whop's checkout lists crypto, not yet seen in a real checkout.) Provider: MoonPay Commerce first (card + exchange-balance crypto, about 150 countries), BoomFi second (blocks UK, Malaysia, Netherlands and about 30 more regions per its docs; unconfirmed whether that applies to us). Order changed by owner argument 2026-10-10.
- Payments sent from an exchange balance cannot auto-renew; the buyer sends each period by hand, so the app sends a renewal reminder.
- Not wanted: card-to-crypto conversion widgets as a separate path, anything country-specific.
- Builds: Whop webhook/unlock = issue #1567; BoomFi unlock = #1555/#1565.

## SUPERSEDED 2026-10-17 by "Whop only" (below). Was: DECISION (owner, 2026-10-10): use ALL THREE gateways: Whop, MoonPay Commerce, BoomFi
- Supersedes the earlier "only two" decision below. BoomFi: NO more verification, go straight to testing (owner, 2026-10-10). Test = owner makes a BoomFi test checkout link, pays it, the webhook payload is captured, then the qa unlock (#1555/#1565) is checked against that real payload.
- **/upgrade UI (owner, 2026-10-10): three separate buttons: "Pay with Whop", "Pay with MoonPay", "Pay with BoomFi".** Each links to that gateway's checkout per plan; all gated by `isProBuyable`.
- **MoonPay Commerce set up 2026-10-10:** profile + Sumsub business questions done (owner did the ID steps). THREE Pay Links created and priced in USDT (owner choice 2026-10-10; payout still USDC on Solana whatever the price currency): $49 "LiquidityHQ Pro - 1 month" https://moonpay.hel.io/pay/6ac9ee570cbeb77c21017692 ; $490 "LiquidityHQ Pro - 1 year" https://moonpay.hel.io/pay/6ac9eec20554bcf324b322ba ; $20 "LiquidityHQ Pro - 2 weeks" https://moonpay.hel.io/pay/6ac9efb0bce217626d54d694 (IDs taken from the dashboard edit URLs; open each once to confirm the public page loads before putting them in code). Not yet tested with a real payment. Payout wallet = the account's own MoonPay "Main Wallet" (Solana 4mjq2W..MaMRt, Settings > Wallets, has Send/Receive; owner confirmed 2026-10-10 it is MoonPay's wallet, not an external one). Whether MoonPay or the owner holds the keys is UNVERIFIED. Before real sales: use "Add Payout Wallet" to point payouts at a wallet or exchange deposit address the owner controls; test Send out of Main Wallet with the first test payment. "Pay with Card" is greyed out until MoonPay is connected (owner step). CARD: "Pay with Card" on a Pay Link is greyed out until MoonPay is connected. Verified on screen: Settings > Integrations > MoonPay ("Accept deposits via more payment methods", link https://dashboard.moonpay.com/signup) needs an Enable toggle plus MoonPay API Key, Secret Key and Webhook Secret from a SEPARATE MoonPay (moonpay.com) business account. Owner creates that account and sets keys himself (never in chat); Onramper is the other listed option (subscription fee). CARD VIA MOONPAY IS BLOCKED FOR AN INDIVIDUAL (verified 2026-10-10 on screen): dashboard.moonpay.com "Start review" questionnaire step 1 (/get-started/questionnaire/legal-name) says "Only registered companies can apply. Not registered yet? Save and exit, and come back once it is." (tickbox "My company is a registered legal entity"). Do not tick it or invent a company name. Card stays on Whop; MoonPay is crypto-only unless the owner registers a business. No auto-renew: Pay Links are one-off, buyer re-pays each period.
- Earlier decision, now superseded: Whop (card, bank) and MoonPay Commerce (crypto, card) only.
- Still dropped and not to be shown again: Radom (unverified), CoinGate, NOWPayments, Cryptomus, Transak, Alchemy Pay, Ramp, Banxa and every other gateway discussed.
- Priority: card payment first (standard form: card holder name, number, MM/YY, CVC). Crypto from Bybit/Binance balances is second.
- Never present an unverified claim as an option. Verify first (official page or screenshot), then present.

## Review-trigger wording (owner order 2026-10-10)
Keep every page free of: guaranteed or promised returns, earnings claims, win-rate boasts, "risk-free", copy trading, auto-trading. Keep the disclaimers (footer risk disclosure, Disclaimer page "No Guarantees", Terms callout). Win Rate / Profit Factor / Signal Accuracy panels stay but are reworded and captioned as historical backtest, not a prediction (issue filed 2026-10-10).

## Radom verified OUT (2026-10-10, Google AI Mode reading of Radom's official hosted-checkout guide)
- Radom does NOT host a card form. Checkout is crypto only (QR code, wallet connect, manual transfer); fiat arrives only by bank transfer swapped to stablecoin. An earlier Google answer saying Radom takes cards was wrong. Do not list Radom.
- Radom, further verified 2026-10-10 (quotes from Radom's own footer/docs via Google AI Mode): services "not directed at, offered to, or intended for persons located or established in the EU/EEA, the United Kingdom, or the United States" - buyers in US/UK/EU are excluded, so it cannot serve a worldwide audience. Recurring needs the buyer's wallet approval. No signals ban listed. Philippines individual onboarding unverified.

## Working rule (owner, 2026-10-10): verify before presenting
If a claim is unverified, verify it in the background (official page or screenshot; Google AI Mode in the SAME thread, never a new thread) BEFORE telling the owner. Do not present unchecked results. Do not ask the owner to do verification manually.

## BoomFi card support, verified 2026-10-10 (quotes from BoomFi docs via Google AI Mode, same thread)
- Verified: BoomFi docs say "Dual payment options: Accept both fiat and cryptocurrency payments"; feature list "Banking rails: SEPA, FPS, Swift, ACH, Wire"; merchant can settle in crypto or fiat.
- NOT verified: the card form itself (never seen), card auto-renew (BoomFi recurring is wallet-based), and the card processor (Google says Stripe; docs only list "Stripe Billing" as an integration). If Stripe runs the card side, Stripe's rules (no Philippines sellers, signals wariness) may apply. (2026-10-10 wording, superseded twice: "all three gateways" the same day, then Whop only on 2026-10-17.)

## Three-gateway verification, 2026-10-10 (Google AI Mode in one thread; quotes from official pages where marked)
Owner decision at the time: use ALL THREE (superseded 2026-10-17: Whop only).
- **Whop:** card form stated in Whop docs (not seen on our own page; the owner's "Get access" is greyed because he owns the product, to be confirmed in a private window). Buyers blocked: sanctioned countries only. Philippines individual accepted; signals/analytics allowed under conditions; review triggers: first sale/withdrawal, $1k/$5k milestones, fraud scores, earnings-claim wording.
- **Whop card form SEEN 2026-10-10** (Whop dashboard checkout-link preview of the $20 plan): Card information (number, MM/YY, CVC) + billing details; also Google Pay, Apple Pay, DuitNow QR, iDEAL, Kakao Pay, MB WAY, Multibanco, Satispay, ACH. It is Whop's preview, not a live payment. Account side has no blocker; individual accepted (payout identity verified). Pending: webhook/API key/secret after the #1567 code, and public product page description + disclaimer (state unchecked).
- **Whop payment methods, Google AI Mode in the existing thread 2026-10-10 (quotes attributed to Whop docs, NOT opened by us; screen-verified: a "Crypto" payment method exists and is ticked in the Whop account's Checkout > Payment methods):** cards Visa/Mastercard/Discover/Amex/Maestro; Apple Pay, Google Pay, Cash App; PayPal (merchant setup); ACH, SEPA; iDEAL, Bancontact, Swish, MobilePay, Vipps. Crypto: BTC, ETH, SOL, USDC, USDT on Ethereum, Bitcoin, Solana, Base, Polygon, Arbitrum, Optimism (via Coinbase Commerce per Google, unverified); buyer can pay from a Binance/Bybit withdrawal (buyer must cover the withdrawal fee); crypto is ONE-TIME ONLY, no auto-renew, buyer re-pays each period; Whop converts crypto to USD at checkout. Only real test purchase settles it.
- **Why Whop needs no company, Google AI Mode in the existing thread 2026-10-10 (quotes attributed to Whop docs, NOT opened by us):** Whop is the merchant of record ("Whop acts as the merchant of record for transactions processed through Whop Payments"), so an individual can sell; MoonPay Commerce makes the seller the direct merchant, hence its company vetting. The SELLER stays liable for chargebacks plus fees. Whop collects and remits sales tax/VAT on digital products (income tax is still the seller's). Whop "reserves the right to request additional documentation, including official business registration" at volume thresholds or high-risk patterns; the threshold is not published (UNVERIFIED). Plan for a possible business registration later; it does not block the first customer.
- **MoonPay Commerce:** MoonPay's "Unsupported Countries" list (quoted via Google) includes Malaysia, Japan, India, China, Bangladesh, Pakistan, Morocco, Mali and others, in addition to sanctioned places. This conflicts with the earlier assumption that Malaysia and Japan are supported: card buyers there cannot use it. Philippines individual: UNVERIFIED (announcement says it serves "individual creators to enterprise-scale platforms"). Signals/analytics policy: UNVERIFIED (not documented in public text). No public card-form demo URL.
- **BoomFi:** Philippines individual: UNVERIFIED. Blocked-country list: only "services may not be available in all jurisdictions" quoted; the earlier-read list (UK, Malaysia, Netherlands, Quebec, NY/AK/LA, China, Russia, ~30 more) was a docs summary. Signals/analytics policy: UNVERIFIED. No public card-form demo. Card support stated in docs; auto-renew of cards and the processor (Stripe?) UNVERIFIED.
- The owner signed up to BoomFi (dashboard reached) on 2026-10-10.

## Whop account state, 2026-10-15 (read from the Whop dashboard unless marked; owner rule: new facts go in the docs)
- **Verification:** individual verification done. The red action "Provide source of wealth, proposed use of cards" (marked "Affects withdrawals") was submitted by the owner on 2026-10-11 and the banner is gone. Business verification is an optional "Get verified" button, not forced. Payouts Active; Whop Card and Bank deposits Inactive.
- **No business-documents requirement** on any settings tab read (Verifications, Risk, Payments, Checkout, Legal, Tax, Invoices). Whop's own threshold for asking stays unpublished (unverified).
- **Whop Card (Google AI Mode, unverified):** a virtual Visa card spending from the Whop balance; not required for payouts; Philippines availability unverified. The owner answered "no card planned".
- **Payout details are Google AI Mode only (unverified):** local bank account via Stripe Express is the main method; USDC/USDT, PayPal, Wise, GCash not native; fee about 3% (unconfirmed); minimum about $10; first payout held 7-14 days, then about 7-day rolling; no published monthly cap. Whether payouts can be withdrawn is proven only by a real test withdrawal (not done).
- **Settings seen:** max price $2,500 per checkout ("Request increase" exists); payment orchestration ON (0.8% fee per Whop's text); 3D Secure frictionless; Dispute Fighter available, off; "$25 / Save 20%" strikethrough on the $20 plan has no setting and looks auto-computed.
- **Legal tab:** Terms of Service, Privacy policy and Return policy PDFs uploaded by the owner; EULA left empty on purpose (a web app has no installed software; Google says Whop does not require any of the four, unverified). "Require terms and conditions acceptance" is ON.
- **PDFs** (clean, built from the live site text): `Documents\LiquidityHQ-Whop-Legal\` (Terms-of-Service, Privacy-Policy with "Whop (payments)" instead of "Lemon Squeezy", Return-Policy). Return policy = owner choice A: all sales final, cancel any time, access until the paid period ends, double-charge review, payment-provider note, support@liquidity-hq.com.
- **Site/PDF mismatch:** the live Privacy page still names Lemon Squeezy; `/refund` redirects to `/terms`; the footer still shows "Refund Policy". Tracked in issue #1571. (2026-10-21: no longer true; neither production's nor staging's footer links "Refund Policy", per QA.)
- **Product page:** headline "LiquidityHQ Pro: crypto market analytics" and a description with "Not financial advice" were added 2026-10-11 and saved.
- **Whop Websites migration job** (builds a Whop-hosted copy of liquidity-hq.com): started on its own, owner stopped it. Not needed; the app stays on Render.
- **Not done:** test purchase (the seller's "Get access" button is greyed out), test withdrawal, success redirect URL, statement descriptor, webhook/unlock (#1567). Settings tabs not read: Notifications, Analytics, Checkout branding, Open graph image, Home preferences, Partners, Authorized apps.
- **Chart idea:** Vela (github.com/LuxAlgo/Vela) could draw our BUY/SELL markers via its renderer-layer plugin; backlog item 18 and issue #1570.

## DECISION (owner, 2026-10-17, latest): WHOP FIRST AND ONLY WHOP for now
- Supersedes the "use all three gateways" decision of 2026-10-10. The owner asked: "let's have whop first and only only whop right now."
- **/upgrade shows one button only: "Pay with Whop".** No "Pay with MoonPay" and no "Pay with BoomFi" buttons for now. Both stay parked, not dropped: MoonPay Commerce (#1568: Pay Links exist, no code built) and BoomFi (the unlock code of #1555/#1565 is merged to qa behind the payments switch, never checked against a real BoomFi payload; do not ship a BoomFi button). Revisit after the first Whop customer.
- **Whop build = #1567**, in the project's usual safe order: Phase 1 records verified webhooks only (nothing granted, nothing revoked); Pro is granted only after a real recorded payload (the #1422 revoke-bug lesson). Needs from the owner, never in chat: a Whop API key and webhook secret set on Render, and his word for the database table migration (prod `lhq_` and dev `lhq_dev_`, one section at a time).
- **The owner cannot afford a real $20 test purchase right now.** A way to capture a real Whop payload without spending (for example a 100% promo code, UNVERIFIED whether it fires a payment webhook and whether it exercises the card form) is still to be checked with Google AI Mode in the existing thread; the owner must re-attach that tab. Until a real payload is recorded, no unlock.
- Whop account state is in the 2026-10-15 section above.

## Owner ruling, 2026-10-17: no refunds
All sales final (Return policy PDF uploaded to Whop; the /upgrade Whop panel says "All sales are final"). Once paid, service continues to period end; refund and dispute events never revoke Pro: they are recorded and flagged only. $0 / promo / hand-added Whop members get no Pro by default: they go to review and the owner decides case by case.

## Whop state, 2026-10-19/20 (verified by PM)
- Plan checkout links (each opened signed out, price confirmed): $49/month `https://whop.com/checkout/plan_5dwC4qy2nSoS9`; $490/year `https://whop.com/checkout/plan_VahzsWgFwGgnP`; $20 every 2 weeks `https://whop.com/checkout/plan_irN54MDYn9Otb`. Set on `liquidity-hq-qa` only (`NEXT_PUBLIC_WHOP_CHECKOUT_*`), with `WHOP_WEBHOOK_SECRET`; production unchanged, payments still off.
- Hidden TEST plan `plan_Lt14d8fRCCBIa` ($1/month, recurring, not on the store page) for one real payment to record the webhook body. Never a Pro plan; cancel the membership and archive the plan after the test.
- Whop shows "~~$25~~ $20 / 2 weeks, Save 20%" by itself (no compare-at price is set); it reads as a comparison with the $49 monthly plan. Owner: keep.
- Product cover: real Arena screenshot with a real Deep Research read. Business logo: the app icon (`public/icons/icon-512.png`).
- Whop Discover: submitted 2026-10-19 23:02 UTC; status "Pending review for Discover".
- The owner's own Whop account cannot buy its own product ("Get access" is disabled), so a test purchase needs another account.
