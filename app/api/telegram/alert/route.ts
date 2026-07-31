import { NextRequest, NextResponse } from 'next/server';
import webpush from 'web-push';
import { classifyNews } from '@/lib/classify';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { detectPatterns } from '@/lib/patterns';
import { T } from '@/lib/tables';
import { recordFires } from '@/lib/alertHistory';
import { isOutcomeTracked, persistAlertFires } from '@/lib/alertOutcomes';
import { BINANCE_SYMS, BYBIT_SYMS, COIN_LABELS, COINS, bybitSymbolPriceFactor } from '@/lib/coins';
import { computeDistributionScore, DistributionInputs } from '@/lib/distribution';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { checkCronAuth } from '@/lib/cronAuth';
import { recordApiHealth, reportHealth, healthError } from '@/lib/apiHealth';
import {
  EMA_SIGNAL_TFS, type EMASignalTF, fetchRibbonCandles, BYBIT_KLINE_SYMS,
} from '@/lib/ribbonCandles';
import { detectStructureSignals } from '@/lib/priceAction';
import {
  STRUCTURE_TFS, type StructureTF,
  isStructureEnabled, structureTfForRuleKey,
} from '@/lib/structurePrefs';
import { detectEMASignals, DEFAULT_FILTER_PARAMS, STRICT_FILTER_PARAMS, OHLCV } from '@/lib/strategyCore';

export const dynamic = 'force-dynamic';

// Telegram's parse_mode:HTML treats any of these characters as markup -
// user-supplied free text (e.g. a saved price alert's label) must be escaped
// before insertion into a message body, or it can inject its own tags
// (e.g. a label containing `<a href="...">`) into a message sent through
// the app's trusted bot identity.
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ── Signal queue - for confluence batching ── */
// ruleKey matches the mute-toggle key used on /alerts (e.g. 'rsi', 'squeeze',
// 'ema_setup_1h') - used at send time to filter recipients who muted this
// specific rule, independent of the coin:/dir: keys also checked per entry.
//
// metricValue/thresholdKind/canonicalHit exist only for rule_keys that have a
// user-adjustable threshold (currently rsi, squeeze - see Settings). The
// checker pushes ONE entry per coin/direction using the loosest threshold
// among current recipients (so it fires whenever anyone would want it), and
// flushSignals decides per-recipient delivery against their own setting.
// canonicalHit marks whether the value also crosses the app-wide canonical
// default (RSI 70/30, squeeze 70) - outcome-tracking (#10) only ever logs
// canonical hits, so a user's personal threshold can never change what the
// shared Alert Track Record means. Entry types with no per-user threshold
// (ema_cross, distribution, whales) leave these fields unset, which reads as
// "always passes" / "always canonical" everywhere they're checked.
interface SignalEntry {
  coin: string; title: string; body: string; name: string;
  dir?: 'long' | 'short'; ruleKey: string; price?: number;
  metricValue?: number; thresholdKind?: 'rsi_ob' | 'rsi_os' | 'squeeze'; canonicalHit?: boolean;
  // Set only on ema_signal entries: which filter mode produced this one
  // (Arena's Anti-Chop Filter). Undefined on every other rule_key, which
  // passesThreshold() reads as "no filter-mode gating, always eligible".
  antiChopMode?: boolean;
}

/* ── Per-recipient mute-aware delivery ── */
interface Recipient { userId: string; chatId: string }

function isMutedFor(mutedByUser: Map<string, Set<string>>, userId: string, ...keys: string[]): boolean {
  const set = mutedByUser.get(userId);
  if (!set) return false;
  return keys.some(k => set.has(k));
}

function entryMuteKeys(e: Pick<SignalEntry, 'coin' | 'dir' | 'ruleKey'>): string[] {
  const keys = [e.ruleKey, `coin:${e.coin}`];
  if (e.dir) keys.push(`dir:${e.dir}`);
  return keys;
}

// The single per-recipient delivery decision, shared by Telegram (flushSignals)
// and Web Push (dispatchPush) so a signal can never be eligible on one channel
// and not the other.
//
// Two different polarities meet here. Every long-standing rule is opt-OUT: a
// row in muted_alerts means the user silenced it, so no row means deliver.
// Market-structure signals are opt-IN: the user must hold an explicit
// structure_on_<tf> row, so no row means stay silent. See lib/structurePrefs.ts
// for why that inversion exists rather than a server-side seeding step.
function isEligibleFor(
  mutedByUser: Map<string, Set<string>>,
  userId: string,
  e: Pick<SignalEntry, 'coin' | 'dir' | 'ruleKey'>,
): boolean {
  if (isMutedFor(mutedByUser, userId, ...entryMuteKeys(e))) return false;
  const structureTf = structureTfForRuleKey(e.ruleKey);
  if (structureTf) return isStructureEnabled(mutedByUser.get(userId), structureTf);
  return true;
}

// For global (non-coin) checks that send directly rather than via the queue -
// just the recipients who haven't muted this one rule key.
function recipientChatIds(recipients: Recipient[], mutedByUser: Map<string, Set<string>>, ruleKey: string): string[] {
  return recipients.filter(r => !isMutedFor(mutedByUser, r.userId, ruleKey)).map(r => r.chatId);
}

/* ── Per-recipient adjustable thresholds (Settings > Notification thresholds) ──
   Canonical/default values - unify with lib/settings.ts DEFAULT_SETTINGS and
   the Telegram cron's own prior hardcoded gates (previously 78/22, now 70/30
   to match what Arena's browser-push channel has used all along). */
interface UserThresholds { rsiOb: number; rsiOs: number; squeezeThreshold: number; antiChopEnabled: boolean }
const DEFAULT_THRESHOLDS: UserThresholds = { rsiOb: 70, rsiOs: 30, squeezeThreshold: 70, antiChopEnabled: false };

// Fail-open: if Supabase is unreachable, every recipient falls back to
// DEFAULT_THRESHOLDS - identical to what an unconfigured user already gets,
// so a fetch failure never changes delivery behavior.
async function fetchThresholdsByUser(): Promise<Map<string, UserThresholds>> {
  const fallback = new Map<string, UserThresholds>();
  const query = (async () => {
    try {
      const db = getSupabaseAdmin();
      const { data, error } = await db.from(T.user_settings).select('user_id, rsi_ob, rsi_os, squeeze_threshold, anti_chop_enabled');
      if (error || !data) return fallback;
      const map = new Map<string, UserThresholds>();
      for (const row of data) {
        map.set(String(row.user_id), {
          rsiOb: typeof row.rsi_ob === 'number' ? row.rsi_ob : DEFAULT_THRESHOLDS.rsiOb,
          rsiOs: typeof row.rsi_os === 'number' ? row.rsi_os : DEFAULT_THRESHOLDS.rsiOs,
          squeezeThreshold: typeof row.squeeze_threshold === 'number' ? row.squeeze_threshold : DEFAULT_THRESHOLDS.squeezeThreshold,
          antiChopEnabled: typeof row.anti_chop_enabled === 'boolean' ? row.anti_chop_enabled : DEFAULT_THRESHOLDS.antiChopEnabled,
        });
      }
      return map;
    } catch { return fallback; }
  })();
  // 5s cap - if Supabase is slow, fail-open (canonical defaults for everyone)
  const cap = new Promise<Map<string, UserThresholds>>(res => setTimeout(() => res(fallback), 5_000));
  return Promise.race([query, cap]);
}

function passesThreshold(e: SignalEntry, t: UserThresholds | undefined): boolean {
  // EMA signal entries come in two variants (one per Anti-Chop Filter mode) -
  // only deliver the one matching this recipient's own Arena chart setting.
  if (e.antiChopMode !== undefined && e.antiChopMode !== (t ?? DEFAULT_THRESHOLDS).antiChopEnabled) return false;
  if (!e.thresholdKind || e.metricValue == null) return true; // not a threshold-gated rule_key
  const th = t ?? DEFAULT_THRESHOLDS;
  if (e.thresholdKind === 'rsi_ob') return e.metricValue >= th.rsiOb;
  if (e.thresholdKind === 'rsi_os') return e.metricValue <= th.rsiOs;
  if (e.thresholdKind === 'squeeze') return e.metricValue >= th.squeezeThreshold;
  return true;
}

/* ── Coin maps (sourced from shared lib/coins.ts) ── */
const BINANCE_PERP  = BINANCE_SYMS;
const BYBIT_PERP    = BYBIT_SYMS;
const BINANCE_SPOT  = BINANCE_SYMS;   // spot symbols are identical to perp symbols
const LABELS: Record<string, string> = COIN_LABELS;

const WHALE_THRESHOLD: Record<string, number> = {
  btc: 5_000_000, eth: 2_000_000, sol: 1_000_000,
  xrp: 750_000,   bnb: 750_000,   near: 500_000, sui: 500_000, hype: 500_000,
  doge: 500_000,  avax: 500_000,  link: 500_000,
  ada: 500_000,   dot: 500_000,   atom: 500_000, wif: 500_000,
  pepe: 500_000,  bonk: 500_000,
  ltc: 750_000,   bch: 750_000,   trx: 500_000,  xlm: 500_000, etc: 250_000, fil: 250_000,
  arb: 500_000,   op: 500_000,    apt: 500_000,  sei: 250_000, inj: 500_000, tia: 250_000,
  aave: 500_000,  uni: 500_000,   ldo: 250_000,  rune: 500_000, gmx: 250_000, crv: 250_000,
  stx: 250_000,   jup: 250_000,   wld: 250_000,  render: 250_000, tao: 500_000, fet: 250_000,
  ondo: 250_000,  pyth: 250_000,  ena: 250_000,  dydx: 250_000,
  sand: 250_000,  mana: 250_000,  gmt: 250_000,
  // xau/spx excluded - synthetic perps with non-standard trade sizing
};

/* ── In-memory state ── */
const lastSent   = new Map<string, number>();
// EMA Buy/Sell Signal dedup - keyed `${coin}_${tf}`, value = the fired
// signal's own timestamp (its arm/confirm candle). More precise than a time
// cooldown: re-fires only when a genuinely NEW signal (alternation flipped)
// appears, never on every tick while the same one is still current.
const emaSignalLastTs = new Map<string, number>();

const CD: Record<string, number> = {
  rsi:        4 * 3600_000,
  move5m:    30 * 60_000,
  move1h:     2 * 3600_000,
  move4h:     4 * 3600_000,
  whale:     30 * 60_000,   // overridden per session in main handler
  news:      15 * 60_000,   // overridden per session in main handler
  oi:         2 * 3600_000,
  cvd:       60 * 60_000,
  fng:       23 * 3600_000,   // Fear & Greed extreme (once per day)
  daily:     23 * 3600_000,   // Daily 7am summary
  sentiment:  4 * 3600_000,   // Sentiment Extremes - all 3 indicators aligned
  squeeze:      4 * 3600_000,   // Squeeze/Flush threshold alert per coin per direction
  distribution:  4 * 3600_000,   // Distribution - big players taking profit into strength
};

/* ── Concurrency limiter - runs tasks in chunks to avoid ETIMEDOUT under Render free tier ── */
async function runBatched<T>(tasks: Array<() => Promise<T>>, batchSize = 5): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    const chunk = tasks.slice(i, i + batchSize);
    results.push(...await Promise.all(chunk.map(t => t())));
  }
  return results;
}

/* ── Session helpers ── */
function isHighActivity(): boolean {
  const phtHour = (new Date().getUTCHours() + 8) % 24;
  return phtHour >= 20 || phtHour < 4;
}
function getSession(): string {
  const d   = new Date();
  const pht = ((d.getUTCHours() + 8) % 24) + d.getUTCMinutes() / 60;
  if (pht >= 21.5 || pht < 4)    return '🇺🇸 NY';
  if (pht >= 15   && pht < 21.5) return '🌍 London';
  if (pht >= 8    && pht < 15)   return '🌏 Asia';
  return '😴 Off';
}
const onCooldown = (key: string, ms: number) => { const t = lastSent.get(key); return t !== undefined && Date.now() - t < ms; };
const markSent   = (key: string) => lastSent.set(key, Date.now());

/* ── Per-recipient alert timestamps ──────────────────────────────────────────
   Message bodies are built once and fanned out to many chat IDs, so the time
   in them can't be baked in per recipient at build time. Instead bodies carry
   TIME_TOKEN, and tg() swaps in each recipient's own local time right before
   sending - grouping chat IDs by timezone so one Telegram call still covers
   everyone who shares a zone, exactly as the mute-subset grouping already does.

   CHAT_TZ is module scope because tg() is called from ~15 places that have no
   reason to know about timezones. It's rebuilt from the same user_settings
   rows at the top of every run, so a concurrent invocation can only ever
   overwrite it with equivalent data. */
