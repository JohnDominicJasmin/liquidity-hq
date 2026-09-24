# LemonSqueezy — Payment Feature

**Status 2026-09-24: the test-mode store exists and one full test purchase has run
on `qa`. Production is untouched - every production step below is still the owner's.**

### `qa` (`liquidity-hq-qa`, dev Supabase), test mode - as of 2026-09-24

| | |
|---|---|
| Store | one store, **test mode**, currency **USD** (it was PHP; switched 2026-09-23 before any price was entered - a price typed into the wrong currency is not a typo you catch later) |
| Products | three, all published: **2 Weeks $20**, **Monthly $35**, **Annual $350** |
| Checkout links | the three `NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL`, `_ANNUAL`, `_FORTNIGHTLY` set on `qa`. Verified from the **built bundle** (variable -> checkout id) and by opening each page from the signed-in UI: right plan, right price, test mode. `/api/version` reports `checkout`, `checkoutAnnual`, `checkoutFortnightly` |
| Webhook | created 2026-09-24 at `https://liquidity-hq-qa.onrender.com/api/lemonsqueezy/webhook`, **five events** (see "What the webhook must subscribe to" - five is one short). Signing secret set on `qa` as `LEMONSQUEEZY_WEBHOOK_SECRET`; **it is never written down in this repo** |
| Test purchase | **ran twice, 05:21Z and 05:27Z.** Delivery, signature and identity are proven from `lhq_dev_ls_webhook_events`: rows are written only after the signature check and the `custom_data.user_id` check, so their existence is the proof |
| What it found | **#1422 - paying REVOKED Pro one second after granting it.** `subscription_payment_success` carries an *invoice* (`status: 'paid'`); the role rule read that as "not active". The same event also overwrote `ls_subscription_id` with the invoice's id. Fixed in #1424 (the event is now ignored). **Verification on `qa` waits for the owner's re-buy** |
| Not yet seen | **renewal** (does `subscription_updated` carry a fresh `renews_at`?) and **recovery after a declined card** (does `subscription_updated` with status `active` arrive when a retry succeeds?). The code depends on both; nobody has observed either |

**Reading the result, so a green run is not mistaken for more than it is.** The flags in
`/api/version` are `NEXT_PUBLIC_*`-derived, so they describe **the build currently running**,
and the commit does not change when only a variable changes - `cronSecret` and
`lemonsqueezyWebhook` both flipped to true on `qa` with the commit unchanged. **Read the flag,
not the commit.**

**Also found: two live test subscriptions on one account.** The webhook keeps ONE row per user
and upserts on `user_id`; nothing compares the incoming subscription id with the stored one, so
last writer wins. A user who buys a second plan would hold two subscriptions against one row,
and cancel (#1396) would act on whichever was written last while the other kept billing.
Whether that needs a fix or a decision on plan switching is the owner's and Dev's - tracked on #1396.

### What the webhook must subscribe to

**The handler acts on five events and receives a sixth it ignores.** `lib/lemonsqueezy.ts` handles
`subscription_created`, `subscription_updated`, `subscription_cancelled`,
`subscription_expired` and **`subscription_payment_failed`** (the owner's 2026-08-08 decision:
a payment that did NOT go through ends access at once), and it **receives and deliberately
ignores** `subscription_payment_success` (#1424). The `qa` webhook was created with the older
five-event list, which has `payment_success` and **no `payment_failed`** - so the
"declined card ends Pro immediately" decision cannot fire there. A failed renewal would still
downgrade through `subscription_updated` with a non-`active` status (`past_due`), which is
the path the recovery assumption above rests on. **Production's webhook must include
`subscription_payment_failed`.** Tick it on `qa`'s too before anyone tests a decline.

### Earlier status - 2026-08-11 (superseded by the section above)

**A test-mode dry run was in progress on STAGING. Production
was untouched - every step in the list below was still outstanding for prod.**

Read that distinction carefully, because this file used to state "payments are
not live" as a flat fact and that is now true of only one environment.

### Staging — `liquidity-hq-staging`, test mode

| | |
|---|---|
| Product/variant at $25/mo | created (**superseded by #1400**: three variants are needed - $20 every 2 weeks, $35/month, $350/year - and the app reads a link per variant) |
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

> **Resolved: the "Full strategy backtesting" claim is gone.** The owner ruled that
> `/backtest` is an internal testing tool that was never for sale and was advertised by
> accident, so the line was **deleted, not commented out**, from the `/upgrade` feature list and
> from the upsell modal (`app/upgrade/page.tsx`, `components/UpgradeGateModal.tsx`,
> `UPGRADE_GATE_BULLET_3`). QA measured **zero mentions of "backtest" anywhere on the rendered,
> signed-in `/upgrade`** on 2026-09-24. **Not checked:** the DB-backed label rows on production
> (labels live in `lhq_labels`, so a copy change needs a row per locale) and the public `/faq`
> as rendered. A real customer-facing backtest feature would be a new decision and a new label
> key, not a restoration of this one.

## ❓ YOUR action — the only thing standing between here and revenue

Four steps, all outside this repo. Do them in this order; the webhook secret
must exist before the first real purchase or that purchase grants nothing.

1. **The three variants exist in TEST mode (#1400): $20 every 2 weeks, $35/month, $350/year - and test-mode products do not transfer to live mode.** Copy them with "Copy to Live Mode"; **each copy has its own new checkout link**, so the three links set on `qa` are test-only and must never be pasted into production. Set the new links as `NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL`, `_ANNUAL`, `_FORTNIGHTLY`. The app
   already displays those prices everywhere (`/upgrade`, landing page in 4 locales, the
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
   `subscription_payment_failed`, `subscription_cancelled` and `subscription_expired`
   (five - see "What the webhook must subscribe to" above; `subscription_payment_success`
   is received and deliberately ignored since #1424, so it may be left off).
   Anything else is accepted and ignored.

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
