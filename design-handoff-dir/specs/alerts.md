# Alerts — `Alerts.dc.html · 5b`

**Fidelity:** structure and gating read from `app/alerts/page.tsx` directly (this screen has no separate `AlertsTerminal.tsx` — terminal mode is a class-name toggle, `mode === 'terminal' ? 'alerts-term-wrap' : undefined`, so the JSX tree is identical between modes; only CSS differs). This spec's gating criteria are the highest-priority items in this batch — QA flagged them as leak-class failures.

## Source
Frame: `Alerts.dc.html · 5b`. Route `/alerts`.

## Section-by-section gating — read directly from source, not inferred

**Telegram connect.** `!entitled → LockedFeatureCard` (title + description + unlock button wired to the upgrade modal). Entitled → the full one-time-code wizard (deep link, manual `/start {code}` fallback, 3s poll for up to 40 attempts, countdown, disconnect). **This is a full component swap, not a dimmed overlay** — the source comment explicitly documents a prior bug where the wizard rendered fully underneath a pitch banner at 0.4 opacity with `pointer-events: none`. Do not reintroduce that pattern.

**Price Alerts.** Same swap pattern: `!entitled → LockedFeatureCard`, separate instance with its own copy ("delivered over Telegram, which only sends to Pro/trial").

**Manual Check button.** Visible to everyone once Telegram is connected, but gated **inside the click handler** via a `403 PRO_REQUIRED` response — a free user who clicks it sees the upgrade modal open, not an error message. This is the one gate on the page that is NOT a visible locked-card; it's a click-time redirect to the same modal.

**Alert Conditions — the QA-flagged section.** `{entitled && (...)}` — **the entire section, coin picker, EMA-timeframe chips, all four alert-group toggle lists, is absent from the render tree for a non-entitled user.** No locked card here (source comment: showing a second "Unlock Pro" pitch under the Telegram card already above it "read as a hard sell, not a second real gate"). **This is the section: node count must be 0, not `display: none`, not a dimmed/disabled version.**

## Colour is data (within Alert Conditions, entitled only)

**Alert-group dot colours** — fixed per rule type, not driven by live state (these are catalogue entries, not fired signals):
```
rsi → --amber            rapid_move → --orange        whales → #1a7aff
oi_spike → --amber       cvd → --green-2               squeeze → #f43f5e
distribution → #f97316   news → --red                  fear_greed → #f97316
sentiment_extremes → #f43f5e   price_alerts → #9ba4ff   daily_summary → --amber
```
These dots identify the *category* of alert, not whether it's currently firing — do not reinterpret them as live status.

**Connection status pill.** Connected → `--green-2` dot + green pill. Not connected → a plain `#f87171` dot with a bordered (not filled) pill — asymmetric treatment, the disconnected state is quieter, not a mirrored red pill.

**Cap-warning messages** (`coinCapMsg`/`tfCapMsg`). Render only when a user tries to exceed the cap (10 coins, 3 EMA timeframes) — `--red` text, appears/disappears with the attempt, not a persistent counter-is-red state.

**Test-button states.** `sending` (default styling), `ok` (`.tg-btn-ok` success styling), `err` (`.tg-btn-err`). Three-state, not binary.

## Acceptance criteria
1. **Node count 0** for the entire Alert Conditions section (coin picker + EMA chips + all 4 alert-group lists) when `entitled === false`. Test by `querySelectorAll` count, not computed `display`.
2. Exactly one `LockedFeatureCard` renders for a non-entitled user in the Telegram slot, and a second, separately-copy'd one in the Price Alerts slot — two distinct cards, not one shared.
3. Manual Check button is visible regardless of entitlement; clicking it as a non-entitled user opens the upgrade modal and does NOT render an inline error string.
4. No element under a `!entitled` condition ever renders at reduced opacity with `pointer-events: none` as a substitute for removal — if it's gated, it's absent, full stop.
5. Alert-group dot colours match the fixed table above regardless of any live market data — changing a coin's actual RSI does not change the RSI row's dot colour.
6. Coin picker enforces the 10-coin cap: attempting an 11th selection shows the cap message and does not add the coin.
7. EMA-timeframe picker enforces the 3-timeframe cap the same way.
8. Connected-state pill and disconnected-state pill are visually asymmetric (filled vs bordered), not colour-inverted mirrors of each other.
9. Every colour is from the confirmed palette or one of the flagged non-token hexes present in source (`#1a7aff`, `#f43f5e`, `#f97316`, `#9ba4ff`, `#f87171`) — kept as-is, not renamed to a token that doesn't exist.
10. Radius per `radius-ruling.md` — the numbered step circles (`numStyle`, 24px) and status dots are the circular exemption.

## Out of scope
The link-code polling mechanics themselves (timing, retry count) — functional, unchanged. `AlertOutcomes` component — restyle only.

## Could not determine
Whether the five non-token hex colours in the alert-group dot table (`#1a7aff`, `#f43f5e`, `#f97316`, `#9ba4ff`, plus `#4ade80` on the EMA signal dot) are meant to stay as distinct category-identifying colours outside the 16-token palette, or should eventually collapse into it. Given there are 12 categories and only ~5 spare tokens, my read is these are intentionally outside the governed palette — flagging for design to confirm rather than assuming.
