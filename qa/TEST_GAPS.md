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

## 🟠 1. Market data is controllable; the CLOCK is not

**Downgraded from 🔴 on 2026-08-09, and only half.**

`qa/e2e/_fixtures.ts` records 20 third-party endpoints and serves them through
`page.route`. `market-scenarios.spec.ts` uses them to pin funding-rate sign and
upstream-500 behaviour, and `contrast.spec.ts` now measures every route against
them rather than against the live market.

**What that closed:** the contrast sweep no longer depends on what the market did
that minute. Measured 2026-08-09 — with fixtures the dark sweep observes **11 of
11** baseline tokens; without them, 10. The missing one needed a surface live
data had not populated.

**Still open, and it is most of the original section:**

- **The clock.** "Best Hours", the economic calendar, DST, and 24h/48h alert
  outcome resolution are all untestable. A fake clock is not installed.
- **Server-side calls are not intercepted.** `page.route` only sees requests the
  BROWSER makes. The app's own `/api/*` handlers call Binance, Bybit, Yahoo and
  er-api from the server, and those go out live in every run. This is why #114
  cannot be closed by inference from the fixture work.
- RSI thresholds, squeeze/flush alert boundaries and liquidation-map extremes
  have fixtures available but **no spec asserts against them**.

**To close:** a fake clock, and interception at a layer the server also passes
through. **Cost:** days. **Value:** still the highest here.

---

## 🟠 2. Nothing has ever looked at the pages

**Unchanged, and now the top item.** Contrast ratios are computed from CSS values
and the DOM is read programmatically. **No test has ever compared what a page
looks like.**

All of these still pass every check in the suite:

- text rendered in a colour that happens to match its background
- two elements overlapping
- a chart drawing at zero height
- a modal opening off-screen
- a layout collapsing at one specific width

**The blocker moved.** This used to be blocked on §1 for data-heavy routes.
Fixtures now make those routes deterministic, so screenshot baselines are viable
for far more than the static pages.

**To close:** `toHaveScreenshot()` per route per viewport per theme. Built into
Playwright, no new dependency.

**Cost:** ~1 day. **Value:** highest value-per-day on this list now that §1's
determinism problem is partly solved.

---

## ✅ 3. Light theme — CLOSED 2026-08-09

Closed by `qa/e2e/contrast.spec.ts`, which sweeps **both** themes across all 32
routes. Light carries a 26-token baseline; dark carries 11. Both print their
counts into the gate log.

Kept as a heading rather than deleted, because "contrast is dark-only" was
repeated from this file for weeks after it stopped being true.

---

## 🔴 4. `lang` is wrong on 30 of 32 routes

**Arabic is resolved. The Level A failure is not.**

`/ar` is out of `SUPPORTED_LOCALES` and out of the picker (#147), `/ar` returns a
real 404 (#163), and `qa/e2e/i18n.spec.ts` guards the offering and the `lang`
attribute on `/`, `/ko` and `/zh`.

**But #164, reproduced 2026-08-09:**

```
localStorage.lhq_lang_v1 = 'ko'

/ko        lang="ko"   Korean on page = true
/upgrade   lang="en"   Korean on page = true    <-- SC 3.1.1, Level A
/login     lang="en"   Korean on page = true
```

There are **two sources of locale truth**. `HtmlLangSync` reads the path;
`LabelsProvider` reads `localStorage` and serves translated copy app-wide. A
Korean user gets Korean UI on every route, declared as English.

**How this survived a 9/9 sign-off:** the verification only loaded routes the fix
touched — `/`, `/ko`, `/zh`, `/ar`. A check that visits only the covered routes
confirms any fix. That is the vacuous-pass shape, and it happened in QA's own
release sign-off.

Also still open, and dev's own note: the **server-rendered** HTML says `lang="en"`
until hydration, so a crawler reading the first response sees English. Needs the
root-layout restructure.

**To close:** #164, then extend `i18n.spec.ts` to assert `lang` against the
*selected* locale on a non-landing route — the assertion that would have caught it.

---

## 🟡 5. A purchase has never granted Pro

**Half closed.** `qa/e2e/payments-webhook.spec.ts` covers what the handler does
with a payload: an absent, forged or malformed signature is rejected; a replayed
payload is not re-applied; a payer cannot grant Pro to an account they do not own.
That last one is the BOLA of payments — `user_id` arrives in `custom_data`, which
`lib/checkout.ts` writes into a client-side URL — and it first executed on
2026-08-09.

**Every one of those payloads is synthetic.** The suite signs them itself. So:

- no real LemonSqueezy event has ever reached this handler
- no purchase has ever granted Pro
- no lapsed subscription has been shown to re-lock
- whether we are pointed at the right store is unverified

`entitlements.spec.ts` does now prove the Pro **boundary** holds in both
directions across 15 routes. What is untested is everything that *changes* which
side of that boundary an account is on.

**To close:** LemonSqueezy test-mode keys — owner action — plus one real
end-to-end purchase against a seeded account.

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

## ✅ 10. Error monitoring — CLOSED 2026-08-08, with one caveat

The 429 finding is resolved. `lib/monitoring.ts` now suppresses non-prod events
before they spend quota (`NEXT_PUBLIC_APP_ENV === 'dev'`), session envelopes went
14 → 0, and `__tests__/monitoringPipeline.test.mts` proves the scrubber runs
**inside the real SDK** against a stub transport — email, IP and username
stripped, the error message preserved, and an OAuth `access_token` in a
breadcrumb URL fragment removed while the path survives.

**The caveat, because it is the part nobody has measured:** no error raised on
**production** has been observed arriving in GlitchTip. Everything above proves
the pipeline is correct in a test harness and that non-prod no longer spends
quota. It does not prove prod capture works end to end.

---

## Suggested order

Ranked by value per unit of effort. Four of the previous eight are closed.

| | Item | Effort | Why this order |
|---|---|---|---|
| 1 | **§4 — #164 `lang`** | hours | A live Level A failure on 30 of 32 routes, already reproduced. Dev assigned |
| 2 | **§2 visual baselines** | ~1 day | The only never-touched gap, and fixtures just made most routes deterministic |
| 3 | §1 fake clock | days | Unblocks Best Hours, DST, alert resolution — none of which any test can reach |
| 4 | §1 server-side interception | days | Also what #114 needs before `workers` can be unpinned |
| 5 | §5 real purchase | days | Blocked on owner-supplied test-mode keys |
| 6 | §10 prod capture check | hours | Cheap, but needs a deliberate error in production |
| 7 | §6 screen reader | manual | Book a session; do not pretend CI covers it |

---

## Also see

- `pendings/QA_AUDIT_2026-08-04.md` — the original audit
- `pendings/QA_A11Y_FINDINGS_2026-08-05.md` — accessibility findings
- `pendings/QA_E2E_FINDINGS_2026-08-05.md` — defects found running the suite
- `qa/E2E_PLAN.md` — how the suite was built. Its §5 is superseded by this file;
  the BOLA gap it describes was closed on 2026-08-06 by `qa/e2e/bola.spec.ts`.
