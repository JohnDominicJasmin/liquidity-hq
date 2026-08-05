# QA — accessibility findings + the authenticated-surface gap, 2026-08-05

**Run by:** the QA session. **No application code was modified.** Everything here
is a finding handed to the development session.

Follow-up to `pendings/QA_E2E_FINDINGS_2026-08-05.md` (first execution of the
E2E suite) and `pendings/QA_AUDIT_2026-08-04.md` (the original sweep). Where
this document disagrees with either, the disagreement was measured, and the
measurement is shown.

**Method.** axe-core 4.x driven by Playwright against a production build of the
2026-08-05 release, WCAG 2.0/2.1/2.2 A + AA rule sets, at desktop 1440×900 and
at iPhone 13 mobile metrics. Plus a source-level static review, whose claims
were then re-tested at runtime — two of three confirmed, one untestable. axe was
installed **outside** the project so `package.json` is untouched.

---

## 0. Status summary

| | |
|---|---|
| Confirmed defects handed to dev | 4 |
| Corrections to our own prior findings | 1 |
| Findings that could not be tested (need auth) | 6 |
| Blocking asks remaining | 1 (test accounts — the CI secrets are now set) |

**The single most important line in this document:** every QA result this project
has ever produced covers the **signed-out** surface only. The authenticated half
of the app — Settings, TradeJournal, Alerts, the chat panel — has never been
examined by anyone, by any method. See §4.

---

## 1. 🔴 Confirmed defects

### 1.1 81% of every page's tab stops are inside closed, invisible panels

**Severity: Critical. Every route. Predates all of 2026-08-05's work.**

`components/NavDrawer.tsx` (`.nav-menu`) and `components/GrokChat.tsx`
(`.gchat-panel`) stay mounted when closed, hidden only via `opacity`,
`transform` and `pointer-events`. None of those remove an element from the tab
order or the accessibility tree.

Measured on `/dashboard`, production build:

```
nav-menu     opacity=1  pointerEvents=none  inert=false  FOCUSABLE_INSIDE=22
gchat-panel  opacity=0  pointerEvents=none  inert=false  FOCUSABLE_INSIDE=64
page focusables=106   before <main>=36
```

86 of 106 focusable controls sit in panels the user cannot see. Empirically the
**10th Tab press** lands inside the hidden drawer:

```
 9. button.lang-nav-btn "EN"
10. input.nav-search        <<IN CLOSED NAV-MENU>>
11. a.nav-tile "Dashboard"  <<IN CLOSED NAV-MENU>>
12. a.nav-tile "Briefing"   <<IN CLOSED NAV-MENU>>
```

A keyboard user tabs through ~22 invisible drawer controls before reaching page
content, and ~64 invisible chat-panel controls before the footer. A screen
reader's link-by-link navigation surfaces the same phantom stops.

**WCAG:** 2.4.3 Focus Order (A), 1.3.2 Meaningful Sequence (A).

**Fix direction:** conditionally render when closed — which `SettingsModal`,
`UsageModal` and `UpgradeGateModal` already do correctly in this codebase — or
add the `inert` attribute (`<div className="nav-menu" inert={!drawerOpen}>`;
React 19 passes boolean `inert` straight through).

**Repro:** load any page, press Tab from the address bar, count focus stops
before `<main>` is reached. Expect the visible nav only.

### 1.2 The shared "ⓘ" tooltip trigger is unreachable by keyboard

**Severity: Critical. One component, 55 call sites across 31 files.**

`components/Tip.tsx:41-46` renders a `<span>` carrying `onClick` and
`onMouseEnter`, with no `tabIndex`, no `role` and no `onKeyDown`.

Measured on `/dashboard`:

```
inline-flex spans containing "ⓘ": 8
  keyboard-focusable: 0    role: 0    tabindex: 0
```

A keyboard-only user cannot focus any of them, so the click handler is
unreachable for that user regardless of what it does.

**WCAG:** 2.1.1 Keyboard (A).

**Fix direction:** make the trigger a real `<button type="button">`, add
`onFocus`/`onBlur` alongside the existing mouse handlers so focus opens the tip,
give the portalled tooltip `role="tooltip"` and an `id`, and reference it from
the trigger via `aria-describedby`. One component fixes all 55 sites.

### 1.3 Colour contrast — audit §4.3 CONFIRMED by an independent tool

Audit §4.3 ends with an explicit instruction that had never been carried out:

