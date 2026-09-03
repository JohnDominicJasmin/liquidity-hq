# Terminal redesign — QA state

**Written 2026-09-02.** Where the Monochrome Terminal redesign actually stands,
what has been measured, what has not, and the traps that cost time.

This file records **state**, and state goes stale. If it and the code disagree,
the code wins — then fix this file.

---

## 1. Working agreement (owner-set, non-negotiable)

**Batch. Never one fix, then a review cycle, repeated.**

The banned loop: dev ships one small change → QA verifies → dev ships the next →
QA verifies again. On 2026-09-01 that produced **six deploys in one evening** for
work that was one batch, and ~30 branches for what should have been three.

The pattern instead:

1. Group related work into one batch — a screen's whole fix list, or a whole
   category (all radius, all palette, all gating) across screens.
2. Dev implements the **entire batch**, ships one PR, one deploy.
3. QA verifies the whole batch in one pass.
4. Failures return as **one consolidated list**, fixed together, re-verified once.

**Do not file a one-line defect as its own issue.** A colour swap or a single
contrast value is a line item inside a larger issue. Six separate tickets were
filed for one afternoon's work on one component before this rule existed; they
were consolidated into one.

**Done means the whole platform** — audited and tested in dark, light, dialogs
and mobile, ready for E2E. Not one screen. Not "6 of 9 criteria".

---

## 2. What is verified, and on which build

| Area | State | Build |
|---|---|---|
| Dark-theme token governance | off-palette 426 → 236 across 60 dark rows | `128198c` |
| Sub-24px targets | 64 → 44 | `128198c` |
| Radius, with the ruling's carve-out applied | 292 → 312 | `128198c` |
| Terminal **light** theme | **built, unverified at time of writing** | `#563` |
| Mobile | **overflows on 50 of 60 rows** | `128198c` |
| E2E | **never run** | — |

Baselines are committed: `qa/platform-audit-0d2e54a.txt`,
`qa/platform-audit-128198c.txt`.

---

## 3. Tooling

| Script | What it answers |
|---|---|
| `qa/platform-audit.mjs` | every route × {desktop, mobile} × {dark, light}, one table |
| `qa/contrast-diff.mjs` | *which* elements fail contrast, grouped by class + colour pair |
| `qa/mobile-audit.mjs` | one route at 390px |
| `qa/mobile-overflow.mjs` | *what* pushes a page wider than the viewport |
| `qa/audit-handoff.mjs` | what the design handoff is missing |

Run with `MSYS_NO_PATHCONV=1` in Git Bash — otherwise `/dashboard` is mangled
into a Windows path.

---

## 4. Measurement traps — every one of these produced a wrong finding

Each cost a round trip with dev. They are listed because they will recur.

### THE ONE THAT MATTERS MOST: never say "verified" about a page you have not looked at

On 2026-09-02 `/dashboard` and `/` were both reported **verified and signed
off** on Playwright criterion runs alone. Nobody had opened either page.

Two things were wrong with that, and the second is worse than the first.

**The checks could not have failed.** Every run set
`localStorage.lhq-design-mode = 'terminal'` in an `addInitScript` before
navigating. The `?design=terminal` URL flag was therefore never exercised —
if it had been broken, every criterion would still have passed. The build
happened to be correct, so the reports happened to be true. That is luck, not
verification.

