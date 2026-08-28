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

### ✅ `/news`
Verified: 2026-08-29 · #496 @ `8496ea7` (static — browser extension offline)

---

### ✅ `/calc`
Verified: 2026-08-29 · #498 @ `35986d3` (static — browser extension offline)

---

### ✅ `/playbook`
Verified: 2026-08-29 · #498 @ `35986d3` (static — browser extension offline)

---

### ✅ `/hours`
Verified: 2026-08-29 · #498 @ `35986d3` (static — browser extension offline)

---

### ✅ `/research`
Verified: 2026-08-29 · #498 @ `35986d3` (static — browser extension offline)

---

### ✅ `/econ-calendar`
Verified: 2026-08-29 · #498 @ `35986d3` (static — browser extension offline)

---

### ✅ `/settings`
Verified: 2026-08-29 · #498 @ `35986d3` (static — browser extension offline)

---

### ✅ `/login`
Verified: 2026-08-29 · #499 @ `6ffe068` (static — browser extension offline)

---

### ✅ `/forgot-password` / `/reset-password`
Verified: 2026-08-29 · #499 @ `6ffe068` (static — browser extension offline)
Both share `.login-term-wrap` nuclear rule.

---

### ✅ `/about`
Verified: 2026-08-29 (static — no treatment needed, 0 hardcoded radii)

---

### ✅ `/learn`
Verified: 2026-08-29 (static — no treatment needed, 0 hardcoded radii)

---

### ✅ `/privacy`
Verified: 2026-08-29 (static — no treatment needed, 0 hardcoded radii)

---

### ✅ Onboarding / SetupChecklist
No treatment needed — `SetupChecklist.tsx` has 0 hardcoded `borderRadius` values (confirmed by dev audit).

---

### ✅ Popup dialogs / modals
Verified: 2026-08-29 · #500 @ `aafd6a5` (static — browser extension offline)
- `SetupChecklist` — no treatment needed (0 hardcoded radii)
- `UsageModal` — no treatment needed (0 hardcoded radii)
- `UpgradeGateModal` (`LockedFeatureCard`, `FullPageUpgradeGate`, `UpgradeGateModal`) — `.locked-card-term-wrap *`, `.upgrade-gate-term-wrap *`, `.upgrade-modal-term-wrap *` nuclear rules all confirmed

---

### ✅ `/faq`
Verified: 2026-08-29 · #503 @ `701d368` (static — browser extension offline)
Nuclear wrapper `.faq-term-wrap *` covers accordion item cards.

---

### ✅ `/terms`
Verified: 2026-08-29 · #503 @ `701d368` (static — browser extension offline)
Nuclear wrapper `.terms-term-wrap *` covers callout box.

---

### ✅ `/refund`
Verified: 2026-08-29 · #503 @ `701d368` (static — browser extension offline)
Nuclear wrapper `.refund-term-wrap *` covers callout box.

---

### ✅ `/upgrade`
Verified: 2026-08-29 · #503 @ `701d368` (static — browser extension offline)
Nuclear wrapper `.upgrade-term-wrap *` covers badge pill, plan cards, "Best value" label, CTA button.

---

## How to add a new verified screen

1. Run all U1–U6 universal checks.
2. Run screen-specific checks above.
3. Post PASS comment on #413 with build commit, date, and table of results.
4. Add route to `qa/e2e/_design-tokens.ts > CONVERTED_ROUTES`.
5. Update this file: change the screen entry header to ✅ with verified date + PR.
