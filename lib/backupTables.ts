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

/** A table in the backup, with the reason it is in it. */
export interface BackupTable {
  readonly table: string;
  readonly why: string;
}

/**
 * IRREPLACEABLE. Losing any of these loses something no API can return.
 *
 * `labels` is on this list for a reason that is easy to miss: production label rows exist that no
 * migration ever inserted, so the files in this repository are NOT the record. Restoring from
 * migrations alone would silently revert copy the owner approved.
 */
export const BACKUP_TABLES: readonly BackupTable[] = [
  { table: T.user_subscriptions,    why: 'who has paid and what plan - the payment record' },
  { table: T.whop_webhook_events,   why: 'payment audit trail from the live processor' },
  { table: T.ls_webhook_events,     why: 'payment audit trail, Lemon Squeezy era' },
  { table: T.boomfi_webhook_events, why: 'payment audit trail, BoomFi era' },
  { table: T.user_settings,         why: 'per-user configuration, including telegram_chat_id' },
  { table: T.muted_alerts,          why: 'what each user has chosen NOT to be told about' },
  { table: T.user_onboarding,       why: 'where each user got to' },
  { table: T.user_status,           why: 'account state' },
  { table: T.price_alerts,          why: 'alerts the user created by hand' },
  { table: T.push_subscriptions,    why: 'browser push endpoints - cannot be re-derived' },
  { table: T.hypotheses,            why: 'user-written research' },
  { table: T.hypothesis_evidence,   why: 'user-written research' },
  { table: T.labels,                why: 'live copy; rows exist that no migration inserted' },
  { table: T.app_config,            why: 'feature flags and kill switches as actually set' },
  { table: T.admin_users,           why: 'who can reach /ops' },
  { table: T.admin_audit_log,       why: 'what was done there - an audit trail is worthless if it can vanish' },
];

/**
 * DELIBERATELY EXCLUDED, listed so the omission is a decision rather than an oversight.
 *
 * Every one of these regenerates from an upstream or from ordinary operation. `alert_fires` is the
 * largest table in the database at 13 MB and 56,941 rows; including it would make the backup mostly
 * history we are separately planning to purge.
 */
export const EXCLUDED_TABLES: readonly BackupTable[] = [
  { table: T.signals,         why: 'regenerates - derived from market data' },
  { table: T.trades,          why: 'regenerates' },
  { table: T.clusters,        why: 'regenerates from exchange feeds' },
  { table: T.liq_events,      why: 'regenerates from the WebSocket feeds; already has retention' },
  { table: T.alert_fires,     why: 'the largest table (13 MB); history, and separately being given retention' },
  { table: T.live_signals,    why: 'regenerates from market data' },
  { table: T.news,            why: 'regenerates from the feeds' },
  { table: T.econ_snapshot,   why: 'regenerates from the calendar upstream' },
  { table: T.market_snapshot, why: 'regenerates from the exchanges' },
  { table: T.api_health,      why: 'observability, reproduces itself within minutes' },
  { table: T.ai_call_log,     why: 'cost telemetry; large, and not needed to restore service' },
  { table: T.alert_grok_log,  why: 'telemetry' },
  { table: T.grok_usage,      why: 'daily quota counters - reset is harmless and self-corrects' },
  { table: T.global_ai_usage, why: 'daily spend counters - same' },
  { table: T.telegram_link_codes, why: 'short-lived single-use codes; a stale one is worse than none' },
];

/** Every table the registry knows, so a new one cannot be silently in neither list. */
export function unclassifiedTables(): string[] {
  const known = new Set([...BACKUP_TABLES, ...EXCLUDED_TABLES].map(t => t.table));
  return Object.values(T).filter(t => !known.has(t));
}