const TIME_TOKEN = '__ALERT_TIME__';
const CHAT_TZ = new Map<string, string | null>();

function alertTimeIn(timeZone: string | null): string {
  // Unknown timezone (never opened the web app, or an older row) -> UTC, and
  // say so, rather than silently implying it's the reader's local time.
  if (!timeZone) {
    return new Date().toLocaleString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' }) + ' UTC';
  }
  try {
    return new Date().toLocaleString('en-GB', {
      timeZone, hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });
  } catch {
    // Bad/unknown IANA name stored - never let a formatting error kill an alert.
    return new Date().toLocaleString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' }) + ' UTC';
  }
}

// checkDailySummary's per-recipient morning-window check. Unknown/bad
// timezone falls back to Asia/Manila - the historical anchor this used
// unconditionally before per-user timezones existed, so a recipient we don't
// know the zone for still gets exactly the behavior they already had, not a
// regression relative to before this fix.
function localHourMinute(timeZone: string | null, d: Date): { hour: number; min: number } {
  const read = (zone: string) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d);
    return {
      hour: Number(parts.find(p => p.type === 'hour')?.value ?? '0'),
      min:  Number(parts.find(p => p.type === 'minute')?.value ?? '0'),
    };
  };
  try {
    return read(timeZone || 'Asia/Manila');
  } catch {
    return read('Asia/Manila');
  }
}

/* ── Telegram send ── */
/* Per-run delivery tally. Reset at the top of the handler, read at the end.
   Module-level because tg() is called from a dozen check functions that have
   no reason to thread a counter through their signatures - same shape as the
   dedup maps above, and with the same caveat: it survives between requests in
   a warm process, hence the explicit reset rather than lazy init. */
const sendTally = { ok: 0, failed: 0, reasons: new Set<string>() };

function resetSendTally(): void {
  sendTally.ok = 0;
  sendTally.failed = 0;
  sendTally.reasons.clear();
}

async function tg(token: string, chatId: string | string[], text: string): Promise<void> {
  // Send-only kill switch (/ops/config) - detection/tracking above this call
  // keeps running either way, only the actual outbound message stops.
  if (!(await isFeatureEnabled('telegram'))) return;

  const ids = Array.isArray(chatId) ? chatId : [chatId];
  // One rendered body per distinct timezone among these recipients.
  const byZone = new Map<string | null, string[]>();
  for (const id of ids) {
    const tz = CHAT_TZ.get(id) ?? null;
    const bucket = byZone.get(tz);
    if (bucket) bucket.push(id); else byZone.set(tz, [id]);
  }
  // Still fire-and-forget for the CALLER - a failed send must never abort the
  // rest of a run. But it is no longer silent. This used to be a bare
  // Promise.all inside `catch {}` that ignored the response entirely, so the
  // whole class of failures Telegram reports as a resolved non-2xx - bot
  // blocked by the user, chat not found, unparseable HTML in the body - was
  // indistinguishable from a successful delivery. Nothing anywhere recorded
  // whether a message actually landed.
  await Promise.all([...byZone.entries()].flatMap(([tz, zoneIds]) => {
    const body = text.includes(TIME_TOKEN) ? text.replaceAll(TIME_TOKEN, alertTimeIn(tz)) : text;
    return zoneIds.map(async id => {
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: id, text: body, parse_mode: 'HTML' }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) { sendTally.ok++; return; }
        sendTally.failed++;
        // description is Telegram's own reason ("chat not found", "bot was
        // blocked by the user") and is what makes the /ops entry actionable.
        const why = await res.json().then(
          (d: { description?: string }) => d?.description ?? `HTTP ${res.status}`,
          () => `HTTP ${res.status}`,
        );
        sendTally.reasons.add(why);
      } catch (e) {
        sendTally.failed++;
        sendTally.reasons.add(healthError(e));
      }
    });
  }));
}

/* ════════════════════════════════════════
   FLUSH - group signals by coin, send single or confluence
   Per-recipient mute-aware: recipients are grouped by which subset of a
   coin's fired entries they're actually eligible for (ruleKey/coin:/dir:
   mutes), so a confluence message only bundles what each person opted into.
   In the common case (nobody's muted anything) every recipient shares one
   group, so this collapses to exactly the old one-message-per-coin behavior.
   ════════════════════════════════════════ */
async function flushSignals(
  token: string,
  recipients: Recipient[],
  mutedByUser: Map<string, Set<string>>,
  thresholdsByUser: Map<string, UserThresholds>,
  stamp: string,
  queue: SignalEntry[],
): Promise<void> {
  if (queue.length === 0 || recipients.length === 0) return;

  // Group by coin
  const byCoin = new Map<string, SignalEntry[]>();
  for (const e of queue) {
    const arr = byCoin.get(e.coin) ?? [];
    arr.push(e);
    byCoin.set(e.coin, arr);
  }

  await Promise.all([...byCoin.entries()].map(async ([coin, entries]) => {
    // Group recipients by the exact subset of this coin's entries they're
    // eligible for (identical mute config + threshold -> identical subset ->
    // one send).
    const groups = new Map<string, { entries: SignalEntry[]; chatIds: string[] }>();
    for (const r of recipients) {
      const eligible = entries.filter(e =>
        isEligibleFor(mutedByUser, r.userId, e) && passesThreshold(e, thresholdsByUser.get(r.userId)));
      if (eligible.length === 0) continue;
      const sig = eligible.map(e => e.ruleKey + '_' + (e.dir ?? '')).join('|');
      if (!groups.has(sig)) groups.set(sig, { entries: eligible, chatIds: [] });
      groups.get(sig)!.chatIds.push(r.chatId);
    }

    const label = LABELS[coin] ?? coin.toUpperCase();

    await Promise.all([...groups.values()].map(async ({ entries: elig, chatIds }) => {
      if (elig.length === 1) {
        // Single signal - send as-is
        await tg(token, chatIds, elig[0].body);
        return;
      }

      // Confluence - 2+ signals this group is eligible for on this coin
      const bullets = elig.map(e => `• ${e.title}`).join('\n');
      await tg(token, chatIds,
        `🔀 <b>${label} - ${elig.length} Signals Aligned</b>\n\n` +
        `${bullets}\n\n` +
        `<i>${stamp}</i>`
      );
    }));
  }));
}

/* ════════════════════════════════════════
   SHARED: Fetch funding rates + spot prices
   ════════════════════════════════════════ */
interface BNTicker { symbol: string; lastFundingRate: string }
interface BBTicker  { symbol: string; fundingRate: string }

async function fetchAllFR(): Promise<Record<string, number | null>> {
  const result: Record<string, number | null> = {};
  COINS.forEach(c => (result[c] = null));
  const [bnR, bbR] = await Promise.allSettled([
    fetch('https://fapi.binance.com/fapi/v1/premiumIndex', { cache: 'no-store', signal: AbortSignal.timeout(7_000) }),
    fetch('https://api.bybit.com/v5/market/tickers?category=linear', { cache: 'no-store', signal: AbortSignal.timeout(7_000) }),
  ]);
  if (bnR.status === 'fulfilled' && bnR.value.ok) {
    const d = await bnR.value.json() as BNTicker[];
    for (const item of d) {
      const coin = Object.entries(BINANCE_PERP).find(([, s]) => s === item.symbol)?.[0];
      if (coin) result[coin] = parseFloat(item.lastFundingRate);
    }
  }
  if (bbR.status === 'fulfilled' && bbR.value.ok) {
    const d = await bbR.value.json() as { result?: { list?: BBTicker[] } };
    for (const item of d.result?.list ?? []) {
      const coin = Object.entries(BYBIT_PERP).find(([, s]) => s === item.symbol)?.[0];
      if (coin && result[coin] == null && item.fundingRate) result[coin] = parseFloat(item.fundingRate);
    }
  }
  return result;
}

async function fetchSpotPrices(): Promise<Record<string, number>> {
  try {
    const res  = await fetch('https://api.binance.com/api/v3/ticker/price', { cache: 'no-store', signal: AbortSignal.timeout(7_000) });
    if (!res.ok) return {};
    const data = await res.json() as Array<{ symbol: string; price: string }>;
    const out: Record<string, number> = {};
    for (const item of data) {
      const coin = Object.entries(BINANCE_SPOT).find(([, s]) => s === item.symbol)?.[0];
      if (coin) out[coin] = parseFloat(item.price);
    }
    return out;
  } catch { return {}; }
}

/* ── Bybit klines helper (newest-first → reversed to oldest-first) ── */
async function fetchBybitKlines(symbol: string, interval: string, limit: number): Promise<number[]> {
  try {
    const res = await fetch(
      `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`,
      { cache: 'no-store', signal: AbortSignal.timeout(7_000) }
    );
    if (!res.ok) return [];
    const data = await res.json() as { result?: { list?: string[][] } };
    const list = data.result?.list ?? [];
    // Bybit returns newest-first - reverse so index 0 = oldest
    const pf = bybitSymbolPriceFactor(symbol);
    return list.map(c => parseFloat(c[4]) * pf).reverse();
  } catch { return []; }
}

/* ════════════════════════════════════════
   3. RSI (extremes)
   ════════════════════════════════════════ */
function computeRSI(closes: number[], period = 14): number {
  if (closes.length < period + 2) return 50;
  const ch = closes.slice(1).map((c, i) => c - closes[i]);
  let ag = 0, al = 0;
  for (let i = 0; i < period; i++) { ag += Math.max(ch[i], 0); al += Math.max(-ch[i], 0); }
  ag /= period; al /= period;
  for (let i = period; i < ch.length; i++) {
    ag = (ag * (period - 1) + Math.max(ch[i], 0)) / period;
    al = (al * (period - 1) + Math.max(-ch[i], 0)) / period;
  }
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}

