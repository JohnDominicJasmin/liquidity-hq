import type { PingKind } from './arenaSoundTriggers';

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

const TONES: Record<PingKind, { freqs: number[]; gain: number; noteMs: number }> = {
  buy:  { freqs: [660, 880], gain: 0.16, noteMs: 110 },
  sell: { freqs: [660, 440], gain: 0.16, noteMs: 110 },
  move: { freqs: [520],      gain: 0.08, noteMs: 170 },
};

/** Plays one ping. Returns false (and plays nothing) when audio has not been unlocked by a gesture. */
export function playPing(kind: PingKind): boolean {
  if (!ctx || ctx.state !== 'running') return false;
  try {
    const { freqs, gain, noteMs } = TONES[kind];
    let t = ctx.currentTime + 0.01;
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + noteMs / 1000);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + noteMs / 1000 + 0.02);
      t += noteMs / 1000;
    }
    return true;
  } catch { return false; }
}
