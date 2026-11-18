import type { PingKind } from './arenaSoundTriggers.ts';

/* THE ARENA'S PINGS, GENERATED, NOT DOWNLOADED. Three short tones from the Web Audio API: no files, no external URLs, nothing to load.
 *   buy  - two rising notes (660 then 880 Hz)       sell - two falling notes (660 then 440 Hz)       move - one soft low note (520 Hz, quieter)
 *
 * NEVER BEFORE A USER GESTURE. Browsers keep audio locked until the page has had a click, tap or key press, and the product's rule is stricter still: the
 * AudioContext is not even created until `unlockAudio()` is called from a gesture (the prompt's Allow click, or the first click or key press afterwards for a
 * visitor who already said yes). `playPing()` does nothing at all while the context is missing or not running, so no code path can make a sound early. */

let ctx: AudioContext | null = null;

/** Creates (or resumes) the audio context. Call it only from a user gesture handler. Returns whether sound can now play. */
export function unlockAudio(): boolean {
  try {
    const AC = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
    if (!AC) return false;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    return true;
  } catch { return false; }
}

export function audioReady(): boolean { return ctx != null && ctx.state === 'running'; }

/* THE SOUND PICKER (owner, PM-approved spec 2026-11-18): 8 presets, all synthesised here (no files). A preset is a waveform, a base pitch, an
   envelope and how its notes move: buy rises, sell falls, a big move is one note, a volume spike is two quick repeats. `volume` (0-1) scales
   every preset; 0.6 is the old loudness. The first preset, 'chime', is the original three tones. */
export const SOUND_IDS = ['chime', 'bell', 'pop', 'marimba', 'beep', 'soft', 'digital', 'drop'] as const;
export type SoundId = typeof SOUND_IDS[number];
export const DEFAULT_SOUND: SoundId = 'chime';
export const DEFAULT_VOLUME = 0.6;

interface Preset { wave: OscillatorType; base: number; noteMs: number; attack: number; gain: number }
const PRESETS: Record<SoundId, Preset> = {
  chime:   { wave: 'sine',     base: 660, noteMs: 110, attack: 0.015, gain: 0.27 },
  bell:    { wave: 'triangle', base: 880, noteMs: 220, attack: 0.005, gain: 0.30 },
  pop:     { wave: 'sine',     base: 520, noteMs: 60,  attack: 0.003, gain: 0.35 },
  marimba: { wave: 'triangle', base: 440, noteMs: 140, attack: 0.004, gain: 0.33 },
  beep:    { wave: 'square',   base: 740, noteMs: 90,  attack: 0.005, gain: 0.10 },
  soft:    { wave: 'sine',     base: 392, noteMs: 260, attack: 0.060, gain: 0.25 },
  digital: { wave: 'sawtooth', base: 990, noteMs: 70,  attack: 0.003, gain: 0.09 },
  drop:    { wave: 'sine',     base: 300, noteMs: 180, attack: 0.010, gain: 0.32 },
};
/** The notes (as multiples of the preset's base pitch) for each kind of ping. */
const SHAPES: Record<PingKind, number[]> = { buy: [1, 4 / 3], sell: [1, 2 / 3], move: [0.8], volume: [1.2, 1.2] };

export function isSoundId(v: unknown): v is SoundId { return typeof v === 'string' && (SOUND_IDS as readonly string[]).includes(v); }

/** Plays one ping. Returns false (and plays nothing) when audio has not been unlocked by a gesture. */
export function playPing(kind: PingKind, opts: { sound?: SoundId; volume?: number } = {}): boolean {
  if (!ctx || ctx.state !== 'running') return false;
  try {
    const p = PRESETS[opts.sound && isSoundId(opts.sound) ? opts.sound : DEFAULT_SOUND];
    const vol = typeof opts.volume === 'number' && Number.isFinite(opts.volume) ? Math.min(1, Math.max(0, opts.volume)) : DEFAULT_VOLUME;
    if (vol <= 0) return true;   // switched to silent: nothing to play, and nothing went wrong
    const peak = Math.max(0.0002, p.gain * vol * (kind === 'move' ? 0.6 : 1));
    let t = ctx.currentTime + 0.01;
    for (const m of SHAPES[kind]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = p.wave;
      osc.frequency.value = p.base * m;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + p.attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + p.noteMs / 1000);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + p.noteMs / 1000 + 0.02);
      t += p.noteMs / 1000;
    }
    return true;
  } catch { return false; }
}

/** The preview a tap on a sound plays: unlocks audio (the tap is the gesture) and plays that preset's buy ping at the chosen volume. */
export function previewSound(sound: SoundId, volume: number): void {
  unlockAudio();
  window.setTimeout(() => { playPing('buy', { sound, volume }); }, 40);
}
