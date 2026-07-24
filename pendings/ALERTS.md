# Telegram Alert System — Cost + Quality Plan

**Status:** planning only, nothing implemented yet. Feature: `app/api/telegram/alert/route.ts`
(cron-gated, Pro/trial-only, scans all 50 coins every tick, fans out to every
connected user's Telegram chat).

## 1. The problem

### 1a. Real xAI usage, measured (`lhq_alert_grok_log`, last ~8 days)

| Signal type | Calls | Share |
|---|---|---|
| `ema_setup` | 358 | 52% |
| `ema_cross` | 285 | 42% |
| whale_trade | 29 | 4% |
| confluence | 9 | 1% |
| daily_summary | 2 | <1% |
| news / rapid_move / oi_spike | 1 each | <1% |
| **Total** | **686** | ~41/day avg, ~$5/mo at current rate |

**Two signal types are 94% of all Grok calls in this cron.** Not expensive in
raw $ today, but two real problems regardless of $:
- **Uncapped.** `grokAnalyze()` in this file never calls `increment_ai_usage`
  or touches the global circuit breaker (`AI_GLOBAL_DAILY_MAX`). The only
  throttle is an in-memory `grokInFlight` concurrency-of-3 guard that resets
  on every restart. This is the one xAI-calling path in the whole app that
  isn't bounded by anything persistent.
- **Why `ema_setup` is 52%:** it's not one check, it's four — `checkEMASetup`
  currently runs on **4 timeframes every tick** (4h, 1h, 30m, 15m) × 50 coins
  × 2 directions. Fast timeframes (15m/30m) fire constantly since price
  drifts in/out of the "value zone" far more often at that speed.

### 1b. The signal quality problem (user's framing, separate from cost)

- **`ema_setup`** fires on a *state check* ("price is currently sitting in
  the 9-20 EMA pullback zone with ribbon aligned") — a heads-up to get ready,
  explicitly says "wait for bounce candle to enter." Not a firm call.
- **`ema_cross`** fires on price crossing its own 200-period EMA on 1H — a
  simple single-EMA trend flip, unrelated to the Arena chart's actual
  buy/sell rule. No persistence filter, no confirm stage, no alternation.
- **Neither matches what the Arena chart draws as a BUY/SELL marker.** The
  user wants the Telegram alert to fire the same confirmed signal the chart
  shows, not a softer pre-entry ping or an unrelated simpler cross.

## 2. The real buy/sell rule already exists — `lib/strategyCore.ts`

`detectEMASignals(candles, tf, filterParams)` — a plain function, not
React-bound, already computes the Arena chart's exact BUY/SELL markers:

1. **ARM**: EMA9 crosses EMA20 (bullish = arm long, bearish = arm short).
2. **CONFIRM**: forward-scan for the first candle whose *close* clears EMA50
   in the armed direction.
3. **ALTERNATE**: strictly long→short→long, never two same-direction fires
   in a row.
4. Returns `sl`/`tp` already computed (0.5% beyond EMA50, 2:1 R:R) and a
   `pending` flag (true = still within the live edge, not yet fully knowable).

> ⚠️ **Correction to an existing memory** (`feedback_ema_signal_rule.md`,
> 34 days old): it describes a mandatory PERSIST≥4-candle hold filter as
> "the rule." Current code shows that's now backwards — a 3-year backtest
> found the persistence filter *hurts* (36.2% win / PF 1.13 firing
> immediately vs. 32.9% win / PF 0.98 waiting for persistence). The
> persistent version is now just an opt-in "Anti-Chop" toggle
> (`STRICT_FILTER_PARAMS`), empirically the worse choice. `DEFAULT_FILTER_PARAMS`
> (fire immediately on the EMA50 confirmation close, no forward hold) is
> what the chart actually uses by default today. Memory needs updating —
> tracked, not yet done.

## 3. Plan A — consolidate `ema_setup` + `ema_cross` into one real signal

Replace both `checkEMASetup` and `checkEMACross` with one `checkEMASignal`:

- Fetch ribbon-TF candles only (drop the extra daily-1D fetch `checkEMASetup`
  currently also makes — not needed by `detectEMASignals` itself).
- Call `detectEMASignals(candles, tf, DEFAULT_FILTER_PARAMS)` — same params
  the chart uses by default, for bit-for-bit parity.
- **Timeframe: 4h only** (dropping 1h/30m/15m) — a swing signal, not a
  scalp ping. Cuts the 4-timeframe fan-out that's the main volume driver.
- Fire only on a **new, non-pending (fully confirmed)** signal per coin —
  dedup via a last-alerted-timestamp map, same pattern as the existing
  `emaSideMap` cooldown.
- Reuse the `sl`/`tp` `detectEMASignals` already computes — no separate math.
- Keep one Grok commentary call per confirmed signal (now rare/high-value,
  not per value-zone-touch).
- Message becomes an actual BUY/SELL call: direction, entry, SL, TP — not
  "setup" or "crossed."
- **Also:** wire this function's `grokAnalyze()` into the global circuit
  breaker (`increment_ai_usage`/`AI_GLOBAL_DAILY_MAX`) so this path is
  finally bounded like every other xAI call in the app. Tradeoff: on a
  genuinely volatile day, this now shares the same daily budget as
  user-triggered calls.

**Expected effect:** timeframe cut (4→1) plus event-based-not-state-based
firing should cut `ema_setup`+`ema_cross` volume substantially — exact
number depends on real market activity, not knowable in advance, but the
structural driver (4x fan-out + non-event firing) goes away either way.

## 4. Plan B — per-user coin cap on alerts (separate ask, "can't have unlimited")

Today: alert cron scans **all 50 coins** for every connected Pro/trial user,
no per-user coin preference exists anywhere in the schema or UI.

**Phase 1 (proposed now): cap it for the new EMA signal check only.**
- New `user_settings` column — an array of selected coins, hard-capped at
  **N** (open decision, you said "10 or 20, something like that" — I'd
  suggest 15 as a middle point, final call is yours).
- New Settings UI: a coin picker (checkbox list over the 50 coins), enforces
  the cap client + server side.
- Cron change: `checkEMASignal` scans the **union** of every connected
  user's selected coins, not all 50 — if the real user base's picks only
  span, say, 20 distinct coins total, that's a real cut in scan volume (and
  Grok calls) on top of the timeframe consolidation in Plan A.
- Delivery: a signal only pushes to users who selected that specific coin.

**Phase 2 (later, not now): extend the same coin-preference to
whale/squeeze/CVD/OI-spike/news alerts too** — same idea, separate broadcast
paths in the same file, bigger lift. Since EMA is 94% of current volume,
Phase 1 alone captures most of the benefit; worth revisiting once Phase 1's
mechanism is proven.

## 5. Open decisions (need your call before implementing)

1. **Coin cap number** — 15, or a specific number (10 / 20 / other)?
2. **Users who haven't picked coins yet** — zero EMA alerts until they visit
   Settings and pick, or a default set (e.g. top 5-10 by volume) so the
   feature isn't silently off for everyone who hasn't configured it?
3. **Timeframe** — 4h only, or keep a faster tier (1h) alongside it for more
   frequent signals?
4. **Pending/tentative signals** — push a "heads up" for a signal that's
   armed+confirmed but still within the live edge (`pending: true`), or wait
   for full confirmation only? (Recommendation: wait — avoids sending a call
   that later gets rejected once more candles print.)
5. **Scope** — do Plan A + Plan B Phase 1 together now, or Plan A first and
   revisit the coin cap separately?

## 6. Related, not blocking this plan

- Telegram alert on global-cap-breach spike (from `SECURITY_AUDIT.md`) — a
  cron that Telegrams the owner when `AI_GLOBAL_DAILY_MAX` usage crosses a
  threshold. Independent of this doc, still open.
- Per-user cap on the 3 cached xAI routes' cache-miss path (dry-powder,
  macro-context, onchain) — also independent, still open, tracked in
  `SECURITY_AUDIT.md`.
