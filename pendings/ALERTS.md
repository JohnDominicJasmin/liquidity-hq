# Telegram Alert System — Cost + Quality Plan

**Status: ✅ DONE, LIVE ON PROD 2026-07-25.** `checkEMASignal` replaces
`checkEMASetup` + `checkEMACross` in `app/api/telegram/alert/route.ts`. New
`ema_signal_<tf>` mute rows + timeframe picker live on `/alerts`. Global-cap
wiring done. All Supabase changes (labels, new SQL function, mute-key
migration) applied live to both prod and dev. Code committed (`bd3d5e6`),
merged to `main`, deployed - `git log origin/main..origin/dev` shows nothing
outstanding for this. §7's "uncommitted" note below is stale, kept only as a
historical record of what changed.
Feature: `app/api/telegram/alert/route.ts` (cron-gated, Pro/trial-only, scans
all 50 coins every tick, fans out to every connected user's Telegram chat).

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
- **Timeframes: 1h, 4h, 1d** (three options, down from today's four —
  4h/1h/30m/15m — dropping the two scalp timeframes 30m/15m). Each is an
  independent toggle on `/alerts`, same UX pattern as today's per-timeframe
  mute rows, just fewer/cleaner and firing real BUY/SELL instead of
  "setup"/"crossed."
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

## 4. Plan B — CORRECTION: this mostly already exists, don't rebuild it

Original version of this section proposed a brand-new coin-cap system (new
DB column, new Settings UI, new cap). **Wrong — didn't check `/alerts` and
`/api/alert-prefs` before writing it.** What's actually there today:

- **Coin selection already exists**, capped at **`ALERT_COIN_CAP = 20`**
  (`app/alerts/page.tsx`). New users default to BTC/ETH/SOL only (rest
  auto-muted). Toggle UI already built, already enforces the cap.
- **Per-timeframe mute toggles already exist** for the current EMA alerts:
  `ema_setup` (4H), `ema_setup_1h`, `ema_setup_30m`, `ema_setup_15m`,
  `ema_cross` — each independently on/off per user.
- **Direction filter already exists** (`dir:long` / `dir:short` mute keys).
- **One generic mechanism backs all of it**: `lhq_muted_alerts (user_id,
  key)`. Delivery checks `[ruleKey, coin:${coin}, dir:${dir}]` against a
  user's muted set before sending — see `entryMuteKeys()`/`isMutedFor()` in
  `app/api/telegram/alert/route.ts`.
- **Scan-scope reduction already exists too** — `checkEMASetup` already
  takes a `fullyMutedCoins` set (coins *every* connected user has muted) and
  skips scanning them entirely. The cost-saving idea in the original Plan B
  was already half-built.

**So there's no Plan B to build.** What actually changes because of Plan A:

- The 5 existing mute rows (`ema_setup`, `ema_setup_1h`, `ema_setup_30m`,
  `ema_setup_15m`, `ema_cross`) get replaced with **3 new rows** matching the
  new signal's timeframes (1h/4h/1d) — same UI pattern, same
  `lhq_muted_alerts` mechanism, just new `ruleKey` values and updated
  copy ("BUY/SELL signal" not "setup"/"crossed").
- `checkEMASignal` should keep the `fullyMutedCoins` scan-skip
  `checkEMASetup` already has — carry it forward, don't lose it.
- **✅ Decided: lowered `ALERT_COIN_CAP` from 20 to 10.** Live on `dev`
  (`app/alerts/page.tsx`) — all the over-limit/at-limit copy was already
  templated (`{onCount}/{cap}`), no label changes needed.

## 5. Open decisions — RESOLVED 2026-07-25

1. **Pending/tentative signals** — moot. `DEFAULT_FILTER_PARAMS.persistBoost
   = -10` clamps `PERSIST` to 0 for every timeframe (`Math.max(0, ...)`), and
   `holdsBeyond50()` short-circuits to `'confirmed'` whenever `PERSIST === 0`.
   Since Plan A always calls `detectEMASignals(candles, tf,
   DEFAULT_FILTER_PARAMS)`, `pending: true` can never reach the alert cron -
   only `STRICT_FILTER_PARAMS` (unused here) could produce it. No decision
   needed; `checkEMASignal` still defensively checks `latest.pending` anyway.
2. **New `ruleKey` names** — `ema_signal_<tf>`, confirmed. **Bigger change
   than originally scoped**: timeframes are NOT fixed to 1h/4h/1d for every
   user. Every timeframe the Arena chart itself offers (1m/5m/15m/30m/1h/2h/4h/1d)
   is selectable on `/alerts`, capped at `ALERT_TF_CAP = 3` concurrently
   active per user (same UX pattern as `ALERT_COIN_CAP`) - the user's own
   call, not a fixed default for everyone. New users default to 1h/4h/1d
   pre-selected. Existing users: old mutes carried over 1:1 to the matching
   new key; the one case that could exceed the new cap (all 4 old
   `checkEMASetup` timeframes on, which is the default-untouched state) gets
   trimmed by muting `ema_signal_15m` (fastest/noisiest, matches the
   Plan A cost reasoning above). Verified live: exactly 2 users affected on
   prod, both got only `ema_signal_15m` muted, nothing else changed.

## 6. Related, not blocking this plan

- ~~Telegram alert on global-cap-breach spike~~ — **done 2026-07-25**, and
  switched from Telegram to email + an `/ops` dashboard banner (owner
  rejected Telegram as the channel). See `SECURITY_AUDIT.md`. Scheduler
  (n8n) still needs pointing at the route.
- Per-user cap on the 3 cached xAI routes' cache-miss path (dry-powder,
  macro-context, onchain) — still open, tracked in `SECURITY_AUDIT.md`.

