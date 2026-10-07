import type { CoinId } from './coins.ts';
import type { StrategySignal } from './useEMAStrategy.ts';

/* THE SIGNAL COIN GATE (owner, 2026-10-07): which coins show Buy / Sell signals to whom. ONE function and two lists, so every
   surface asks the same question and they cannot drift:

     signed out          signals on BTC only
     Free                BTC, ETH, SOL
     Pro or trial        every coin

   The existing rule is separate and unchanged: Free signals are on 30m and slower only (lib/limits.ts, GATED_TFS).

   WHAT THIS GATES, AND WHAT IT CANNOT. The signal itself is computed in the browser from public candle data (lib/strategyCore.ts),
   so on the Arena this is a product gate in what the page shows, not a secret kept from the client. Every route that SERVES signals
   to a user is already Pro-only (alerts preview, Telegram alerts, the backtest), so for them the ladder resolves to "every coin"
   and there is nothing to withhold server-side. If a route that serves signals to Free or signed-out users is ever added, it must
   call signalsAllowedFor() with the caller's plan before sending anything. */
export type SignalPlan = 'signed_out' | 'free' | 'pro';

/** Easy to change: the coins whose signals each tier sees. */
export const SIGNED_OUT_SIGNAL_COINS: readonly CoinId[] = ['btc'];
export const FREE_SIGNAL_COINS: readonly CoinId[] = ['btc', 'eth', 'sol'];

/** The plan the gate sees. null = not known yet (auth or the subscription read still loading, or it failed): the gate does not
 *  lock on a guess, the same rule as the rest of the app (#1119). */
export function signalPlanFor(i: { signedIn: boolean; entitlementStatus: 'entitled' | 'not_entitled' | 'unknown'; authLoading: boolean }): SignalPlan | null {
  if (i.authLoading) return null;
  if (!i.signedIn) return 'signed_out';
  if (i.entitlementStatus === 'entitled') return 'pro';
  if (i.entitlementStatus === 'not_entitled') return 'free';
  return null;
}

export function signalsAllowedFor(plan: SignalPlan | null, coin: string): boolean {
  if (plan === null || plan === 'pro') return true;
  const list = plan === 'signed_out' ? SIGNED_OUT_SIGNAL_COINS : FREE_SIGNAL_COINS;
  return (list as readonly string[]).includes(coin);
}

/** The one line a locked surface shows, and where it leads. Only says what exists today. */
export function signalLockCopy(plan: Exclude<SignalPlan, 'pro'>): { text: string; href: string; cta: string } {
  return plan === 'signed_out'
    ? { text: 'Sign up free to see signals on more coins', href: '/login?signup=1&next=/arena', cta: 'Sign up' }
    : { text: 'Upgrade to Pro for signals on every coin', href: '/upgrade', cta: 'Upgrade' };
}

/* Applies the gate to a computed signal, for EVERY surface that reads it (chart markers, the strategy panel, the "latest
   signal", the Grok line, the confluence score). The ribbon values stay: a locked coin still shows its chart and ribbon. What
   goes is everything that says buy or sell: markers (replaced by direction-less locked ones), the verdict, conditions, levels,
   the pending setup, the latest signal and the record. */
export function gateSignal(sig: StrategySignal, plan: SignalPlan | null, coin: string): StrategySignal {
  if (sig.loading || signalsAllowedFor(plan, coin)) return sig;
  return {
    ...sig,
    verdict: 'FREEZE',
    phase: 'Signals are locked for this coin on your plan',
    conditions: [],
    priceInValueZone: false,
    sl: null, tp: null,
    signalTimestamp: null, signalAnchorPrice: null, signalDir: null,
    signalLongs: [], signalShorts: [], pendingSetup: null,
    reversalWarnings: [],
    recentStats: null, weakEdge: false,
    verdictChangedBySelection: false,
    signalLock: plan === 'signed_out' ? 'signed_out' : 'free',
  };
}
