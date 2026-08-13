# Which API routes scale with users, and which do not

**Owner: QA. Measured 2026-08-09 against `dev`.** This is an audit, not a change.
Every route below is app code — dev writes the fix, QA measured the scope.

## The question this answers

> We are using free APIs. If we have a thousand users we make a thousand times
> the calls. Why not fetch on the backend once and serve that to everyone?

**That pattern already exists here — it is just applied to 6 routes out of 37.**

`/api/market/snapshot` sends `Cache-Control: public, s-maxage=60,
stale-while-revalidate=600`. Upstream cost is a function of TIME, not of user
count: one call per minute serves one user or ten thousand.

`/api/funding` sends no cache header at all. Every page load that touches it goes
out to Binance and Bybit again.

So this is not an architecture change. It is a header, applied consistently, and
a decision per route about how stale is acceptable.

---

## Measured

```
routes under app/api        68
call a third party          37
have any cache policy        6
```

**Six of thirty-seven.**

### The six that already do it

| Route | Policy | Upstream |
|---|---|---|
| `/market/snapshot` | `s-maxage=60, swr=600` | Binance, CMC |
| `/market/rsi` | `s-maxage=60, swr=600` | Binance |
| `/macro` | `s-maxage=300, swr=600` | Yahoo, er-api |
| `/econ-calendar` | `s-maxage=3600, swr=7200` | ForexFactory, Fed |
| `/ath` | `s-maxage=3600, swr=86400` | CoinGecko |
| `/forex/jpy` | `max-age=300` | Yahoo |

Note `/forex/jpy` uses `max-age`, not `s-maxage` — that caches in the **user's
browser**, not at the edge, so it does nothing for the second user. Probably not
what was intended.

---

## 🔴 Ranked by actual exposure

Ordered by what is genuinely unprotected, not by traffic guesses.

### 1. `/signal-accuracy` — nothing at all

No cache, **no rate limit**, no auth. Calls Bybit. The only route in the audit
with none of the three.

### 2. `/funding` and `/cycle` — rate limit only

Call Binance and Bybit. No cache, no auth. `rateLimit` is the sole protection —
see the caveat below, which is the important part of this document.

### 3. `/cmc` — a PAID API, uncached

`pro-api.coinmarketcap.com` is credit-metered. Has `getUser` and `rateLimit`, no
cache. Every uncached call spends real money rather than goodwill.

### 4. `/proxy` — uncached, and one upstream is already dead

Calls sosovalue and coinglass. `getUser` + `rateLimit`, no cache. Also the route
behind #175, where `sosovalue:etf-flows` has failed 301 consecutive times and has
**never once succeeded**.

### 5. `/briefing`, `/grok`, `/grok-chat` — NOT the problem they look like

These call `api.x.ai`, which is paid per token, and they have no cache header —
so they look like the worst items here. **They are not.** All three are protected
by `aiUsage` metering plus `rateLimit` plus `getUser`, so spend is bounded per
user by design.

Recorded because I nearly filed them as the headline finding. A route calling a
paid API without a cache header is not automatically unbounded; the question is
whether anything else bounds it.

---

## ⚠️ Rate limiting is not a substitute, and here it is weaker than it looks

`lib/rateLimit.ts` keeps its buckets in a **process-memory `Map`**. Two
consequences, both already documented in `qa/QA_TEST_PLAN.md`:

- **Every deploy resets every bucket to zero.** Someone throttled a minute ago is
  not throttled after a deploy.
- **Buckets are not shared across instances.** The moment this app runs more than
  one instance — which is the growth scenario that prompted the question — each
  instance enforces its own limit independently.

More importantly, the two mechanisms defend different things:

> **Rate limiting protects us from a user. Caching protects the upstream from all
> of our users at once.**

A per-IP limit does nothing about a thousand *different* users each making one
legitimate call. That is exactly the scenario in the question, and it is the
scenario rate limiting cannot address.

---

## What this changes about the Binance cost decision

The open decision "proxying server-side costs money" (audit §8.10) is currently
framed as a per-request cost that grows with users. **With `s-maxage`, upstream
volume stops being a function of user count and becomes a function of time.**

At `s-maxage=60`, `/funding` costs 1,440 upstream calls a day whether the product
has ten users or a hundred thousand. That is a different decision from the one on
the list.

---

## The staleness question, which is the only real trade

Caching is not free: `s-maxage=N` means a user can see data up to N seconds old.
That is a **product** call per route, not an engineering one, and it is the
reason this document does not propose numbers for all of them.

The existing policies imply the house style — 60s for market data, 300s for
macro, 3600s for calendar and all-time highs. Applying that shape to the
uncached routes would be consistent, but three deserve an explicit decision:

- **`/funding`** — funding rates change on a fixed 8-hour schedule. Almost
  certainly tolerates 60s, plausibly much more.
- **`/cmc`** — paid, so longer is strictly better unless a screen needs freshness.
- **`/signal-accuracy`** — historical accuracy stats. Minutes, not seconds.

**Nothing here should be applied to a route where a user acts on the number
expecting it to be live.** That is the one place staleness is a real defect
rather than a saving.

---

## What QA will do once headers land

Nothing in this suite asserts a cache policy today, so a header could be removed
and no test would notice. That is the same shape as every other gap in
`TEST_GAPS.md`.

Once dev decides the policies, QA adds a spec asserting each route returns the
`Cache-Control` it is supposed to — cheap, HTTP-level, no fixtures needed, and it
makes the decision durable instead of a comment.

---

## Method, so it can be re-run rather than trusted

Generated by walking `app/api/**/route.ts` and, per file, detecting: a
`Cache-Control` header literal, `export const revalidate`, `export const
dynamic`, a third-party hostname or `fetch('https://…')`, and the presence of
`hasProFeatures` / `checkCronAuth` / `aiUsage` / `rateLimit` / `getUser`.

Two limits worth stating:

- **Static analysis.** A header set through a helper or a shared response builder
  would be missed. Verified the six above against production responses; the rest
  are from source only.
- **"Third party" is a regex** over known hostnames. A new upstream added under a
  name not in that list would not be flagged.

Both mean this is a floor. The real number of uncached third-party routes is
**at least** 31, not at most.
