# Pricing & Per-User Cost Analysis

**Question being answered:** what does a user actually cost us in API spend, is
$15/mo Pro profitable, and where should the price / caps land?

> ✅ **DECIDED 2026-07-24.** Final: **Pro price $15 → $25/mo**, **Pro caps
> trimmed** (quick 50→40, deep 25→18, chat 100→75, search 25→18, briefing
> 10→8, one-shot tools 25→18 each) and **Free caps trimmed** (quick 7→5,
> deep 5→3, chat 15→10, search 5→3, briefing 3→2, tools 5→3 each). Both price
> and caps changed together after grounding the decision in real competitor
> pricing (crypto trading tools run $16-$50/mo entry-to-mid tier — $25 is
> solidly normal, not expensive) and the real xAI rate correction below.
> Implemented live: `lib/limits.ts`, `/upgrade` page, landing page (all 4
> locales), and the DB-backed checkout CTA label (5 locales, both Supabase
> projects). See §7 for the final numbers.
>
> The rate correction itself: the original version of this doc used labeled
> *estimates* ($3/M input, $15/M output). Those were replaced with the actual
> grok-4.3 rate card, confirmed live on console.x.ai/models and cross-checked
> against this account's real 7-day invoice. **The old output-token estimate
> was 6× too high** — this is what made the original "$29+ mandatory" framing
> wrong (see §0).

## 0. What changed

- **Real rate card** (console.x.ai/models, `grok-4.3`, confirmed live
  2026-07-24): Input **$1.25/1M**, Cached input **$0.20/1M**, Output
  **$2.50/1M**. Old assumptions were $3/M input (2.4× too high) and $15/M
  output (**6× too high**).
- **Cross-validated against this account's actual invoice** (console.x.ai
  Usage page, Jul 18–24, 100% grok-4.3, 233,756 tokens, $0.44 total):
  reasoning tokens billed at ~$2.51/M (matches the $2.50/M output rate),
  fresh prompt tokens at ~$1.17/M (matches $1.25/M input), cached prompt at
  <$0.27/M (consistent with $0.20/M cached rate). The real invoice confirms
  the rate card — high confidence, not a guess.