async function checkRSI(stamp: string, queue: SignalEntry[], recipients: Recipient[], thresholdsByUser: Map<string, UserThresholds>): Promise<string[]> {
  const fired: string[] = [];
  // Loosest (most sensitive) threshold across current recipients - a push
  // happens whenever ANYONE would want it; exact per-recipient delivery is
  // decided later in flushSignals via passesThreshold.
  const obValues = recipients.map(r => (thresholdsByUser.get(r.userId) ?? DEFAULT_THRESHOLDS).rsiOb);
  const osValues = recipients.map(r => (thresholdsByUser.get(r.userId) ?? DEFAULT_THRESHOLDS).rsiOs);
  const loosestOb = obValues.length ? Math.min(...obValues) : DEFAULT_THRESHOLDS.rsiOb;
  const loosestOs = osValues.length ? Math.max(...osValues) : DEFAULT_THRESHOLDS.rsiOs;

  await runBatched(COINS.map(coin => async () => {
    try {
      let closes: number[];
      if (BINANCE_SPOT[coin]) {
        // Wilder's RSI smoothing needs a long lookback to converge to the value
        // TradingView/Bybit show - 20 candles only gives ~5 smoothing iterations
        // past the initial seed, nowhere near enough. 300 matches what the
        // Arena chart reader uses for the same calculation.
        const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${BINANCE_SPOT[coin]}&interval=1h&limit=300`, { cache: 'no-store', signal: AbortSignal.timeout(7_000) });
        if (!res.ok) return;
        const data = await res.json() as Array<unknown[]>;
        closes = data.map(c => parseFloat(c[4] as string));
      } else if (BYBIT_KLINE_SYMS[coin]) {
        closes = await fetchBybitKlines(BYBIT_KLINE_SYMS[coin], '60', 300);
        if (closes.length === 0) return;
      } else {
        return;
      }
      const rsi    = computeRSI(closes);
      const r      = rsi.toFixed(1);
      const label  = LABELS[coin];
      const price  = closes[closes.length - 1];
      if (rsi >= loosestOb && !onCooldown(`rsi_ob_${coin}`, CD.rsi)) {
        queue.push({
          coin, dir: 'short', ruleKey: 'rsi', name: `${label} RSI overbought (${r})`, price,
          title: `RSI Overbought ${r} (1H)`,
          body: `⚡ <b>${label} RSI Overbought (1H)</b>\n\nRSI: <b>${r}</b>\nSignal: Exhaustion - Potential Reversal\nAction: Avoid chasing longs. Watch for rejection / reversal candle.\n\n<i>${stamp}</i>`,
          metricValue: rsi, thresholdKind: 'rsi_ob', canonicalHit: rsi >= DEFAULT_THRESHOLDS.rsiOb,
        });
        markSent(`rsi_ob_${coin}`); fired.push(`${label} RSI overbought (${r})`);
      }
      if (rsi <= loosestOs && !onCooldown(`rsi_os_${coin}`, CD.rsi)) {
        queue.push({
          coin, dir: 'long', ruleKey: 'rsi', name: `${label} RSI oversold (${r})`, price,
          title: `RSI Oversold ${r} (1H)`,
          body: `⚡ <b>${label} RSI Oversold (1H)</b>\n\nRSI: <b>${r}</b>\nSignal: Oversold - Bounce Setup\nAction: Watch for bounce from key support. Long bias on confirmation.\n\n<i>${stamp}</i>`,
          metricValue: rsi, thresholdKind: 'rsi_os', canonicalHit: rsi <= DEFAULT_THRESHOLDS.rsiOs,
        });
        markSent(`rsi_os_${coin}`); fired.push(`${label} RSI oversold (${r})`);
      }
    } catch { /* skip */ }
  }), 6);
  return fired;
}

/* ════════════════════════════════════════
   3c. RAPID PRICE MOVE (5m / 1H / 4H)
   ════════════════════════════════════════ */
async function checkRapidMove(stamp: string, queue: SignalEntry[]): Promise<string[]> {
  const fired: string[] = [];
  const FRAMES = [
    { interval: '5m',  bybitInterval: '5',   threshold: 4,  cd: 'move5m', tfLabel: '5m' },
    { interval: '1h',  bybitInterval: '60',  threshold: 5,  cd: 'move1h', tfLabel: '1H' },
    { interval: '4h',  bybitInterval: '240', threshold: 10, cd: 'move4h', tfLabel: '4H' },
  ] as const;

  await runBatched(
    COINS.flatMap(coin =>
      FRAMES.map(({ interval, bybitInterval, threshold, cd, tfLabel }) => async () => {
        try {
          let prevClose: number, currClose: number;
          let patternStr = '';
          if (BINANCE_SPOT[coin]) {
            const res = await fetch(
              `https://api.binance.com/api/v3/klines?symbol=${BINANCE_SPOT[coin]}&interval=${interval}&limit=25`,
              { cache: 'no-store', signal: AbortSignal.timeout(7_000) }
            );
            if (!res.ok) return;
            const data = await res.json() as Array<unknown[]>;
            if (data.length < 2) return;
            prevClose = parseFloat(data[data.length - 2][4] as string);
            currClose = parseFloat(data[data.length - 1][4] as string);
            // Detect patterns from OHLC
            const ohlc = data.map(k => ({ o: parseFloat(k[1] as string), h: parseFloat(k[2] as string), l: parseFloat(k[3] as string), c: parseFloat(k[4] as string) }));
            const pats = detectPatterns(ohlc);
            if (pats.length > 0) patternStr = pats[0]; // show first pattern
          } else if (BYBIT_KLINE_SYMS[coin]) {
            const closes = await fetchBybitKlines(BYBIT_KLINE_SYMS[coin], bybitInterval, 25);
            if (closes.length < 2) return;
            prevClose = closes[closes.length - 2];
            currClose = closes[closes.length - 1];
          } else {
            return;
          }
          if (prevClose === 0) return;
          const pct = (currClose - prevClose) / prevClose * 100;
          if (Math.abs(pct) < threshold) return;

          const label = LABELS[coin];
          const dir   = pct > 0 ? 'up' : 'down';
          const key   = `move_${dir}_${interval}_${coin}`;
          if (onCooldown(key, CD[cd])) return;

          const sign     = pct > 0 ? '+' : '';
          const emoji    = pct > 0 ? '🚀' : '🔻';

          queue.push({
            coin, ruleKey: 'rapid_move', name: `${label} rapid ${dir} ${sign}${pct.toFixed(1)}% (${tfLabel})`,
            title: `Rapid ${pct > 0 ? 'Pump' : 'Dump'} ${sign}${pct.toFixed(1)}% (${tfLabel})`,
            body: `${emoji} <b>${label} Rapid ${pct > 0 ? 'Pump' : 'Dump'} ${sign}${pct.toFixed(1)}% (${tfLabel})</b>\n\n` +
              `Price: <b>$${currClose.toLocaleString()}</b>\n` +
              `Signal: ${Math.abs(pct).toFixed(1)}% candle - ${pct > 0 ? 'momentum surge' : 'flash dump'}\n` +
              (patternStr ? `Pattern: <b>${patternStr}</b>\n` : '') +
              `Action: Check volume + OI. Next candle direction is key.` +
              `\n\n<i>${stamp}</i>`,
          });
          markSent(key); fired.push(`${label} rapid ${dir} ${sign}${pct.toFixed(1)}% (${tfLabel})`);
        } catch { /* skip */ }
      })
    ), 5
  );
  return fired;
}

/* ════════════════════════════════════════
   4. WHALE TRADES
   ════════════════════════════════════════ */
interface AggTrade { T: number; p: string; q: string; m: boolean }

async function checkWhales(stamp: string, queue: SignalEntry[]): Promise<string[]> {
  const fired: string[] = [];
  const since = Date.now() - 5 * 60_000;
  await runBatched([
    // ── Binance perp coins ──
    ...Object.entries(BINANCE_PERP).map(([coin, sym]) => async () => {
      const threshold = WHALE_THRESHOLD[coin];
      if (!threshold) return;
      try {
        const res    = await fetch(`https://fapi.binance.com/fapi/v1/aggTrades?symbol=${sym}&startTime=${since}&limit=500`, { cache: 'no-store', signal: AbortSignal.timeout(7_000) });
        if (!res.ok) return;
        const trades = await res.json() as AggTrade[];
        const label  = LABELS[coin];
        for (const t of trades) {
          const usd = parseFloat(t.p) * parseFloat(t.q);
          if (usd < threshold) continue;
          const side = t.m ? 'SELL' : 'BUY';
          const key  = `whale_${coin}_${side}`;
          if (onCooldown(key, CD.whale)) continue;
          const usdFmt   = usd >= 1_000_000 ? `$${(usd / 1_000_000).toFixed(2)}M` : `$${(usd / 1000).toFixed(0)}K`;
          const price    = parseFloat(t.p);
          const priceStr = price.toLocaleString();
          queue.push({
            coin, dir: side === 'BUY' ? 'long' : 'short', ruleKey: 'whales', name: `${label} whale ${side} ${usdFmt}`, price,
            title: `Whale ${side} ${usdFmt}`,
            body: side === 'BUY'
              ? `🐋 <b>${label} Whale BUY Detected</b>\n\nSize: <b>${usdFmt}</b> at $${priceStr}\nSignal: Large aggressive buy - institutional accumulation\n\n<i>${stamp}</i>`
              : `🐋 <b>${label} Whale SELL Detected</b>\n\nSize: <b>${usdFmt}</b> at $${priceStr}\nSignal: Large aggressive sell - institutional distribution\n\n<i>${stamp}</i>`,
          });
          markSent(key); fired.push(`${label} whale ${side} ${usdFmt}`); break;
        }
      } catch { /* skip */ }
    }),
    // ── Bybit-only coins (HYPE) ──
    ...Object.entries(BYBIT_KLINE_SYMS).map(([coin, sym]) => async () => {
      const threshold = WHALE_THRESHOLD[coin];
      if (!threshold) return;
      try {
        const res = await fetch(
          `https://api.bybit.com/v5/market/recent-trade?category=linear&symbol=${sym}&limit=1000`,
          { cache: 'no-store', signal: AbortSignal.timeout(7_000) }
        );
        if (!res.ok) return;
        const data = await res.json() as { result?: { list?: Array<{ T: number; p: string; v: string; S: string }> } };
        const trades = (data.result?.list ?? []).filter(t => t.T >= since);
        const label  = LABELS[coin];
        for (const t of trades) {
          const usd = parseFloat(t.p) * parseFloat(t.v);
          if (usd < threshold) continue;
          const side = t.S === 'Buy' ? 'BUY' : 'SELL';
          const key  = `whale_${coin}_${side}`;
          if (onCooldown(key, CD.whale)) continue;
          const usdFmt   = usd >= 1_000_000 ? `$${(usd / 1_000_000).toFixed(2)}M` : `$${(usd / 1000).toFixed(0)}K`;
          const price    = parseFloat(t.p);
          const priceStr = price.toLocaleString();
          queue.push({
            coin, dir: side === 'BUY' ? 'long' : 'short', ruleKey: 'whales', name: `${label} whale ${side} ${usdFmt}`, price,
            title: `Whale ${side} ${usdFmt}`,
            body: side === 'BUY'
              ? `🐋 <b>${label} Whale BUY Detected</b>\n\nSize: <b>${usdFmt}</b> at $${priceStr}\nSignal: Large aggressive buy - institutional accumulation\n\n<i>${stamp}</i>`
              : `🐋 <b>${label} Whale SELL Detected</b>\n\nSize: <b>${usdFmt}</b> at $${priceStr}\nSignal: Large aggressive sell - institutional distribution\n\n<i>${stamp}</i>`,
          });
          markSent(key); fired.push(`${label} whale ${side} ${usdFmt}`); break;
        }
      } catch { /* skip */ }
    }),
  ], 5);
  return fired;
}

/* ════════════════════════════════════════
   5. BREAKING NEWS (global - stays direct, no coin grouping)
   ════════════════════════════════════════ */
interface FinnhubItem { id: number; headline: string; datetime: number; source: string }
const FINNHUB_KEY = process.env.FINNHUB_KEY ?? '';

async function checkNews(
  token: string, recipients: Recipient[], mutedByUser: Map<string, Set<string>>, stamp: string,
): Promise<string[]> {
  const fired: string[] = [];
  const chatId = recipientChatIds(recipients, mutedByUser, 'news');
  if (chatId.length === 0) return fired;
  const since = Math.floor(Date.now() / 1000) - 600;
  try {
    const [cryptoR, generalR] = await Promise.allSettled([
      fetch(`https://finnhub.io/api/v1/news?category=crypto&token=${FINNHUB_KEY}`, { cache: 'no-store', signal: AbortSignal.timeout(7_000) }),
      fetch(`https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_KEY}`, { cache: 'no-store', signal: AbortSignal.timeout(7_000) }),
    ]);
    const items: FinnhubItem[] = [];
    if (cryptoR.status === 'fulfilled' && cryptoR.value.ok) {
      const d = await cryptoR.value.json() as FinnhubItem[];
      items.push(...d.filter(n => n.datetime >= since));
    }
    if (generalR.status === 'fulfilled' && generalR.value.ok) {
      const d = await generalR.value.json() as FinnhubItem[];
      items.push(...d.filter(n => n.datetime >= since && classifyNews(n.headline) === 'red'));
    }
    for (const item of items) {
      const type = classifyNews(item.headline);
      if (!type || type === 'purple') continue;
      const key = `news_${item.id}`;
      if (onCooldown(key, CD.news)) continue;
      const emoji    = type === 'red' ? '🚨' : '📊';
      const label    = type === 'red' ? 'Breaking Alert' : 'Macro Alert';
      await tg(token, chatId, `${emoji} <b>${label}</b>\n\n<b>${item.headline}</b>\nSource: ${item.source}\n\n<i>${stamp}</i>`);
      markSent(key); fired.push(`news: ${item.headline.slice(0, 50)}`);
    }
  } catch { /* skip */ }
  return fired;
}

/* ════════════════════════════════════════
   6. OI SPIKE (+15% in 1h)
   ════════════════════════════════════════ */
interface OIHistItem { sumOpenInterest: string; timestamp: number }

