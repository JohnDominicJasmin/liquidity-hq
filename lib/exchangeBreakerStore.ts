/* The exchange breaker's cooldowns, kept across a restart (lib/exchangeGuard.ts).
 *
 * WHY. The breaker lived only in process memory, so a deploy or a restart forgot a ban and the new process called the exchange that had
 * just banned this IP straight away. Binance answers a repeat caller during a 418 ban with a LONGER ban, so forgetting one is how a
 * 10-minute stop becomes hours.
 *
 * WHERE. One row in the existing app_config table, key `exchange_breaker`, value `{ binance: { openUntil, strikes, lastTripAt }, ... }`
 * (epoch ms). app_config takes any text key, so no migration. Only cooldowns still running are kept; an expired one is dropped on read
 * and on the next write.
 *
 * The parsing and merging below are pure so they can be tested without a database. The two database calls load Supabase lazily: the
 * guard is imported by every exchange route and its tests, which should not load Supabase just to make a request. */
import type { Exchange } from './exchangeGuard.ts';

/** The key's prefix. The row itself is per service, see breakerConfigKey. */
export const BREAKER_CONFIG_KEY = 'exchange_breaker';
/** The longest the breaker ever stays open (also the cap on a saved cooldown, so a corrupt row cannot switch an exchange off for good). */
export const COOLDOWN_MAX_MS = 6 * 60 * 60_000;
export const BREAKER_EXCHANGES: readonly Exchange[] = ['binance', 'bybit', 'okx', 'hyperliquid'];
/** A saved lastTripAt further out than this is not a time, it is a corrupt row. */
const MAX_FUTURE_MS = 7 * 24 * 60 * 60_000;
const MAX_STRIKES = 64;

/** The app_config key for THIS service: dev, qa and staging share one database, so one key would make a ban seen by one environment stop
 *  the others too (QA review of #2571). Render's own service name first (the only value that differs between qa and staging, which both
 *  run NEXT_PUBLIC_APP_ENV=dev, docs/INFRASTRUCTURE.md 4b), then the error-tracker label, then the table switch, then 'local'. */
export function breakerConfigKey(env: Record<string, string | undefined> = process.env): string {
  const name = env.RENDER_SERVICE_NAME || env.NEXT_PUBLIC_SENTRY_ENV || env.NEXT_PUBLIC_APP_ENV || 'local';
  return `${BREAKER_CONFIG_KEY}:${name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 64)}`;
}

/** EXCHANGE_BREAKER_IGNORE_SAVED=1: the way out of a wrongly-open saved breaker. The saved row is neither read nor applied (the next trip
 *  overwrites it). docs/INFRASTRUCTURE.md 2d. */
export function ignoreSavedBreaker(env: Record<string, string | undefined> = process.env): boolean {
  return env.EXCHANGE_BREAKER_IGNORE_SAVED === '1';
}

export interface BreakerEntry { openUntil: number; strikes: number; lastTripAt: number }
export type BreakerSnapshot = Partial<Record<Exchange, BreakerEntry>>;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** An app_config value read back as a snapshot. Anything malformed (unknown exchange, missing or non-numeric openUntil) is dropped, never
 *  thrown. A bad strikes or lastTripAt (non-numeric, negative, or a lastTripAt more than 7 days ahead, which is no time at all) reads as 0.
 *  A far-future openUntil is kept here and capped at 6 h by mergeBreakerState. */
export function parseBreakerSnapshot(value: unknown, now: number = Date.now()): BreakerSnapshot {
  const out: BreakerSnapshot = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const ex of BREAKER_EXCHANGES) {
    if (!Object.prototype.hasOwnProperty.call(value, ex)) continue;
    const e = (value as Record<string, unknown>)[ex];
    if (!e || typeof e !== 'object') continue;
    const { openUntil, strikes, lastTripAt } = e as Record<string, unknown>;
    if (!isNum(openUntil) || openUntil <= 0) continue;
    out[ex] = {
      openUntil,
      strikes: isNum(strikes) && strikes > 0 ? Math.min(MAX_STRIKES, Math.floor(strikes)) : 0,
      lastTripAt: isNum(lastTripAt) && lastTripAt > 0 && lastTripAt <= now + MAX_FUTURE_MS ? lastTripAt : 0,
    };
  }
  return out;
}

/** The two views of the breaker combined, per exchange: only cooldowns still running at `now` are kept; of those, the LATER openUntil wins
 *  (so a long ban is never shortened by a shorter one, e.g. a later 429 with a small Retry-After), and strikes / lastTripAt take the higher
 *  value. A saved openUntil further out than now + COOLDOWN_MAX_MS is clamped to it. */
export function mergeBreakerState(memory: BreakerSnapshot, stored: BreakerSnapshot, now: number): BreakerSnapshot {
  const out: BreakerSnapshot = {};
  for (const ex of BREAKER_EXCHANGES) {
    const live = [memory[ex], stored[ex]].filter((e): e is BreakerEntry => !!e && isNum(e.openUntil) && e.openUntil > now);
    if (!live.length) continue;
    out[ex] = {
      openUntil: Math.min(now + COOLDOWN_MAX_MS, Math.max(...live.map((e) => e.openUntil))),
      strikes: Math.max(...live.map((e) => e.strikes || 0)),
      lastTripAt: Math.max(...live.map((e) => e.lastTripAt || 0)),
    };
  }
  return out;
}

/** Where the snapshot is kept. Swappable for tests (exchangeGuard's _setExchangeBreakerStore). */
export interface BreakerStore {
  load(): Promise<BreakerSnapshot>;
  save(snapshot: BreakerSnapshot): Promise<void>;
}

/** The app_config row. The read uses the read deadline so a hung database cannot hold an exchange call; a failure throws (the caller treats
 *  "could not read" as "nothing known", never as "nothing banned" being confirmed). */
export const supabaseBreakerStore: BreakerStore = {
  async load() {
    const [{ getSupabaseAdmin }, { T }] = await Promise.all([import('./supabase-admin.ts'), import('./tables.ts')]);
    const { data, error } = await getSupabaseAdmin({ deadline: true }).from(T.app_config)
      .select('value').eq('key', breakerConfigKey()).maybeSingle();
    if (error) throw error;
    return parseBreakerSnapshot(data?.value);
  },
  async save(snapshot) {
    const [{ getSupabaseAdmin }, { T }] = await Promise.all([import('./supabase-admin.ts'), import('./tables.ts')]);
    const { error } = await getSupabaseAdmin().from(T.app_config).upsert(
      { key: breakerConfigKey(), value: snapshot, updated_by: 'exchange-guard', updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );
    if (error) throw error;
  },
};
