# What a green suite does not mean

**Owner: QA. Last measured 2026-08-08.** Status and blockers live in [`STATUS.md`](STATUS.md); this file is only about coverage.

This file exists because "187 tests passed" reads like "the product works", and it
does not. It is the standing list of what is **not** covered, why it matters, and
what closing it would take.

Read it before quoting a green CI run as evidence of anything.

Two rules for keeping it honest:

- **A gap leaves this list only when a test covers it**, not when someone is
  confident it is fine. Confidence is what this file exists to replace.
- **When a gap is closed, say what closed it** — the spec name, so the claim is
  checkable.

---

## What the suite actually covers today

| | |
|---|---|
| ✅ Signed-out surface | 32 routes, desktop + iPhone 13 |
| ✅ Signed-in surface | Settings, TradeJournal, Grok chat — accessibility only, desktop only |
| ✅ Cross-account access (BOLA/IDOR) | 9 tests, both seeded accounts, HTTP level |
| ✅ Accessibility | axe WCAG 2.0/2.1/2.2 A+AA, tap targets, names, landmarks |
| ✅ Performance | LCP + CLS budgets per route |
| ✅ SEO / meta | canonical, titles, h1 |
| ✅ Colour contrast | **dark theme only**, 8 routes measured |

Everything below is outside that.

---

## 🔴 1. Market data and the clock cannot be controlled

**The biggest gap by a wide margin, and the least visible.**

Every test runs against whatever the live market is doing at that moment. There
is no way to pin an input, so the product's own domain logic — the reason anyone
uses it — has never been tested.

Untestable today:

- funding rate flipping **negative**, and the UI that is supposed to react to it
- RSI crossing overbought / oversold thresholds
- squeeze and flush scores at their alert boundaries
- **24h and 48h alert outcome resolution** — a test would have to wait 24 hours
- "Best Hours" and the economic calendar **across timezones**, including DST
- what the app does when Binance/CMC returns an error, an empty array, a `null`
  price, or a number where a string was expected
- liquidation map behaviour at extremes

Right now a passing run means "nothing crashed given today's prices". It does not
mean the calculations are right, because nothing ever asserts a calculation
against a **known** input.

**To close:** intercept the market-data calls at the network layer
(`page.route`) and serve recorded fixtures — one per scenario. Plus a fake clock
for the time-dependent paths. This is the real work: recording representative
payloads is most of it.

**Cost:** days, not hours. **Value:** highest of anything on this list.

---

## 🟠 2. Nothing has ever looked at the pages

Contrast ratios are computed from CSS values and the DOM is read
programmatically. **No test has ever compared what the page looks like.**

So all of these would pass every check currently in the suite:

- text rendered in a colour that happens to match its background
- two elements overlapping
- a chart drawing at zero height
- a modal opening off-screen
- a layout collapsing at one specific width