async function checkOISpike(stamp: string, prices: Record<string, number>, queue: SignalEntry[]): Promise<string[]> {
  const fired: string[] = [];
  await runBatched([
    // ── Binance perp coins ──
    ...Object.entries(BINANCE_PERP).map(([coin, sym]) => async () => {
    try {
      const res = await fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${sym}&period=5m&limit=13`, { cache: 'no-store', signal: AbortSignal.timeout(7_000) });
      if (!res.ok) return;
      const data  = await res.json() as OIHistItem[];
      if (data.length < 12) return;
      const oldest = parseFloat(data[0].sumOpenInterest);
      const newest = parseFloat(data[data.length - 1].sumOpenInterest);
      if (oldest === 0) return;
      const pct   = (newest - oldest) / oldest * 100;
      const label = LABELS[coin];
      const price = prices[coin];

      if (Math.abs(pct) >= 15) {
        const dir = pct > 0 ? 'spike' : 'drop';
        const key = `oi_${dir}_${coin}`;
        if (onCooldown(key, CD.oi)) return;

        queue.push({
          coin, ruleKey: 'oi_spike', name: `${label} OI ${dir} ${pct.toFixed(1)}%`,
          title: `Open Interest ${pct > 0 ? 'Spike' : 'Drop'} ${pct > 0 ? '+' : ''}${pct.toFixed(1)}% (1h)`,
          body: `📈 <b>${label} Open Interest ${pct > 0 ? 'Spike' : 'Drop'} - ${pct > 0 ? '+' : ''}${pct.toFixed(1)}% in 1h</b>\n\n` +
            `Open interest changed from ${(oldest / 1000).toFixed(1)}K to ${(newest / 1000).toFixed(1)}K contracts\n` +
            `Signal: ${pct > 0 ? 'New money entering - big move likely building' : 'Positions closing - potential trend reversal'}` +
            `\n\n<i>${stamp}</i>`,
        });
        markSent(key); fired.push(`${label} OI ${dir} ${pct.toFixed(1)}%`);
      }
    } catch { /* skip */ }
    }),
    // ── Bybit-only coins (HYPE) ──
    ...Object.entries(BYBIT_KLINE_SYMS).map(([coin, sym]) => async () => {
      try {
        const res = await fetch(
          `https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${sym}&intervalTime=5min&limit=13`,
          { cache: 'no-store', signal: AbortSignal.timeout(7_000) }
        );
        if (!res.ok) return;
        const data = await res.json() as { result?: { list?: Array<{ openInterest: string }> } };
        const list = data.result?.list ?? [];
        if (list.length < 12) return;
        // Bybit returns newest-first
        const newest = parseFloat(list[0].openInterest);
        const oldest = parseFloat(list[list.length - 1].openInterest);
        if (oldest === 0) return;
        const pct   = (newest - oldest) / oldest * 100;
        const label = LABELS[coin];
        const price = prices[coin];
        if (Math.abs(pct) >= 15) {
          const dir = pct > 0 ? 'spike' : 'drop';
          const key = `oi_${dir}_${coin}`;
          if (onCooldown(key, CD.oi)) return;
          queue.push({
            coin, ruleKey: 'oi_spike', name: `${label} OI ${dir} ${pct.toFixed(1)}%`,
            title: `Open Interest ${pct > 0 ? 'Spike' : 'Drop'} ${pct > 0 ? '+' : ''}${pct.toFixed(1)}% (1h)`,
            body: `📈 <b>${label} Open Interest ${pct > 0 ? 'Spike' : 'Drop'} - ${pct > 0 ? '+' : ''}${pct.toFixed(1)}% in 1h</b>\n\n` +
              `Open interest: ${(oldest / 1000).toFixed(1)}K → ${(newest / 1000).toFixed(1)}K contracts\n` +
              `Signal: ${pct > 0 ? 'New money entering - big move likely building' : 'Positions closing - potential trend reversal'}` +
              `\n\n<i>${stamp}</i>`,
          });
          markSent(key); fired.push(`${label} OI ${dir} ${pct.toFixed(1)}%`);
        }
      } catch { /* skip */ }
    }),
  ], 5);
  return fired;
}

/* ════════════════════════════════════════
   7. CVD DIVERGENCE
   ════════════════════════════════════════ */
interface TakerVolItem { buyVol: string; sellVol: string; timestamp: number }

async function checkCVD(stamp: string, queue: SignalEntry[]): Promise<string[]> {
  const fired: string[] = [];
  await runBatched(Object.entries(BINANCE_PERP).map(([coin, sym]) => async () => {
    try {
      const [kRes, tvRes] = await Promise.allSettled([
        fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1h&limit=2`, { cache: 'no-store', signal: AbortSignal.timeout(7_000) }),
        fetch(`https://fapi.binance.com/futures/data/takerBuySellVol?symbol=${sym}&period=5m&limit=12`, { cache: 'no-store', signal: AbortSignal.timeout(7_000) }),
      ]);
      if (kRes.status !== 'fulfilled' || !kRes.value.ok) return;
      if (tvRes.status !== 'fulfilled' || !tvRes.value.ok) return;

      const klines  = await kRes.value.json() as Array<unknown[]>;
      const tvData  = await tvRes.value.json() as TakerVolItem[];
      if (klines.length < 2 || tvData.length < 6) return;

      const prevClose      = parseFloat(klines[0][4] as string);
      const currClose      = parseFloat(klines[1][4] as string);
      const priceChangePct = (currClose - prevClose) / prevClose * 100;

      let totalBuy = 0, totalSell = 0;
      for (const item of tvData) { totalBuy += parseFloat(item.buyVol); totalSell += parseFloat(item.sellVol); }
      const netCVD = totalBuy - totalSell;
      const label  = LABELS[coin];
      const THRESH = 1.5;

      if (priceChangePct > THRESH && netCVD < 0 && !onCooldown(`cvd_bear_${coin}`, CD.cvd)) {
        queue.push({
          coin, ruleKey: 'cvd', name: `${label} bearish CVD divergence`,
          title: `Bearish CVD Divergence`,
          body: `⚠️ <b>${label} Bearish CVD Divergence</b>\n\nPrice: <b>+${priceChangePct.toFixed(1)}%</b> in 1h\nCVD: <b>Negative</b> - sellers dominating volume\nSignal: Price pump not supported by buying - likely a fake move\nAction: Avoid chasing longs. Watch for reversal.\n\n<i>${stamp}</i>`,
        });
        markSent(`cvd_bear_${coin}`); fired.push(`${label} bearish CVD divergence`);
      }
      if (priceChangePct < -THRESH && netCVD > 0 && !onCooldown(`cvd_bull_${coin}`, CD.cvd)) {
        queue.push({
          coin, ruleKey: 'cvd', name: `${label} bullish CVD divergence`,
          title: `Bullish CVD Divergence`,
          body: `⚡ <b>${label} Bullish CVD Divergence</b>\n\nPrice: <b>${priceChangePct.toFixed(1)}%</b> in 1h\nCVD: <b>Positive</b> - buyers absorbing the dip\nSignal: Price drop not matched by sell volume - accumulation signal\nAction: Watch for bounce from key support.\n\n<i>${stamp}</i>`,
        });
        markSent(`cvd_bull_${coin}`); fired.push(`${label} bullish CVD divergence`);
      }
    } catch { /* skip */ }
  }), 5);
  return fired;
}

/* ════════════════════════════════════════
   8. PRICE ALERTS (user-set, Supabase)
   Per-user: each alert fires only to its owner's Telegram.
   Falls back to allChatIds for legacy rows with no user_id.
   ════════════════════════════════════════ */
interface PriceAlert { id: number; coin: string; target_price: number; direction: string; label: string; user_id?: string | null }

async function checkPriceAlerts(
  token: string, stamp: string, prices: Record<string, number>,
  allChatIds: string[], proUserIds: Set<string>
): Promise<string[]> {
  const fired: string[] = [];
  try {
    const admin = getSupabaseAdmin();

    // Fetch alerts + per-user chat IDs in parallel
    const [alertsRes, settingsRes] = await Promise.all([
      admin.from(T.price_alerts).select('*').eq('active', true),
      admin.from(T.user_settings).select('user_id, telegram_chat_id'),
    ]);

    if (!alertsRes.data?.length) return [];

    // Build user_id → telegram_chat_id lookup - Telegram alerts are Pro-only,
    // so a free user's chat_id (however it got saved) never receives a ping.
    const chatIdByUser = new Map<string, string>();
    for (const row of settingsRes.data ?? []) {
      const userId = row.user_id as string;
      if (!proUserIds.has(userId)) continue;
      const id = (row.telegram_chat_id as string)?.trim();
      if (id) chatIdByUser.set(userId, id);
    }

    // Collect ids to deactivate and issue ONE batched UPDATE after the loop,
    // instead of a separate round-trip per triggered alert (N+1).
    const triggeredIds: number[] = [];

    for (const alert of alertsRes.data as PriceAlert[]) {
      const price = prices[alert.coin];
      if (price == null) continue;
      const triggered =
        (alert.direction === 'above' && price >= alert.target_price) ||
        (alert.direction === 'below' && price <= alert.target_price);
      if (!triggered) continue;

      // Route to owner if known; only a row with NO user_id at all (true
      // legacy, pre-dates per-user ownership) falls back to broadcasting to
      // everyone. A row WITH a user_id whose owner isn't entitled/connected
      // must never fall through to the broadcast branch - that used to
      // happen here (ownerChatId ?? allChatIds treated "owner not entitled"
      // the same as "no owner"), which leaked a free user's private price-
      // alert note to every Pro user's Telegram. Leave it active; it's
      // retried next tick in case the owner becomes entitled.
      const hasOwner = !!alert.user_id;
      const ownerChatId = hasOwner ? chatIdByUser.get(alert.user_id!) : undefined;
      if (hasOwner && !ownerChatId) continue;
      if (!hasOwner && allChatIds.length === 0) continue;
      const recipient = hasOwner ? ownerChatId! : allChatIds;

      const label    = LABELS[alert.coin] ?? alert.coin.toUpperCase();
      const dirLabel = alert.direction === 'above' ? '📈 Crossed Above' : '📉 Crossed Below';

      const body = `🎯 <b>${label} Price Alert Triggered</b>\n\n` +
        `${dirLabel} <b>$${alert.target_price.toLocaleString()}</b>\n` +
        `Current: $${price.toLocaleString()}` +
        (alert.label ? `\nNote: ${escapeHtml(alert.label)}` : '') +
        `\n\n<i>${stamp}</i>`;

      await tg(token, recipient, body);

      triggeredIds.push(alert.id);
      // Deliberately NOT added to `fired`. That list goes to recordFires(),
      // an app-wide in-memory feed served by /api/telegram/history and shown
      // on /alerts to everyone - so pushing one user's coin and target price
      // into it published their private alert to every other user. Same leak
      // the comment above describes, just through the history feed instead of
      // Telegram. `fired` is for market-wide signals only; a price alert is by
      // definition one person's.
    }

    // Deactivate all fired alerts in a single round-trip
    if (triggeredIds.length > 0) {
      await admin.from(T.price_alerts)
        .update({ active: false, triggered_at: new Date().toISOString() })
        .in('id', triggeredIds);
    }
  } catch { /* skip */ }
  return fired;
}

/* ════════════════════════════════════════
   9. FEAR & GREED EXTREME
   ════════════════════════════════════════ */
interface FNGData { value: string; value_classification: string }

async function checkFearGreed(
  token: string, recipients: Recipient[], mutedByUser: Map<string, Set<string>>, stamp: string,
): Promise<string[]> {
  const fired: string[] = [];
  const chatId = recipientChatIds(recipients, mutedByUser, 'fear_greed');
  if (chatId.length === 0) return fired;
  try {
    const res  = await fetch('https://api.alternative.me/fng/', { cache: 'no-store', signal: AbortSignal.timeout(7_000) });
    if (!res.ok) return [];
    const json = await res.json() as { data: FNGData[] };
    const val  = parseInt(json.data?.[0]?.value ?? '50');
    const cls  = json.data?.[0]?.value_classification ?? '';
    if (isNaN(val)) return [];

    if (val <= 15 && !onCooldown('fng_fear', CD.fng)) {
      await tg(token, chatId,
        `🩸 <b>Extreme Fear - Fear &amp; Greed: ${val}</b>\n\n` +
        `Classification: <b>${cls}</b>\n` +
        `Signal: Market in panic - historically a contrarian accumulation zone\n` +
        `Action: Watch for capitulation candle + volume spike as entry signal.\n\n` +
        `<i>${stamp}</i>`);
      markSent('fng_fear'); fired.push(`Fear & Greed extreme fear (${val})`);
    }
    if (val >= 85 && !onCooldown('fng_greed', CD.fng)) {
      await tg(token, chatId,
        `🔥 <b>Extreme Greed - Fear &amp; Greed: ${val}</b>\n\n` +
        `Classification: <b>${cls}</b>\n` +
        `Signal: Market euphoria - historically a distribution zone\n` +
        `Action: Consider tightening stops and reducing position size.\n\n` +
        `<i>${stamp}</i>`);
      markSent('fng_greed'); fired.push(`Fear & Greed extreme greed (${val})`);
    }
  } catch { /* skip */ }
  return fired;
}

/* ════════════════════════════════════════
   10. DAILY 7AM PHT SUMMARY
   ════════════════════════════════════════ */
