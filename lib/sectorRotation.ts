// Sector rotation: is money flowing into alts, or back into BTC?
//
// Alts are a money-flow game - an alt can have a clean technical setup and
// still bleed simply because capital is rotating into BTC. The AI prompts
// already carry per-coin technicals and BTC-wide flow, but nothing told them
// where capital sat *between* BTC and everything else, so a Quick/Deep read on
// an alt could look constructive while the whole alt complex was being drained.
//
// Deliberately built from data the app already has (CoinMarketCap dominance +
// alt-season score, Binance/Bybit volume and open interest) rather than from
// Coinglass exchange flow, which is a separate and currently broken source.
import type { MarketStore, CoinId } from './marketStore';

// Same buckets CoinHeatmap uses. Majors are the benchmark rather than the
// subject: "is capital rotating into alts" is not a meaningful question to ask
// about BTC itself, and answering it for ETH would be misleading too, since ETH
// leads the alt complex rather than following it.
const MAJORS: readonly CoinId[] = ['btc', 'eth', 'sol', 'xrp', 'bnb', 'ltc', 'bch', 'ada'];

export function isAlt(coin: CoinId): boolean {
  return !MAJORS.includes(coin);
}

export interface SectorRotation {
  /** Prompt-ready line, or '-' when there is not enough data to be honest. */
  line: string;
  /** 'to_alts' | 'to_btc' | 'neutral' | null when undetermined. */
  direction: 'to_alts' | 'to_btc' | 'neutral' | null;
}

// BTC dominance direction over the recent history window. Rising dominance
// means BTC is taking share - capital leaving alts even if alt prices are flat
// in dollar terms.
function domDirection(history: number[]): { delta: number; label: string } | null {
  if (!history || history.length < 3) return null;
  const first = history[0];
  const last = history[history.length - 1];
  if (first == null || last == null || !isFinite(first) || !isFinite(last)) return null;
  const delta = last - first;
  const label =
    delta > 0.3  ? 'BTC taking share (alts bleeding)' :
    delta < -0.3 ? 'BTC losing share (alts gaining)'  :
                   'flat';
  return { delta, label };
}

export function computeSectorRotation(store: MarketStore, coin: CoinId): SectorRotation {
  const dom = domDirection(store.btcDomHistory);
  const alt = store.altSeasonScore;

  // Relative participation: how much of the combined BTC+coin turnover and open
  // interest is sitting on this coin. Rising alt prices on a shrinking share of
  // volume is a much weaker signal than rising prices on an expanding share -
  // it is the difference between real rotation and a thin bounce.
  const btc = store.coins?.btc;
  const c = store.coins?.[coin];
  const shareOf = (a: number | null | undefined, b: number | null | undefined): number | null => {
    if (a == null || b == null || !isFinite(a) || !isFinite(b)) return null;
    const total = a + b;
    if (total <= 0) return null;
    return (a / total) * 100;
  };
  const volShare = shareOf(c?.vol24, btc?.vol24);
  const oiShare = shareOf(c?.oi, btc?.oi);

  if (!dom && alt == null) return { line: '-', direction: null };

  let direction: SectorRotation['direction'] = 'neutral';
  // Alt-season score is the more direct measure (share of top-50 alts actually
  // outperforming BTC), so it decides when present; dominance drift is the
  // fallback and the tie-breaker.
  if (alt != null) {
    direction = alt >= 60 ? 'to_alts' : alt <= 40 ? 'to_btc' : 'neutral';
  } else if (dom) {
    direction = dom.delta < -0.3 ? 'to_alts' : dom.delta > 0.3 ? 'to_btc' : 'neutral';
  }

  const parts: string[] = [];
  if (dom) parts.push(`BTC dominance ${dom.delta >= 0 ? '+' : ''}${dom.delta.toFixed(2)}pp (${dom.label})`);
  if (alt != null) {
    parts.push(
      `alt-season ${alt}/100 (${alt >= 60 ? 'alt season' : alt <= 40 ? 'BTC season' : 'mixed'})`,
    );
  }
  if (isAlt(coin)) {
    if (volShare != null) parts.push(`${coin.toUpperCase()} share of 24h volume vs BTC: ${volShare.toFixed(1)}%`);
    if (oiShare != null) parts.push(`open interest share vs BTC: ${oiShare.toFixed(1)}%`);
  }

  const verdict =
    direction === 'to_alts' ? 'capital rotating INTO alts' :
    direction === 'to_btc'  ? 'capital rotating INTO BTC (alt headwind)' :
                              'no clear rotation';

  return { line: `${parts.join(' | ')} - ${verdict}`, direction };
}