**The criteria did not cover what a person sees.** `specs/landing.md` has 21
criteria and **not one asserts a colour**. Landing scored 20/21 while rendering
the current design's `#050505` ground and `#1a7aff` accent in light theme
(#595), and while `Sign In` stood 55px tall inside a 52px nav. The owner found
both in under a minute by opening the URL.

**The standing rule, and it is not negotiable:**

> Render the page and read the image before the word *verified* is used.
> Dark **and** light, desktop **and** mobile. Every screen, every time.

Practical form:

- Drive the design flag **the way a person does** — through the URL. Never
  pre-seed storage, or the check cannot fail.
- **Screenshot first**, probe second. A `getComputedStyle(null)` in a probe
  killed an 8-shot loop after one file.
- **Screenshot and measurement must come from the same page instance.** Taking
  them from two runs compares two different market states — that produced
  flatly contradictory answers about whether a text collision existed.
- **Gate on paint before capturing.** A wedged context returns a blank frame
  that looks exactly like a crashed page. Three blank captures were nearly
  filed as bugs, and one *was* announced before being retracted.
- **Do not mutate the DOM before capturing.** Removing `[class*="consent"]`
  nodes matched something structural on `/arena` and produced blank frames.
- **Then still read the source before calling anything a defect.** The blue
  `LIQUIDITYHQ` mark looked like drift and is documented as correct in
  `BrandMark.tsx` — the handoff's own `logo.png` colours.

### Three checks that find what criteria cannot

Added after the above, labelled `Q` so they are never mistaken for handoff
criteria. Each exists because a specific defect scored clean:

| | asserts | why a criterion missed it |
|---|---|---|
| `Q1` | the ground and CTA **paint** the terminal tokens | the root tokens were *correct*; the page ignored them, so any `getPropertyValue` read passed |
| `Q2` | no leaf's text is wider than its own box (`scrollWidth > clientWidth`) | the two element boxes did not intersect and page-level overflow was 0, yet the string painted 40px across its neighbour |
| `Q3` | every nav/band child fits its parent | `C11`/`C18` assert the nav's own height, which was correctly 52 while its child rendered 55 |

`Q4` (arena) generalises dev's `.at-chart` root-cause: any fixed-height box
whose content spills with `overflow-y: visible`.

### A checker that reports phantom defects is worse than no checker

The first arena run produced **five failures that were the checker's, not the
build's** — 0 padlocked chips on a row that visibly has three, "nav 44 failed"
against the app shell's nav, a missing chart that was present, a 5-region root
scored as a failed 7, and a two-unit colour difference. Sending those would
have cost dev a cycle chasing nothing.

**Look at the render before filing.** Three passing criteria that contradict a
failing one is the tell — it was the tell on #572 too, and it was explained
away then.

---

**Alpha compositing.** Reading the first non-transparent ancestor background as
opaque reported **20 contrast failures that did not exist**. Translucent tint
layers must be composited down to an opaque base before computing a ratio.

**`getComputedStyle` cannot distinguish a literal from a `var()`.** 14
occurrences of `#2a2e32` were reported as hardcoded literals; they were correct
token reads. Computed styles report *resolved* values. Open the stylesheet.

**Shell chrome is permanently in the DOM, offscreen, at full size.** `.nav-menu`
(360×939) and `.gchat-panel` do not unmount and `Escape` does not close them.
Scoping a sweep to `body *` attributes shell-wide colours to whichever route is
being measured — it inflated one route's count from 15 to 26 distinct.

**The Dashboard mounts two `.dashboard-grid` trees during the design-mode
transition** — the real one plus a 0×0 phantom with `-` prices and every row
`▲ 0.00%`. It has been observed settling anywhere from 20s to 127s on qa's free
tier. **Do not wait for it to settle**; scope to the visible grid:
`[...document.querySelectorAll('.dashboard-grid')].find(g => g.getBoundingClientRect().width > 0)`.
The phantom produced a false "4 of 7 rows unfixed" report and nearly a false
criterion-25 double-mount bug.

**Check the deployed commit before measuring.** A stale-deploy read produced a
"the fix did not work" report on a fix that had worked, and sent dev building a
theory on it. Always confirm `/api/version` first.

**Read the property that matters.** A sweep over `color`, `background-color` and
`border-color` reported text-colour failures that were decorative 8%-alpha
tints. The text was correct.

**`resize_window` reports success and does not resize.** Three attempts,
`window.innerWidth` unchanged each time. Every "mobile" check before
`qa/mobile-audit.mjs` existed was silently running at desktop width. Use
Playwright.

**Aggregate counts double-count.** `/scanner`'s 392 "empty fields" and 51
"contrast failures" are largely the *same* 50 placeholder dashes. Headline
numbers overstate; `contrast-diff.mjs` exists because of this.

**Text on a tint of ITSELF is structurally marginal in light theme.**
`PerpSpotCard`'s verdict pill sets `color: tone` with
`background: color-mix(in srgb, tone 12%, transparent)`. A self-tint moves the
**surface toward the text colour**. In dark the tone is lighter than the card,
so it starts from a large margin and survives; in light the tone is darker, the
tint drags the surface down toward it, and the margin was never large.

Computed across all four states × both themes — deterministic from the tokens,
so states the market may not produce for days are still checkable:

| state | tone | light | dark |
|---|---|---|---|
| perp | `--amber` | 4.66 pass | 8.63 pass |
| spot | `--green-2` | **4.04 FAIL** | 6.00 pass |
| normal | `--txt2` | **4.41 FAIL** | 4.79 pass |
| unknown | `--txt3` | **4.06 FAIL** | **4.11 FAIL** |

**Four of eight fail**, and only one was ever observed live — the market moved
between runs, which is why it first looked flaky. It is not: the defect is
deterministic per state, only *which state renders* is not.

**RULED, and it is the standing pattern.** Design's call, 2026-09-02: the text
takes a fixed `--txt`, and the tone is carried by the tint alone — the same
shape as the correlation-diagonal fix. Their reasoning is the durable part:

> A self-tint where text colour equals tone colour is marginal in light *by
> construction*, and that does not go away by tuning alpha. Fixing text-colour
> once is **one rule**; tuning alpha per component is **seven tunings that can
> each drift back out of range** as content changes.

Applied to `PerpSpotCard` immediately. The other six sites inherit it **when
their canvas rebuilds land, not before** — a contrast fix applied now would be
thrown away by the rebuild.

**`withAlpha()` hides this from a grep.** `lib/color.ts:10` returns
`color-mix(...)`, so none of its 34 call sites match a search for
`color-mix(in srgb,`. Searching the *semantics* instead finds the same shape at
`arena:1374`, `arena:1521`, `briefing:781`, `liq:436`, `liq:513`, `liq:562` —
seven components across four routes, alphas 8–13%, none of their states
measured. **Grep what a helper produces, not what call sites spell out.**

**A check that cannot report failure is worse than no check — it gets trusted.**
Two instances the same night, from both sessions:

- **QA:** `spec-conformance.mjs` derived its expected sections by reading the
  rendered page, so C1/C2 confirmed the page matched *itself* and passed while
  `/dashboard` was 31% of its canvas.
- **Dev:** gates were chained as `lint && tsc && test && build; echo $?` — the
  `;` resets `$?` to the *echo's* status, so the gate printed `0` no matter
  which command failed. Caught before pushing; each gate now runs with its own
  captured exit code.

Different surfaces, one shape: **the check's verdict was structurally
independent of the thing it was checking.** Before trusting any pass, ask what
would have to be true for it to fail — and if the answer is "nothing", it is
not a check. State where each expected value came from; if the answer is "the
artifact under test", stop.

**An INVALID declaration and an ABSENT one look identical in computed styles.**
`EconCalendarWidget.tsx:145` had ``background: `${col}22` `` where `col` is
`'var(--red)'` — producing the string `var(--red)22`, which is not valid CSS.
The browser drops the whole declaration silently, so `getComputedStyle` returns
`rgba(0, 0, 0, 0)`. I measured exactly that, read it as "transparent by
design", and moved on. The chip had **never** rendered its tint.

A computed-style sweep can only ever tell you what the element resolved to, not
that the author wrote something the parser rejected. So **`transparent`,
`initial` and "the cascade fell through" are all indistinguishable from
"deliberate"** — treat an unexpectedly empty value as a question, not an answer,
especially next to siblings that do have one. Dev found this by reading the
source after my locator pointed at the element; measurement alone would never
have surfaced it.

Grepped for the pattern platform-wide afterwards: that was the only instance,
and the codebase has a correct `withAlpha()` helper used in 129 places.

**A fixed sleep does not report that it was too short — it reports zero.**
`token-surfaces.mjs` waited a fixed 4500ms. Enough for most routes; **not**
enough for `/correlation`'s 2500-cell heatmap on the free tier. The desktop run
recorded no `corr-cell` rows at all — not zero failures, zero rows — which read
first as "route not covered", then (on a 9s probe) as "route renders nothing at
desktop", a serious defect that does not exist. It renders 2500 cells at every
width from 390 to 1440, both themes, both design modes; only the wait differed.
**Three consecutive readings of one route, all wrong, all from a fixed sleep.**
Wait for the DOM to stop growing instead:
`waitForFunction(() => { const n = document.querySelectorAll('body *').length;
const p = window.__prev; window.__prev = n; return p !== undefined && n === p && n > 0; })`.
Same failure as the Dashboard double-mount, different symptom.

**The right unit for finding a problem is the wrong unit for sizing it.**
`token-surfaces.mjs` reported light-theme failures going **52 (desktop) → 77
(mobile)**, which reads as "mobile is far worse". It is not. Grouped by
component, effectively all of the increase is `/correlation`'s heatmap — 24
near-identical surfaces from one continuous gradient (`#99dfc3` … `#b2e2ce`,
all 4.01–4.30:1), i.e. **one defect on one component counted 24 times.**
Per-surface aggregation is correct for locating a cause and misleading as a
headline. Group by component before quoting a number. This is the same failure
as `/scanner`'s 392 "empty fields" being 50 dashes.

**A detector that matches too broadly invents failures.** `gating-audit.mjs`
counted any descendant `<svg>` as a lock glyph and reported **4 "locked but
enabled" paid-surface leaks** on `/settings` — the theme chips' sun/moon icons
and the Ask-AI FAB. All four were fabricated; the real count is zero. Require
the thing you are detecting to identify itself (a lock-named class, the glyph,
an accessible name that says so), and be suspicious of any check that finds a
defect on a surface nobody has complained about.

**A token has one value and many contrast ratios.** One figure per token,
measured against the page canvas, is the token's *best* case — and it is what
`light-theme-tokens.md` recorded. It let three values ship that fail on the
surfaces they actually land on. `--txt3` light `#6a6e73` was documented at
5.14:1 on `--bg0` while measuring **3.93:1** on `--bg2` and 4.26:1 on the
composited `#e8eaed`; `--green` light `#1a7f37` was documented at 4.70:1 and
measures **3.89:1** on `--bg2`.

The binding surface **differs per token, and is sometimes not a token at all** —
the `/scanner` em dash lands on a composited `#1d1e20` that appears in no
palette. So a single "darkest surface" column does not close this either; it has
to be derived per token from where that token is actually used. Design is
restructuring the file accordingly: a per-token usage list, each entry naming
its real landing surface (token or composited hex) and the ratio there.

Two rounds of wrong values came out of this, on both sides. Check a candidate
against every surface it lands on **before** relaying it to dev.

### `color(srgb …)` channels are 0–1, `rgb()` channels are 0–255

The one that has done the most damage, because it was silent and it was in
**eight** scripts at once.

`getComputedStyle` does not normalise colour syntax. A plain declaration comes
back as `rgb(240, 82, 77)`. A `color-mix()` result comes back as
`color(srgb 0.941176 0.321569 0.301961 / 0.8)` — the same colour, channels
scaled 0–1. Every parser in `qa/` read the numbers positionally and assumed
0–255, so **every translucent modern-syntax colour composited to near-black**.

On the terminal landing build that reported 50 ticker cells at **1.04:1** —
invisible text. The real figure is **3.96:1**.

```js
const k = /^color\(/.test(c.trim()) ? 255 : 1;   // scale by PREFIX
```

Detect by prefix, never by value range: a genuine `rgb(0, 1, 2)` must not be
rescaled.

**Why this reaches further than one screen.** `lib/color.ts`'s `withAlpha()`
returns `color-mix()`, and it has 34 call sites. So every contrast number these
tools produced at a `withAlpha()` call site was computed wrong. The bug only
ever manufactures failures and never hides them — no past PASS is in doubt —
but any *failure* reported on a translucent value has to be re-derived before
anyone acts on it. Fixed in `180dd6f`.

The general shape, and the third instance of it this project: **a measurement
that reads a browser's output positionally is assuming a serialisation the
browser never promised.** The lock-detector counting any `<svg>` and the
palette check reading raw RGB of translucent declarations were the same
mistake in different clothes.

### A locator keyed to one design's class prefix fails silently under the other

Both designs coexist behind `?design=terminal`, and the terminal build names
its landing root `.lpt-root` where the current design uses `.lp-root`. Six
criteria in `qa/landing-conformance.mjs` were keyed to `lp-`:

| Reported | Actually |
|---|---|
| C1 — 2 top-level sections (`main.app-content`, `div.consent-bar`) | 8, correct |
| C3 — 0 feature cards | 6, correct |
| C5 — `-1` footer columns | 4, correct |
| C6 — 8 risk items | 6, correct |
| C7 — plans `$77` | `$0` / `$25`, correct |

Four false defects on a build that was right. C13 was simultaneously measuring
the very grid C3 said did not exist — **three passing criteria that
contradict a failing one is the tell**, and it is the same tell I explained
away on #572.

Prefer structure to class names: the footer's link grid is "the descendant of
`<footer>` that is `display: grid` with the most children holding ≥2 links",
which is true in either design and survives the next one.

---

## 5. The handoff contradicts itself in places — the files win

Three times the handoff's prose was wrong where its `.dc.html` files were right:

- **`dashboard-2a.md` specced `app/dashboard/page.tsx`**, which returns
  `<DashboardTerminal/>` early at line 519. Everything below that line is the
  non-terminal branch. The spec described the wrong component.
- **Token values** in the canvases predated the owner-approved amendment.
- **"Radius 0 everywhere"** (README:141) was contradicted by **29 of 30
  canvases**, which carry 4px, 5px, 6px and one 50%. `specs/radius-ruling.md`
  resolved it: radius 0 on rectangular surfaces; status dots, avatar/coin
  markers, toggle thumbs and step circles **≤24px stay 50%**.

Treat the `.dc.html` files as authoritative and the prose as commentary, and
verify any criterion against the files before scoring anyone against it.

---

## 6. Ungoverned tokens — a recurring class, five instances so far

A token used under `[data-design="terminal"]` but declared **only** at `:root`
inherits the current design's value in terminal mode. It is invisible to the
conformance test, which checks that the terminal block declares nothing
undocumented — but **not** that everything terminal *uses* is declared there.

Found so far, all incidentally: `--amber`, `--accent-2`, `--accent-bg` /
`--accent-bdr` (with `--purple` aliasing to them, which hid the leak at the
`--accent` level), `--fr-slight-long`, `--on-accent`.

**The query that closes the class**: every custom property referenced under
terminal scope but declared only at `:root`. Not yet run.

**The ungoverned RULE — the same failure one level up. 141 of them.**
A token can be ungoverned; so can an entire CSS rule. A selector scoped
`[data-theme="light"]` with no `[data-design]` applies in **both** design modes,
so a declaration written for the current design reaches terminal through the
cascade. Found via `globals.css:3862` — `[data-theme="light"] .gchat-fab {
color: #fff }` — which is why the FAB rendered white in terminal light and
nothing in dark (dark never matches the selector at all).

```
141  rules matching ^[data-theme="light|dark"] with no [data-design]
 75  of those set a hardcoded colour on in-content, non-shell selectors
```

Affected in-content components include `.liq-row`, `.gex-row`, `.arena-conf-bar`,
`.fng-bar-bg`, `.sms-gauge-track`, `.gchat-bubble` — all on redesign routes.

**Nothing we run can see this.** The conformance test checks the terminal token
block, and these are not tokens. `no-bare-hex-colour` reads TSX, not
stylesheets. A palette sweep sees the *resolved* colour and cannot tell which
rule supplied it. So they surface one at a time, on whichever route someone
happens to measure — which is exactly how this one was found.

Not all 75 are defects: shared shell chrome may be meant to look identical in
both designs. **Whether in-content `[data-theme]` rules must be design-scoped is
a design decision, not a cleanup task**, and is open with them.

**A second shape of the same class: the derivative that does not follow.**
When a base token's value changes, tints written as literals rather than
derived from it keep the old value. Found on 2026-09-02 after `--red`,
`--amber` and `--accent` light all moved: `--red-bg`/`--red-bdr` and
`--accent-bg`/`--accent-bdr`/`--accent-dim` were all still the pre-move colour.
The symptom is subtle and passes a contrast check — **the text is the new
colour on a tint of the old one**, so it reads as a hue mismatch rather than a
legibility failure, and only a per-surface palette sweep catches it.

**And the worst variant: correct by coincidence.** `--amber-bg`/`--amber-bdr`
were never declared in *either* terminal block. Dark rendered correctly anyway,
because `:root`'s fallback and terminal dark's `--amber` are both `#fbbf24` —
the same value by accident, not by declaration. Light had no such luck and fell
through to the current design's amber tint entirely. **A token can render right
for a reason that is not a rule**, and it will keep doing so until one of the
two values it accidentally matches is changed.

Whenever a base token moves, check its `-bg`, `-bdr`, `-dim`, `-2` and `-soft`
derivatives in *both* themes — and check that they are *declared*, not merely
resolving to something plausible.

---

## 7. Terminal had no light theme until #563

`globals.css:5315` reads `[data-design="terminal"]:not([data-theme="light"])`,
and no terminal+light block existed. In light, every route rendered the
**current design** — `--accent: #0052cc`, figtree — with only structural wrap
classes applied.

That guard came from PR #514, which fixed a real bug (terminal tokens beating
light on source order, black cards on a light page) and was reviewed and
approved by QA. **The guard was correct; its consequence was unexamined.** It
withheld a rule without anyone checking what won instead.