async function checkDailySummary(
  token: string, recipients: Recipient[], mutedByUser: Map<string, Set<string>>, stamp: string,
  frMap: Record<string, number | null>
): Promise<string[]> {
  const d = new Date();
  // Each recipient's OWN local 7:00-7:10am window, not one fixed instant that
  // only actually meant "morning" for Philippine subscribers. This used to
  // gate the entire function on a single `(getUTCHours()+8)%24 === 7` check -
  // correct for PHT, but a "7am summary" that always lands at 7pm the
  // previous evening for a US Eastern subscriber isn't a morning briefing for
  // them at all. Cron ticks every few minutes (see the 10-minute slop below)
  // and checks every recipient's zone each time, so each one gets exactly one
  // send, at their own morning, on whichever tick happens to land in it - the
  // per-chatId cooldown is what prevents a second send on the next tick.
  const eligible: { r: Recipient; zone: string }[] = [];
  for (const r of recipients) {
    if (isMutedFor(mutedByUser, r.userId, 'daily_summary')) continue;
    const zone = CHAT_TZ.get(r.chatId) || 'Asia/Manila';
    const { hour, min } = localHourMinute(zone, d);
    if (hour !== 7 || min > 10) continue;
    const cdKey = `daily_summary_${r.chatId}`;
    if (onCooldown(cdKey, CD.daily)) continue;
    markSent(cdKey);
    eligible.push({ r, zone });
  }
  if (eligible.length === 0) return [];

  // Fear & Greed
  let fngLine    = '';
  try {
    const fngRes = await fetch('https://api.alternative.me/fng/', { cache: 'no-store', signal: AbortSignal.timeout(7_000) });
    if (fngRes.ok) {
      const fngJson = await fngRes.json() as { data: FNGData[] };
      const val = fngJson.data?.[0]?.value;
      const cls = fngJson.data?.[0]?.value_classification;
      if (val) { fngLine = `\n😨 F&amp;G: <b>${val}</b> (${cls})`; }
    }
  } catch { /* skip */ }

  // Funding rates - two rows of 4
  const frParts = COINS.map(coin => {
    const fr = frMap[coin];
    if (fr == null) return null;
    const sign = fr >= 0 ? '+' : '';
    return `${LABELS[coin]} ${sign}${(fr * 100).toFixed(4)}%`;
  }).filter(Boolean) as string[];
  const frBlock    = [frParts.slice(0, 4).join(' · '), frParts.slice(4).join(' · ')].filter(Boolean).join('\n');

  // Active price alerts - grouped by owner so each recipient's summary only
  // ever shows THEIR OWN alerts. This used to be one shared query with no
  // user_id filter, pooling every user's alerts (labels included) into the
  // single broadcast every daily_summary subscriber received - a cross-user
  // privacy leak, not just an injection risk.
  const alertsByUser = new Map<string, PriceAlert[]>();
  try {
    const { data } = await getSupabaseAdmin().from(T.price_alerts).select('*').eq('active', true);
    for (const a of (data ?? []) as PriceAlert[]) {
      if (!a.user_id) continue; // legacy ownerless rows - never shown in anyone's personalized summary
      const list = alertsByUser.get(a.user_id) ?? [];
      list.push(a);
      alertsByUser.set(a.user_id, list);
    }
  } catch { /* skip */ }

  await Promise.all(eligible.map(({ r, zone }) => {
    // "Today" in the header means the recipient's own calendar date at their
    // 7am, not UTC's - someone far enough east or west of UTC can be on a
    // different UTC calendar day than their own local morning.
    const dateStr = d.toLocaleString('en-GB', {
      timeZone: zone, weekday: 'short', month: 'short', day: 'numeric',
    });
    const bodyBase =
      `☀️ <b>Morning Briefing - ${dateStr}</b>` +
      `${fngLine}\n\n` +
      `📊 <b>Funding Rates:</b>\n${frBlock}`;
    const own = alertsByUser.get(r.userId) ?? [];
    const alertsBlock = own.length
      ? `\n\n🎯 <b>Active Price Alerts:</b>\n${own.map(a => {
          const lbl = LABELS[a.coin] ?? a.coin.toUpperCase();
          const dir = a.direction === 'above' ? '↑' : '↓';
          return `• ${lbl} ${dir} $${parseFloat(String(a.target_price)).toLocaleString()}${a.label ? ` (${escapeHtml(a.label)})` : ''}`;
        }).join('\n')}`
      : '';
    return tg(token, r.chatId, `${bodyBase}${alertsBlock}\n\n<i>${stamp}</i>`);
  }));

  return ['Daily 7am summary'];
}

/* ════════════════════════════════════════
   11. SENTIMENT EXTREMES (#20)
   Fires when F&G + BTC funding rate + BTC L/S ratio all hit extremes together
   ════════════════════════════════════════ */
interface LSItem { longShortRatio: string; longAccount: string; shortAccount: string }

async function checkSentimentExtremes(
  token: string, recipients: Recipient[], mutedByUser: Map<string, Set<string>>, stamp: string,
  frMap: Record<string, number | null>
): Promise<string[]> {
  const fired: string[] = [];
  const chatId = recipientChatIds(recipients, mutedByUser, 'sentiment_extremes');
  if (chatId.length === 0) return fired;
  try {
    const btcFR = frMap['btc'];
    if (btcFR == null) return [];

    // Fetch F&G and BTC L/S ratio in parallel
    const [fngR, lsR] = await Promise.allSettled([
      fetch('https://api.alternative.me/fng/', { cache: 'no-store', signal: AbortSignal.timeout(7_000) }),
      fetch('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1', { cache: 'no-store', signal: AbortSignal.timeout(7_000) }),
    ]);

    if (fngR.status !== 'fulfilled' || !fngR.value.ok) return [];
    if (lsR.status  !== 'fulfilled' || !lsR.value.ok)  return [];

    const fngJson = await fngR.value.json() as { data: FNGData[] };
    const fng     = parseInt(fngJson.data?.[0]?.value ?? '50');
    const fngCls  = fngJson.data?.[0]?.value_classification ?? '';
    if (isNaN(fng)) return [];

    const lsData  = await lsR.value.json() as LSItem[];
    if (!lsData?.length) return [];
    const longPct  = parseFloat(lsData[0].longAccount) * 100;   // e.g. 60.87
    const shortPct = 100 - longPct;
    const frPct    = btcFR * 100;

    // ── BEARISH EXTREME: F&G greedy + FR long-heavy + L/S long-heavy ──
    // All 3 screaming "longs are overcrowded" → dump risk is elevated
    if (fng >= 75 && frPct >= 0.04 && longPct >= 60 && !onCooldown('sentiment_bear', CD.sentiment)) {
      await tg(token, chatId,
        `🚨 <b>Sentiment Extremes - ALL 3 BEARISH</b>\n\n` +
        `😱 F&amp;G: <b>${fng}</b> (${fngCls})\n` +
        `💸 BTC FR: <b>+${frPct.toFixed(4)}%</b> - Longs overcrowded\n` +
        `📊 L/S Ratio: <b>${longPct.toFixed(1)}% Long</b> / ${shortPct.toFixed(1)}% Short\n\n` +
        `Signal: All 3 sentiment gauges at extremes - <b>long flush risk elevated</b>\n` +
        `Action: Tighten stops on longs. Do NOT add longs into this setup.` +
        `\n\n<i>${stamp}</i>`
      );
      markSent('sentiment_bear');
      fired.push(`Sentiment extremes - bearish (F&G ${fng}, FR +${frPct.toFixed(4)}%, Long ${longPct.toFixed(0)}%)`);
    }

    // ── BULLISH EXTREME (contrarian): F&G fearful + FR short-heavy + L/S short-heavy ──
    // All 3 screaming "shorts are overcrowded" → squeeze / reversal risk
    if (fng <= 25 && frPct <= -0.02 && longPct <= 40 && !onCooldown('sentiment_bull', CD.sentiment)) {
      await tg(token, chatId,
        `🟢 <b>Sentiment Extremes - Contrarian BULLISH Setup</b>\n\n` +
        `😨 F&amp;G: <b>${fng}</b> (${fngCls})\n` +
        `💸 BTC FR: <b>${frPct.toFixed(4)}%</b> - Shorts paying\n` +
        `📊 L/S Ratio: <b>${longPct.toFixed(1)}% Long</b> / ${shortPct.toFixed(1)}% Short\n\n` +
        `Signal: All 3 sentiment gauges at fear extremes - <b>potential contrarian reversal zone</b>\n` +
        `Action: Watch for capitulation candle + volume spike before entering long.` +
        `\n\n<i>${stamp}</i>`
      );
      markSent('sentiment_bull');
      fired.push(`Sentiment extremes - contrarian bullish (F&G ${fng}, FR ${frPct.toFixed(4)}%, Long ${longPct.toFixed(0)}%)`);
    }
  } catch { /* skip */ }
  return fired;
}

/* ════════════════════════════════════════
   12. SQUEEZE / FLUSH THRESHOLD ALERTS
   Fires when funding rate + L/S ratio both scream overcrowding (score ≥ 70)
   ════════════════════════════════════════ */

async function fetchAllLSR(): Promise<Record<string, number | null>> {
  const result: Record<string, number | null> = {};
  COINS.forEach(c => (result[c] = null));
  await Promise.all([
    // Binance perp L/S ratio
    ...Object.entries(BINANCE_PERP).map(async ([coin, sym]) => {
      try {
        const res = await fetch(
          `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=5m&limit=1`,
          { cache: 'no-store', signal: AbortSignal.timeout(7_000) }
        );
        if (!res.ok) return;
        const d = await res.json() as Array<{ longAccount: string }>;
        if (d?.[0]) result[coin] = parseFloat(d[0].longAccount);
      } catch { /* skip */ }
    }),
    // Bybit-only coins L/S ratio
    ...Object.entries(BYBIT_KLINE_SYMS).map(async ([coin, sym]) => {
      if (result[coin] != null) return;
      try {
        const res = await fetch(
          `https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=${sym}&period=5min&limit=1`,
          { cache: 'no-store', signal: AbortSignal.timeout(7_000) }
        );
        if (!res.ok) return;
        const d = await res.json() as { result?: { list?: Array<{ buyRatio: string }> } };
        const item = d.result?.list?.[0];
        if (item) result[coin] = parseFloat(item.buyRatio);
      } catch { /* skip */ }
    }),
  ]);
  return result;
}

function calcSqueezeScore(fr: number | null, longRatio: number | null): { score: number; dir: 'LONG_LIQ' | 'SHORT_SQ' | 'NEUTRAL' } {
  let longRisk = 0, shortRisk = 0;
  if (fr != null) {
    const p = fr * 100;
    if (p >= 0.05) longRisk += 40;
    else if (p >= 0.02) longRisk += 22;
    else if (p >= 0.01) longRisk += 10;
    else if (p <= -0.03) shortRisk += 40;
    else if (p <= -0.015) shortRisk += 22;
    else if (p <= -0.005) shortRisk += 10;
  }
  if (longRatio != null) {
    const shortRatio = 1 - longRatio;
    if (longRatio >= 0.65) longRisk += 40;
    else if (longRatio >= 0.58) longRisk += 22;
    else if (longRatio >= 0.52) longRisk += 10;
    else if (shortRatio >= 0.65) shortRisk += 40;
    else if (shortRatio >= 0.58) shortRisk += 22;
    else if (shortRatio >= 0.52) shortRisk += 10;
  }
  const dominant = Math.max(longRisk, shortRisk);
  const score = Math.min(100, dominant);
  if (longRisk > shortRisk && longRisk > 10) return { score, dir: 'LONG_LIQ' };
  if (shortRisk > longRisk && shortRisk > 10) return { score, dir: 'SHORT_SQ' };
  return { score: 0, dir: 'NEUTRAL' };
}

