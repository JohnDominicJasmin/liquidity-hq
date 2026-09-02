# Settings — `Settings.dc.html · 5d`

**Fidelity:** structure read from `app/settings/page.tsx` directly. No `SettingsTerminal.tsx` exists (confirmed 404) — terminal mode is `mode === 'terminal' ? ' settings-term-wrap' : ''`, appended only in the signed-out branch's className; the signed-in branch doesn't even check `mode` in the reviewed source, so its terminal styling must come from a global class further up the tree. Flag if the build finds otherwise.

## Source
Frame: `Settings.dc.html · 5d`. Route `/settings`.

## Two structurally different pages, not one page with a dimmed state

**Signed out:** returns early with a **different component tree** — Appearance section (theme + analytics consent, both work signed-out) plus a **locked list of 7 section names as plain text** (Account, Watchlist, Trading Profile, Arena Defaults, Notifications, "Dashboard Sections", Telegram), then Sign-in/Create-account links. The locked list has `pointerEvents: 'none'` but is inert text anyway — nothing to click, so this is not the "visible but interactive" leak pattern Alerts had. **This is intentionally a teaser list, not the QA leak-class issue** — no functional surface is exposed, only section names.

**Signed in:** the full 7-section page (Account, Watchlist, Trading Profile, Arena Defaults, Notifications, Appearance, Telegram) — no gating within it except the one described below.

## The gated timeframe chips — the QA-flagged section

**Arena Defaults → default timeframe chips.** Per-chip, not section-level:
```
locked = !entitled && isGatedTf(tf)
```
Locked chips render with: `disabled` attribute set, `opacity: 0.4`, `cursor: not-allowed`, a `title` tooltip reading "Pro only," **and a 🔒 emoji appended to the label** (`{tf}{locked ? ' 🔒' : ''}`). Clicking a locked chip is a no-op (the onClick guards `if (!locked)`), not a modal trigger — different from Alerts' Manual Check button, which does open the modal on click. **Do not add modal-on-click here; source doesn't.**

This is the opposite failure mode from Alerts: here the gated state must be visually present (disabled + lock glyph + tooltip), not absent — a free user needs to see which timeframes exist and that they're locked, since this is a preference picker, not a paid feature card.

## Colour is data

**Signed-out locked list.** Fixed `--txt2` for every entry, uniform — this is a name list, not a status list; nothing here is colour-coded.

**Push-notification toggle test button.** `sent → --green` bg/text, `error → --red` bg/text, `idle → --txt2`/neutral bg — 3-state, appears only while `pushEnabled`.

**At-risk calculation** (Trading Profile). The computed dollar figure is always `--red` regardless of how small the risk percentage is — this is a "money you could lose" figure, always a caution colour, not graded by size.

**Analytics/push toggles.** Binary on/off via `.st-toggle.on` class — no data-driven colour, pure UI state (matches the design's own "state, not signal" pattern elsewhere).

**Telegram status dot.** `configured → --green`, else `--txt3` — a 2-state status dot, simpler than Alerts' page (no amber/warning tier here).

## Acceptance criteria
1. Signed-out page renders exactly 2 functional controls (theme chips + analytics toggle) plus 2 links (sign in / create account) — the 7 locked section names render as `pointerEvents: none` text with zero click handlers attached.
2. Signed-in page renders all 7 sections with no section-level gate.
3. Each gated timeframe chip has the `disabled` HTML attribute present (not just a visual style) when `!entitled && isGatedTf(tf)`.
4. Every locked chip's rendered label contains the 🔒 character; unlocked chips never do.
5. Clicking a locked chip does not change the selected default timeframe and does not open any modal.
6. Push-test-button colour is 3-state (`sent`/`error`/idle) and resets to idle after 3 seconds (matches source timeout).
7. The at-risk dollar figure renders `--red` even when risk% is set to its minimum (0.1%).
8. Telegram status dot is exactly 2-state (`--green`/`--txt3`) — no third colour exists for this dot on this page.
9. Radius per `radius-ruling.md` — toggle thumbs and the Telegram/push status dots are the circular exemption; risk-preset chips and inputs are `0`.
10. Every colour is from the confirmed palette.

## Out of scope
Password-field validation rules (`passwordMeetsPolicy`) — functional, unchanged. `CoinMultiSelect`, `ThemeChips`, `LanguageSelect` — restyle their existing rows to tokens, no structural change.

## Could not determine
Whether the signed-in branch's terminal styling truly comes from an ancestor wrapper (as the missing `mode` check in this file suggests) or whether `app/settings/page.tsx` has an unread sibling file applying it — worth a source-level confirmation before build, since if no wrapper exists the signed-in page would render unstyled in terminal mode.
