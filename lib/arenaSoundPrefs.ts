/* THE SOUND PICKER'S SETTINGS (owner, PM-approved spec 2026-11-18): one nullable jsonb column, user_settings.arena_sound_prefs, beside the master
 * on/off (arena_sound). null means the defaults below, which play exactly what the Arena played before the picker. Pure: read by the client
 * (normalise) and checked by /api/settings (validate). */
import { DEFAULT_SOUND, DEFAULT_VOLUME, isSoundId, type SoundId } from './arenaSound.ts';

export interface ArenaSoundPrefs {
  sound: SoundId;
  volume: number;                                              // 0-1
  on: { signal: boolean; move: boolean; volume: boolean };    // Buy/Sell on the selected timeframe, big price move, volume spike
}

export const DEFAULT_SOUND_PREFS: ArenaSoundPrefs = { sound: DEFAULT_SOUND, volume: DEFAULT_VOLUME, on: { signal: true, move: true, volume: true } };

/** Any stored value (or null) as a complete prefs object; an unknown or out-of-range field takes its default. */
export function normaliseSoundPrefs(raw: unknown): ArenaSoundPrefs {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const on = r.on && typeof r.on === 'object' && !Array.isArray(r.on) ? r.on as Record<string, unknown> : {};
  const vol = typeof r.volume === 'number' && Number.isFinite(r.volume) && r.volume >= 0 && r.volume <= 1 ? r.volume : DEFAULT_SOUND_PREFS.volume;
  return {
    sound: isSoundId(r.sound) ? r.sound : DEFAULT_SOUND_PREFS.sound,
    volume: vol,
    on: {
      signal: typeof on.signal === 'boolean' ? on.signal : true,
      move: typeof on.move === 'boolean' ? on.move : true,
      volume: typeof on.volume === 'boolean' ? on.volume : true,
    },
  };
}

/** What /api/settings accepts: null, or exactly { sound: known id, volume: 0-1, on: { signal, move, volume: booleans } }. Anything else is refused. */
export function isValidSoundPrefs(v: unknown): v is ArenaSoundPrefs | null {
  if (v === null) return true;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  if (Object.keys(r).some(k => !['sound', 'volume', 'on'].includes(k))) return false;
  if (!isSoundId(r.sound)) return false;
  if (typeof r.volume !== 'number' || !Number.isFinite(r.volume) || r.volume < 0 || r.volume > 1) return false;
  const on = r.on as Record<string, unknown> | null;
  if (!on || typeof on !== 'object' || Array.isArray(on)) return false;
  if (Object.keys(on).some(k => !['signal', 'move', 'volume'].includes(k))) return false;
  return ['signal', 'move', 'volume'].every(k => typeof on[k] === 'boolean');
}
