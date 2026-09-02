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
| Mobile overflow, ~76px, every route | dev | `.app-bar` at 466px. **Pre-existing** — `?design=current` does it too |
| Placeholder dashes at 1.16:1 | **design** | 50 on `/scanner` alone. Needs a legibility decision, not a guess |
| Coin badge hues (`#f7931a`, `#627eea`, …) | **owner** | 12 hash-assigned decorative colours vs criterion 19 |
| `/correlation` has no design frame | design | own route, own `CorrelationTerminal.tsx` |
| Gating: Alerts absent-not-locked, Settings `disabled` + lock glyph | dev | highest severity — leaks paid surface |
| E2E | **owner** | costs money; run at finalisation |

## 9. What no audit can score

These need controlled fixtures, not a live sweep. They are **unverified**, not
passed:

`funding.md` #1 (frColor vs frSignal granularity at exactly 0.012) ·
`briefing.md` #3 and `liquidation-map.md` #3 (absent-not-dashed on null feeds) ·
`markets.md` #3–4 (sort behaviour, active-state exclusivity) ·
`alerts.md` #6–7 (10-coin and 3-timeframe caps) · `settings.md` #5 (locked chip
does not change selection).
