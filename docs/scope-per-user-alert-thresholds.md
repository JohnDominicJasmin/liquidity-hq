# Scope: Per-User Telegram Alert Threshold Customization (Roadmap #13)

Scoping doc, not an implementation. Traced against the actual code in
`app/api/telegram/alert/route.ts`, `app/api/alert-prefs/route.ts`, and
`lib/tables.ts` - every claim below is grounded in what's on disk today, 2026-07-17.

---

## 1. What's actually there today

**The alert engine is a single cron-triggered scan, not a per-user job.**
`GET /api/telegram/alert` (cron-triggered) runs `runAlerts()` once per invocation:

1. Fetches shared market data once (funding rates, prices, L/S ratios) - cheap, fine to keep shared.
2. Runs ~16 check functions (`checkSqueezeAlerts`, `checkWhales`, `checkRapidMove`, `checkEMASetup`, etc.), each with a **hardcoded threshold** baked into the boolean "did this fire" decision:
   - Squeeze/Flush: `score < 70` ([route.ts:1110](app/api/telegram/alert/route.ts:1110))
   - Rapid move: `4%` (5m) / `5%` (1H) / `10%` (4H) ([route.ts:422-424](app/api/telegram/alert/route.ts:422))
   - Whale trades: per-coin USD table, e.g. BTC `$5M`, ETH `$2M` ([route.ts:91-104](app/api/telegram/alert/route.ts:91))
   - Distribution/EMA Setup/OI spike/CVD/RSI: similarly fixed constants
3. Every check that fires pushes into one shared `signalQueue`.
4. `flushSignals()` sends the **same message to every recipient** in a flat `chatId: string[]` array - one broadcast, no per-recipient branching anywhere in the send path.
5. Cooldowns (`lastSent` Map, e.g. `squeeze_LONG_btc` for 4h) are **global and in-memory** (module-level `Map`, not DB-backed, not per-user) - once any recipient gets an alert, nobody gets another for that key until the shared cooldown expires.

**The "mute" system on `/alerts` is not per-user - it's a global config table
that happens to be gated behind login.** This is the real landmine, and it's
documented as intentional in the code, not a bug:

> `app/api/alert-prefs/route.ts:20-29`: *"Muted Telegram alert groups - stored
> as one row per muted key. This is a single global config table with no
> per-user ownership (no user_id column)... same reasoning as the rest of the
> alert system."*