- **The old "$0.025/call search surcharge" doesn't match how xAI actually
  bills.** The real invoice has exactly 4 line items — reasoning / prompt /
  completion / cached-prompt tokens — no separate search or tool-call fee.
  Replaced with a token-based estimate instead (search-enabled calls assumed
  to carry more input + reasoning tokens from injected search results, not a
  flat fee). This estimate is still unverified at the token-count level (this
  account hasn't logged enough search-mode volume to isolate it) — flagged
  below.
- **Bottom line flips from "we're bleeding money" to "we're probably fine."**
  A fully cap-maxing Pro user is now estimated at ~$57/mo cost (was ~$291/mo)
  against $15 revenue — still a loss at 100% cap usage, but ~3.8× underwater,
  not ~19×. The urgent case for repricing to $29+ no longer holds; it's now
  an optional margin-safety choice, not a correction.
- **Separately found while pulling this data: the xAI account is at $0.00
  credit balance** ("no credits remaining") — live production impact, not a
  pricing question. Tracked in `pendings/PENDING.md`, not this doc.
- Sample size caveat: only 1,065 real requests total (2 active days before
  credits ran out), so real usage *patterns* are still thin. The **rate**
  correction is solid regardless (it's the published rate card, not a
  usage-derived guess) — only the "realistic vs. worst-case" usage mix is a
  small sample.

## 1. Rate inputs (REAL, confirmed 2026-07-24)

| Input | Real value | Source |
|-------|-----------|--------|
| grok-4.3 input tokens | **$1.25 / 1M** | console.x.ai/models, live |
| grok-4.3 cached input tokens | **$0.20 / 1M** | console.x.ai/models, live |
| grok-4.3 output tokens (incl. reasoning) | **$2.50 / 1M** | console.x.ai/models, live |
| avg input tokens per call | ~1,500 | unchanged (prompts embed trade history / candles) |
| avg output tokens per call | ~900 (capped 200–1500) | unchanged (route `max_tokens`) |
| search-mode extra tokens (deep/search) | ~+3,000 input / +500 output | **estimate** — injected search results, not a flat fee (see §0) |

**Derived per-call cost (real rates):**
- Plain AI call: (1,500 × $1.25/M) + (900 × $2.50/M) = **~$0.0041 ≈ $0.004/call**
- Search-enabled call (deep, search mode): (4,500 × $1.25/M) + (1,400 × $2.50/M) = **~$0.0091 ≈ $0.009/call**

Both roughly **4–5× cheaper** than the old estimates.

## 2. What the caps ALLOW per user per day (worst case = abuse case)

Caps from `lib/limits.ts` (`AI_LIMITS`, unchanged since last check). "Search" = deep + search modes.

| Tier | Plain calls/day | Search calls/day | Total/day | Cost/day (real) | Cost/30d (real) |
|------|-----------------|------------------|-----------|----------------|----------------|
| **Free** | ~65 | ~10 | **~75** | **~$0.35** | **~$10.50** |
| **Pro** | ~360 | ~50 | **~410** | **~$1.89** | **~$56.70** |

Free = quick 7 + chat 15 + briefing 3 + 8 one-shot tools×5 (40) + deep 5 + search 5.
Pro = quick 50 + chat 100 + briefing 10 + 8 tools×25 (200) + deep 25 + search 25.

**The revised problem in one line:** a Pro user who maxes the caps costs an
estimated **~$57/mo** to serve for **$15** revenue — still underwater at 100%
cap usage, but a real gap, not a crisis. A Free/trial user who maxes the caps
costs an estimated **~$10.50/mo** for **$0** revenue — noticeably more
tolerable than the earlier $54/mo figure.

## 3. Breakeven math for $15/mo Pro

Blended cost/call for the Pro mix ≈ $56.70 / 410 calls/day / 30 ≈ **$0.0046/call**.
**$15 / $0.0046 ≈ 3,260 calls/month ≈ ~109 calls/day** to break even.

- Breakeven at $15 ≈ 109 calls/day (was ~17/day under the old estimate).
- Pro cap ≈ 410 calls/day → **~3.8× breakeven headroom** for a single maxed-out
  account (was 24×).
- A realistic Pro user — nowhere near maxing every cap every day — is very
  likely profitable at $15. Only a genuine cap-maxing power user (or an
  abuser) crosses into loss, and by a bounded, much smaller margin than
  previously estimated.

## 4. The two distinct threats (both still real, smaller magnitude)

1. **Abuse / bots (your stated #1 — unchanged priority).** Free + trial
   accounts have caps sized for a paying product but earn $0. 500 farmed free
   accounts × 75 calls/day × ~$0.0047 blended ≈ **~$176/day** at the real rate
   (was ~$900/day estimated) — still real, uncapped-fleet money. Defenses in
   place: per-user caps, the **global circuit breaker** (`AI_GLOBAL_DAILY_MAX`
   — still needs a number, see §5A), trial email-dedup, and **Turnstile
   CAPTCHA is now live on prod** (closed since this doc was first written).
2. **Legit-user margin.** Much less urgent now. A genuinely engaged Pro user
   who doesn't max every cap every day is likely profitable at $15; this is a
   margin-safety question, not a "we're losing money today" problem.

## 5. Recommendations (revised ranking)

**A. Set the global circuit breaker now — with the corrected multiplier.**
Using the real blended rate (~$0.005/call, rounding up for headroom), pick a
number tied to a daily $ budget:

| Daily $ budget you'll tolerate | Global calls/day cap |
|---|---|
| $10/day | ~2,000 |
| $15/day | ~3,000 |
| $30/day | ~6,000 |

Any of these is a reasonable starting hard ceiling — pick by how much daily
xAI spend you're comfortable eating while things scale, then set
`AI_GLOBAL_DAILY_MAX` in Render (prod, and dev if you want it enforced there
too).

**B. Free-tier caps — trim is optional, not urgent.** At ~$10.50/mo worst-case
cost for a $0-revenue account, this is tolerable, not alarming. Still worth a
modest trim given free/trial earns nothing (e.g. halve the one-shot tool caps
from 5→2–3 each), but the "drop to 5–8 calls/day total" recommendation from
the old estimate is no longer necessary.

**C. Pro price — $15 is now a defensible choice, not clearly too low.**
Two honest options, no longer a hard "must reprice":
- **Keep $15/mo.** Worst-case a maxed-out account costs you ~$57/mo (bounded
  further by the per-user cap and the global circuit breaker) — a real but
  contained tail risk, and realistic usage is profitable.
- **Bump to ~$19–22/mo** if you want the cap-maxing worst case fully covered
  with margin, without the drastic $29+ jump the old numbers implied.
- The urgent case for $29–49/mo is gone — that recommendation was built on a
  6×-too-high output rate.

**D. Trial already uses the tighter FREE caps** (unchanged — trial grants Pro
FEATURES but Free AI caps per `entitlements.ts`). Worst-case trial cost is now
~$10.50 for the 14-day window's daily-cap ceiling, down from the old ~$25
estimate — farming a trial is even less attractive than previously thought,
on top of Turnstile now gating signup.

**E. Build the live per-user $ cost view** (next code task, unchanged
recommendation). Store `$1.25 / $0.20 / $2.50` per 1M input/cached/output
tokens in a small config — real constants now, not placeholders — compute $
from the existing `lhq_grok_usage` counts, and surface on `/ops`: per-user $
(24h/7d/30d), a sortable "top spenders," each user's **$ cost vs $ revenue
(margin)**, and a global daily $ total with a spike alert.

## 6. Bottom line

- **Are we profitable at $15?** Much closer than the original estimate
  suggested. Realistic (non-maxing) usage: likely yes. Worst-case cap-maxing:
  still a loss (~$57 cost vs $15 revenue, ~3.8×) but a contained, bounded tail
  risk rather than a crisis — and it's already bounded further by the
  per-user cap and the global circuit breaker once `AI_GLOBAL_DAILY_MAX` is set.
- **Is $15 too low?** Debatable, not clearly yes anymore. Reasonable to keep
  $15 and lean on the caps/circuit breaker, or bump modestly to ~$19–22/mo for
  extra margin. The old $29+ recommendation was an artifact of a 6×-too-high
  rate assumption, not a real structural finding.
- **Next actions:** (1) set `AI_GLOBAL_DAILY_MAX` using the corrected
  multiplier in §5A, (2) CAPTCHA — already live, closed, (3) build the live $
  cost view (§5E) once you want it, using the real constants above.

## 7. Final decision & implementation (2026-07-24)

Sections 2-6 above are the analysis trail that led here — left intact for the
reasoning, but the numbers below are what actually shipped.

- **`AI_GLOBAL_DAILY_MAX = 2,000`** — set on both Render services (prod +
  dev). Chosen from the $10/day-budget row in §5A.
- **Pro price: $15 → $25/mo.** Landed here after checking real competitor
  pricing (3Commas/TradeSanta/altFINS $18-20, Bitsgap $23, Coinrule/TradeZella
  ~$29-30) — $25 sits naturally in the middle of that band, not expensive for
  this market.
- **Pro caps trimmed** (`lib/limits.ts`): quick 50→40, deep 25→18, chat
  100→75, search 25→18, briefing 10→8, one-shot tools (thesisCheck /
  strategyResearch / shadowAccount / behavioralBias / pineScript /
  hypothesisAnalyze / tokenUnlock / smcSnapshot) 25→18 each.
- **Free caps trimmed** (`lib/limits.ts`): quick 7→5, deep 5→3, chat 15→10,
  search 5→3, briefing 3→2, one-shot tools 5→3 each.

**Recomputed worst-case cost with the final numbers (real rates from §1):**

| Tier | Plain calls/day | Search calls/day | Total/day | Cost/day | Cost/30d |
|------|-----------------|------------------|-----------|----------|----------|
| Free | 41 | 6 | 47 | ~$0.22 | **~$6.54** |
| Pro | 267 | 36 | 303 | ~$1.39 | **~$41.76** |

- Pro worst-case: **~$41.76/mo cost vs $25/mo revenue ≈ 1.67× underwater** at
  100% cap-maxing — down from the original 19× (wrong rate) and the
  intermediate 3.8× (right rate, old caps, old price). This is the best
  margin position reached across the whole analysis, combining the rate
  correction, the price move, and the cap trim.
- Breakeven at $25: blended rate ≈ $0.0046/call → ~182 calls/day to break
  even, vs the new 303/day Pro cap → ~1.67× headroom for a maxed account.
  Realistic (non-maxing) usage is comfortably profitable.
- Free worst-case drops from the original ~$54/mo estimate to **~$6.54/mo**
  for $0 revenue — a taster tier again, not a workhorse.

**Implemented in:** `lib/limits.ts` (caps), `app/upgrade/page.tsx` +
`components/LandingContent.tsx` (price literals), `lib/i18n/dictionaries.ts`
(landing-page copy, all 4 locales: en/ko/zh/ar — both price and the hand-typed
cap numbers in the feature lists), Supabase `lhq_labels` + `lhq_dev_labels`
(`UPGRADE_CHECKOUT_BUTTON_CTA`, 5 locales incl. ru), `lib/labelDefaults.en.json`
(regenerated). The `/upgrade` page's own feature-list numbers (quick/deep/
chat/search) are template-driven from `lib/limits.ts` and needed no separate
edit.

**Not yet done — external, when payments go live:** the LemonSqueezy
product/variant's actual charge price still needs to be set to $25 in
LemonSqueezy's dashboard (not this repo) once `NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL`
is configured and checkout goes live — tracked in `pendings/PENDING.md` under
the payment-feature-deferred section.
