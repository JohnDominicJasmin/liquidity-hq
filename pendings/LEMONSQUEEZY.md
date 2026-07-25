# LemonSqueezy — Payment Feature (Deferred)

Payments aren't live yet — `NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL` isn't
configured, so `/upgrade` shows "Pro payments launching soon" instead of a
real checkout button (see `CHECKOUT_CONFIGURED` in `app/upgrade/page.tsx`).
Everything below is scoped to "when resuming this feature," not urgent now.

## ❓ YOUR action (can't do from code, needed before launch)

- **Set the LemonSqueezy product/variant price to $25** in LemonSqueezy's own
  dashboard (not this repo) to match the app's displayed price. (The pricing
  rationale doc this used to point to was removed 2026-07-25 - fully
  resolved, nothing left pending in it; see git history for the full
  analysis if needed.) The app-side price display is already $25 everywhere
  (`/upgrade`, landing page, DB labels) as of 2026-07-24; only the actual
  LemonSqueezy variant price still needs to match it once checkout is
  configured.

## 🔭 Build checklist for when resuming payments

- **`custom_data.user_id` unbound from payer (MED severity)** — not
  exploitable until payments are live, but real once they are:
  `lib/checkout.ts` puts the signed-in user's `user_id` into
  `checkout[custom][user_id]`, and `app/api/lemonsqueezy/webhook/route.ts`
  trusts that value to attribute the payment to a Supabase user. Nothing
  currently verifies the paying LemonSqueezy customer actually **is** that
  user — a modified checkout URL could in principle grant Pro to an
  arbitrary `user_id`. Fix: bind `user_id` to a verified LS customer (e.g.
  cross-check `data.attributes.user_email`/customer id against the Supabase
  user before granting `role='pro'`) rather than trusting the custom field
  alone.
- **Webhook idempotency / replay protection** — add before going live.
  LemonSqueezy can (and does) retry webhook deliveries; the handler should
  be safe to receive the same event twice (e.g. dedupe on the event's unique
  id) rather than double-granting or double-processing.
- **Set the LemonSqueezy variant price to $25** (matches the app's displayed
  price) once checkout is actually configured — same item as the action
  above, listed here too since it's part of the go-live checklist.

## Already shipped (not blocked on payments going live)

- `app/api/lemonsqueezy/webhook/route.ts` rejects `attrs.test_mode === true`
  in prod (checked after signature verification, before processing) — done
  2026-07-24, part of the security audit pass.
