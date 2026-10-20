import type { CoinId } from './coins.ts';
import type { StrategySignal } from './useEMAStrategy.ts';
import type { UsageTier } from './limits.ts';

/* THE SIGNAL COIN GATE (owner, 2026-10-07; split trial from paid 2026-10-20, #1596): which coins show Buy / Sell signals, and take Quick
   and Deep Research, for whom. ONE function and two lists, so every surface asks the same question and they cannot drift:

     signed out                  signals on BTC only
     Free AND free trial         BTC, ETH, SOL   (anyone who has NOT PAID)
     paid Pro                    every coin

   The existing rule is separate and unchanged: Free signals are on 30m and slower only (lib/limits.ts, GATED_TFS).

   A TRIAL IS NOT PAID PRO HERE. Elsewhere in the app a trial gets Pro features (proFeatures = paid OR trial); for the coin ladder it
   does not, so signalPlanFor() has its own 'trial' value and treats it exactly like Free.

   WHAT THIS GATES, AND WHAT IT CANNOT. The signal itself is computed in the browser from public candle data (lib/strategyCore.ts),
   so on the Arena the chart/panel part is a product gate in what the page shows, not a secret kept from the client. The AI part is
   different: Quick and Deep cost money per call, so /api/grok enforces aiCoinAllowed() on the server before it reserves quota or
   calls xAI. Every route that SERVES signals to a user is Pro-only (alerts preview, Telegram alerts, the backtest), so for them the
   ladder resolves to "every coin" and there is nothing to withhold server-side. If a route that serves signals to Free or signed-out
   users is ever added, it must call signalsAllowedFor() with the caller's plan before sending anything. */
export type SignalPlan = 'signed_out' | 'free' | 'trial' | 'pro' | 'pending';

/** Easy to change: the coins whose signals each tier sees. */
export const SIGNED_OUT_SIGNAL_COINS: readonly CoinId[] = ['btc'];
export const FREE_SIGNAL_COINS: readonly CoinId[] = ['btc', 'eth', 'sol'];

/** The plan the gate sees.
 *    'pending'  auth or the subscription read is still loading. Nothing is LOCKED on a guess (no lock line, no upgrade prompt), but a
 *               coin outside the Free list shows no signal yet either, so a Free account never sees Pro markers flash and vanish.
 *    null       the subscription read SETTLED without an answer (it failed): the gate does not lock on a guess, the same rule as the
 *               rest of the app (#1119), so a paying user is never locked out by a failed read. */
export function signalPlanFor(i: {
  signedIn: boolean;
  entitlementStatus: 'entitled' | 'not_entitled' | 'unknown';
  authLoading: boolean;
  /** PAID Pro (AuthProvider's isPro). A trial is 'entitled' but not paid. */
  isPro: boolean;
  entitlementsLoading: boolean;
}): SignalPlan | null {
  if (i.authLoading) return 'pending';
  if (!i.signedIn) return 'signed_out';
  if (i.entitlementsLoading) return 'pending';
  if (i.entitlementStatus === 'entitled') return i.isPro ? 'pro' : 'trial';
  if (i.entitlementStatus === 'not_entitled') return 'free';
  return null;
}

export function signalsAllowedFor(plan: SignalPlan | null, coin: string): boolean {
  if (plan === null || plan === 'pro') return true;
  const list = plan === 'signed_out' ? SIGNED_OUT_SIGNAL_COINS : FREE_SIGNAL_COINS;
  return (list as readonly string[]).includes(coin);
}

/** True when the viewer is KNOWN not to have paid and this coin is outside the Free list: the state that shows the lock line and locks
 *  Quick and Deep. False while pending or unknown (never a lock on a guess) and for signed-out visitors (their ladder is unchanged and
 *  they are sent to sign in, not to /upgrade). */
export function coinLockedForUnpaid(plan: SignalPlan | null, coin: string): boolean {
  return (plan === 'free' || plan === 'trial') && !signalsAllowedFor(plan, coin);
}

/** A coin id as the server sees it from a request: trimmed and lower-cased, so ' XRP ' and 'Xrp' are the same locked coin and cannot
 *  be a way round the list. null when it is not a non-empty string. */
export function normalizeCoinId(coin: unknown): string | null {
  if (typeof coin !== 'string') return null;
  const c = coin.trim().toLowerCase();
  return c.length > 0 ? c : null;
}

/** The server-side question for Quick and Deep Research (/api/grok). Paid Pro: every coin. Anyone else (Free, trial, and a read that
 *  failed and so resolved to Free): only the Free list, and a request that names no coin is not allowed. The CALLER decides what to do
 *  with a failed plan read; this function only answers the ladder. */
export function aiCoinAllowed(tier: UsageTier, coin: unknown): boolean {
  if (tier === 'pro') return true;
  const c = normalizeCoinId(coin);
  return c !== null && (FREE_SIGNAL_COINS as readonly string[]).includes(c);
}

/** The one line a locked surface shows, and where it leads. Only says what exists today. The Free/trial text is a label
 *  (ARENA_COIN_LOCK_*); this is the signed-out line and the fallback. */
export function signalLockCopy(plan: 'signed_out' | 'free'): { text: string; href: string; cta: string } {
  return plan === 'signed_out'
    ? { text: 'Sign up free to see signals on more coins', href: '/login?signup=1&next=/arena', cta: 'Sign up' }
    : { text: 'Upgrade to Pro for signals on every coin', href: '/upgrade', cta: 'Upgrade' };
}

/* Applies the gate to a computed signal, for EVERY surface that reads it (chart markers, the strategy panel, the "latest
   signal", the Grok line, the confluence score). The ribbon values stay: a locked coin still shows its chart and ribbon. What
   goes is everything that says buy or sell: markers, the verdict, conditions, levels, the pending setup, the latest signal and
   the record.

   LOCKED (Free / trial / signed out, coin not on their list): a clean chart. No buy/sell markers AND no locked circles for Free and
   trial (owner, #1596). Signed-out visitors keep the direction-less locked markers they have today (their ladder is unchanged).

   PENDING (plan still loading, coin not on the Free list): returned as a LOADING signal, so nothing says buy or sell and nothing says
   locked either; the real answer replaces it the moment the plan is known. */
export function gateSignal(sig: StrategySignal, plan: SignalPlan | null, coin: string): StrategySignal {
  if (sig.loading || signalsAllowedFor(plan, coin)) return sig;
  const cleared: StrategySignal = {
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
    lockedMarkers: plan === 'signed_out' ? sig.lockedMarkers : [],
    signalLock: plan === 'signed_out' ? 'signed_out' : 'free',
  };
  if (plan === 'pending') return { ...cleared, loading: true, verdict: 'LOADING', phase: 'Loading…', lockedMarkers: [], signalLock: null };
  return cleared;
}
