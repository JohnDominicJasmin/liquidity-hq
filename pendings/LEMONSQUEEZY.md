# LemonSqueezy — Payment Feature

**Status 2026-08-11: a test-mode dry run is in progress on STAGING. Production
is untouched — every step in the list below is still outstanding for prod.**

Read that distinction carefully, because this file used to state "payments are
not live" as a flat fact and that is now true of only one environment.

### Staging — `liquidity-hq-staging`, test mode

| | |
|---|---|
| Product/variant at $25/mo | created |
| Checkout URL | `checkout.liquidity-hq.com/checkout/buy/0e357d1e-…`, on our own subdomain |
| `NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL` | **set**, and confirmed inlined into the deployed build |
| Test-mode webhook | created, all 7 events, pointed at the staging route |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | **not set yet** — staging returns 401 to every delivery, which is fail-closed working as designed |

Verified on 2026-08-11 against the deployed service, not from the dashboard:
`/upgrade` renders the real **"Get Pro - $25/mo →"** button and the "launching
soon" copy is gone.

**How to check this, because the obvious check is wrong.** The CTA is a
`<button onClick={handleCheckout}>` that sets `window.location.href` at click
time (`app/upgrade/page.tsx`), so the checkout URL is **never in the DOM**.
Scanning for an `<a href>` containing the store domain reports a false failure
every time. Assert on the button text and the absence of the fallback copy, or
grep the served JS chunks for the URL — it is inlined into exactly one.

### Production — nothing done

`NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL` is unset on prod, so `/upgrade` there
still renders "Pro payments launching soon" (`CHECKOUT_CONFIGURED` in
`app/upgrade/page.tsx`), and `UpgradeGateModal` falls back the same way. Nothing
is broken — there is simply no way to pay yet.

**Prod needs its own everything**: its own live-mode webhook (test and live
webhooks are separate objects in LemonSqueezy), its own secret, and its own
build with the URL inlined. Nothing configured on staging carries over, and a
prod secret must never be copied to a non-prod service.

> ⚠️ **Before the first real purchase, someone has to decide what Pro actually
> includes.** `/backtest` and `/live-tracking` were hidden on 2026-08-11 (#264),
> but the Pro sales copy still advertises "Full strategy backtesting" on the
> `/upgrade` pricing card, in the upsell modal, and on the public `/faq`. As of
> today a buyer would be paying for a feature that redirects to the Dashboard.
> Owner decision — raised on #265, not resolved.

## ❓ YOUR action — the only thing standing between here and revenue

Four steps, all outside this repo. Do them in this order; the webhook secret
must exist before the first real purchase or that purchase grants nothing.

1. **Create the product/variant in LemonSqueezy priced at $25/month.** The app
   already displays $25 everywhere (`/upgrade`, landing page in 4 locales, the
   DB-backed checkout CTA label in 5 locales, both Supabase projects) as of
   2026-07-24. Only the LemonSqueezy-side price still needs to match.
2. **Set `LEMONSQUEEZY_WEBHOOK_SECRET`** in Render on prod. Without it
   `verifySignature` returns false for every delivery and every payment is
   rejected with a 401 — fail-closed by design.
3. **Set `NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL`** in Render on prod. This is
   the switch that turns the "launching soon" copy into a real button.
4. **Point the LemonSqueezy webhook at**
   `https://liquidity-hq.com/api/lemonsqueezy/webhook` and subscribe to
   `subscription_created`, `subscription_updated`,
   `subscription_payment_success`, `subscription_cancelled`,
   `subscription_expired`. Those five are what the handler switches on;
   anything else is accepted and ignored.

Both env changes trigger a Render redeploy — `NEXT_PUBLIC_*` is inlined at
build time, so setting it without rebuilding does nothing.

## ✅ Build checklist — all three items are DONE

Verified by reading `app/api/lemonsqueezy/webhook/route.ts` on 2026-08-01, not
from memory. This file previously listed all three as pending long after they
shipped.

- **`custom_data.user_id` bound to the payer** — was the MED-severity finding:
  `lib/checkout.ts` writes `user_id` into a client-side checkout URL, so the
  payer picks it, and a signature only proves LemonSqueezy sent the event, never
  that the payer owns the named account. Now the handler resolves the account's
  real email via `sb.auth.admin.getUserById(userId)` and refuses to grant unless
  it matches `attrs.user_email`. Fails closed, returns 200 so LemonSqueezy stops
  retrying, and reports to GlitchTip — because a mismatch is also what a
  legitimate customer paying from a second address looks like, and that needs
  reconciling by hand rather than silently refusing.
- **Replay protection** — `lhq_ls_webhook_events` (confirmed present on prod)
  takes a `sha256` of the raw body as a primary key; a duplicate key is treated
  as the expected already-handled path, not an error. The hash is used because
  the payload carries no per-delivery id: `meta.webhook_id` identifies the
  webhook *configuration*, not the delivery. The current handlers are idempotent
  upserts anyway, so this guards the next non-idempotent thing added here.
- **Test-mode rejection** — `attrs.test_mode === true` is ignored in prod,
  checked after signature verification. Dev keeps test-mode events so the
  checkout flow can be exercised end to end.

## Before the first real payment

Upgrade Supabase to Pro. The org is on Free, which includes **zero** backups —
see the entry in `pendings/PENDING.md`. Taking money for a service whose
database has no recovery path is the point where that stops being theoretical.
