# Design handoff — what we still need

**To:** Design
**From:** QA
**Date:** 2026-09-01
**Re:** Monochrome Terminal redesign, 31 screens

Generated from `node qa/audit-handoff.mjs`. Re-run it any time — it reads the
directory rather than anyone's memory, so it will not drift from what you have
actually delivered.

---

## First, what has landed and is good

Thank you — the 14 screens delivered today closed the whole coverage gap.

- **31 canvases**, every user-facing route covered.
- **Desktop 1440 artboard: 31/31.**
- **Mobile 390 artboard: 31/31.**
- `support.js` and `assets/logo.png` present, so the canvases render.
- `Dashboard.dc.html` answers a standing question — it is titled *"2A · Desk ·
  read band + coin table"*, which is the `Desk 2a` frame our code has been
  citing in comments with no file behind it.

Nothing below is a complaint about coverage. It is about the three things a
screen needs before we can build it correctly and prove it.

---

## 1. Specs — missing on 30 of 31 screens

**This is the one that blocks us.**

`design_handoff_arena/specs/arena.md` is the model, and it is genuinely
excellent. It gives us:

- per-panel geometry (rail 352, chart 430, panel headers 30, rail headers 28)
- the colour-is-data rules — *"in the evidence grid, 2 of 8 rows carry colour.
  Six are quiet, and four of those six hold positive numbers. Colouring them
  green would look better, be wrong, and pass every automated check"*
- extend rules — what happens when production returns 50 coins and the frame
  drew 8
- honest labels — `Liq 24h` ships as `Liq 15m`; `CB prem` is an em dash
- **35 numbered acceptance criteria** we score against
- an explicit *Could not determine* section listing open questions

Because Arena has that, we produced a conformance audit that found 9 real
failures with measurements behind each one. **For the other 30 screens we can
measure a canvas, but there is nothing authored to score against** — no stated
fidelity level, no extend rules, no statement of which values were measured
versus reconstructed.

Without it we end up inventing intent, which we have already done once this
session and had to throw away.

**Requested, in priority order** — we do not need 30 at once:

| Priority | Screens | Why first |
|---|---|---|
| 1 | **Dashboard**, **Journal** | Highest traffic. Dashboard is already implemented and may diverge from your frame — see §4. |
| 2 | **Markets**, **Setup Scanner**, **Alerts** | Dense data tables; extend rules matter most here. |
| 3 | **Liquidation Map**, **Funding - Correlation**, **Briefing** | Charting and colour-as-data. |
| 4 | Settings, Calculator, Economic Calendar, News, Upgrade, Login - Forgot Password | Form and content screens. |
| 5 | The 15 static/utility screens | Lowest risk; token conformance may be enough. |

If a full spec per screen is too much, the parts we would take first are
**numbered acceptance criteria** and the **colour-is-data rules**. Geometry we
can measure off the canvas; intent we cannot.

## 2. READMEs — missing on 30 of 31

Arena's README carries what the spec does not: fidelity level, which values are
measured versus reasoned reconstruction, what is out of scope, and the *Open
decisions* list naming what needs the owner.

That last part matters more than it looks. Arena's README says plainly that four
values are reconstructions and that one of them — mobile verdict 26px — is *"a
ratio argument with no sibling and no README line behind it"*. Knowing which
numbers are soft stops us reporting a defect against a value you were never
certain of.

A short README per screen is fine. It does not need Arena's depth.

## 3. Light theme — missing on 31 of 31

**No screen has a light artboard.** Every canvas is dark-only.

The product ships a light theme, users can switch to it, and the owner has set
the standard that every screen is signed off in **dark, light and 390 mobile**.
So we are currently shipping a theme with no design behind it, and we have
already found real defects in it — a badge at 3.09:1 and a form border at
1.38:1, both light-theme only.

**Important: the dark palette cannot simply be inverted.** We measured all four
dark accents against a light ground and every one fails WCAG AA:

| Token | Dark value | On white | Needs |
|---|---|---|---|
| `--accent` | `#d9a626` | **2.23:1** | ≥4.5:1 |
| `--green` | `#3fb950` | **2.56:1** | ≥4.5:1 |
| `--red` | `#f0524d` | **3.49:1** | ≥4.5:1 |
| `--amber` | `#f0a626` | **2.14:1** | ≥4.5:1 |

So light theme needs its own accent values, chosen by you rather than derived by
us. We can propose a set if that is useful, but we would rather you own it.

**We are not asking for 31 light artboards.** What would unblock us is a
**light-theme token set plus one or two worked screens** showing how the palette
behaves on a light ground — enough to extrapolate the rest.

## 4. Token values are superseded in 31 of 31 canvases

Not a request so much as a heads-up, and an apology for a moving target.

The owner ratified an amendment to three tokens today. Your canvases predate it,
so all 31 draw the old values:

| Token | Canvas draws | Now | Why it changed |
|---|---|---|---|
| `--txt3` | `#5a5f66` (31/31) | **`#7c828a`** | `#5a5f66` measures **3.10:1** on `--bg0`. `specs/arena.md` §Accessibility lists `--txt3`/`--bg0` as a pair that must clear **4.5:1** — the spec's own value failed the spec's own bar. |
| `--bg1` | `#0c0d0f` (25/31) | **`#141517`** | 13 hex units off `--bg0`; imperceptible as a card boundary. |
| `--border-input` | `#2a2e32` (28/31) | **`#5e646b`** | **1.36:1**; WCAG 1.4.11 wants 3:1 for component boundaries. |

The amendment is recorded in `design_handoff_arena/README.md` §Design tokens with
both original and new values, and in `specs/arena.md` §Accessibility.

**Geometry in your canvases is unaffected and we are still measuring from it.**
Only colour is stale. No need to redraw 31 files — but if there is a source these
were generated from, updating the three values there would stop the next batch
inheriting them.

## 5. One question on Dashboard specifically

`Dashboard.dc.html` is *"read band + coin table"*. The implemented
`DashboardTerminal.tsx` documents itself as mirroring the existing Dashboard's
component structure exactly, changing only visuals.

Those may not be the same layout. **We have not finished comparing them and are
not claiming a mismatch** — but if your frame is a restructure rather than a
restyle, that is a much larger piece of work than the other screens and we would
like to know before anyone starts.

Arena's README states this distinction explicitly at the top — *"this is a
restyle, not a restructure"* — and that one line saved a lot of argument. A
sentence like it on Dashboard would do the same.

---

## Summary of the ask

1. **Specs** — Dashboard and Journal first. Acceptance criteria and
   colour-is-data rules are the parts we most need.
2. **Short READMEs** — especially which values are firm versus reconstructed.
3. **Light theme** — a token set plus one or two worked screens, not 31.
4. **Restyle or restructure?** — one line on Dashboard.

Nothing here blocks the token, radius and contrast conformance work, which is
already underway across all 31 screens against the global rules in Arena's
README. It blocks per-screen geometry and layout conformance, which we cannot
begin without something authored to check against.

Happy to do a pass ourselves and have you correct it if that is faster — but we
did not want to invent intent and present it as yours.

— QA Team