This is not theoretical. **Nine routes received colour-token substitutions with
no measured proof** (recorded in every release note since 2026-08-05 as "not
verified"), and the suite cannot tell whether they render correctly.

**To close:** screenshot baselines per route per viewport per theme, with a
pixel-diff threshold. Playwright has `toHaveScreenshot()` built in — no new
dependency.

**The catch:** live market data means the pixels change every run. This gap is
**blocked on gap 1** for the data-heavy routes; the static/marketing routes could
be baselined today.

**Cost:** ~1 day for the static routes. **Value:** high, and it is the cheapest
big win once fixtures exist.

---

## 🟠 3. Light theme has never been measured

Contrast was measured on the **dark** theme only. The app ships a light theme
(`Settings → Appearance → Light`), and no automated check has ever run against
it.

Every contrast number QA has ever reported — including the fixes in
`__tests__/contrastTokens.test.mts` — describes dark mode.

**To close:** parameterise the contrast sweep over `data-theme`, run both. The
harness already exists; it just runs once.

**Cost:** hours. **Value:** high for the cost — this is the cheapest item here.

---

## 🟠 4. Five languages ship; one is tested

The app has English, 한국어, 中文, العربية, Русский. Every test asserts against
**English** strings and English layout.

**العربية is right-to-left.** An RTL layout is not a translation of an LTR one —
it is a mirrored layout, and it breaks in ways nothing here would catch: icons
pointing the wrong way, text overflowing the wrong edge, charts and number
formatting reading backwards, `margin-left` where `margin-inline-start` was
meant.

Related and already burned: `LabelsProvider` overwrote 2,570 seeded English
labels when `/api/labels` returned `200 {}` (found 2026-08-05, fixed). That
defect was found by accident in a degraded CI environment. Nothing routinely
checks that the label layer is intact in **any** language.

**To close:** run the smoke + a11y sweep under each locale; add an RTL-specific
layout check for Arabic.

**Cost:** ~1 day. **Value:** high — one of these five is a different layout, not
different words.

---

## 🟡 5. The payment and upgrade flow has never been exercised

`/upgrade`, LemonSqueezy checkout, subscription state, Pro-gating. Reached only
as an unauthenticated page render.

Never tested: that a purchase grants Pro, that Pro-gated features unlock, that a
lapsed subscription re-locks them, that a failed payment is handled. The
timeframe chips in Settings carry `title="Fast timeframes are a Pro feature."` —
whether that gate actually holds is unverified.

**Why it is 🟡 and not 🔴:** it involves a third party's sandbox and real money
paths, so it is genuinely awkward to automate — not because it matters less. It
arguably matters most in money terms.

**To close:** LemonSqueezy test mode + a seeded Pro account alongside the two
existing fixtures.

---

## 🟡 6. Accessibility is asserted, never heard

The suite checks that `aria-live`, `role`, and accessible names **exist**. It has
never checked what a screen reader actually **announces**.

An element can have every correct attribute and still be unusable — wrong reading
order, a name that says "button" and nothing else, a live region that fires on
every keystroke. Attribute presence is a floor, not a pass.

**To close:** honestly, partly unclosable in CI. A real pass needs NVDA or
VoiceOver and a person. Worth booking as a manual session rather than pretending
automation covers it.

---

## 🟡 7. `qa` and `dev` share one database

Documented in `CLAUDE.md` and accepted deliberately — Supabase's free plan caps
the account at two projects, and dev + prod take both.

Consequence, stated so nobody forgets: **QA test data and dev's data live in the
same database.** A clean QA run is not proof the data path is clean; it may be
proof that dev happened to leave good data lying around. Row counts, empty
states, and "no results" assertions are all suspect.

**To close:** a third Supabase project. Costs money. Owner's call.

---

## 🟡 8. Offline / PWA behaviour

There is a service worker and an `/offline` route. Nothing tests the app going
offline: whether cached routes serve, whether the offline page appears, whether
queued actions replay on reconnect, or whether a stale service worker serves an
old build after a deploy.

That last one bites in production and is invisible on the qa and staging test environments.

**To close:** `context.setOffline(true)` plus service-worker lifecycle
assertions. Playwright supports both.

**Cost:** ~half a day.

---

## 🟢 9. Known harness weaknesses (QA's own bugs)

Recorded here rather than hidden, because the suite is code and has defects too.

- **`perf.spec` does not warm a route before measuring it.** Two LCP failures on
  2026-08-06 were cold-start artefacts, not regressions — 3460ms cold vs 676ms
  warm on the same build. Until this is fixed, an LCP failure needs a warm re-run
  before it is believed.
- **`playwright.config.ts` sets `reuseExistingServer: !process.env.CI`.** Locally
  the suite will silently reuse whatever is already on port 3000, which may be a
  different branch's build. Always check what is being served before trusting a
  local run.
- **`a11y-auth.spec.ts` is desktop-only** — deliberate (same DOM, double the
  cost), but it does mean no signed-in mobile coverage exists at all.
- **The trade journal has no API route**, so it has no API-level BOLA surface to
  probe. Its data isolation is unverified at HTTP level; only the UI path is
  covered.

---

## 🔴 10. Error monitoring is installed and capturing nothing

**CORRECTED 2026-08-06.** This section previously said "There is no Sentry, no
error aggregation, no alert." That was **wrong**, and written without reading
`pendings/OPS_ROADMAP.md:46`, which documents the opposite.

Error monitoring exists: `@sentry/nextjs` 10.67.0, wired through
`instrumentation.ts` (server + edge) and `instrumentation-client.ts` (client),
pointed at **GlitchTip**, environment-tagged from `NEXT_PUBLIC_APP_ENV`, with
`tracesSampleRate: 0` set deliberately after traces ate 99% of the free quota.

The real finding is worse than the gap that was imagined:

```
POST https://app.glitchtip.com/api/25983/envelope/   ->  429 Too Many Requests
```

Measured on the qa test environment across four page loads — **every request, no exceptions**.
The event quota is exhausted, so every error the app reports is rejected and
dropped.

That is worse than having none, because none is at least honest. This appears in
the dependency list, in the ops doc, and in the network tab, and captures
nothing. Anyone asking "do we have error monitoring?" gets *yes*.

Likely cause: `NEXT_PUBLIC_SENTRY_DSN` is one variable and `environment` is a
tag, not a separate quota — so if `dev`, `qa` and `prod` share a DSN, dev noise
and QA traffic spend production's 1,000 events a month. Structurally the same
trap as §7, and with the same consequence: the noisy environments starve the one
that matters.

**To close:** a separate DSN for prod, or `beforeSend` dropping non-prod events
before they spend quota. Filed as issue #51.

**The lesson, recorded because it is the more useful part:** this file's job is
to say what is *not* covered, and its first version asserted a gap that did not
exist. A claim about the absence of something needs the same evidence as a claim
about its presence — check the repo before writing "there is no X".

---

## Suggested order

Ranked by value per unit of effort, not by severity:

| | Item | Effort | Why this order |
|---|---|---|---|
| 1 | §10 GlitchTip 429 | hours | Monitoring exists but drops every event — it is the only thing here that catches bugs nobody predicted, and right now it catches none |
| 2 | §3 light theme | hours | Harness exists, runs once, just needs a second pass |
| 3 | §8 offline/PWA | ½ day | Self-contained, no fixtures needed |
| 4 | §2 visual, static routes only | 1 day | Immediate value, not blocked on §1 |
| 5 | §4 i18n + RTL | 1 day | Arabic is a different layout, not different words |
| 6 | §1 data + clock fixtures | days | The big one — unblocks the rest of §2 |
| 7 | §5 payments | days | Awkward, third party, matters most in money |
| 8 | §6 screen reader | manual | Book a session; do not pretend CI covers it |

---

## Also see

- `pendings/QA_AUDIT_2026-08-04.md` — the original audit
- `pendings/QA_A11Y_FINDINGS_2026-08-05.md` — accessibility findings, §4 now
  verified
- `pendings/QA_E2E_FINDINGS_2026-08-05.md` — defects found running the suite
- `qa/E2E_PLAN.md` — how the suite was built. Its §5 is superseded by this file;
  the BOLA gap it describes was closed on 2026-08-06 by `qa/e2e/bola.spec.ts`.