async function checkSqueezeAlerts(
  stamp: string,
  frMap: Record<string, number | null>,
  lsMap: Record<string, number | null>,
  prices: Record<string, number>,
  queue: SignalEntry[],
  recipients: Recipient[],
  thresholdsByUser: Map<string, UserThresholds>,
): Promise<string[]> {
  const fired: string[] = [];
  // Loosest (most sensitive) squeeze threshold across current recipients -
  // mirrors checkRSI's approach; exact per-recipient delivery is decided
  // later in flushSignals via passesThreshold.
  const thValues = recipients.map(r => (thresholdsByUser.get(r.userId) ?? DEFAULT_THRESHOLDS).squeezeThreshold);
  const loosestTh = thValues.length ? Math.min(...thValues) : DEFAULT_THRESHOLDS.squeezeThreshold;

  for (const coin of COINS) {
    const fr       = frMap[coin];
    const longRat  = lsMap[coin];
    const price    = prices[coin];
    const { score, dir } = calcSqueezeScore(fr, longRat);
    if (score < loosestTh || dir === 'NEUTRAL') continue;

    const key = `squeeze_${dir}_${coin}`;
    if (onCooldown(key, CD.squeeze)) continue;

    const label    = LABELS[coin];
    const frPct    = fr != null ? (fr >= 0 ? '+' : '') + (fr * 100).toFixed(4) + '%' : '-';
    const longPct  = longRat != null ? (longRat * 100).toFixed(1) + '%' : '-';
    const shortPct = longRat != null ? ((1 - longRat) * 100).toFixed(1) + '%' : '-';
    const canonicalHit = score >= DEFAULT_THRESHOLDS.squeezeThreshold;

    if (dir === 'SHORT_SQ') {
      // Shorts overcrowded - expect pump to flush them
      queue.push({
        coin, dir: 'long', ruleKey: 'squeeze', name: `${label} short squeeze building (${score}/100)`, price,
        title: `Short Squeeze Building - Score ${score}/100`,
        body:
          `⚡ <b>SHORT SQUEEZE BUILDING - ${label}/USDT</b>\n` +
          `Score: <b>${score}/100</b>\n\n` +
          `Funding: <b>${frPct}</b> (shorts paying heavily)\n` +
          `L/S Ratio: <b>${longPct} long / ${shortPct} short</b>\n\n` +
          `Shorts overcrowded - price likely pumps to flush them.\n` +
          `Watch for break above key resistance with volume spike.\n\n` +
          `<i>${stamp}</i>`,
        metricValue: score, thresholdKind: 'squeeze', canonicalHit,
      });
      markSent(key);
      fired.push(`${label} short squeeze building (${score}/100)`);
    } else {
      // Longs overcrowded - expect dump to flush them
      queue.push({
        coin, dir: 'short', ruleKey: 'squeeze', name: `${label} long flush building (${score}/100)`, price,
        title: `Long Flush Building - Score ${score}/100`,
        body:
          `🔥 <b>LONG FLUSH BUILDING - ${label}/USDT</b>\n` +
          `Score: <b>${score}/100</b>\n\n` +
          `Funding: <b>${frPct}</b> (longs paying heavily)\n` +
          `L/S Ratio: <b>${longPct} long / ${shortPct} short</b>\n\n` +
          `Longs overcrowded - price likely dumps to flush them.\n` +
          `Watch for break below key support with volume spike.\n\n` +
          `<i>${stamp}</i>`,
        metricValue: score, thresholdKind: 'squeeze', canonicalHit,
      });
      markSent(key);
      fired.push(`${label} long flush building (${score}/100)`);
    }
  }
  return fired;
}

/* ════════════════════════════════════════
   12b. DISTRIBUTION - BIG PLAYERS TAKING PROFIT
   Server-side twin of the Dashboard's Distribution Tracker. Scoring lives in
   lib/distribution.ts (shared with the client) - this function only derives
   the inputs from Binance futures data: 1h klines carry taker-buy volume
   (field 9) for the sell-flow + CVD proxy, openInterestHist gives the OI
   trend, topLongShortPositionRatio gives whale positioning, funding from
   frMap. Fires at score ≥ 70 with a 4h per-coin cooldown. Muted coins are
   skipped before fetching.
   ════════════════════════════════════════ */

async function checkDistribution(
  stamp: string,
  frMap: Record<string, number | null>,
  queue: SignalEntry[],
  fullyMutedCoins: Set<string>,
): Promise<string[]> {
  const fired: string[] = [];

  const tasks = COINS
    .filter(coin => !fullyMutedCoins.has(coin) && BINANCE_PERP[coin])
    .map(coin => async () => {
      try {
        const sym = BINANCE_PERP[coin];
        const [kRes, oiRes, topRes] = await Promise.allSettled([
          fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1h&limit=26`,
            { cache: 'no-store', signal: AbortSignal.timeout(8_000) }),
          fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${sym}&period=1h&limit=25`,
            { cache: 'no-store', signal: AbortSignal.timeout(8_000) }),
          fetch(`https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${sym}&period=1h&limit=1`,
            { cache: 'no-store', signal: AbortSignal.timeout(8_000) }),
        ]);
        if (kRes.status !== 'fulfilled' || !kRes.value.ok) return;
        const kl = await kRes.value.json() as Array<unknown[]>;
        if (kl.length < 26) return;

        const closes = kl.map(k => parseFloat(k[4] as string));
        const vols   = kl.map(k => parseFloat(k[5] as string));
        const tbVols = kl.map(k => parseFloat(k[9] as string)); // taker buy base volume
        const price  = closes[closes.length - 1];
        const base24 = closes[closes.length - 25];
        if (!(base24 > 0)) return;
        const change24hPct = (price - base24) / base24 * 100;

        // Taker ratio over the last ~5h
        const v5  = vols.slice(-5).reduce((a, b) => a + b, 0);
        const tb5 = tbVols.slice(-5).reduce((a, b) => a + b, 0);
        const takerBuyRatio = v5 > 0 ? tb5 / v5 : null;

        // CVD proxy over the last 12h: delta = taker buys − taker sells.
        // Bearish divergence = price up over the window while net delta is selling.
        const v12  = vols.slice(-12).reduce((a, b) => a + b, 0);
        const tb12 = tbVols.slice(-12).reduce((a, b) => a + b, 0);
        const base12 = closes[closes.length - 13];
        const px12Pct = base12 > 0 ? (price - base12) / base12 * 100 : 0;
        const cvdDivergence: 'bearish' | null = (px12Pct >= 1 && (2 * tb12 - v12) < 0) ? 'bearish' : null;

        // OI trend vs price - same semantics as the client store's oiTrend
        let oiTrend: DistributionInputs['oiTrend'] = null;
        if (oiRes.status === 'fulfilled' && oiRes.value.ok) {
          const oi = await oiRes.value.json() as Array<{ sumOpenInterest: string }>;
          if (oi.length >= 20) {
            const oiStart = parseFloat(oi[0].sumOpenInterest);
            const oiEnd   = parseFloat(oi[oi.length - 1].sumOpenInterest);
            if (oiStart > 0) {
              const oiChg = (oiEnd - oiStart) / oiStart * 100;
              const pxUp = change24hPct >= 0.5, pxDn = change24hPct <= -0.5;
              oiTrend = oiChg >= 2  ? (pxUp ? 'strong_up' : pxDn ? 'strong_down' : null)
                      : oiChg <= -2 ? (pxUp ? 'weak_up'   : pxDn ? 'weak_down'   : null)
                      : null;
            }
          }
        }

        // Top-trader dollar-weighted long share
        let whaleLongRatio: number | null = null;
        if (topRes.status === 'fulfilled' && topRes.value.ok) {
          const top = await topRes.value.json() as Array<{ longAccount: string }>;
          const v = parseFloat(top[0]?.longAccount ?? '');
          if (isFinite(v)) whaleLongRatio = v;
        }

        const avg20 = vols.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
        const fr = frMap[coin];

        const res = computeDistributionScore({
          change24hPct,
          cvdDivergence,
          takerBuyRatio,
          oiTrend,
          whaleLongRatio,
          fundingRatePct: fr != null ? fr * 100 : null,
          volRatio: avg20 > 0 ? vols[vols.length - 1] / avg20 : null,
          priceBelowVwap: null, // not derived server-side
        });
        if (!res || res.score < 70) return;

        const key = `distribution_${coin}`;
        if (onCooldown(key, CD.distribution)) return;

        const label = LABELS[coin];

        queue.push({
          coin, dir: 'short', ruleKey: 'distribution', name: `${label} distribution (${res.score}/100)`, price,
          title: `Distribution Detected - Score ${res.score}/100`,
          body:
            `💰 <b>DISTRIBUTION DETECTED - ${label}/USDT</b>\n` +
            `Score: <b>${res.score}/100</b>\n\n` +
            `Price still up <b>+${change24hPct.toFixed(1)}%</b> in 24h, but big players look to be taking profits into strength:\n` +
            res.reasons.map(r => `• ${r}`).join('\n') + '\n\n' +
            `Caution on new longs - watch for lower highs and loss of VWAP.` +
            `\n\n<i>${stamp}</i>`,
        });
        markSent(key);
        fired.push(`${label} distribution detected (${res.score}/100)`);
      } catch { /* skip */ }
    });

  await runBatched(tasks, 5);
  return fired;
}

/* ════════════════════════════════════════
   13. EMA BUY/SELL SIGNAL
   Real chart-parity signal - calls the exact same detectEMASignals() the
   Arena chart uses (lib/strategyCore.ts), same DEFAULT_FILTER_PARAMS, so a
   fired alert is bit-for-bit the same BUY/SELL marker the chart would draw
   right now. Replaces the old checkEMASetup (a soft "value zone, wait for
   it" state check) and checkEMACross (an unrelated simple 200EMA cross) -
   neither matched the chart's actual rule (see pendings/ALERTS.md).
   Every timeframe the chart itself offers is checked here; which ones a
   user actually receives is entirely their own choice on /alerts (capped at
   ALERT_TF_CAP there) - fullyMutedTfs (nobody has this TF on at all) skips
   the fetch/compute entirely, same cost-control shape as fullyMutedCoins.
   ════════════════════════════════════════ */

// EMA_SIGNAL_TFS, EMASignalTF and fetchRibbonCandles now live in
// lib/ribbonCandles.ts so /api/alerts/preview evaluates the same bars this
// cron does - see the note there.

async function checkEMASignal(
  stamp: string,
  queue: SignalEntry[],
  fullyMutedTfs: Set<EMASignalTF>,
  tf: EMASignalTF,
): Promise<string[]> {
  const fired: string[] = [];
  if (fullyMutedTfs.has(tf)) return fired;
  const ruleKey = `ema_signal_${tf}`;
  const tfLabel = tf.toUpperCase();

  // Two variants per coin - Default and Anti-Chop (STRICT_FILTER_PARAMS) -
  // computed from the same fetched candles. Each recipient only ever
  // receives the variant matching their own Arena chart's Anti-Chop Filter
  // setting (see passesThreshold's antiChopMode check), so a fired alert is
  // always the same BUY/SELL marker that recipient's own chart would draw.
  const MODES: Array<{ antiChopMode: boolean; params: typeof DEFAULT_FILTER_PARAMS; dedupSuffix: string }> = [
    { antiChopMode: false, params: DEFAULT_FILTER_PARAMS, dedupSuffix: 'default' },
    { antiChopMode: true,  params: STRICT_FILTER_PARAMS,  dedupSuffix: 'strict' },
  ];

  await Promise.all(COINS.map(async coin => {
    try {
      const candles = await fetchRibbonCandles(coin, tf);
      if (candles.length < 55) return; // same minimum runway the chart's own hook requires

      for (const mode of MODES) {
        const { signalLongs, signalShorts } = detectEMASignals(candles, tf, mode.params);
        const all = [...signalLongs, ...signalShorts];
        if (all.length === 0) continue;
        const latest = all.sort((a, b) => b.timestamp - a.timestamp)[0];
        if (latest.pending) continue; // still on the live edge - not a confirmed call yet

        // Identity-based dedup (not a time cooldown) - re-fires only when
        // alternation produces a genuinely NEW signal, never on every tick
        // while the same one is still current. Each filter mode dedups
        // independently since they can hold different "current" signals.
        const dedupKey = `${coin}_${tf}_${mode.dedupSuffix}`;
        if (emaSignalLastTs.get(dedupKey) === latest.timestamp) continue;
        emaSignalLastTs.set(dedupKey, latest.timestamp);

        const label   = LABELS[coin];
        const fmtP    = (n: number) => n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toFixed(4);
        const dirWord = latest.dir === 'long' ? 'BUY' : 'SELL';

        queue.push({
          coin, dir: latest.dir, ruleKey, name: `${label} ${dirWord} signal (${tfLabel})`, price: latest.entryPrice,
          title: `${dirWord} Signal (${tfLabel})`,
          antiChopMode: mode.antiChopMode,
          // Both mode variants share this ruleKey with no other field to tell
          // them apart - without this, Anti-Chop's variant would double up
          // alongside Default's in the shared Alert Track Record every time
          // both fire. Default is the canonical EMA definition (see
          // DEFAULT_FILTER_PARAMS in strategyCore.ts), same precedent as
          // rsi/squeeze's canonicalHit excluding personal-threshold-only hits.
          canonicalHit: !mode.antiChopMode,
          body:
            `${latest.dir === 'long' ? '🟢' : '🔴'} <b>${label}/USDT ${dirWord} (${tfLabel})</b>\n\n` +
            `Entry: <b>$${fmtP(latest.entryPrice)}</b>\n` +
            `SL: $${fmtP(latest.sl)} · TP: $${fmtP(latest.tp)} (2:1)` +
            `\n\n<i>${stamp}</i>`,
        });
        fired.push(`${label} ${dirWord} signal (${tfLabel})`);
      }
    } catch { /* skip */ }
  }));

  return fired;
}

