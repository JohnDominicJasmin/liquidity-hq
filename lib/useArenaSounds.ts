'use client';
import { useCallback, useEffect, useRef } from 'react';
import { intervalToMs } from './candles';
import { audioReady, playPing, unlockAudio } from './arenaSound';
import { pingForSignalChange, readMove, signalIdentity, type Bar } from './arenaSoundTriggers';

/* THE ARENA'S SOUND ALERTS (owner-requested, 2026-11-14). Wires lib/arenaSoundTriggers.ts (the rules) to lib/arenaSound.ts (the tones).
 *
 *  - SIGNAL ping: watches the strategy panel's signal for the selected coin and timeframe. The first reading after the coin or timeframe changes is only
 *    remembered; a later reading with a different identity (direction + candle) is the ping, buy or sell.
 *  - MOVE ping: the chart hands over its own live bars every few seconds (KLineProChart `onLiveBars`); the forming candle is read against the last 20.
 *    At most once per candle, per coin and timeframe.
 *
 * NO SOUND UNTIL THE USER HAS ANSWERED AND CLICKED. `enabled` is the user's saved answer (true only after they pressed Allow or turned the setting on).
 * Even then audio stays locked until a gesture: this hook arms a one-time click / key listener that unlocks it, for the visitor who said yes last visit and has
 * not touched the page yet. `playPing` itself refuses while locked, so nothing can sound early.
 *
 * THE TAB IN THE BACKGROUND: it still plays. The point of an alert is to reach a trader who is not looking at the screen; the setting is the way to silence it.
 * (Browsers throttle background timers, so a ping can arrive up to about a minute late there, never early.) */
export interface LiveBarsInfo { coin: string; tf: string; bars: Bar[] }

export function useArenaSounds({ enabled, coin, tf, signal }: {
  enabled: boolean;
  coin: string;
  tf: string;
  signal: { loading?: boolean; error?: unknown; signalTimestamp?: number | null; signalDir?: 'long' | 'short' | null } | null | undefined;
}): { onLiveBars: (info: LiveBarsInfo) => void } {
  const ctxRef = useRef({ enabled, coin, tf });
  ctxRef.current = { enabled, coin, tf };
  const baseRef = useRef<{ key: string; id: string | null | undefined }>({ key: '', id: undefined });
  const lastMoveRef = useRef<{ key: string; candle: number } | null>(null);

  // Arm the unlock for a visitor who already answered yes: the first click or key press, never before.
  useEffect(() => {
    if (!enabled || audioReady()) return;
    const unlock = () => { unlockAudio(); };
    const evts = ['pointerdown', 'keydown'] as const;
    evts.forEach(e => window.addEventListener(e, unlock, { once: true, passive: true }));
    return () => { evts.forEach(e => window.removeEventListener(e, unlock)); };
  }, [enabled]);

  const loading = !!signal?.loading;
  const id = signalIdentity(signal);
  useEffect(() => {
    const key = `${coin}|${tf}`;
    const base = baseRef.current;
    if (base.key !== key) {                      // a new coin or timeframe: start over, remember, never ping
      baseRef.current = { key, id: loading ? undefined : id };
      return;
    }
    if (base.id === undefined) {                 // still waiting for the first finished reading
      if (!loading) base.id = id;
      return;
    }
    const kind = pingForSignalChange(base.id, id);
    base.id = id;
    if (kind && enabled) playPing(kind);
  }, [coin, tf, id, loading, enabled]);

  const onLiveBars = useCallback((info: LiveBarsInfo) => {
    const cur = ctxRef.current;
    if (!cur.enabled || info.coin !== cur.coin || info.tf !== cur.tf) return;   // not the chart the user is looking at any more
    const tfMs = intervalToMs(cur.tf);
    if (!tfMs) return;
    const r = readMove(info.bars, tfMs, Date.now());
    if (!r || !r.hit) return;
    const key = `${cur.coin}|${cur.tf}`;
    if (lastMoveRef.current && lastMoveRef.current.key === key && lastMoveRef.current.candle === r.candleStart) return;   // once per candle
    if (playPing('move')) lastMoveRef.current = { key, candle: r.candleStart };
  }, []);

  return { onLiveBars };
}
