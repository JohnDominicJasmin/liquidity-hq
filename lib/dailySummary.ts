/* The daily Telegram summary: who gets it, when, and what it says.
 *
 * OPT-IN (owner sweep 2026-11-18). The summary used to be opt-OUT: a `daily_summary` mute row turned it off, so every linked Pro chat got
 * it at 7 am without asking. It now follows the market-structure model (lib/structurePrefs.ts): a `daily_summary_on` row in muted_alerts
 * means ON, no row means OFF. The old `daily_summary` mute row no longer counts (lib/dailySummaryPrefs.ts says why); it cannot switch anyone on.
 *
 * What this cannot do, stated rather than discovered: the opt-out model never stored "I turned it on" (turning a key on DELETES its row),
 * so a user who received the old 7 am summary on purpose looks exactly like one who never touched it. The migration that adds the hour
 * (20261119v) therefore writes the ON row for every current receiver (linked chat, no 'daily_summary' mute): nobody loses the summary at
 * the deploy, and only users who link Telegram afterwards start OFF.
 *
 * WHEN: user_settings.daily_summary_hour (0-23, null = 7) in the user's own user_settings.timezone (null = UTC, same as every other
 * alert stamp). One send per chat per LOCAL DATE (summaryDueNow in lib/dailySummaryPrefs.ts; it was a 23 h cooldown, which skipped a day when the hour moved earlier - QA F1).
 *
 * WHAT: the three tracked coins with the largest absolute 24 h move (Bybit linear tickers), each with a direction word and one fact
 * line, then every squeeze setup at or above the user's own squeeze threshold. Facts only - no advice. Coins the user muted on /alerts
 * (which includes the trial ladder) are left out of both lists. */
import { BYBIT_SYMS, COIN_LABELS, COINS, symbolDenominationFactor } from '@/lib/coins';
import { exchangeFetch } from '@/lib/exchangeGuard';

export * from '@/lib/dailySummaryPrefs';

export const DAILY_SUMMARY_TOP_N = 3;

export interface Mover {
  coin: string;
  label: string;
  changePct: number;   // 24 h change in percent, e.g. 4.2
  price: number;
  high: number;
  low: number;
}

export interface SqueezeRead {
  coin: string;
  label: string;
  score: number;
  dir: 'LONG_LIQ' | 'SHORT_SQ' | 'NEUTRAL';
  fundingPct: number | null;   // per 8 h, in percent
  longPct: number | null;      // share of accounts long, in percent
}

const finite = (n: number) => Number.isFinite(n);

/** The N coins with the largest absolute 24 h move, leaving out the excluded (muted) coins and any row with a broken number. */
export function topMovers(rows: Mover[], exclude: (coin: string) => boolean, n = DAILY_SUMMARY_TOP_N): Mover[] {
  return rows
    .filter(r => !exclude(r.coin) && finite(r.changePct) && finite(r.price) && r.price > 0)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct) || a.coin.localeCompare(b.coin))
    .slice(0, n);
}

/** Setups at or above the user's threshold, strongest first. */
export function squeezeSetups(rows: SqueezeRead[], threshold: number, exclude: (coin: string) => boolean): SqueezeRead[] {
  return rows
    .filter(r => r.dir !== 'NEUTRAL' && finite(r.score) && r.score >= threshold && !exclude(r.coin))
    .sort((a, b) => b.score - a.score || a.coin.localeCompare(b.coin));
}

function fmtPrice(n: number): string {
  if (n >= 1) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return '$' + n.toLocaleString('en-US', { maximumSignificantDigits: 5 });
}

export function directionWord(changePct: number): 'Up' | 'Down' | 'Flat' {
  if (Math.abs(changePct) < 0.05) return 'Flat';
  return changePct > 0 ? 'Up' : 'Down';
}

export function moverLines(m: Mover): string {
  const sign = m.changePct > 0 ? '+' : '';
  const range = finite(m.high) && finite(m.low) && m.high > 0 && m.low > 0
    ? ` · 24 h range ${fmtPrice(m.low)} - ${fmtPrice(m.high)}`
    : '';
  return `<b>${m.label}</b> · ${directionWord(m.changePct)}\n${sign}${m.changePct.toFixed(2)}% in 24 h · now ${fmtPrice(m.price)}${range}`;
}

export function squeezeLine(s: SqueezeRead): string {
  const side = s.dir === 'LONG_LIQ' ? 'long-heavy' : 'short-heavy';
  const facts: string[] = [];
  if (s.fundingPct != null && finite(s.fundingPct)) facts.push(`funding ${s.fundingPct >= 0 ? '+' : ''}${s.fundingPct.toFixed(4)}%`);
  if (s.longPct != null && finite(s.longPct)) facts.push(`${s.longPct.toFixed(0)}% of accounts long`);
  return `• <b>${s.label}</b> ${side} positioning, score ${s.score}/100${facts.length ? ` (${facts.join(', ')})` : ''}`;
}

export function buildDailySummaryText(opts: {
  dateStr: string; movers: Mover[]; setups: SqueezeRead[]; threshold: number; stamp: string;
}): string {
  const { dateStr, movers, setups, threshold, stamp } = opts;
  const moversBlock = movers.length ? movers.map(moverLines).join('\n\n') : 'No 24 h data for the coins you have on.';
  const setupsBlock = setups.length
    ? setups.map(squeezeLine).join('\n')
    : `None at or above your threshold (${threshold}).`;
  return (
    `☀️ <b>Daily Summary - ${dateStr}</b>\n\n` +
    `📈 <b>Biggest 24 h moves</b>\n${moversBlock}\n\n` +
    `⚡ <b>Squeeze setups (score ${threshold}+)</b>\n${setupsBlock}\n\n` +
    `<i>${stamp}</i>`
  );
}

interface BybitLinearTicker { symbol: string; lastPrice?: string; price24hPcnt?: string; highPrice24h?: string; lowPrice24h?: string }

/** One Bybit linear tickers call: 24 h change, price and range for every tracked coin listed there. Empty on any failure. */
export async function fetchMovers24h(): Promise<Mover[]> {
  const bySym = new Map<string, string>();
  for (const coin of COINS) { const s = BYBIT_SYMS[coin]; if (s) bySym.set(s, coin); }
  try {
    const res = await exchangeFetch('https://api.bybit.com/v5/market/tickers?category=linear', { cache: 'no-store', signal: AbortSignal.timeout(7_000) });
    if (!res.ok) return [];
    const d = await res.json() as { result?: { list?: BybitLinearTicker[] } };
    const out: Mover[] = [];
    for (const t of d.result?.list ?? []) {
      const coin = bySym.get(t.symbol);
      if (!coin) continue;
      const f = symbolDenominationFactor(t.symbol);
      const pct = parseFloat(t.price24hPcnt ?? '') * 100;
      const price = parseFloat(t.lastPrice ?? '') * f;
      if (!finite(pct) || !finite(price) || price <= 0) continue;
      out.push({
        coin, label: COIN_LABELS[coin] ?? coin.toUpperCase(), changePct: pct, price,
        high: parseFloat(t.highPrice24h ?? '') * f, low: parseFloat(t.lowPrice24h ?? '') * f,
      });
    }
    return out;
  } catch {
    return [];
  }
}