## 7. Implementation closeout (2026-07-25)

**Code (uncommitted as of this writing, on `dev`):**
- `app/api/telegram/alert/route.ts` — `checkEMASetup`/`checkEMACross`/
  `computeEMA`/`emaSideMap`/`calcEMALocal`/`calcSMALocal`/`EMA_SETUP_TF_CONFIG`
  all deleted. New `checkEMASignal` + `fetchRibbonCandles` (Binance-first,
  Bybit fallback - closes a gap `checkEMASetup` silently had for Bybit-only
  coins like HYPE). `grokAnalyze()` gained an opt-in `checkGlobalCap` param,
  used only by `checkEMASignal`'s call. `fullyMutedTfs` added alongside the
  existing `fullyMutedCoins`.
- `app/alerts/page.tsx` — old 4 `ema_setup_*` rows + the `ema_cross` row (and
  the now-empty Trading Signals/Trend sections) removed. New capped
  timeframe picker (`ALERT_TF_CAP = 3`, `toggleTf`, `tfCapMsg`) mirroring the
  existing `ALERT_COIN_CAP`/`toggleCoin` pattern exactly. Brand-new-user
  default seeding (1h/4h/1d on) mirrors the existing BTC/ETH/SOL coin seed.
- `lib/aiUsage.ts` — new `incrementGlobalUsage()`, global-only check (no
  per-user row) for the one call site with no natural user attribution.
- `lib/alertOutcomes.ts` — `ema_cross` swapped for the 8 `ema_signal_<tf>`
  keys in `OUTCOME_TRACKED_RULE_KEYS` + `OUTCOME_DEDUP_MS`.
- `lib/labelKeys.ts` — 10 old EMA-related keys removed, 7 new ones added.

**Database (already applied live, both prod `qdpwhnvmhqgzijuwopso` and dev
`wdtjhrilakoitfcezxpx` unless noted):**
- `supabase/migrations/20260805f_global_only_ai_usage_check.sql` — new
  `increment_global_ai_usage()` function. **Prod only** (Telegram alerts are
  prod-only; dev's webhook is unregistered).
- `supabase/migrations/20260805g_labels_seed_ema_signal.sql` — 6 new label
  rows (English only, paused-translation convention) + a stale-reference fix
  to the existing `ALERTS_COIN_SELECTION_DESC` key (English only - it still
  says "EMA Ribbon Setup" in ko/zh/ar/ru, not fixed, see the file's comment).
- `supabase/migrations/20260805h_ema_signal_mute_migration.sql` — one-time
  mute-key carryover. **Prod only.** Verified: exactly 2 users affected,
  both got `ema_signal_15m` muted, nothing else.

**Verified:** `npx tsc --noEmit` clean (run 3x across the changes). Live
local dev-server check via real Chrome (signed-in account): new picker
renders, all 8 timeframe chips present, cap-reached message fires correctly
on the 4th pick, state persists across reload, old EMA Ribbon
Setup/200 EMA Cross rows confirmed gone, no console errors.
**Not done:** no commit, no push, no Render deploy of any kind.
