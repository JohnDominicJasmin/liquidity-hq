# Monochrome Terminal — screen-by-screen migration

The redesign is 31 screens. This file is the tracker: one row per screen, what
it maps to in the repo, and whether it has been built **against the frame**.

It exists because of one mistake worth not repeating. See "Read the frame, not
the summary" below before starting any screen.

---

## Where the design lives

Vendored into the repo so both sessions read the same source:

```
Codebase access granted/design_handoff_liquidityhq_terminal/
├── README.md                        the written spec (218 lines)
└── design_files/
    ├── Monochrome Terminal.dc.html          270 KB — 16 app screens
    ├── Monochrome Terminal - Static.dc.html  85 KB — 7 marketing/legal screens
    ├── Monochrome Terminal - States.dc.html  51 KB — 5 states
    ├── Monochrome Terminal - Tools.dc.html   49 KB — 3 tools
    ├── github.md                    screen → repo-file map
    ├── support.js                   the design tool's runtime (do not edit)
    └── assets/logo.png              18–26px in every nav bar and mobile header
```

### Opening a frame

Double-click any `.dc.html` — a normal browser tab opens `file://` fine. Each
file is one canvas holding several fixed-size frames side by side, each with an
amber id badge (`3A`, `1B`, …). Those ids are what the README and the table
below refer to.

If you are driving a browser through tooling that blocks `file://`, serve the
folder instead:

```bash
npx --yes http-server "Codebase access granted/design_handoff_liquidityhq_terminal/design_files" -p 8899
```

Frames are **1440×900 desktop and 390×844 mobile**. Size the window to 1440+ or
the right rail is simply off-screen and you will not know it exists.

---

## Read the frame, not the summary

`/disclaimer` was built from README:167:

> Shared static shell: 56px marketing nav, 264px page index rail (active item
> has a 2px amber left border), content column, right rail.

That sentence is accurate. It was still read wrong. "Page index rail" was taken
to mean an index of the page's own sections, so what shipped was a table of
contents on the left and nothing on the right.

Opening frame `3A` shows what it means:

| Slot | Frame | What shipped |
|---|---|---|
| Left rail, 264px | **The site's pages** — About, FAQ, Glossary, Terms, Privacy, Refunds, Disclaimer. Active row has the 2px amber left border | This page's own sections 01–10 |
| Content column | Eyebrow `RISK DISCLOSURE` in **red**, `DISCLAIMER` uppercase, intro paragraph, `EFFECTIVE 14 AUG 2026` right-aligned, then a 4-cell stat band in red, then 7 numbered sections | `IMPORTANT INFORMATION` eyebrow in grey, `Disclaimer.` title, no intro, no date, 10 sections |
| Right rail | **`CONTENTS` 01–07**, plus a pull-quote with a red left border: "Never risk capital you cannot afford to lose." | Absent entirely |

The two rails were collapsed into one and put on the wrong side. No amount of
re-reading the sentence would have caught it; opening the frame caught it in
about four seconds.

**So: open the frame first, every screen, at 1440 wide. The README is a summary
of the frames. The frames are the spec.**

Two more that only the frame shows:

- The marketing nav's middle links are **PRODUCT · LIQUIDATION MAP · ARENA ·
  PRICING · DOCS**. `components/StaticShell.tsx` currently omits them with a
  comment claiming the prototype leaves them unresolved. That was read off the
  template source rather than the rendered frame, and it is wrong.
- Risk numbers on `/disclaimer` are **red** (`--red`), not amber. Amber is
  reserved for the active nav item and the primary action (README:41).

---

## Process, one screen at a time

1. Open the frame at 1440, and again at 390. README:191 — **mobile frames are
   separate layouts, not the desktop grid stacked.** Two layouts per screen.
2. Read the README paragraph for that screen id. It carries measured values the
   frame cannot tell you (grid templates, row heights, alpha values).
3. Build against the token layer (`lib/terminalTokens.ts`, `app/globals.css`),
   not inline styles lifted from the prototype — README:13.
4. Screenshot yours next to the frame before opening the PR. Name the frame id
   in the PR body.
5. One screen per PR. QA re-opens the same frame to review.

### Rules that apply to every screen

- **Colour only where a signal is firing** (README:47). In Arena's evidence grid
  exactly 2 of 8 rows carry colour. Everything else is `--txt`.
- **Radius 0 everywhere.** No rounded corners in this direction.
- **IBM Plex Mono for every number**, micro-label, nav item, button label and
  screen title; IBM Plex Sans for prose. Never Inter.
