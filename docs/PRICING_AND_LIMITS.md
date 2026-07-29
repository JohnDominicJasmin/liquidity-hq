# Pricing, limits, trial and free tier

How Free / Trial / Pro are decided, what each one gets, and which file owns
each rule. Written 2026-08-07 after an audit found the pricing page and the
API disagreeing about what Free includes.

Read this before changing any number in `lib/limits.ts` or adding a paywall.

---

## 1. There are TWO independent mechanisms. Confusing them causes real bugs.

| | Question it answers | Where it lives | Failure if wrong |
|---|---|---|---|
| **Feature gate** | May this account touch the feature at all? | `hasProFeatures()` in `lib/entitlements.ts`, called per route | Paid feature given away, or a paying user locked out |
| **Usage limit** | How many times per day, once allowed? | `AI_LIMITS[tier]` in `lib/limits.ts` | Overspend at xAI, or a user blocked early |

The gate is the paywall. **The limit is not a paywall.** A limit of 0 is not a
way to deny access - it produces "Daily limit of 0 reached" after the user has
already been let in, which reads as a bug, not as an upsell.

## 2. Three tiers, and how each is determined

`role` is the PAID role, stored in `lhq_user_subscriptions.role`. It is only
ever `free` or `pro`. **A trial user's role is `free`.**

| Tier | Condition | Type |
|---|---|---|
| `free` | not paid, no active trial | `UsageTier` |
| `trial` | `trial_ends_at` in the future, not paid | `UsageTier` |
| `pro` | `role = 'pro'` | `UsageTier` and `Tier` |

- `Tier` = the paid role. Use it for "have they paid us" - `/upgrade` copy, billing.
- `UsageTier` = what a request bills against. Use it for **every limit lookup**.
- `getUserRole()` returns `Tier`. `getUsageTier()` returns `UsageTier`.
- Client side: `useAuth()` exposes `isPro`, `isTrial`, and
  `entitled = isPro || isTrial`. **`entitled` matches the server's
  `proFeatures` exactly** - that equivalence is what keeps lock cards honest.

### Trial rule: Pro tools, Free core spend

A trial gets Pro **feature access** but Free-tier **core AI volume**
(quick / deep / chat / search / briefing). It has its own tool pool, set below
Pro's, so upgrading still buys something.

## 3. What each tier gets

### AI volume (`lib/limits.ts`)

| | Free | Trial | Pro |
|---|---|---|---|
| Quick analysis | 5 | 5 | 30 |
| Deep analysis | 3 | 3 | 10 |
| AI chat | 5 | 5 | 50 |
| Chat with search | 3 | 3 | 10 |
| Daily briefing | 2 | 2 | 4 |
| Tool pool (shared across all 11 tools) | none | **8** | **25** |
| Each individual tool | **0** | 8 | 25 |

Free's per-tool `0` is deliberate defence in depth. Free never reaches it - the
route gate stops the request first - but if a gate ever regresses, the cap
still refuses the spend.

The pool exists so 11 per-tool caps don't multiply out. Per-tool caps equal the
pool on purpose for Trial and Pro: the pool binds, so a user can spend the whole
budget on the one tool they care about instead of being forced to sample.

### Feature access

| Feature | Free | Trial | Pro | Enforced by |
|---|---|---|---|---|
| All 11 one-shot AI tools | No | Yes | Yes | `hasProFeatures` in each route, 403 `PRO_REQUIRED` |
| Fast timeframes (1m/5m/15m) | No | Yes | Yes | `GATED_TFS` - **client-side only**, see §6 |
| Backtesting | No | Yes | Yes | `/backtest` paywall |
| Telegram + push alerts | No | Yes | Yes | `hasProFeatures` |
| Creating price alerts | No | Yes | Yes | `hasProFeatures` on POST only - see §6 |
| Dashboard, news, scanner, charts, briefing, quick/deep, chat | Yes | Yes | Yes | - |

