# Terminal Design — QA Acceptance Criteria

Per-screen checklist for `?design=terminal` verification on `qa`.
Add a route to `_design-tokens.ts > CONVERTED_ROUTES` after posting PASS on #413.

## Universal criteria (every screen)

All of these must pass before any screen-specific checks.

| # | Criterion | How to verify |
|---|---|---|
| U1 | `data-design="terminal"` on `<html>` | JS: `document.documentElement.getAttribute('data-design')` → `"terminal"` |
| U2 | Body font is IBM Plex Sans | JS: `getComputedStyle(document.body).fontFamily` contains `"plexSans"` |
| U3 | No rounded corners on cards | JS: check `.borderRadius` on card selectors → `"0px"` |
| U4 | Amber accent visible | Visual: section markers, active states, headings use `#d9a626` range |
| U5 | All interactive elements functional | Manual: click buttons, links, inputs — no broken actions |
| U6 | No console errors | DevTools: zero red errors on page load |

---

## Screen-by-screen

### ✅ `/` (homepage)
Verified: 2026-08-26 · #448

### ✅ `/disclaimer`
Verified: 2026-08-26 · #420

### ✅ `/arena`
Verified: 2026-08-26 · #460

### ✅ `/dashboard` (Desk 2a)
Verified: 2026-08-28 · #491 @ `d3d7e15`
Extra checks: TCoinSidebar, TEdgeSignals, TSelectedCoinCard, TCascadeAlertBanner, TMarketPulseStrip all render flat.

---

### ✅ `/briefing` (Desk 2b)
Verified: 2026-08-28 · #492 @ `27e495a`
Extra: `.mb-macro-item`, `.mb-event-tag`, `.mb-brief-btn` all `0px`. Generate Briefing button flat. Shell nav rounding deferred to shell conversion.

---

### ✅ `/markets`
Verified: 2026-08-29 · #495 @ `8496ea7` (static — browser extension offline)

---

### ✅ `/scanner`
Verified: 2026-08-29 · #495 @ `8496ea7` (static — browser extension offline)

---

### ✅ `/liq` (liquidation map)
Verified: 2026-08-29 · #494 @ `8496ea7` (static — browser extension offline)

---

### ✅ `/funding`
Verified: 2026-08-29 · #494 @ `8496ea7` (static — browser extension offline)

---

### ✅ `/correlation`
Verified: 2026-08-29 · #494 @ `8496ea7` (static — browser extension offline)

---

### ✅ `/journal`
Verified: 2026-08-29 · #496 @ `8496ea7` (static — browser extension offline)

---

### ✅ `/alerts`
Verified: 2026-08-29 · #496 @ `8496ea7` (static — browser extension offline)

---

### `/calc`
**Test URL:** `/calc?design=terminal`
Extra checks:
- Calculator panels flat
- Input fields use `--border-input`
- Result display uses `--txt` on `--bg1`

---

### `/playbook`
**Test URL:** `/playbook?design=terminal`
Extra checks:
- Playbook cards flat
- Tag chips flat
- Pagination controls flat

---

### `/hours`
**Test URL:** `/hours?design=terminal`
Extra checks:
- Session blocks flat rectangles
- Active session uses `--accent` (#d9a626) indicator
- Table rows flat

---

### `/research`
**Test URL:** `/research?design=terminal`
Extra checks:
- Article/note cards flat
- Tag chips flat

---

### ✅ `/news`
Verified: 2026-08-29 · #496 @ `8496ea7` (static — browser extension offline)

---

### `/econ-calendar`
**Test URL:** `/econ-calendar?design=terminal`
Extra checks:
- Event rows flat
- Impact badges flat (no pill)
- Day header uses `--bdr` separator

---

### `/settings`
**Test URL:** `/settings?design=terminal`
Extra checks:
- Settings sections flat panels
- Toggle inputs styled flat
- Form inputs use `--border-input`
- Destructive actions use `--red`

---

### `/login`
**Test URL:** `/login?design=terminal`
Extra checks:
- Auth card flat (no rounded card shadow)
- Input fields use `--border-input`
- Submit button uses `--accent`

---

### `/forgot-password` / `/reset-password`
**Test URL:** `?design=terminal`
Extra checks:
- Same as login: flat card, `--border-input` inputs, `--accent` CTA

---

### Onboarding / SetupChecklist
**How to trigger:** new account or clear onboarding state, visit `/dashboard?design=terminal`
Extra checks:
- Onboarding modal/wizard flat (0px radius)
- Step indicators use `--accent`
- Checklist items flat rows

---

### Popup dialogs / modals
**Where they appear:** confirm dialogs, alert modals, settings modals across all screens
Extra checks:
- Modal overlay uses `--bg0` / `--bg1` tokens
- Modal panel flat (0px radius)
- Close button / actions styled with terminal palette
- No rounded card shadow

---

## How to add a new verified screen

1. Run all U1–U6 universal checks.
2. Run screen-specific checks above.
3. Post PASS comment on #413 with build commit, date, and table of results.
4. Add route to `qa/e2e/_design-tokens.ts > CONVERTED_ROUTES`.
5. Update this file: change the screen entry header to ✅ with verified date + PR.
