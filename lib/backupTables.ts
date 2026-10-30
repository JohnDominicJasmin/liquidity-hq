/* WHICH TABLES A BACKUP HAS TO CONTAIN, and the reasoning for each side of the line (#1413).
 *
 * The production database has NO BACKUPS - it is on Supabase's free plan, and `CONTRIBUTING.md`
 * says plainly that if a destructive migration ships there is no recovery path. The owner raised
 * this; `docs/OWNER-BLOCKERS.md` had it deferred to a ~$25/month upgrade, which read as "backups
 * are impossible until he pays". The database is 32 MB. That framing was wrong.
 *
 * THE LINE IS "CAN THIS BE REGENERATED", NOT "IS THIS IMPORTANT". Market data is important and it
 * is also reproducible from the exchanges in minutes - including it would make the dump dominated
 * by the one thing we can always get back. What cannot be regenerated is anything a human or a
 * payment processor put there: who paid, what they configured, what they muted, what they wrote.
 *
 * Extracted from the route so the list can be read, reviewed and tested without standing up a
 * request - the convention from #1223, and the thing that makes "which columns leave the database"
 * answerable by reading one file.
 */
import { T } from './tables.ts';

/** A table in the backup, with the reason it is in it and the column that makes paging stable. */
export interface BackupTable {
  readonly table: string;
  readonly why: string;
  /**
   * THE COLUMN PAGING ORDERS BY, and it is not optional for a reason.
   *
   * `.range(from, to)` without an `ORDER BY` has no defined row order in Postgres. Two pages can
   * overlap and skip rows at the same time, and the total can still come to the expected count -
   * so the "rows fetched equals rows counted" check passes over a dump holding duplicates and
   * missing records. **The integrity check was defeatable until this existed**, which is worse
   * than having no check, because the file reports itself sound.
   *
   * Required rather than defaulted: a wrong guess here is silent, and `mode=count` verifies every
   * one of these against the live schema before any export can run.
   */
  readonly orderBy: string;
}

/**
 * IRREPLACEABLE. Losing any of these loses something no API can return.
 *
 * `labels` is on this list for a reason that is easy to miss: production label rows exist that no
 * migration ever inserted, so the files in this repository are NOT the record. Restoring from
 * migrations alone would silently revert copy the owner approved.
 */
export const BACKUP_TABLES: readonly BackupTable[] = [
  { table: T.user_subscriptions,    why: 'who has paid and what plan - the payment record', orderBy: 'id' },
  { table: T.whop_webhook_events,   why: 'payment audit trail from the live processor', orderBy: 'id' },
  { table: T.ls_webhook_events,     why: 'payment audit trail, Lemon Squeezy era', orderBy: 'id' },
  { table: T.boomfi_webhook_events, why: 'payment audit trail, BoomFi era', orderBy: 'id' },
  { table: T.user_settings,         why: 'per-user configuration, including telegram_chat_id', orderBy: 'user_id' },
  { table: T.muted_alerts,          why: 'what each user has chosen NOT to be told about', orderBy: 'id' },
  { table: T.user_onboarding,       why: 'where each user got to', orderBy: 'user_id' },
  { table: T.user_status,           why: 'account state', orderBy: 'user_id' },
  { table: T.price_alerts,          why: 'alerts the user created by hand', orderBy: 'id' },
  { table: T.push_subscriptions,    why: 'browser push endpoints - cannot be re-derived', orderBy: 'id' },
  { table: T.hypotheses,            why: 'user-written research', orderBy: 'id' },
  { table: T.hypothesis_evidence,   why: 'user-written research', orderBy: 'id' },
  { table: T.labels,                why: 'live copy; rows exist that no migration inserted', orderBy: 'key' },
  { table: T.app_config,            why: 'feature flags and kill switches as actually set', orderBy: 'key' },
  { table: T.admin_users,           why: 'who can reach /ops', orderBy: 'id' },
  { table: T.admin_audit_log,       why: 'what was done there - an audit trail is worthless if it can vanish', orderBy: 'id' },
];

/**
 * DELIBERATELY EXCLUDED, listed so the omission is a decision rather than an oversight.
 *
 * Every one of these regenerates from an upstream or from ordinary operation. `alert_fires` is the
 * largest table in the database at 13 MB and 56,941 rows; including it would make the backup mostly
 * history we are separately planning to purge.
 */
export const EXCLUDED_TABLES: readonly BackupTable[] = [
  { table: T.signals,         why: 'regenerates - derived from market data', orderBy: '-' },
  { table: T.trades,          why: 'regenerates', orderBy: '-' },
  { table: T.clusters,        why: 'regenerates from exchange feeds', orderBy: '-' },
  { table: T.liq_events,      why: 'regenerates from the WebSocket feeds; already has retention', orderBy: '-' },
  { table: T.alert_fires,     why: 'the largest table (13 MB); history, and separately being given retention', orderBy: '-' },
  { table: T.live_signals,    why: 'regenerates from market data', orderBy: '-' },
  { table: T.news,            why: 'regenerates from the feeds', orderBy: '-' },
  { table: T.econ_snapshot,   why: 'regenerates from the calendar upstream', orderBy: '-' },
  { table: T.market_snapshot, why: 'regenerates from the exchanges', orderBy: '-' },
  { table: T.api_health,      why: 'observability, reproduces itself within minutes', orderBy: '-' },
  { table: T.ai_call_log,     why: 'cost telemetry; large, and not needed to restore service', orderBy: '-' },
  { table: T.alert_grok_log,  why: 'telemetry', orderBy: '-' },
  { table: T.grok_usage,      why: 'daily quota counters - reset is harmless and self-corrects', orderBy: '-' },
  { table: T.global_ai_usage, why: 'daily spend counters - same', orderBy: '-' },
  { table: T.telegram_link_codes, why: 'short-lived single-use codes; a stale one is worse than none', orderBy: '-' },
];

/** Every table the registry knows, so a new one cannot be silently in neither list. */
export function unclassifiedTables(): string[] {
  const known = new Set([...BACKUP_TABLES, ...EXCLUDED_TABLES].map(t => t.table));
  return Object.values(T).filter(t => !known.has(t));
}
