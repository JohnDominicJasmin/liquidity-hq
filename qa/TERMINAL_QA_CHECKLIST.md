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

## U5/U6 live sweep — 2026-08-29 @ `6acb3e9`

All 29 CONVERTED_ROUTES checked live via browser extension against `https://liquidity-hq-qa.onrender.com?design=terminal`.

| Route | U5 (interactive elements) | U6 (console errors) |
|---|---|---|
| `/disclaimer` | ✅ 72 buttons, 39 links | ✅ 0 errors |
| `/arena` | ✅ 99 buttons | ✅ 0 errors |
| `/dashboard` | ✅ 79 buttons, 44 links | ✅ 0 errors |
| `/briefing` | ✅ 77 buttons, 56 links | ✅ 0 errors |
| `/liq` | ✅ 83 buttons | ✅ 0 errors |
| `/markets` | ✅ 82 buttons, 38 links | ✅ 0 errors |
| `/scanner` | ✅ 84 buttons, 38 links | ✅ 0 errors |
| `/funding` | ✅ 76 buttons, 38 links | ✅ 0 errors |
| `/correlation` | ✅ 75 buttons, 38 links | ✅ 0 errors |
| `/journal` | ✅ 149 buttons, 38 links | ✅ 0 errors |
| `/alerts` | ✅ 73 buttons, 38 links | ✅ 0 errors |
| `/news` | ✅ 78 buttons, 38 links | ✅ 0 errors |
| `/calc` | ✅ 72 buttons, 38 links | ✅ 0 errors |
| `/playbook` | ✅ 133 buttons, 38 links | ✅ 0 errors |
| `/hours` | ✅ 72 buttons, 38 links | ✅ 0 errors |
| `/research` | ✅ 73 buttons, 38 links | ✅ 0 errors |
| `/econ-calendar` | ✅ 72 buttons, 38 links | ✅ 0 errors |
| `/settings` | ✅ 72 buttons, 38 links | ✅ 0 errors |
| `/login` | ✅ auth redirect correct | ✅ 0 errors |
| `/forgot-password` | ✅ 1 submit, 1 link | ✅ 0 errors |
| `/reset-password` | ✅ 1 submit, 1 link | ✅ 0 errors |
| `/about` | ✅ 72 buttons, 38 links | ✅ 0 errors |
| `/learn` | ✅ 72 buttons, 42 links | ✅ 0 errors |
| `/privacy` | ✅ 72 buttons, 38 links | ✅ 0 errors |
| `/faq` | ✅ 88 buttons, 38 links | ✅ 0 errors |
| `/terms` | ✅ 72 buttons, 38 links | ✅ 0 errors |
| `/refund` | ✅ 72 buttons, 38 links | ✅ 0 errors |
| `/upgrade` | ✅ 72 buttons, 38 links | ✅ 0 errors |

`/` redirects to `/arena` — covered above. **All routes PASS U5 and U6.**

---

## Screen-by-screen

### ✅ `/` (homepage)
Redirects to `/arena` — see `/arena` status.

### ✅ `/disclaimer`
Verified: 2026-08-26 · #420
Live re-check 2026-08-29 @ `b859ef4` — U1–U3 PASS.

### ✅ `/arena`
Previously verified: 2026-08-26 · #460
U3 FAIL found 2026-08-29 @ `b859ef4` · #505 — fixed in PR #507
Live re-check 2026-08-29 @ `6acb3e9` — U1–U3 PASS (nuclear `arena-term-wrap` confirmed).

---

### ✅ `/dashboard` (Desk 2a)
Previously verified: 2026-08-28 · #491 @ `d3d7e15`
U3 FAIL found 2026-08-29 @ `b859ef4` · #505 — fixed in PR #507
Live re-check 2026-08-29 @ `6acb3e9` — U1–U3 PASS (nuclear `dashboard-term-wrap` confirmed).

---

### ✅ `/briefing` (Desk 2b)
Previously verified: 2026-08-28 · #492 @ `27e495a`
U3 FAIL found 2026-08-29 @ `b859ef4` · #505 — fixed in PR #507
Live re-check 2026-08-29 @ `6acb3e9` — U1–U3 PASS (nuclear `briefing-term-wrap` confirmed).

---

### ✅ `/markets`
Verified: 2026-08-29 · #495 @ `8496ea7` (static)
Live re-check 2026-08-29 @ `b859ef4` — U1–U3 PASS.

---

### ✅ `/scanner`
Verified: 2026-08-29 · #495 @ `8496ea7` (static)
Live re-check 2026-08-29 @ `b859ef4` — U1–U3 PASS (nuclear term-wrap confirmed clean).

---

### ✅ `/liq` (liquidation map)
Previously verified: 2026-08-29 · #494 @ `8496ea7` (static)
U3 FAIL found 2026-08-29 @ `b859ef4` · #505 — fixed in PR #507
Live re-check 2026-08-29 @ `6acb3e9` — U1–U3 PASS (nuclear `liq-term-wrap` confirmed).

---

### ✅ `/funding`
Verified: 2026-08-29 · #494 @ `8496ea7` (static)
Live re-check 2026-08-29 @ `b859ef4` — U1–U3 PASS.

---

### ✅ `/correlation`
Verified: 2026-08-29 · #494 @ `8496ea7` (static)
Live re-check 2026-08-29 @ `b859ef4` — U1–U3 PASS.

---

### ✅ `/journal`
Verified: 2026-08-29 · #496 @ `8496ea7` (static)
Live re-check 2026-08-29 @ `b859ef4` — U1–U3 PASS (nuclear term-wrap confirmed clean).

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