- **Reuse `components/icons.tsx`**, not the prototype's path strings.
- Hairlines are never doubled — each region owns its bottom border.

---

## Status

`shipped` means built against the frame and merged to `dev`. Nothing counts as
shipped on a colour change alone.

### Shell and tokens (applies to all 31)

| Piece | State |
|---|---|
| Colour tokens, IBM Plex Sans, `data-design` flag | shipped (#419, #421) |
| 44px app nav, 5 destinations, 60px mobile tab bar | shipped (#413) |
| 38px mobile header | PR #431 |
| 56px static marketing nav | PR #431 — **middle links missing, see above** |
| Ticker strip (34px, Arena/Desk/Markets/landing/auth) | not started |

### `Monochrome Terminal.dc.html` — 16 screens

| Id | Screen | Repo | State |
|---|---|---|---|
| 1a | Arena | `app/arena/page.tsx` | not started |
| 2a | Desk | `app/dashboard/page.tsx` | not started |
| 3a | Markets | `app/markets/page.tsx` | not started |
| 3b | Liquidation map | `app/liq/page.tsx` | not started |
| 3c | News | `app/news/page.tsx` | not started |
| 3d | Auth | `app/login/page.tsx`, `app/forgot-password/page.tsx` | not started |
| 3e | Upgrade + paywall | `app/upgrade/page.tsx` | not started |
| 4a | Setup scanner | `app/scanner/page.tsx` | not started |
| 4b | Funding + correlation | `app/funding/page.tsx`, `app/correlation/page.tsx` | not started |
| 4c | Econ calendar | `app/econ-calendar/page.tsx` | not started |
| 4d | Briefing | `app/briefing/page.tsx` | not started |
| 5a | Journal | `app/journal/page.tsx` | not started |
| 5b | Alerts | `app/alerts/page.tsx` | not started |
| 5c | Calculators | `app/calc/page.tsx` | not started |
| 5d | Settings | `app/settings/page.tsx` | not started |
| 6a | Landing | `app/[locale]/page.tsx`, `components/LandingContent.tsx` | not started |

### `Monochrome Terminal - Static.dc.html` — 7 screens

| Id | Screen | Repo | State |
|---|---|---|---|
| 1a | About | `app/about/page.tsx` | not started |
| 1b | FAQ | `app/faq/page.tsx` | not started |
| 1c | Learn / glossary | `app/learn/page.tsx`, `lib/glossary.ts` | not started |
| 2a | Terms | `app/terms/page.tsx` | not started |
| 2b | Privacy | `app/privacy/page.tsx` | not started |
| 2c | Refunds | `app/refund/page.tsx` | not started |
| 3a | Disclaimer | `app/disclaimer/page.tsx` | **rebuild** — shipped against the README, not the frame |

### `Monochrome Terminal - Tools.dc.html` — 3 screens

| Id | Screen | Repo | State |
|---|---|---|---|
| 1a | Trading hours | `app/hours/page.tsx` | not started |
| 1b | Playbook | `app/playbook/page.tsx` | not started |
| 1c | Research | `app/research/page.tsx` | not started |

### `Monochrome Terminal - States.dc.html` — 5 screens

| Id | Screen | Repo | State |
|---|---|---|---|
| 1a | Reset password | `app/reset-password/page.tsx` | not started |
| 1b | Onboarding | `components/OnboardingProvider.tsx`, `OnboardingGate.tsx`, `SetupChecklist.tsx` | not started |
| 1c | 404 | `app/not-found.tsx` | not started |
| 1d | Offline | `app/offline/page.tsx`, `public/sw.js` | not started |
| 1e | Maintenance | `components/MaintenanceScreen.tsx` | not started |

### Not designed — leave alone

`/ops` and all its children, `/admin` (owner excluded them). `/backtest` and
`/live-tracking` redirect to the dashboard, `/[locale]` is a wrapper,
`/auth/callback` is a spinner.

---

## Open questions for the owner

Neither is decidable from the frames:

1. **The logo is blue** in a palette whose whole premise is a single amber
   accent. `assets/logo.png` is the mark as supplied and the frames use it as
   is. Keep the blue mark, or restate it?
2. **README:188 specifies a blue hover tint** for table rows,
   `rgba(140,150,255,.05)`, described as "per the current design system". Also
   blue, also deliberate. Keep, or move to a neutral/amber tint?

Until these are answered, `components/BrandMark.tsx` is used rather than
`logo.png`, so nothing imports a blue asset by accident.
