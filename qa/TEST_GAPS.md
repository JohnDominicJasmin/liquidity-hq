# What a green suite does not mean

**Owner: QA. Last measured 2026-08-09.** Status and blockers live in [`STATUS.md`](STATUS.md); this file is only about coverage.

This file exists because "250 tests passed" reads like "the product works", and it
does not. It is the standing list of what is **not** covered, why it matters, and
what closing it would take.

Read it before quoting a green CI run as evidence of anything.

Three rules for keeping it honest:

- **A gap leaves this list only when a test covers it**, not when someone is
  confident it is fine. Confidence is what this file exists to replace.
- **When a gap is closed, say what closed it** — the spec name, so the claim is
  checkable.
- **A gap that is half closed is still open.** §1 and §5 below are the live
  examples. "Fixtures exist" and "the clock is controllable" are different
  claims, and collapsing them is how a list stops being true without anyone
  editing it.

---

## What the suite actually covers today

250 passed / 110 skipped, 41 minutes, measured on release gate #162.

| | |
|---|---|
| ✅ Signed-out surface | 32 routes, desktop + iPhone 13 |
| ✅ Signed-in surface | Settings, TradeJournal, Grok chat — accessibility only, desktop only |
| ✅ Cross-account access (BOLA/IDOR) | 10 tests, both seeded accounts, HTTP level |
| ✅ **Pro entitlement boundary** | 15 routes × both directions, pinned `pro` and `free` fixtures |
| ✅ **Payments webhook** | signature, replay guard, cross-account ownership — **synthetic payloads only** |
| ✅ Accessibility | axe WCAG 2.0/2.1/2.2 A+AA, tap targets, names, landmarks |
| ✅ Performance | LCP + CLS budgets per route |
| ✅ SEO / meta | canonical, titles, h1 |
| ✅ Colour contrast | **both themes**, all 32 routes, served from fixtures |
| ✅ **Offline / service worker** | 5 tests — precache, offline page, API passthrough, revalidation, cache purge |
| ✅ **Locale offering + page language** | `lang`/`dir` per route, picker contents, `/ar` removal |

Everything below is outside that.

---

## 🟡 1. Data and clock are controllable; SERVER time is not

**Downgraded twice on 2026-08-09.** Two of the three original blockers are gone.

**Market data** — `qa/e2e/_fixtures.ts` serves 20 recorded endpoints to the
browser; `contrast.spec.ts` measures against them.

**The clock** — `qa/e2e/clock.spec.ts` pins it with `page.clock`, no app change.
Three fixed instants produce three different renders on `/hours`. It found a
dated defect: `HOLIDAYS_2026` is hardcoded and `getHoliday()` falls back to `[]`,
so from 2027-01-01 every market holiday silently becomes a trading day. The guard
fires in **November**, not on New Year's Day.

**Server-side calls** — `qa/server-intercept.mjs` wraps the Node process's own
`fetch`. Off unless `QA_INTERCEPT_UPSTREAM` is set; `count` tallies without
altering anything, `1` stubs. That measurement retired #114: Binance **0**,
Bybit **<25**, Supabase 100+ per contrast sweep — the constraint the `workers`
pin was built around barely exists.

**Still open:**

- **SERVER time.** `page.clock` fakes the browser only, so the 24h/48h alert
  outcome resolution — a cron — remains untestable.
- **The user's timezone.** `page.clock` moves the instant, not the zone. A real
  DST matrix needs `timezoneId` contexts.
- RSI thresholds and squeeze/flush boundaries have fixtures but no spec asserts
  against them.

---

## 🟡 2. Geometry is checked now; APPEARANCE still is not

**Downgraded from 🟠 on 2026-08-09.** `qa/e2e/layout.spec.ts` closed the half of
this that could be closed deterministically.

**What is covered now**, on both viewports, no baseline files:

- a control rendered underneath something else → **obscured** check, via
  `elementFromPoint` on each control's own centre
- a chart drawing at zero height → **zero-size** check on every visible
  `canvas`/`svg`
- the **first-visit** state, where the consent banner sits over the page

