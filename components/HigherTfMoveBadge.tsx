'use client';
import { useEffect, useState } from 'react';
import type { CoinId } from '@/lib/marketStore';
import { BINANCE_SYMS, BYBIT_SYMS, bybitSymbolPriceFactor } from '@/lib/coins';
import { fetchBybitKlinesRetry } from '@/lib/bybitKlines';
import Tip from './Tip';
import { Warn } from './icons';
import { withAlpha } from '@/lib/color';
import { useLabels } from '@/lib/labels';

// Informational only - NOT a signal filter. Backtested three separate hard-suppression
// approaches this session (same-TF range position, same-TF choppiness, higher-TF RSI/
// price-change/choppiness - 10 variants across 6 coin/TF combos) and none showed a
// reliable edge: sometimes helped a little, sometimes catastrophically removed the best
// trades (e.g. SOL 15m RSI 65/35 turned +3R into -6R by suppressing signals that were
// 83% winners). A blunt threshold can't reliably tell "exhausted chop" from "a genuine
// trend leg that already moved" - both look identical to these metrics in the moment.
// So instead of guessing for the trader, this surfaces the 4h context and lets them judge.

const LOWER_TFS = new Set(['1m', '5m', '15m', '30m']);
const LOOKBACK_BARS = 6; // ~24h of 4h candles
const MOVE_THRESHOLD_PCT = 6;
const REFRESH_MS = 5 * 60_000;

interface Props { coin: CoinId; tf: string; signalDir: 'long' | 'short' | null }

export default function HigherTfMoveBadge({ coin, tf, signalDir }: Props) {
  const { t } = useLabels();
  const [changePct, setChangePct] = useState<number | null>(null);

  useEffect(() => {
    setChangePct(null);
    if (!LOWER_TFS.has(tf)) return;
    let cancelled = false;

    async function load() {
      try {
        const bn = BINANCE_SYMS[coin];
        const by = BYBIT_SYMS[coin];
        let closes: number[] = [];
        // #1059: Bybit primary, Binance fallback. This only ever compares two
        // closes as a ratio, so bybitSymbolPriceFactor is a no-op here (both
        // sides scale identically) - applied anyway per the coins.ts rule that
        // any new code reading a price off BYBIT_SYMS applies the factor.
        if (by) {
          // #1080: retry shared with every other Bybit-klines caller (see
          // lib/bybitKlines.ts). Exhaustion is unchanged - `d === null` falls
          // through the same way an empty result already did (closes stays
          // [], the length check below bails, the badge just doesn't render -
          // it's informational only, so silence on failure was already
          // correct and stays correct).
          const d = await fetchBybitKlinesRetry(by, '240', LOOKBACK_BARS + 1);
          // #1085 audit: the badge's normal resting state IS invisible (most
          // 4h windows don't clear MOVE_THRESHOLD_PCT), so a silent UI is
          // right - but that means "no qualifying move" and "retry exhausted"
          // now render identically, with nothing to tell them apart later.
          // console.warn, not a user-facing change, so the next person asking
          // "why didn't the badge fire during that pump" has an answer.
          if (d === null) {
            console.warn(`HigherTfMoveBadge: Bybit klines retry exhausted for ${by}/${coin}`);
          }
          const pf = bybitSymbolPriceFactor(by);
          closes = [...(d?.result?.list ?? [])].reverse().map(k => +k[4] * pf);
        } else if (bn) {
          const r = await fetch(`/api/market/klines?source=binance-futures&symbol=${bn}&interval=4h&limit=${LOOKBACK_BARS + 1}`);
          const raw = await r.json() as (string | number)[][];
          closes = raw.map(k => +k[4]);
        }
        if (closes.length < LOOKBACK_BARS + 1) return;
        const now = closes[closes.length - 1], then = closes[closes.length - 1 - LOOKBACK_BARS];
        if (!cancelled && then > 0) setChangePct(((now - then) / then) * 100);
      } catch { /* silent - informational only */ }
    }
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [coin, tf]);

  if (!LOWER_TFS.has(tf) || changePct == null || Math.abs(changePct) < MOVE_THRESHOLD_PCT) return null;

  const pumped = changePct > 0;
  const agrees = signalDir != null && ((pumped && signalDir === 'long') || (!pumped && signalDir === 'short'));
  const col = 'var(--amber)';

  return (
    <div style={{
      margin: '0 0 10px', fontSize: 'var(--fs-caption)', fontWeight: 600, lineHeight: 1.5,
      color: col, padding: '8px 10px', borderRadius: 8,
      background: withAlpha(col, '14'), border: `0.5px solid ${withAlpha(col, '44')}`,
    }}>
      <Tip
        width={280}
        iconColor={withAlpha(col, '99')}
        text={t('HIGHER_TF_MOVE_BADGE_TOOLTIP')}
      >
        <Warn /> {t('HIGHER_TF_MOVE_BADGE_MOVE_TEXT', {
          direction: pumped ? t('HIGHER_TF_MOVE_BADGE_PUMPED') : t('HIGHER_TF_MOVE_BADGE_DUMPED'),
          pct: Math.abs(changePct).toFixed(1),
        })}
      </Tip>
      {agrees && <span>{t('HIGHER_TF_MOVE_BADGE_AGREES_TEXT', { side: signalDir === 'long' ? t('HIGHER_TF_MOVE_BADGE_BUY') : t('HIGHER_TF_MOVE_BADGE_SELL') })}</span>}
    </div>
  );
}