> **Before acting on this section, run a real tool** (axe-core, Lighthouse, or
> Chrome DevTools' own contrast picker) to confirm.

Done. axe-core, WCAG A+AA, desktop:

```
[serious] color-contrast — 37 nodes across 9 routes
  .nav-more-btn.on.desktop-nav-item
    contrast 3.98  (foreground #ffffff, background #1a7aff, 16px normal)
```

axe independently reproduces **3.98:1** — matching to two decimals the figure
produced by a checker its own author had flagged as unreliable. Also confirmed:

| Ratio | Where | Colours |
|---|---|---|
| **3.98** | every active nav pill + the primary CTA | `#ffffff` on `#1a7aff` |
| **2.06** | `/scanner`, 21 nodes | `#444444` on `#06070a` |
| **3.79** | `/scanner` `.mr-scale-good` | `#656b7e` on `#06070a` |

Plus `select-name` (**critical**): the `/liq` `<select>` has no implicit or
explicit label — the fourth unnamed control from audit §4.2, and the worst of
them.

**The design-token change is justified.** Proceed with it.

### 1.4 A failed labels fetch wipes the English fallback and renders raw keys sitewide

**Severity: High. Latent on production today. Found via CI, not by looking.**

Surfaced when the `e2e` job ran on a GitHub runner without Supabase env vars.
Two failures that looked like layout bugs turned out to share one cause:

```
/arena overflows by 28px at desktop
  div.app-bar-right  "LONDON OPEN · 1h 54m EN NAV_SIGN_IN"
  a.auth-signin-btn  "NAV_SIGN_IN"
  div.nav-menu       "NAV_SECTION_MAIN NAV_DASHBOARD NAV_BRIEFIN…"
  scrollWidth 1468 vs innerWidth 1440

/markets CLS 0.255, and 0.256 on retry   (budget 0.1)
```

Those are **raw i18n label keys**, not text. Unresolved keys are longer than
their English strings, so the layout widens and reflows.

`PENDING.md` records a fix for exactly this — seeding `lib/labelDefaults.en.json`
so that "worst case is now a brief English flash before the real locale loads,
**never a raw key**." The seed is intact and correct: 2,570 keys, and
`NAV_SIGN_IN → "Sign In"` is present. It is being **overwritten**.

Two fail-open designs that do not compose:

`app/api/labels/route.ts`
```
 12:  // empty object on any error rather than 500ing the page; the client's t()
 93:  } catch { /* fail open to {} */ }
106:  if (Object.keys(data).length === 0) {
107:    return NextResponse.json(data, …)      // HTTP 200 carrying {}
```

`components/LabelsProvider.tsx:59-66`
```js
fetch(`/api/labels?locale=${l}`)
  .then(r => r.json())
  .then(data => {
    setMap(data);            // ← unconditional; {} replaces 2,570 defaults
    saveCachedMap(l, data);
  })
  .catch(() => { /* keep last-known map on transient failure */ })
```

The route deliberately returns `200 {}` on any DB error, trusting the client to
fall back. The client's `.catch` covers a *network* failure but not a
**successful response carrying an empty object**, so `setMap({})` destroys the
seed. Each half is defensible alone; together they render every label in the app
as its raw key.

**Why it matters beyond CI.** Production is fine today — Supabase is up and the
labels table is populated. But any Supabase incident, an RLS change, or the
PostgREST `db-max-rows` cap that this same route warns about at line 62 would
turn the entire UI into `NAV_SIGN_IN` / `NAV_DASHBOARD` / `NAV_SECTION_MAIN`,
silently, with no error anywhere.

**Fix direction:** do not install an empty or non-object payload over the
defaults, e.g.
`setMap(data && Object.keys(data).length ? data : DEFAULT_EN_LABELS)`, or merge
the response over `DEFAULT_EN_LABELS` so a partial response degrades to English
rather than to keys.

**Not introduced by the 2026-08-05 release** — `LabelsProvider.tsx` is not in
that diff. Pre-existing and unrelated to it.

---

## 2. ⚠️ Correction to our own finding — the tap-target number is mislabelled

Audit §4.1 reports "159 tap targets below the 24px WCAG 2.2 AA floor";
`QA_E2E_FINDINGS_2026-08-05.md` §1.2 corrected the count to 217 and kept the
same framing. **The count is right. The conformance claim is not.**

axe's `target-size` rule, run at iPhone 13 metrics (390×844):

```
/playbook   violations=0  incomplete=0  passes=156
/scanner    violations=0  incomplete=0  passes=106
/refund     violations=0  incomplete=0  passes= 94
```

The rule ran — it is not disabled or inapplicable — and passed every target,
including `/playbook`'s 55 `button.pb-star` controls measured at 16×13.

WCAG 2.2 SC 2.5.8 carries exceptions that a `getBoundingClientRect()` sweep does
not model:

- **Spacing** — an undersized target conforms if a 24px-diameter circle centred
  on it does not intersect the circle of any other target.
- **Inline** — targets within a sentence or block of text are exempt entirely.
  That covers the footer links, which are 112 of the 217.

**Consequence for the work queue.** Audit §8 ranks "fix `.pf-footer-*` tap-target
heights" at #3 and the 14×16 close buttons at #4, both justified as AA
conformance. On this evidence they are **ergonomics, not conformance failures**,
and belong below the contrast work. Still worth doing — the app is an installable
PWA and the 44px Apple HIG target stands, as audit §4.1 already noted — but not
as AA blockers.

`BASELINE.tapTargetsUnder24` in `qa/e2e/_shared.ts` stays at 217, because the
count is accurate and the ratchet still catches regressions. Its comment needs
correcting to say what it actually measures: elements under 24px, not SC 2.5.8
violations.

⚠️ Worth one human spot-check with a ruler before formally downgrading this.
axe's `target-size` implementation has its own limits, and "0 violations, 0
incomplete" everywhere is a strong claim. But the burden of proof has shifted.

---

## 3. `/scanner` CLS — full before/after data

Three builds, 10 consecutive identical loads each, desktop 1440×900, production
build, 2.5s hydration wait then buffered `layout-shift` entries.

| Build | values | min | mean | max |
|---|---|---|---|---|
| `main`, no fixes | 1.289 1.138 1.185 1.341 1.659 1.836 1.452 1.724 0.775 2.312 | 0.775 | **1.471** | **2.312** |
| `dev`, + `fix/scanner-layout-shift` | 1.693 1.278 1.196 1.535 0.861 1.221 1.330 1.440 1.276 0.622 | 0.622 | **1.245** | **1.693** |
| release, + `fix/scanner-card-layout-shift` | 0.028 0.149 0.246 0.176 0.232 0.178 0.041 0.229 0.037 0.220 | 0.028 | **0.154** | **0.246** |

Same release against staging (`liquidity-hq-qa.onrender.com`), 6 runs:
min 0.022, mean 0.117, max 0.199.

Local and staging agree on magnitude. The absolute numbers differ because these
shifts are **data-arrival dependent** — anything that moves when data lands
(network latency, cache warmth, cold start) moves the measurement.

**That property is also why the fix worked.** This was never an unsized element
with a stable wrong value; it was a race whose magnitude depended on timing.
Reserving space removes the dependency on *when* data arrives, which is why two
independently-measured baselines both collapsed by ~10× from different starting
points.

Other routes, release build, same method:

| Route | before | after |
|---|---|---|
| `/arena` | 0.364 — one 0.297 shift at ~1s from `FOOTER.pf-footer` | **0.026** |
| `/briefing` | 0.167 | 0.107 — still above 0.1, no fix attempted |
| `/dashboard` | 0.006 | 0.006 |
| `/` | 0 | 0 |

**Two follow-ups:**

1. `/scanner` is now bounded enough for a real budget. At 0.028–0.246 it no
   longer needs the `CLS_UNSTABLE` treatment proposed in PR #22 — a
   `CLS_BUDGET` of ~0.30 would hold. QA will revise that branch.
2. **`/briefing` at 0.107 is now the last route above the "good" threshold**,
   driven by five `DIV.card` (`.mb-brief-card`) elements resizing once data
   arrives. Same shape as `/scanner`, presumably the same fix.

**Correction to an earlier QA report:** the scanner fix was initially measured at
0.691 over **3** runs and reported as insufficient. Ten runs show 0.246. The
3-run sample was an undersampled fluke; the fix is substantially better than
first stated.

---

## 4. 🔴 The authenticated surface has never been tested

Measured signed-out against the release build:

```
/settings   inputs=2   .st-input / .st-field-label = 0
/journal    inputs=2   .tj-inp   / .tj-lbl         = 0
```

Neither form renders. An axe pass on `/settings` therefore returns "no
violations" while proving **nothing** — the controls do not exist to be checked.

This is the same failure mode that makes an unseeded BOLA test dangerous: a
vacuous pass is indistinguishable from a genuine one.

### Findings that cannot be confirmed or refuted until this is fixed

A source-level review produced 28 findings. Three were runtime-testable: §1.1
and §1.2 above were confirmed (§1.1 was *understated* by 2×), one was
untestable. The rest touch surfaces behind auth. Recorded here so they are not
lost, and explicitly marked **UNVERIFIED — do not action yet**:

| # | Claim | File |
|---|---|---|
| U1 | ~24 Settings inputs: visible `<label>` with no `htmlFor` and no `aria-label` fallback | `components/SettingsModal.tsx`, `app/settings/page.tsx` |
| U2 | TradeJournal `aria-label` strings drifted from visible labels — "Entry \*" vs "Entry" | `components/TradeJournal.tsx:854-874` |
| U3 | TradeJournal inline-edit: 4 controls with no accessible name at all | `components/TradeJournal.tsx:1148-1186` |
| U4 | Rule-builder selects: no label, visible or hidden | `components/TradeJournal.tsx:1361-1443` |
| U5 | Auth error messages lack `role="alert"` — failures are silent to AT | `app/login/page.tsx:298,401` and the reset/forgot pages |
| U6 | GrokChat replies arrive with no `aria-live` announcement | `components/GrokChat.tsx:789` |

U2 is worth flagging early even unverified: it is the `HANDOVER.md` §14
anti-pattern forming. If someone "fixes" it by adding `htmlFor`/`id` **without**
deleting the `aria-label`, they recreate the documented voice-control defect
exactly, because `aria-label` overrides an explicit association too.

One further unverified finding is **not** behind auth and is worth checking
independently: `components/BeamsBackground.tsx` runs an uncapped
`requestAnimationFrame` loop plus a `repeat: Infinity` Motion animation with no
`prefers-reduced-motion` check anywhere in the file. That is WCAG 2.2.2 Pause,
Stop, Hide at **Level A**, on the public marketing homepage.

---

## 5. Blocking asks

### 5.1 Two seeded test accounts — owner / dev

Unblocks BOLA/IDOR (OWASP API #1, still the largest untested area) **and** the
six findings in §4.

**They must be seeded.** Account A needs ≥1 row in the trade journal, price
alerts, settings, hypotheses and a subscription row, plus the row IDs, since the
test must request them explicitly. Account B only needs to log in.

Credentials, not tokens — access tokens expire in ~1h, so a pasted token works
once and breaks CI the next day. With email + password a fresh token is minted
per run.

`.env.e2e.local` in the QA checkout (`.gitignore` already covers `.env*`):

```
E2E_USER_A_EMAIL=...
E2E_USER_A_PASSWORD=...
E2E_USER_B_EMAIL=...
E2E_USER_B_PASSWORD=...
```

Dev Supabase only (`wdtjhrilakoitfcezxpx`). Never prod. Never the service-role
key. Both accounts must be email-confirmed or the login call returns 400.

### 5.2 ✅ DONE — three GitHub repo secrets

`E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY`, `E2E_TURNSTILE_SITE_KEY` were added
by the owner on 2026-08-05 and confirmed present. The `e2e` job's four failures
on `main` were all traceable to their absence — two `/login` specs directly, and
`/arena` overflow plus `/markets` CLS via §1.4's raw-key cascade.

Worth keeping in mind for the future: that run is the reason §1.4 was found at
all. Running the suite in a **degraded** environment surfaced a latent
production defect that a fully-configured run would have hidden. That is an
argument for occasionally testing without env on purpose, not only with it.

---

## 6. Reproducing

axe-core is deliberately **not** a project dependency. Install it anywhere
outside the repo and inject it:

```js
const axeSource = fs.readFileSync('<path>/axe-core/axe.min.js', 'utf8');
await page.addScriptTag({ content: axeSource });
const res = await page.evaluate(() => window.axe.run(document, {
  runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'] },
}));
```

Two traps worth knowing:

- **Read `incomplete`, not just `violations`.** axe reports cases it cannot
  decide as `incomplete`. A rule returning nothing in `violations` may simply
  have deferred to manual review — reporting that as "clean" would be wrong.
  §2's conclusion depended on checking that `target-size` had 0 in *both*.
- **Check the page actually rendered what you are auditing.** §4 exists because
  a clean axe result on `/settings` meant only that the form was not on screen.