**The 11 tools** are: thesis-check, strategy-research, shadow-account,
behavioral-bias, pine-script, hypotheses/[id]/analyze, token-unlock,
smc-snapshot, dry-powder, macro-context, onchain.

## 4. Single source of truth for each rule

| Rule | Owner | Notes |
|---|---|---|
| Daily AI numbers | `lib/limits.ts` `AI_LIMITS` | `/upgrade` derives its numbers from here, so pricing copy cannot drift from the API |
| Who is entitled (server) | `lib/entitlements.ts` | `getEntitlement` is the only place `trial_ends_at` is read |
| Who is entitled (client) | `components/AuthProvider.tsx` | `entitled = isPro \|\| isTrial` |
| Gated timeframes | `lib/limits.ts` `GATED_TFS` | |
| Pricing page contents | `app/upgrade/page.tsx` | Has a comment listing every gate it must stay in sync with |
| Lock card UI | `LockedFeatureCard` in `components/UpgradeGateModal.tsx` | |

**Localised landing copy (`lib/i18n/dictionaries.ts`, ko/zh/ar) embeds these
numbers inside translated sentences and must be updated by hand.** The English
`/upgrade` page is derived, so the primary pricing surface never drifts, but the
translations can.

## 5. Invariants - break these and something silently misbehaves

1. **Any limit lookup uses `getUsageTier()`, never `getUserRole()`.** Passing a
   role bills a trial user against the free row. That is what made the free
   numbers secretly mean "trial" for months.
2. **A tier that can reach a feature must have a non-zero limit for it.**
   Gate and limit have to agree in the same direction.
3. **A tier that cannot reach a feature should show no usage ring for it.**
   `UsageRings` hides any ring whose limit is 0 - which is why Trial having
   `toolPool: null` meant trial users had tools but no counter for them.
4. **`entitled` (client) must equal `proFeatures` (server).** If they diverge, a
   user sees a lock card for something they can use, or a button that 403s.
5. **Every Pro feature is enforced server-side.** A client-side hide is not a
   paywall - the API is callable directly with any account's token.
6. **Trial users must pass every Pro gate.** Gating on `role !== 'pro'` instead
   of `hasProFeatures` locks out exactly the people evaluating the product.

## 6. Known gaps, deliberately open

- **Fast timeframes are client-side only.** `GATED_TFS` appears in no API route.
  Candles come straight from Binance in the browser, so there is no server call
  to gate. Editing state in devtools unlocks 1m/5m/15m. Revenue leak, but no
  server cost. Fixing it means proxying candles through an authenticated route.
- **Price alerts gate POST only.** GET, PATCH and DELETE are ungated, so a free
  account can read and modify existing alert rows.
- **LemonSqueezy webhook trusts client-supplied `user_id`.** `custom_data.user_id`
  is written into a client-side checkout URL, so a payer can name any account to
  receive Pro. Harmless while payments are off. **Hard gate on payment launch** -
  cross-check `attrs.user_email` and dedup on event ID before a dollar moves.
- **Leaked-password protection is unavailable.** Supabase Pro plan only. Free
  plan compensates with minimum length 12 and letters-plus-digits required.

## 7. History - why this document exists

`/upgrade` sold the AI tool pool as a Pro feature from the start, but only 6 of
the 11 tool routes enforced it. A free account could run the other 5. Closing
that exposed the deeper problem: Free and Trial shared one limits row, so
"free" and "trial" were the same numbers with different access. Zeroing Free to
match the paywall would have let trials through the gate and then blocked every
tool at 0.

Splitting `UsageTier` into three rows fixed both, and also fixed two things
nobody had noticed: a trial was getting 22 unpooled tool calls a day against a
paying user's 25 pooled, and saw no usage ring for any of it.

The lesson worth keeping: **the gate and the limit are different questions, and
a tier is not the same thing as a role.**
