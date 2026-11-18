/* SHORT MUTE FROM THE TELEGRAM MESSAGE (#1651 Telegram checklist, "short-mute for OI/CVD/dump").
 *
 * An OI spike, CVD divergence or rapid move alert carries two buttons, "Mute 1 h" and "Mute 4 h". A tap mutes that alert TYPE for that user
 * until the time it names; the alert cron then treats the type as muted for that user until it passes. Stored in
 * user_settings.alert_type_mutes as { [ruleKey]: isoUntil }, written by the bot webhook only (service role), read by the cron.
 *
 * Pure: no database, no Telegram. The webhook and the cron hold the I/O; everything that decides lives here so it can be tested alone.
 *
 * The bot has no locale yet, so the button text and the confirmation are English constants (as in the rest of the bot's replies). */

/** The alert types that carry the buttons, and the name a confirmation uses for each. Nothing else can be muted this way. */
export const TYPE_MUTE_RULE_KEYS = ['oi_spike', 'cvd', 'rapid_move'] as const;
export type TypeMuteRuleKey = typeof TYPE_MUTE_RULE_KEYS[number];
export const TYPE_MUTE_HOURS = [1, 4] as const;
export type TypeMuteHours = typeof TYPE_MUTE_HOURS[number];

const TYPE_NAME: Record<TypeMuteRuleKey, string> = {
  oi_spike: 'Open interest',
  cvd: 'CVD divergence',
  rapid_move: 'Rapid move',
};

export type TypeMutes = Record<string, string>;

const isRuleKey = (k: string): k is TypeMuteRuleKey => (TYPE_MUTE_RULE_KEYS as readonly string[]).includes(k);

export function isTypeMuteRuleKey(ruleKey: string): ruleKey is TypeMuteRuleKey {
  return isRuleKey(ruleKey);
}

/** The callback_data a button carries: `tmute:<ruleKey>:<hours>`. Well under Telegram's 64-byte limit. */
export function typeMuteCallbackData(ruleKey: TypeMuteRuleKey, hours: TypeMuteHours): string {
  return `tmute:${ruleKey}:${hours}`;
}

/* THE ALLOWLIST. Every valid callback string is listed here in full; a lookup either finds one of these six or nothing. No parsing of the
   incoming text, so a forged value (another rule key, 0 or 9999 hours, extra fields, a different prefix) can never reach the database. */
const VALID_CALLBACKS = new Map<string, { ruleKey: TypeMuteRuleKey; hours: TypeMuteHours }>(
  TYPE_MUTE_RULE_KEYS.flatMap(ruleKey => TYPE_MUTE_HOURS.map(hours => [typeMuteCallbackData(ruleKey, hours), { ruleKey, hours }] as const)),
);

/** True when the callback belongs to this feature at all (its prefix), valid or not: the webhook routes it here and never to the link flow. */
export function isTypeMuteCallback(data: string | undefined | null): boolean {
  return typeof data === 'string' && data.startsWith('tmute:');
}

/** The mute a callback asks for, or null for anything outside the allowlist. */
export function parseTypeMuteCallback(data: string | undefined | null): { ruleKey: TypeMuteRuleKey; hours: TypeMuteHours } | null {
  if (typeof data !== 'string') return null;
  return VALID_CALLBACKS.get(data) ?? null;
}

/** The stored value, read defensively: anything that is not a plain object of string values is treated as no mutes. */
export function readTypeMutes(raw: unknown): TypeMutes {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: TypeMutes = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (isRuleKey(k) && typeof v === 'string') out[k] = v;
  return out;
}

/** True while the stored mute for `ruleKey` is in the future. A missing, unparseable or past time is not muted. */
export function isTypeMuted(mutes: TypeMutes | null | undefined, ruleKey: string, nowMs: number): boolean {
  const until = mutes?.[ruleKey];
  if (typeof until !== 'string') return false;
  const t = Date.parse(until);
  return Number.isFinite(t) && t > nowMs;
}

/** The rule keys muted right now, for the cron to add to that user's mute set for this run only. */
export function activeTypeMuteKeys(mutes: TypeMutes | null | undefined, nowMs: number): TypeMuteRuleKey[] {
  return TYPE_MUTE_RULE_KEYS.filter(k => isTypeMuted(mutes, k, nowMs));
}

/** The map to store after a tap: this type muted until now + hours (the latest tap wins, so 1 h after 4 h shortens it), and expired entries dropped. */
export function withTypeMute(mutes: TypeMutes | null | undefined, ruleKey: TypeMuteRuleKey, hours: TypeMuteHours, nowMs: number): TypeMutes {
  const out: TypeMutes = {};
  for (const k of activeTypeMuteKeys(mutes, nowMs)) out[k] = mutes![k];
  out[ruleKey] = new Date(nowMs + hours * 3_600_000).toISOString();
  return out;
}

/** The reply shown when the tap is saved, e.g. "Open interest alerts muted for 1 h." */
export function typeMuteConfirmation(ruleKey: TypeMuteRuleKey, hours: TypeMuteHours): string {
  return `${TYPE_NAME[ruleKey]} alerts muted for ${hours} h.`;
}
export const TYPE_MUTE_SAVE_FAILED = 'Could not mute. Try again.';

type InlineButton = { text: string; callback_data: string };

/** The inline keyboard for a message carrying these rule keys, or null when none of them can be muted this way. A message about one type
 *  gets "Mute 1 h" / "Mute 4 h"; a confluence message naming several types gets one row per type, with the type in the button. */
export function typeMuteKeyboard(ruleKeys: readonly string[]): { inline_keyboard: InlineButton[][] } | null {
  const types = TYPE_MUTE_RULE_KEYS.filter(k => ruleKeys.includes(k));
  if (types.length === 0) return null;
  const single = types.length === 1 && ruleKeys.every(k => k === types[0]);
  return {
    inline_keyboard: types.map(k => TYPE_MUTE_HOURS.map(h => ({
      text: single ? `Mute ${h} h` : `Mute ${TYPE_NAME[k]} ${h} h`,
      callback_data: typeMuteCallbackData(k, h),
    }))),
  };
}