/* ════════════════════════════════════════
   WEB PUSH DISPATCH
   ════════════════════════════════════════ */
async function dispatchPush(queue: SignalEntry[], mutedByUser: Map<string, Set<string>>, thresholdsByUser: Map<string, UserThresholds>, proUserIds: Set<string>): Promise<void> {
  // Same send-only kill switch as tg() - shares the 'telegram' flag rather
  // than a separate one, since /ops/config's "Telegram + Push alerts" switch
  // is meant to silence both outbound channels together.
  if (!(await isFeatureEnabled('telegram'))) return;

  const pubKey  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privKey = process.env.VAPID_PRIVATE_KEY;
  const email   = process.env.VAPID_EMAIL;
  if (!pubKey || !privKey || !email) return;

  const admin = getSupabaseAdmin();
  const { data: allSubs } = await admin.from(T.push_subscriptions).select('*');
  if (!allSubs?.length) return;

  // Signal alerts are a Pro feature. Telegram delivery already filters on
  // proUserIds (see checkPriceAlerts / flushSignals recipients), but this
  // push path used to fan out to EVERY stored subscription - so a free user
  // who enabled browser notifications received the full Pro alert stream.
  const subs = (allSubs as Array<{ endpoint: string; p256dh: string; auth: string; user_id: string }>)
    .filter(s => proUserIds.has(s.user_id));
  if (!subs.length) return;

  webpush.setVapidDetails(email, pubKey, privKey);

  // Group by coin - same logic as flushSignals
  const byCoin = new Map<string, SignalEntry[]>();
  for (const e of queue) {
    const arr = byCoin.get(e.coin) ?? [];
    arr.push(e);
    byCoin.set(e.coin, arr);
  }

  const expired: string[] = [];
  let pushSent = 0;
  let pushFailed = 0;

  for (const [coin, entries] of byCoin) {
    const label = LABELS[coin] ?? coin.toUpperCase();

    await Promise.allSettled(
      subs.map(async sub => {
        const eligible = entries.filter(e =>
          isEligibleFor(mutedByUser, sub.user_id, e) && passesThreshold(e, thresholdsByUser.get(sub.user_id)));
        if (eligible.length === 0) return;
        const body = eligible.length === 1
          ? `${label}: ${eligible[0].title}`
          : `${label}: ${eligible.length} signals aligned`;
        const payload = JSON.stringify({ title: 'LiquidityHQ', body, tag: `lhq-${coin}`, url: '/' });
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          );
          pushSent++;
        } catch (err: unknown) {
          if ((err as { statusCode?: number }).statusCode === 410) expired.push(sub.endpoint);
          else pushFailed++;
        }
      })
    );
  }

  // Reported here rather than from a tally in the main handler, because this
  // function is void-ed at the call site and finishes after the response has
  // gone out - the handler has already returned by the time these results
  // exist. Render runs a normal long-lived Node process, so the floating
  // promise does complete; this would need rethinking only on a runtime that
  // freezes the container at response time.
  //
  // A 410 is NOT a failure of the push service: it means that particular
  // subscription is gone (browser uninstalled, permission revoked), which is
  // why they are pruned below rather than retried. Counting them as delivery
  // failures would show Web Push as broken every time a user cleared their
  // browser data.
  if (pushSent + pushFailed > 0) {
    reportHealth('webpush:vapid', 'delivery', pushFailed === 0,
      pushFailed === 0
        ? `${pushSent} sent${expired.length ? `, ${expired.length} expired` : ''}`
        : `${pushFailed} of ${pushSent + pushFailed} failed`,
      pushSent);
  }

  if (expired.length > 0) {
    await admin.from(T.push_subscriptions).delete().in('endpoint', expired);
  }
}

/* ════════════════════════════════════════
   MAIN HANDLER
   ════════════════════════════════════════ */
/* Muted alert groups - set on /alerts page, stored in Supabase, one row per
   (user_id, key) since 2026-07-17 (previously a single global table - any
   user's mute silenced everyone's Telegram feed, see
   supabase/migrations/20260717_muted_alerts_per_user.sql). Fail-open: if
   Supabase is unreachable, nothing is muted for anyone. */
async function fetchMutedKeysByUser(): Promise<Map<string, Set<string>>> {
  const fallback = new Map<string, Set<string>>();
  const query = (async () => {
    try {
      const db = getSupabaseAdmin();
      const { data, error } = await db.from(T.muted_alerts).select('user_id, key');
      if (error || !data) return fallback;
      const map = new Map<string, Set<string>>();
      for (const row of data) {
        const uid = String(row.user_id);
        if (!map.has(uid)) map.set(uid, new Set());
        map.get(uid)!.add(String(row.key));
      }
      return map;
    } catch { return fallback; }
  })();
  // 5s cap - if Supabase is slow, fail-open (no keys muted)
  const cap = new Promise<Map<string, Set<string>>>(res => setTimeout(() => res(fallback), 5_000));
  return Promise.race([query, cap]);
}

/* ════════════════════════════════════════
   MARKET STRUCTURE (price action) - lib/priceAction.ts
   A second, price-only read that runs alongside the EMA ribbon alerts and
   never feeds into them. Its own rule_key, its own dedup, its own wording,
   so a recipient can always tell which system fired - and can mute one
   without losing the other.

   Only 1h and 4h. Structure on a 1m chart is noise, and the EMA rule already
   covers every timeframe the chart offers; the point of this alert is the
   swing levels a swing trader would actually mark. STRUCTURE_TFS now lives in
   lib/structurePrefs.ts so /alerts renders exactly the timeframes this cron
   computes, instead of the two lists being kept in sync by a comment.
   ════════════════════════════════════════ */

// A structure break is only worth a notification while it is still news. On a
// fresh process the dedup map is empty, so without this the first run would
// happily announce whatever break happened to be latest - possibly days old.
const STRUCTURE_MAX_AGE_BARS = 3;

const structureLastTs = new Map<string, number>();

// Still deliberately does NOT take fullyMutedTfs. That set means "no user has
// this EMA timeframe switched on", and reusing it here would couple two
// unrelated systems: muting the EMA 1h alert would silently also kill 1h
// structure alerts. unusedTfs is the structure-specific equivalent, computed
// from the structure keys alone - see where it is built in the main handler.
async function checkStructureSignal(
  stamp: string,
  queue: SignalEntry[],
  tf: StructureTF,
  unusedTfs: Set<string>,
): Promise<string[]> {
  const fired: string[] = [];
  // Opt-in at the system level, defaulting OFF (lib/featureFlags.ts). The
  // per-recipient opt-in below is the other half: this flag decides whether the
  // feature runs at all, structure_on_<tf> rows decide who hears about it.
  // Both default to silence, which is the point - the original bug was a
  // default that only applied to users who opened the /alerts page, while the
  // cron ran regardless and delivered to every connected chat.
  if (!(await isFeatureEnabled('structure_alerts'))) return fired;
  // Nobody has this timeframe switched on, so every candle fetch below would be
  // discarded at the delivery filter. Cheapest possible skip, same shape as
  // fullyMutedTfs for the EMA rule.
  if (unusedTfs.has(tf)) return fired;
  const ruleKey = `structure_${tf}`;
  const tfLabel = tf.toUpperCase();

  await Promise.all(COINS.map(async coin => {
    try {
      const candles = await fetchRibbonCandles(coin, tf);
      if (candles.length < 30) return;

      const signals = detectStructureSignals(
        candles.map(c => ({
          timestamp: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
        })),
      );
      if (!signals.length) return;
      const latest = signals[signals.length - 1];

      // Must be on one of the last few bars - see STRUCTURE_MAX_AGE_BARS.
      const lastBarTs = candles[candles.length - 1].time;
      const barMs = candles.length > 1
        ? candles[candles.length - 1].time - candles[candles.length - 2].time
        : 0;
      if (barMs > 0 && lastBarTs - latest.timestamp > barMs * STRUCTURE_MAX_AGE_BARS) return;

      // Identity dedup on the breaking candle, same shape as the EMA rule:
      // re-fires only on a genuinely new break, never every tick while the
      // same one is still the latest.
      const dedupKey = `${coin}_${tf}`;
      if (structureLastTs.get(dedupKey) === latest.timestamp) return;
      structureLastTs.set(dedupKey, latest.timestamp);

      const label = LABELS[coin];
      const fmtP  = (n: number) => n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toFixed(4);
      const isBull = latest.dir === 'bull';
      const kindWord = latest.kind === 'CHOCH' ? 'Change of Character' : 'Break of Structure';
      const shortKind = latest.kind === 'CHOCH' ? 'CHoCH' : 'BOS';

      queue.push({
        coin,
        dir: isBull ? 'long' : 'short',
        ruleKey,
        name: `${label} ${shortKind} ${isBull ? 'up' : 'down'} (${tfLabel})`,
        price: latest.price,
        title: `${shortKind} ${isBull ? '▲' : '▼'} (${tfLabel})`,
        // Not counted in the shared Alert Track Record. That record measures
        // the EMA rule's hit rate, and mixing a different system's signals
        // into it would make both numbers meaningless.
        canonicalHit: false,
        body:
          `${isBull ? '🔵' : '🟣'} <b>${label}/USDT ${shortKind} ${isBull ? 'UP' : 'DOWN'} (${tfLabel})</b>\n\n` +
          `${kindWord} - price closed ${isBull ? 'above' : 'below'} the prior swing ` +
          `${isBull ? 'high' : 'low'} at <b>$${fmtP(latest.level)}</b>\n` +
          `Close: <b>$${fmtP(latest.price)}</b>\n` +
          (latest.volumeRatio != null
            ? `Volume: ${latest.volumeRatio.toFixed(1)}x average${latest.volumeBacked ? ' ⚡' : ' (light)'}\n`
            : '') +
          `\n<i>Price-action signal - separate from the EMA buy/sell rule.</i>`,
      });
      fired.push(`${ruleKey}:${coin}`);
    } catch { /* one coin failing must not take down the rest of the run */ }
  }));

  return fired;
}

let structureDedupHydrated = false;

async function hydrateStructureDedup(): Promise<void> {
  if (structureDedupHydrated) return;
  structureDedupHydrated = true;
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin.from(T.app_config).select('value').eq('key', 'structure_signal_dedup').maybeSingle();
    const saved = data?.value as Record<string, number> | undefined;
    if (saved) for (const [k, v] of Object.entries(saved)) structureLastTs.set(k, v);
  } catch { /* fail open - worst case this run behaves like a fresh process */ }
}

async function persistStructureDedup(): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    await admin.from(T.app_config).upsert(
      { key: 'structure_signal_dedup', value: Object.fromEntries(structureLastTs) },
      { onConflict: 'key' },
    );
  } catch { /* best-effort - a missed persist just re-derives next run */ }
}

/* ── EMA signal dedup persistence (app_config) ──────────────────────────────
   emaSignalLastTs is a plain in-memory Map - wiped on every deploy/restart.
   Render restarted this service 8 times in one afternoon (2026-07-27) and
   each restart made the next cron tick resend EVERY currently-active EMA
   signal to Telegram, including ones armed days earlier, because the empty
   Map treated them all as brand new (confirmed: XRP's 30M SELL, armed
   2026-07-21, got re-sent at 11:30, 14:20, 16:35 and 19:00 on 07-27, each
   time 1-3 minutes after a deploy's finishedAt). alertOutcomes.ts already
   had to work around this same failure mode for the outcome-tracking table
   (see its OUTCOME_DEDUP_MS comment) - this applies the same DB-backed fix
   to the actual Telegram send gate. Hydrated once per process lifetime,
   persisted back after every run, so a fresh process picks up exactly where
   the last one left off instead of starting from empty. */
let dedupHydrated = false;

async function hydrateEMASignalDedup(): Promise<void> {
  if (dedupHydrated) return;
  dedupHydrated = true; // set first - a failed read must never retry every tick
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin.from(T.app_config).select('value').eq('key', 'ema_signal_dedup').maybeSingle();
    const saved = data?.value as Record<string, number> | undefined;
    if (saved) for (const [k, v] of Object.entries(saved)) emaSignalLastTs.set(k, v);
  } catch { /* fail open - worst case this run behaves like a fresh process */ }
}

