# Pricing & Per-User Cost Analysis

**Question being answered:** what does a user actually cost us in API spend, is
$15/mo Pro profitable, and where should the price / caps land?

> ⚠️ **Rate assumptions.** The xAI grok-4.3 token prices below are ESTIMATES,
> labeled as such. **Verify the real numbers on console.x.ai billing** and plug
> them into the "rate inputs" block — the formula and the structural conclusions
> (caps are far too loose for $15; free tier is pure cost; breakeven is ~17
> calls/day) hold regardless of the exact rate. This is a calculator, not a
> final invoice.

## 1. Rate inputs (VERIFY + edit these)

| Input | Assumed value | Where to confirm |
|-------|---------------|------------------|
| grok-4.3 input tokens | ~$3 / 1M | console.x.ai pricing |
| grok-4.3 output tokens | ~$15 / 1M | console.x.ai pricing |
| web_search + x_search surcharge (deep/search calls) | ~$0.025 / call | xAI live-search billing |
| avg input tokens per call | ~1,500 | (prompts embed trade history / candles) |
| avg output tokens per call | ~900 (capped 200–1500) | route `max_tokens` |

**Derived per-call cost (with the assumptions above):**
- Plain AI call: (1,500 × $3/M) + (900 × $15/M) = **~$0.018 ≈ $0.02/call**
- Search-enabled call (deep, search mode): $0.02 + $0.025 = **~$0.045 ≈ $0.05/call**

## 2. What the caps ALLOW per user per day (worst case = abuse case)

Caps from `lib/limits.ts` (`AI_LIMITS`). "Search" = deep + search modes.

| Tier | Plain calls/day | Search calls/day | Total/day | Cost/day (est) | Cost/30d (est) |
|------|-----------------|------------------|-----------|----------------|----------------|
| **Free** | ~65 | ~10 | **~75** | **~$1.80** | **~$54** |
| **Pro** | ~360 | ~50 | **~410** | **~$9.70** | **~$291** |

Free = quick 7 + chat 15 + briefing 3 + 8 one-shot tools×5 (40) + deep 5 + search 5.
Pro = quick 50 + chat 100 + briefing 10 + 8 tools×25 (200) + deep 25 + search 25.

**The problem in one line:** a Pro user who maxes the caps costs **~$291/mo** to
serve for **$15** revenue — ~19× underwater. A Free/trial user who maxes the caps
costs **~$54/mo** for **$0** revenue.

## 3. Breakeven math for $15/mo Pro

At ~$0.03 blended cost/call: **$15 / $0.03 = ~500 AI calls per MONTH** to break
even = **~17 calls/day**. The Pro cap allows **410/day** — i.e. a Pro user only
has to use **~4%** of their allowance to cost you the whole subscription; a
moderately heavy legit user already loses money.

- Breakeven at $15 ≈ 17 calls/day.
- Pro cap ≈ 410 calls/day → **24× breakeven headroom** for a single account.
- This is why the per-user cap alone doesn't protect margin — the cap is set for
  UX generosity, not unit economics.

## 4. The two distinct threats (both real)

1. **Abuse / bots (your stated #1).** Free + trial accounts have caps sized for
   a paying product but earn $0. 500 farmed free accounts × 75 calls =
   37,500 calls/day ≈ **$900/day** at the estimate. Defenses now in place:
   per-user caps, the **global circuit breaker** (`AI_GLOBAL_DAILY_MAX` — set
   it), trial email-dedup. Still needed: **CAPTCHA** (your dashboard action) +
   **much tighter FREE caps** (see §5).
2. **Legit-user margin.** Even with zero abuse, $15 doesn't cover a genuinely
   engaged Pro user under the current caps. This is a pricing + cap-sizing fix,
   not a security fix.

## 5. Recommendations (ranked)

**A. Set the global circuit breaker now.** `AI_GLOBAL_DAILY_MAX` in Render. Pick
a number tied to a daily $ budget you're willing to eat, e.g. if you'll tolerate
$20/day of xAI while you tune pricing: 20 / $0.03 ≈ **~650 calls/day** globally.
This is the hard ceiling on total damage regardless of account count.

**B. Cut FREE-tier caps hard.** Free should be a *taster*, not a workhorse.
Suggest dropping free to ~**5–8 total AI calls/day** (e.g. quick 2, deep 1,
chat 3, briefing 1, tools 1 each, search 1). That caps a free/trial account's
worst-case cost at ~**$0.20–0.40/day** (~$6–12/mo) instead of $54/mo.

**C. Reprice Pro, and/or size Pro caps to the price.** Two levers — use both:
- **Price:** at current caps, sustainable Pro is ~$29–49/mo, not $15. If the
  product's value supports it, **$29/mo** is the conservative floor; **$39–49**
  if usage skews heavy.
- **Caps:** if you want to keep a low headline price, cut Pro caps so max cost
  ≈ 40–50% of price. For $15 that means max ~**250 calls/mo** (~8/day), which is
  probably too tight for a real trader → supports raising the price instead.
- Recommended combo: **$29/mo Pro** + Pro caps roughly halved (quick 25, deep
  12, chat 50, search 12, briefing 5, tools ×12). Max cost then ≈ $4–5/day ≈
  $120–150/mo worst case, and realistic usage lands comfortably profitable.

**D. Trial should use the tighter FREE caps** (it already does — trial grants Pro
FEATURES but Free AI caps per `entitlements.ts`). After tightening free caps (B),
a 14-day trial's max cost drops from ~$25 to ~$3–6 — abuse-farming a trial stops
being worth it.

**E. Build the live per-user $ cost view** (next code task). Store the per-call
cost constants from §1 in a small config, compute $ from the existing
`lhq_grok_usage` counts, and surface on `/ops`: per-user $ (24h/7d/30d), a
sortable "top spenders," each user's **$ cost vs $ revenue (margin)**, and a
global daily $ total with a spike alert. Then this whole doc becomes a live
dashboard instead of a one-time estimate, and you can calibrate the real rate.

## 6. Bottom line

- **Are we profitable at $15?** Under the current caps, **no** — not for an
  engaged Pro user, and free/trial users are pure cost. You're likely negative
  on your heaviest (and most abusive) users, roughly breakeven-to-positive only
  on light Pro users.
- **Is $15 too low?** **Yes.** Recommend **$29/mo** as the floor, paired with
  tighter caps (§5C) and hard free-tier limits (§5B). Confirm the exact number
  after plugging your real xAI rate into §1 and reading the live cost view (§5E).
- **Next actions:** (1) set `AI_GLOBAL_DAILY_MAX`, (2) enable CAPTCHA, (3) tell
  me your real xAI rate so I finalize the numbers, (4) I build the cost view.