It invalidated 60 of 120 audit rows, which had been comparing the current
design's colours against the terminal palette.

**Do not remove the guard.** #563 adds a sibling block so all three states —
current/light, terminal/dark, terminal/light — have exactly one source of truth.

**Lesson worth keeping: when a fix withholds a rule, check what wins instead.**

---

## 8. Open, and who owns it

| Item | Owner | Note |
|---|---|---|
| Coin badge hues (`#f7931a`, `#627eea`, …) | **owner** | 12 hash-assigned decorative colours vs criterion 19 |
| `/correlation` has no design frame | design | own route, own `CorrelationTerminal.tsx` |
| Gating: Alerts absent-not-locked, Settings `disabled` + lock glyph | dev | highest severity — leaks paid surface |
| E2E | **owner** | costs money; run at finalisation |

### Closed in #567 — pending verification against the deploy

**Mobile overflow (#557), ~76px on every route.** Root cause was **not**
`.app-bar`, which is what I reported. `.pf-footer-nav` has `flex-shrink:0` and no
`flex-wrap`, so its 7 links never wrapped even after `.pf-footer-top` stacks at
640px; its unwrapped width inflated the *document's layout width*, and
`.app-bar` / `.nav-drawer` (`position:fixed; left:0; right:0`) resolve against
that rather than the visual viewport. Dev bisected it on the live deploy —
hiding only `.pf-footer-nav` drops `.app-bar` from 466px to exactly 390px. Fix
is `flex-wrap` at the existing breakpoint; it needed no
hamburger/wrap/scroll decision at all.

> **The widest element is not necessarily the cause.** I named `.app-bar`
> because I was reading which box overflowed, not which one inflated the width
> everything else resolved against.

**Light-theme token values — design has ruled on all three.**

| token | was | now | why |
|---|---|---|---|
| `--txt3` light | `#6a6e73` | `#5e6267` | 3.93:1 on `--bg2` → 4.70:1 |
| `--green` light | `#1a7f37` | `#14702c` | 3.89:1 on `--bg2` → 4.75:1 |
| empty-cell dash | inherited `--txt3` | own value `#848a92` | 4.30:1 on composited `#1d1e20` → 4.79:1 |

`--txt3` **dark stays `#7c828a`.** Moving a token that passes on three of four
surfaces, to fix one composited edge case, degrades what works to fix what is
local — so the dash gets its own value instead. Design, dev and QA reached that
independently.

The `--txt3` light change should take `/liq` light-theme contrast to **zero**:
all 18 failures across 11 distinct causes have `#6a6e73` as the foreground, and
every background involved clears 4.70 with the new value. Arithmetic, not yet a
measurement.

**Measured 2026-09-03: `/liq` reaches zero in both themes, and the route there
needed two more tokens.** The arithmetic above held, but it did not cover the
case that dominated the remaining failures.

### The `-fg` pattern — a foreground for a composited ground

| token | dark | light | for |
|---|---|---|---|
| `--txt-dash` | `#848a92` | `#4f5257` | muted text on a translucent overlay |
| `--green-fg` | `#3fb950` (= `--green`) | `#0f5a22` | positive value on a green tint |
| `--red-fg` | `#ff8a85` | `#7d0f18` | negative value on a red tint |

**The recurring failure is a signal colour on a wash of itself.** `/liq`'s
`.gex-net-chip` measured 4.05, `/econ-calendar`'s impact badge 4.04, and
`/scanner` runs 3.51–4.23 across four tint strengths. Same arithmetic each time:
the tint lifts the ground toward the foreground, and the stronger the signal the
worse the contrast — so the worst case is set by the data, not by a fixed value.

**Each `-fg` token aliases its base wherever the base passes**, so only the
composited case moves and the rest of the palette is untouched. That is the same
reasoning that kept `--txt3` dark at `#7c828a`: fix what is local, do not degrade
what works.

### Two things this pattern does NOT solve

**A data-driven tint can outrun any foreground.** `/scanner`'s green tint
`rgb(30,78,62)` puts `--green-fg` at 3.73 — it is stronger than the 12% wash the
token was sized against, and the next stronger mover would beat a new value too.
Recorded on #698 with three options; **the durable one is `/correlation`'s**,
where #570 moved the text to `--txt` and let the tint carry the meaning. That
measures 2450 cells at zero failures on production and cannot be reopened by a
stronger tint.

**A theme-aware overlay is not automatically safer than a literal.** Replacing
`rgba(255,255,255,0.025)` with `color-mix(in srgb, var(--txt) 2.5%, transparent)`
correctly stopped a dark-palette literal being painted in light — and made the
light row *darker*, taking `--txt3` there from 4.74 to 4.48. Nothing failed,
because every cell on that row had already moved to `--txt-dash`, but the row
went from a dark-only hazard to an all-theme one. **A tokenisation can move a
number in the direction nobody was watching.**

### A literal from the other palette is invisible from both sides

**Three instances on 2026-09-03**, and they share one signature: **a composited
ground that corresponds to no token in the palette being audited.**

| where | the literal | what it actually was |
|---|---|---|
| `/econ-calendar` impact badge | `rgba(248,113,113,…)` | current design's `--red` |
| `/scanner` heatmap tiles | `rgba(52,211,153,…)`, `rgba(248,113,113,…)` | current design's `--green-2`, `--red` |
| `qa/platform-audit.mjs` | five hard-coded hexes | superseded light values |

The failure is symmetric and that is what makes it hard to see. **Reading the
terminal stylesheet, the value is not there. Reading the current design's, it is
correct.** Only a composited measurement shows it, and then only as a ground
that matches nothing — on `/scanner` the measured grounds were `rgb(30,78,62)`
and `rgb(77,44,46)`, neither of which is any tint of terminal's `--green` or
`--red`. **QA recorded both as observed values and moved on; the mismatch was
the finding.**

It also skews the contrast in a way that hides its own size: terminal was
painting a *lighter* ground than its own palette would, so `/econ-calendar`'s
badge measured 4.04 where its own colour gives 4.49 — the literal made the
defect look worse than the token error it was, and tokenising alone closed most
of the gap.

**The check that catches it is compositing, not reading.** `color-mix(in srgb,
var(--token) N%, transparent)` cannot cross palettes; an `rgba()` literal always
can, and no source read on either side will say so.

### Opacity is not a fade tool here

Minimum opacity each token needs to hold 4.5:1 against `--bg1`:

| token | dark | light |
|---|---|---|
| `--txt` | 50% | 61% |
| `--txt2` | 87% | 91% |
| `--txt3` | 97% | 95% |
| `--txt-dash` | 91% | 85% |

**Only `--txt` survives a fade anyone would perceive.** A 0.45 stale-row fade
measured 1.87–1.93 and was removed rather than tuned (#692) — there was no safe
value to tune it to. If a de-emphasised state is wanted, a background tint or a
left border moves no text contrast.

## 9. What no audit can score

These need controlled fixtures, not a live sweep. They are **unverified**, not
passed:

`funding.md` #1 (frColor vs frSignal granularity at exactly 0.012) ·
`briefing.md` #3 and `liquidation-map.md` #3 (absent-not-dashed on null feeds) ·
`markets.md` #3–4 (sort behaviour, active-state exclusivity) ·
`alerts.md` #6–7 (10-coin and 3-timeframe caps) · `settings.md` #5 (locked chip
does not change selection).