`lhq_muted_alerts` has no `user_id` column. When any authenticated user taps
a coin to "stop all alerts for it" on `/alerts`, they silence it for **every
Pro user connected to Telegram**, not just themselves. The UI copy ("Tap a
coin to stop all alerts for it") reads as personal preference; it isn't.

**Recipients are already correctly scoped for Pro-gating and price alerts.**
`runAlerts()` builds `allChatIds` per-user from `lhq_user_settings` joined
against `lhq_user_subscriptions.role = 'pro'` ([route.ts:1552-1573](app/api/telegram/alert/route.ts:1552)),
and `checkPriceAlerts` already reads `lhq_price_alerts` per-row with its own
`user_id`, routing each fired alert to its owner
(*"Route to owner if known; legacy rows (no user_id) broadcast to everyone"*,
[route.ts:812](app/api/telegram/alert/route.ts:812)). **Price Alerts is the
one existing feature that's already the shape #13 needs.** Everything else
isn't.

---

## 2. What #13 actually requires

Two separable problems, not one:

### 2a. Fix the mute system (prerequisite, ships alone, real bug either way)
Give `lhq_muted_alerts` a `user_id` column (or a new `lhq_alert_prefs` table),
scope every read/write to the authenticated user. This is a smaller, self-
contained fix - worth doing regardless of whether thresholds ship, because
right now one user's mute silently mutes everyone's feed. Rough size: 1 table
migration + touch 2 files (`alert-prefs/route.ts` read/write, and
`runAlerts()`'s `fetchMutedKeys()` call site).

### 2b. Make thresholds user-configurable (the actual feature)
This is the real rearchitecture. The expensive part (fetching funding/price/
kline data) stays shared - one fetch serves everyone, as today. What has to
change is everything downstream of "did this cross the line":

- **New table**, e.g. `lhq_alert_thresholds(user_id, rule_key, threshold_value, enabled)` -
  one row per user per configurable rule (`squeeze_score`, `whale_usd_btc`,
  `rapid_move_5m_pct`, etc.), keyed the same way `muted_alerts.key` already is.
- **Check functions stop deciding "fire or not" globally.** Instead of
  `if (score < 70) continue`, each check computes and returns the raw metric
  (squeeze score, % move, whale USD) for every coin, unconditionally. A new
  routing layer then does, per recipient: read their threshold row (default
  to today's hardcoded value if unset, so nobody's alerts silently break),
  compare, and only include that recipient in the send list for that specific
  signal if they cross their own line.
- **Send path changes from one broadcast to N targeted sends** (or grouped by
  distinct threshold buckets, to avoid literally one HTTP call per user per
  signal - most users will share the default, so bucket-then-send keeps this
  cheap). `flushSignals`/`tg()` already accept `chatId: string | string[]`, so
  the plumbing for "send to this subset" already exists; it's the subset
  *computation* that's new.
- **Cooldowns need a user (or bucket) dimension.** Today `squeeze_LONG_btc`
  is one global key. If user A's threshold is 60 and user B's is 80, a score
  of 65 should cooldown-and-fire for A but not touch B's cooldown at all -
  otherwise a low-threshold user's frequent alerts silently eat a high-
  threshold user's cooldown window and vice versa. Simplest correct fix:
  key cooldowns as `${ruleKey}_${coin}_${dir}_${thresholdBucket}` instead of
  just `${ruleKey}_${coin}_${dir}`.
- **UI**: `/alerts` page's flat toggle list needs number inputs next to the
  rules that have a real threshold (squeeze score, whale $, move %) alongside
  the existing on/off toggle for rules that don't (news, daily summary).
  Existing `.acoin-search`/`.tg-*`/`.pa-*` CSS patterns already cover input
  styling - no new design system needed.
- **Web Push** (`dispatchPush`) reads the same filtered queue as Telegram
  today - once the queue is per-recipient instead of global, push needs the
  same per-subscription filtering, not just Telegram.

---

## 3. Explicit non-goals for a first pass

- **Compound conditions** ("funding > 0.05% AND squeeze > 70") - the original
  roadmap item's example. This is a genuinely separate, larger feature (a
  small condition-tree data model + evaluator) layered on top of simple
  per-rule thresholds. Ship simple thresholds first; a compound-condition
  builder is a plausible v2, not part of this scope.
- **Custom cooldown periods per user** - keep cooldowns admin-set (current
  `CD` constants), only the trigger threshold becomes per-user. Configurable
  cooldowns compound the bucketing problem above for little payoff.
- **Historical backfill/migration of existing global mutes** - when
  `lhq_muted_alerts` gains `user_id`, existing rows have no owner. Simplest
  answer: wipe the table on migration (small enough - it's config, not data)
  and let users re-set their own coin/rule mutes fresh.

---

## 4. Suggested sequencing

1. **Fix global mute → per-user mute** (2a). Small, self-contained, fixes a
   real correctness bug today regardless of thresholds. Ship independently.
2. **Per-user thresholds for the 3 highest-value rules only**: squeeze score,
   whale USD, rapid-move %. These are the ones with a single obvious numeric
   knob and the clearest "this is annoying me / not sensitive enough" user
   complaint shape. Skip EMA Setup/OI/CVD/distribution thresholds in v1 -
   same mechanism, just more rows, add later once the pattern is proven.
2b. Routing-layer + cooldown-bucketing changes described above, scoped to
    just those 3 rules.
3. **UI**: threshold inputs on `/alerts` for those 3 rules.
4. Extend to remaining rule types once the pattern's live and validated,
   one check function at a time (each is already independently structured,
   so this is additive, not a second rearchitecture).

Step 1 alone is worth doing this week. Steps 2-3 are the real project -
estimate a few focused sessions, not a quick pass, mainly because of the
cooldown-bucketing correctness work, not the UI.
