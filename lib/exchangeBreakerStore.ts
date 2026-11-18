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

export const BREAKER_CONFIG_KEY = 'exchange_breaker';
/** The longest the breaker ever stays open (also the cap on a saved cooldown, so a corrupt row cannot switch an exchange off for good). */
export const COOLDOWN_MAX_MS = 6 * 60 * 60_000;
export const BREAKER_EXCHANGES: readonly Exchange[] = ['binance', 'bybit', 'okx', 'hyperliquid'];

export interface BreakerEntry { openUntil: number; strikes: number; lastTripAt: number }
export type BreakerSnapshot = Partial<Record<Exchange, BreakerEntry>>;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** An app_config value read back as a snapshot. Anything malformed (unknown exchange, missing or non-numeric openUntil) is dropped, never thrown. */
export function parseBreakerSnapshot(value: unknown): BreakerSnapshot {
  const out: BreakerSnapshot = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const ex of BREAKER_EXCHANGES) {
    const e = (value as Record<string, unknown>)[ex];
    if (!e || typeof e !== 'object') continue;
    const { openUntil, strikes, lastTripAt } = e as Record<string, unknown>;
    if (!isNum(openUntil) || openUntil <= 0) continue;
    out[ex] = {
      openUntil,
      strikes: isNum(strikes) && strikes > 0 ? Math.floor(strikes) : 0,
      lastTripAt: isNum(lastTripAt) && lastTripAt > 0 ? lastTripAt : 0,
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
      .select('value').eq('key', BREAKER_CONFIG_KEY).maybeSingle();
    if (error) throw error;
    return parseBreakerSnapshot(data?.value);
  },
  async save(snapshot) {
    const [{ getSupabaseAdmin }, { T }] = await Promise.all([import('./supabase-admin.ts'), import('./tables.ts')]);
    const { error } = await getSupabaseAdmin().from(T.app_config).upsert(
      { key: BREAKER_CONFIG_KEY, value: snapshot, updated_by: 'exchange-guard', updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );
    if (error) throw error;
  },
};
