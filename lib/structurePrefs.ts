/* Market-structure alert preferences - shared by the /alerts page and the
   Telegram/push cron so the two can never disagree about which timeframes
   exist or what a stored key means.

   These keys live in the same table as every other alert preference
   (muted_alerts), but their polarity is INVERTED, and that is deliberate:

     coin:btc / ema_signal_1h / rsi   -> row PRESENT means MUTED  (opt-out)
     structure_on_1h                  -> row PRESENT means ENABLED (opt-in)

   Opt-out is right for an alert that already exists and is already being
   delivered: a missing row must not silently kill it. It is wrong for a NEW
   alert type, where a missing row would silently START it. Market-structure
   alerts shipped on 2026-07-31 and did exactly that - the intended "off by
   default" was implemented as a seeding step in the /alerts page bootstrap,
   which only runs when a human opens that page. The cron does not wait for
   anyone to open a page, so its first run delivered a brand-new alert type
   to every connected chat.

   The obvious repair - have the server seed the same mute rows - does not
   actually hold, because the opt-out model cannot represent the difference
   between "never configured" and "deliberately turned both on" (turning a
   key on DELETES its row, see app/api/alert-prefs POST). Any seeder keyed on
   "user has no structure rows" would re-mute the users who most clearly
   asked for the alerts, every time they reloaded the page.

   Inverting the polarity removes the default instead of relocating it. No
   row, no send - so there is no default left to forget, nothing to seed, no
   backfill for future users, and any data loss fails toward silence rather
   than toward spamming someone. Same reasoning as the structure_alerts
   feature flag in lib/featureFlags.ts, which is the only fail-CLOSED flag
   there for the same reason. */

// The cron only ever computes these two - offering more on /alerts would be
// a toggle for an alert that can never fire. Structure on a 1m chart is
// noise, and the EMA rule already covers the fast timeframes.
export const STRUCTURE_TFS = ['1h', '4h'] as const;
export type StructureTF = typeof STRUCTURE_TFS[number];

// Distinct prefix from the rule key itself (`structure_1h`), which is what
// entryMuteKeys() puts in the mute set. A user can therefore hold a legacy
// `structure_1h` mute row and a new `structure_on_1h` row at the same time
// without the two being confused for each other - the mute still wins.
export function structureOnKey(tf: string): string {
  return `structure_on_${tf}`;
}

export function isStructureEnabled(keys: Set<string> | undefined, tf: string): boolean {
  return keys?.has(structureOnKey(tf)) ?? false;
}

// Maps a queued signal's ruleKey back to its timeframe, or null when the
// entry is not a structure signal at all. Used by the delivery filter to
// decide which entries need the opt-in check.
export function structureTfForRuleKey(ruleKey: string): StructureTF | null {
  const tf = STRUCTURE_TFS.find(t => `structure_${t}` === ruleKey);
  return tf ?? null;
}