async function persistEMASignalDedup(): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    const value = Object.fromEntries(emaSignalLastTs);
    await admin.from(T.app_config).upsert({ key: 'ema_signal_dedup', value }, { onConflict: 'key' });
  } catch { /* best-effort - a missed persist just re-derives correctly next run */ }
}

export async function GET(req: NextRequest) {
  // Fail-closed: spams every connected Telegram chat and force-deactivates
  // price alerts if left reachable by anyone who finds the URL. See
  // lib/cronAuth.ts for why this denies by default instead of only checking
  // when CRON_SECRET happens to be set.
  if (!checkCronAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token)
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 503 });

  // Safety net - never exceed Render's 30s limit
  let timerId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<NextResponse>(res => {
    timerId = setTimeout(() => res(NextResponse.json({ ok: true, fired: [], note: 'timeout - some checks skipped' })), 28_000);
  });
  const result = await Promise.race([runAlerts(token), timeout]);
  clearTimeout(timerId!);
  return result;
}

async function runAlerts(token: string): Promise<NextResponse> {

  // Telegram alerts are a Pro-only feature (matches the /alerts page gate and
  // the /upgrade pricing card) - resolve which connected users are actually
  // entitled before collecting recipients, so a free user's chat_id (however it
  // got saved - the UI disables the connect form, but that's not a security
  // boundary) never receives a broadcast. "Entitled" here must match
  // lib/entitlements.ts's definition (paid Pro OR active trial) - this used to
  // check role === 'pro' only, so a brand-new signup could connect Telegram
  // and configure conditions in the UI (both correctly gated on `entitled`,
  // which includes trial) and then silently never receive a single alert for
  // the entire 14-day trial, since this cron excluded them.
  const proUserIds = new Set<string>();
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin.from(T.user_subscriptions).select('user_id, role, trial_ends_at');
    const now = Date.now();
    for (const row of data ?? []) {
      const isPro   = row.role === 'pro';
      const isTrial = row.role !== 'pro' && !!row.trial_ends_at && new Date(row.trial_ends_at as string).getTime() > now;
      if (isPro || isTrial) proUserIds.add(row.user_id as string);
    }
  } catch { /* admin key not configured - allChatIds falls back to the env var below */ }

  // Collect Pro users who have connected their Telegram
  const allChatIds: string[] = [];
  const recipients: Recipient[] = [];
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from(T.user_settings)
      .select('user_id, telegram_chat_id, timezone')
      .not('telegram_chat_id', 'is', null)
      .neq('telegram_chat_id', '');
    // Rebuilt every run - see the note on CHAT_TZ above.
    CHAT_TZ.clear();
    for (const row of data ?? []) {
      const userId = row.user_id as string;
      if (!proUserIds.has(userId)) continue;
      const id = (row.telegram_chat_id as string)?.trim();
      if (id && !allChatIds.includes(id)) {
        allChatIds.push(id);
        CHAT_TZ.set(id, (row.timezone as string | null) || null);
        recipients.push({ userId, chatId: id });
      }
    }
  } catch { /* admin key not configured - fall through to env var */ }

  // Env var fallback (legacy / single-user installs) - not a per-user row,
  // predates the Pro gate, always allowed. Has no user_id, so it can't be
  // muted per-rule - only ever reachable via the broadcast-fallback paths
  // (checkPriceAlerts' legacy branch), not the per-recipient ones below.
  const envChatId = process.env.TELEGRAM_CHAT_ID;
  if (envChatId && !allChatIds.includes(envChatId)) allChatIds.push(envChatId);

  if (allChatIds.length === 0)
    return NextResponse.json({ error: 'No Telegram recipients configured' }, { status: 503 });

  // Session-based cooldowns - tighter during pre-NY + NY (8pm–4am PHT)
  const nyActive = isHighActivity();
  CD.whale = nyActive ? 5 * 60_000  : 30 * 60_000;
  CD.news  = nyActive ? 5 * 60_000  : 15 * 60_000;

  // TIME_TOKEN, not a rendered time: tg() replaces it per recipient with that
  // subscriber's own local clock (falling back to UTC when we don't know their
  // timezone). Was a single Manila time for everyone, then a single UTC time -
  // correct but still nobody's actual wall clock. The session name beside it is
  // already timezone-independent.
  const stamp = `⏰ ${TIME_TOKEN} · ${getSession()}`;

  // Before any send in this run. The tally is module state, so a warm process
  // would otherwise carry the previous run's counts into this one's health
  // record - reporting a stale failure long after it was resolved.
  resetSendTally();

  // Restore EMA signal dedup state from its last persisted snapshot before any
  // checkEMASignal call runs - no-op after the first call in this process's
  // lifetime (see hydrateEMASignalDedup).
  await hydrateEMASignalDedup();
  // Same restart problem, same DB-backed fix - a fresh process must not treat
  // an existing structure break as brand new and re-announce it.
  await hydrateStructureDedup();

  // Fetch shared data once (+ per-user muted alert groups + threshold settings)
  const [frMap, prices, lsMap, mutedByUser, thresholdsByUser] = await Promise.all([
    fetchAllFR(), fetchSpotPrices(), fetchAllLSR(), fetchMutedKeysByUser(), fetchThresholdsByUser(),
  ]);

  // Coins muted by every single recipient - the only case it's safe to skip
  // fetching entirely (checkDistribution's cost-control pre-filter).
  // Anything less than 100% agreement still has to be fetched; per-recipient
  // eligibility is decided later, at flush/push time.
  const fullyMutedCoins = new Set(
    COINS.filter(coin => recipients.every(r => mutedByUser.get(r.userId)?.has(`coin:${coin}`))),
  );

  // Same shape, per-timeframe: a TF nobody has selected at all (see
  // ALERT_TF_CAP on /alerts) is skipped before fetching for every coin.
  const fullyMutedTfs = new Set(
    EMA_SIGNAL_TFS.filter(tf => recipients.every(r => mutedByUser.get(r.userId)?.has(`ema_signal_${tf}`))),
  );

  // Structure's equivalent, and a stronger check than the two above rather than
  // a copy of them. Those scan `recipients` (Telegram only), so a Web Push
  // subscriber who is not also a Telegram recipient does not keep a timeframe
  // alive. Structure keys are opt-IN, so the question has an exact answer with
  // no recipient list at all: if NOT ONE user row anywhere holds
  // structure_on_<tf>, then nobody on any channel can receive that timeframe
  // and the per-coin candle fetch is pure waste. mutedByUser covers every user
  // with any preference row, not just this run's recipients.
  const unusedStructureTfs = new Set<string>(
    STRUCTURE_TFS.filter(tf => ![...mutedByUser.values()].some(keys => isStructureEnabled(keys, tf))),
  );

  // Per-request signal queue - all coin checks push here, flushed after.
  // Every check now runs unconditionally (compute is shared/unavoidable
  // regardless of who's muted what) - the old top-level skip() gate used to
  // disable a whole rule for every recipient at once, which is exactly the
  // global-mute bug being fixed here. Muting now only affects who receives
  // the result, decided per-recipient in flushSignals/dispatchPush/below.
  const signalQueue: SignalEntry[] = [];

  const results = await Promise.allSettled([
    checkRSI(stamp, signalQueue, recipients, thresholdsByUser),
    checkRapidMove(stamp, signalQueue),
    checkWhales(stamp, signalQueue),
    checkNews(token, recipients, mutedByUser, stamp),                     // global - sends directly
    checkFearGreed(token, recipients, mutedByUser, stamp),                // global - sends directly
    checkDailySummary(token, recipients, mutedByUser, stamp, frMap),      // global - sends directly
    checkOISpike(stamp, prices, signalQueue),
    checkCVD(stamp, signalQueue),
    checkPriceAlerts(token, stamp, prices, allChatIds, proUserIds),       // already per-user (own table)
    checkSentimentExtremes(token, recipients, mutedByUser, stamp, frMap), // global - sends directly
    checkSqueezeAlerts(stamp, frMap, lsMap, prices, signalQueue, recipients, thresholdsByUser),
    checkDistribution(stamp, frMap, signalQueue, fullyMutedCoins),
    ...EMA_SIGNAL_TFS.map(tf => checkEMASignal(stamp, signalQueue, fullyMutedTfs, tf)),
    ...STRUCTURE_TFS.map(tf => checkStructureSignal(stamp, signalQueue, tf, unusedStructureTfs)),
  ]);

  // Persist dedup state so the NEXT process (post-restart or post-deploy)
  // hydrates from here instead of starting empty - see hydrateEMASignalDedup.
  await persistEMASignalDedup();
  await persistStructureDedup();

  // Flush: single signals → send as-is, 2+ same coin → confluence alert.
  // Per-recipient coin:/dir:/ruleKey eligibility is decided inside.
  await flushSignals(token, recipients, mutedByUser, thresholdsByUser, stamp, signalQueue);

  // Web Push - fire-and-forget, never let it block or throw
  void dispatchPush(signalQueue, mutedByUser, thresholdsByUser, proUserIds).catch(() => {});

  const fired = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  if (fired.length > 0) recordFires(fired);

  // Persist outcome-trackable fires (squeeze/ema_cross/distribution/rsi/whales -
  // the rule_keys with an unambiguous implied direction) so /alerts can later
  // show honest win-rate + avg move, misses included. Best-effort - never
  // blocks or throws (see persistAlertFires).
  //
  // canonicalHit !== false excludes rsi/squeeze entries that only crossed a
  // recipient's personal (looser-than-default) threshold - the shared Alert
  // Track Record stays anchored to ONE definition (RSI 70/30, squeeze 70)
  // regardless of what any individual user has tuned their own alerts to.
  // Entry types with no per-user threshold (ema_cross, distribution, whales)
  // never set canonicalHit, so it's undefined there and always passes.
  const outcomeFires = signalQueue
    .filter(e => isOutcomeTracked(e.ruleKey, e.dir, e.price) && e.canonicalHit !== false)
    .map(e => ({ ruleKey: e.ruleKey, coin: e.coin, dir: e.dir as 'long' | 'short', label: e.name, price: e.price! }));
  await persistAlertFires(outcomeFires);

  // ── Delivery observability ────────────────────────────────────────────────
  // Until now this route emitted no logs at all and structure signals are
  // deliberately kept out of lhq_alert_fires (canonicalHit: false, so they
  // never pollute the shared Alert Track Record). Between the two there was no
  // server-side record of whether ANY message reached anyone - a send that
  // Telegram rejected looked exactly like one that landed, and confirming a
  // delivery meant opening the app and reading the chat.
  //
  // Only recorded when a send was actually attempted: a quiet run with no
  // signals is not evidence that Telegram is healthy, and marking the source
  // ok on every empty tick would paper over a real outage between alerts.
  const attempted = sendTally.ok + sendTally.failed;
  if (attempted > 0) {
    const reasons = [...sendTally.reasons].join('; ');
    await recordApiHealth([{
      source: 'telegram:sendMessage',
      category: 'delivery',
      // Semantic, per lib/apiHealth: partial delivery is a failure. One
      // recipient silently not receiving alerts is the exact condition worth
      // surfacing, and it would be invisible if any success counted as ok.
      ok: sendTally.failed === 0,
      detail: sendTally.failed === 0
        ? `${sendTally.ok} sent`
        : `${sendTally.failed} of ${attempted} failed: ${reasons}`,
      items: sendTally.ok,
    }]);
  }
  // One line per run, so Render logs can answer "did it fire, did it land"
  // without a database query. Deliberately includes the rule keys - that is
  // what makes a structure alert visible here at all.
  console.log(
    `[alert] fired=${fired.length}${fired.length ? ` (${fired.join(',')})` : ''} ` +
    `sent=${sendTally.ok} failed=${sendTally.failed} recipients=${recipients.length}`
  );

  return NextResponse.json({
    ok: true, fired,
    recipients: recipients.length,
    mutedUsers: mutedByUser.size,
    delivery: { sent: sendTally.ok, failed: sendTally.failed, reasons: [...sendTally.reasons] },
    checked: [
      'RSI', 'Rapid move', 'Whales', 'News', 'Fear & Greed', 'Daily summary', 'OI spike', 'CVD',
      'Price alerts', 'Sentiment extremes', 'Squeeze/Flush threshold', 'Distribution',
      ...EMA_SIGNAL_TFS.map(tf => `EMA Buy/Sell Signal (${tf.toUpperCase()})`),
      ...STRUCTURE_TFS.map(tf => `Market structure (${tf.toUpperCase()})`),
    ],
    coins: COINS.length,
    session: nyActive ? 'NY/Pre-NY (high activity)' : 'Asia/London',
    cooldowns: { whale: `${CD.whale / 60_000}min`, news: `${CD.news / 60_000}min` },
  });
}