It found real defects immediately: two `/calc` inputs under the fixed mobile tab
bar (#173), and 4 desktop / 26 mobile controls covered by the consent banner on a
first visit (#174).

**What is still NOT covered, and it is the original wording of this section:**

- text rendered in a colour that happens to match its background
- two elements overlapping **without** either one's centre landing on the other
- a modal opening off-screen
- anything that is simply *ugly* — spacing, alignment, wrapping

Geometry catches "unusable". It does not catch "wrong".

**Why not `toHaveScreenshot()`, which is the obvious answer to the rest.**
Playwright suffixes snapshots per platform, so baselines generated on a developer
machine are never compared against a Linux CI run — CI silently generates its own
and compares a build against itself. **Pixel baselines have to be produced on the
platform that judges them**, which makes this a CI-side job: generate on a runner,
commit, then diff.

**Two cautions for whoever does it.** The counts in `layout.spec.ts` proved
unstable until a DOM-settle wait was added — pixels will be worse, because a
one-pixel scrollbar or font-rendering difference fails a diff that a geometry
check ignores. And the mobile obscured count moves with content height, so
screenshots of data-heavy routes will need the fixtures that already exist.

**Cost:** ~1 day, most of it CI plumbing rather than test code.
**Value:** high, but no longer the highest — the unusable cases are caught.

---

## ✅ 3. Light theme — CLOSED 2026-08-09

Closed by `qa/e2e/contrast.spec.ts`, which sweeps **both** themes across all 32
routes. Light carries a 26-token baseline; dark carries 11. Both print their
counts into the gate log.

Kept as a heading rather than deleted, because "contrast is dark-only" was
repeated from this file for weeks after it stopped being true.

---

## ✅ 4. Page language — CLOSED 2026-08-09

Arabic was withdrawn rather than implemented (#147, owner's Option B), `/ar`
returns a real 404 (#163), and `lang`/`dir` now come from `LabelsProvider` — the
component that owns the locale — so they follow the locale a user actually
selected on every route, not just the three with a locale in the URL (#165).

Guarded by `qa/e2e/i18n.spec.ts`, including the assertion that was missing: `lang`
on a route with **no locale in its URL**, driven by stored selection, for `ko`,
`zh` and `ru`. Plus the withdrawn-locale case, where `lang`, `dir` and rendered
text must all agree.

**Kept as a heading for the lesson, not the fix.** This section was closed once
before, on 2026-08-08, and was wrong:

- Arabic was still selectable in **two other pickers** — a second locale system
  nobody had looked at
- QA's production sign-off ran nine checks and passed nine, having only visited
  routes the fix had touched. Thirty of thirty-two routes were serving Korean
  copy under `lang="en"` at that moment
- the first attempted fix was a **no-op**: the component was mounted outside the
  provider it read from, so its hook returned the context default forever

Three verifications in a row that could not observe what they claimed to check.
That is why the spec now asserts against the *selected* locale rather than the
route, and why it runs in a browser rather than over source.

---

## 🟡 5. A REAL purchase has never granted Pro

**Narrowed on 2026-08-09, and the remaining gap is one sentence long.**

Three files now cover the payments path:

| file | asserts |
|---|---|
| `__tests__/checkoutUrl.test.mts` | what the checkout URL contains |
| `qa/e2e/checkout.spec.ts` | that the button actually sends it |
| `qa/e2e/payments-webhook.spec.ts` | that the server does not trust it |

Together: the URL carries the signed-in user's own id, the button really hands it
off, a signed-out visitor reaches no checkout, and a forged, replayed or
cross-account payload is refused.

**None of that needed a LemonSqueezy account.** I had reported this section as
blocked on owner-supplied keys; that was wrong.

**What is still untested:** a real purchase granting Pro, a lapsed subscription
re-locking, and whether we are pointed at the right store. That needs approval,
keys and a sandbox — and it is a once-before-launch check, not a per-commit one.

**Production risk worth naming:** `NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL` is
inlined at build time. If it is unset on prod, `getCheckoutUrl` returns
`/login?signup=1` and the upgrade button silently sends buyers to a signup page.
`checkout.spec.ts` fails loudly when it is absent rather than testing the
fallback while claiming to test checkout.

---

## 🟡 6. Accessibility is asserted, never heard

**Unchanged.** The suite checks that `aria-live`, `role` and accessible names
**exist**. It has never checked what a screen reader **announces**.

An element can have every correct attribute and still be unusable — wrong reading
order, a name that says "button" and nothing else, a live region that fires on
every keystroke. Attribute presence is a floor, not a pass.

Sharpened by §4: `lang` was *present* on every page for the whole life of the
project. It was present and wrong, and no attribute-presence check can find that.

**To close:** partly unclosable in CI. A real pass needs NVDA or VoiceOver and a
person. Book it as a manual session rather than pretending automation covers it.

---

## 🟡 7. `staging` and `dev` share one database

**Unchanged, and the wording corrected** — it is `staging`, not `qa`, that shares
the dev Supabase project (`wdtjhrilakoitfcezxpx`). Accepted deliberately:
Supabase's free plan caps the account at two projects and dev + prod take both.

Consequence: **QA test data and dev's data live in the same database.** A clean
run on staging is not proof the data path is clean; it may be proof that dev left
good data lying around. Row counts, empty states and "no results" assertions are
all suspect.

New as of 2026-08-09: CI now holds that project's **service-role key**
(`E2E_SUPABASE_SERVICE_ROLE_KEY`). Scoped to the E2E job, dev project only. Prod's
key must never reach CI — prod holds real customers and the free plan has no
backups.

**To close:** a third Supabase project. Costs money. Owner's call.

---

## ✅ 8. Offline / PWA — CLOSED 2026-08-08

Closed by `qa/e2e/offline.spec.ts`: the worker registers, activates and
precaches; a failed navigation serves the offline page; **API requests are not
answered with it**; navigations revalidate rather than serving a stale copy; and
activation purges older caches.

That last one is the "stale service worker serves an old build after a deploy"
case, which bites in production and is invisible on the test environments.

---

## 🟢 9. Known harness weaknesses (QA's own bugs)

Recorded here rather than hidden, because the suite is code and has defects too.

- **`perf.spec` does not warm a route before measuring it.** Two LCP failures on
  2026-08-06 were cold-start artefacts — 3460ms cold vs 676ms warm on the same
  build. Still true. An LCP failure needs a warm re-run before it is believed.
- **`playwright.config.ts` sets `reuseExistingServer: !process.env.CI`.** Locally
  the suite silently reuses whatever is on port 3100, which may be another
  branch's build. Check what is being served before trusting a local run.
- **`a11y-auth.spec.ts` is desktop-only** — deliberate, but it means no
  signed-in mobile coverage exists at all.
- **The trade journal has no API route**, so no API-level BOLA surface. Its data
  isolation is unverified at HTTP level; only the UI path is covered.
- **Several assertions cannot fail.** `bola.spec.ts`'s `REFUSED` set contains
  `200`, so the status check is decorative and the data assertion beside it is
  what has teeth. Deliberate, documented in the file, and listed here so it is
  not rediscovered as a bug.
- **110 tests skip every run.** 95+ are the mobile project on HTTP-level specs,
  which is by design. Every skip names its reason. Read them — some are accepted
  limits and some would be findings if they appeared.

---

## 🟡 10. Monitoring is wired in production; DELIVERY is unconfirmed

**Was ✅ with a caveat. The caveat is the whole of what is left, so it is amber
again** — a section marked closed with an untested claim inside it is how this
file went wrong before.

**Confirmed 2026-08-09, measured against the production bundle:** the GlitchTip
DSN is compiled in and points at project `25983`. Monitoring is genuinely present
in prod, not just in the repo.

**Confirmed earlier:** `lib/monitoring.ts` suppresses non-prod events before they
spend quota, session envelopes went 14 → 0, and
`__tests__/monitoringPipeline.test.mts` proves the scrubber runs inside the real
SDK — email, IP and username stripped, an OAuth `access_token` in a breadcrumb
fragment removed while the path survives.

**Still unconfirmed:** that an error raised on production actually ARRIVES. Every
proof above is a harness or a bundle inspection. The original finding on this
section was a 429 quota rejection, which is invisible from outside.

**To close:** raise one deliberate error in production and confirm it appears in
GlitchTip. It needs the owner's say-so, because it means breaking something on
purpose on the live site.

---

## Suggested order

Rewritten 2026-08-09. **Three of ten closed, five half-closed.** Nothing here is
blocked on code any more - the top three all need a person, not a keyboard.

| | Item | Needs | Why this order |
|---|---|---|---|
| 1 | **§5 real purchase** | owner: LemonSqueezy approval + keys | The only untested thing that touches money. Approval has a lead time nobody controls, so it is the item where waiting costs calendar rather than effort |
| 2 | **§10 prod capture** | owner: permission to break something live | One deliberate error, once. Everything else about monitoring is proven; this is the only unmeasured link |
| 3 | **§6 screen reader** | a person + NVDA/VoiceOver | `lang` was PRESENT and wrong on every page for the project's life. Attribute checks cannot find that class of defect |
| 4 | §1 server time / fake cron | QA | The 24h/48h alert resolution is still unreachable |
| 5 | §2 pixel baselines | QA + CI | Mostly plumbing: baselines must be generated on the platform that judges them |
| 6 | §1 DST / timezone matrix | QA | `timezoneId` contexts; the clock moves the instant, not the zone |

**Removed since this list was last written:** §4 (closed by #165), §2's geometry
half (`layout.spec.ts`), §1's data and clock halves, and #114 - whose premise was
measured wrong and which is now closed rather than carried.

## Also see

- `pendings/QA_AUDIT_2026-08-04.md` — the original audit
- `pendings/QA_A11Y_FINDINGS_2026-08-05.md` — accessibility findings
- `pendings/QA_E2E_FINDINGS_2026-08-05.md` — defects found running the suite
- `qa/E2E_PLAN.md` — how the suite was built. Its §5 is superseded by this file;
  the BOLA gap it describes was closed on 2026-08-06 by `qa/e2e/bola.spec.ts`.
