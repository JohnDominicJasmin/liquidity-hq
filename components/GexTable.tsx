'use client';
import { useMarket } from '@/lib/marketStore';

function fmtGex(v: number): string {
  const abs = Math.abs(v);
  const sign = v >= 0 ? '+' : '−';
  if (abs >= 1e9) return sign + '$' + (abs / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(0) + 'M';
  return sign + '$' + abs.toFixed(0);
}

export default function GexTable() {
  const { store } = useMarket();
  const { btcNetGex, btcGexFlip, btcGexLevels, btcMaxPain } = store;

  const gexLoaded = btcNetGex !== null && btcGexLevels.length > 0;
  const isLongGamma = (btcNetGex ?? 0) >= 0;

  const gexCol     = isLongGamma ? '#34d399' : '#f87171';
  const gexBg      = isLongGamma ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)';
  const gexBorder  = isLongGamma ? 'rgba(52,211,153,0.3)'  : 'rgba(248,113,113,0.3)';

  const maxAbsGex = btcGexLevels.length
    ? Math.max(...btcGexLevels.map(l => Math.abs(l.gex)))
    : 1;

  const spotPrice = store.coins.btc?.price ?? 0;

  return (
    <div className="gex-table">
      {/* Title + net GEX chip */}
      <div className="gex-title-row">
        <div className="gex-title">BTC Options Market Pressure <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 400, opacity: 0.5 }}>(GEX)</span></div>
        {gexLoaded ? (
          <div
            className="gex-net-chip"
            style={{ color: gexCol, background: gexBg, border: `0.5px solid ${gexBorder}` }}
          >
            {fmtGex(btcNetGex!)} net
          </div>
        ) : (
          <div className="gex-net-chip" style={{ color: 'var(--txt2)', background: 'transparent' }}>Fetching…</div>
        )}
        {btcMaxPain != null && (
          <div className="gex-meta">Max pain: ${btcMaxPain.toLocaleString()} <span style={{ fontWeight: 400, opacity: 0.6 }}>(the price where the most option bets lose - BTC often drifts toward it as expiry nears)</span></div>
        )}
      </div>

      {/* Plain one-liner: what this whole panel is, for someone new to options */}
      <div className="gex-subtitle" style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', lineHeight: 1.5, margin: '2px 0 8px' }}>
        Where the big Bitcoin options bets sit - and whether they&apos;re calming price down (range) or fueling it (trend). Use it to decide: fade the moves, or follow them.
      </div>

      {/* Signal interpretation */}
      <div className="gex-signal-row">
        {gexLoaded ? (() => {
          const largestGexLevel = btcGexLevels.length > 0
            ? btcGexLevels.reduce((a, b) => Math.abs(a.gex) > Math.abs(b.gex) ? a : b)
            : null;

          let lean: 'bull' | 'bear' | 'neutral' = 'neutral';
          let leanReason = '';
          if (btcGexFlip != null && spotPrice > 0) {
            if (spotPrice > btcGexFlip) {
              lean = 'bull';
              leanReason = `price is holding above the $${btcGexFlip.toLocaleString()} flip line (the calmer side)`;
            } else {
              lean = 'bear';
              leanReason = `price has slipped below the $${btcGexFlip.toLocaleString()} flip line (the jumpier side)`;
            }
          } else if (largestGexLevel && spotPrice > 0) {
            if (largestGexLevel.strike > spotPrice) {
              lean = 'bull';
              leanReason = `the strongest magnet ($${(largestGexLevel.strike / 1000).toFixed(0)}K) sits above price, pulling up`;
            } else {
              lean = 'bear';
              leanReason = `the strongest magnet ($${(largestGexLevel.strike / 1000).toFixed(0)}K) sits below price, pulling down`;
            }
          }

          const leanColor = lean === 'bull' ? '#34d399' : lean === 'bear' ? '#f87171' : '#9ca3af';
          const leanLabel = lean === 'bull' ? '↑ BULLISH LEAN' : lean === 'bear' ? '↓ BEARISH LEAN' : '→ NEUTRAL';
          const regimeLabel = isLongGamma ? 'RANGING' : 'TRENDING';
          const regimeColor = isLongGamma ? '#34d399' : '#f87171';
          const regimeDesc  = isLongGamma
            ? 'the market likes to chop and bounce right now - fade the extremes, don’t chase breakouts'
            : 'moves tend to keep running right now - follow the momentum, don’t try to catch the top or bottom';

          return (
            <>
              <span style={{ color: leanColor, fontWeight: 700 }}>{leanLabel}</span>
              {leanReason && <span style={{ color: 'var(--txt2)' }}> - {leanReason}</span>}
              <span style={{ color: 'var(--txt3)' }}> · </span>
              <span style={{ color: regimeColor }}>{regimeLabel}</span>
              <span style={{ color: 'var(--txt2)' }}> regime - {regimeDesc}</span>
            </>
          );
        })() : (
          <span style={{ color: 'var(--txt3)' }}>Calculating from Deribit options chain…</span>
        )}
      </div>

      {/* Plain English interpretation */}
      {gexLoaded && (
        <div className="gex-insight">
          <span style={{ color: 'var(--txt3)', marginRight: 6 }}>→</span>
          {(() => {
            const largest = btcGexLevels.length > 0
              ? btcGexLevels.reduce((a, b) => Math.abs(a.gex) > Math.abs(b.gex) ? a : b)
              : null;
            const lK = largest
              ? (largest.strike >= 1000 ? `$${(largest.strike / 1000).toFixed(0)}K` : `$${largest.strike.toLocaleString()}`)
              : null;
            const fK = btcGexFlip != null
              ? (btcGexFlip >= 1000 ? `$${(btcGexFlip / 1000).toFixed(0)}K` : `$${btcGexFlip.toLocaleString()}`)
              : null;
            if (fK && spotPrice > 0) {
              const above = spotPrice > btcGexFlip!;
              if (above && isLongGamma)
                return `BTC is above the ${fK} flip line, so the big options players are cushioning price - expect it to chop and stay boxed in${lK ? ` near ${lK}` : ''} instead of trending. Good for buying dips / selling rips inside the range; risky to chase a breakout.`;
              if (!above && !isLongGamma)
                return `BTC dropped below the ${fK} flip line, so those same players now push moves harder instead of cushioning them - expect bigger, faster swings${lK ? `. ${lK} is the level price is drawn to` : ''}. Momentum trades work better here than fading.`;
              if (above && !isLongGamma)
                return `Options positioning is amplifying moves right now, so swings can run - trade with the trend, not against it.${lK ? ` ${lK} is the level to watch as a magnet.` : ''}`;
              return `Options players are still cushioning price, so expect choppy, contained moves${lK ? ` around ${lK}` : ''} rather than a clean trend.`;
            }
            return isLongGamma
              ? `Big options players are steadying the price right now, so expect range-bound chop${lK ? `. ${lK} is the level it keeps getting pulled toward this week` : ''}.`
              : `Options positioning is amplifying moves right now, so expect bigger swings${lK ? `. ${lK} is the level to watch as a magnet` : ''}.`;
          })()}
        </div>
      )}

      {/* Strike chart */}
      {gexLoaded && btcGexLevels.length > 0 && (
        <>
          <div className="gex-hdr">
            <div>Price level</div><div>Wall strength (bigger = stronger magnet)</div><div>$ size</div>
          </div>
          {btcGexLevels.map(({ strike, gex }) => {
            const pct   = maxAbsGex > 0 ? Math.abs(gex) / maxAbsGex * 100 : 0;
            const col   = gex >= 0 ? 'rgba(52,211,153,0.65)' : 'rgba(248,113,113,0.65)';
            const vcol  = gex >= 0 ? '#34d399' : '#f87171';
            const isAtm = spotPrice > 0 && Math.abs(strike - spotPrice) / spotPrice < 0.005;
            return (
              <div key={strike} className={`gex-row${isAtm ? ' gex-row-atm' : ''}`}>
                <div className="gex-strike" style={isAtm ? { color: 'var(--txt)' } : {}}>
                  ${strike >= 1000 ? (strike / 1000).toFixed(0) + 'K' : strike}
                  {isAtm && <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginLeft: 4 }}>← current price</span>}
                </div>
                <div className="gex-bar-wrap">
                  <div className="gex-bar-fill" style={{ width: `${pct}%`, background: col }} />
                </div>
                <div className="gex-value" style={{ color: vcol }}>{fmtGex(gex)}</div>
              </div>
            );
          })}
        </>
      )}

      {/* Flip level + pin */}
      {gexLoaded && (
        <div className="gex-flip-row">
          {btcGexFlip != null && (
            <div>
              Flip line: <span>${btcGexFlip.toLocaleString()}</span>
              <span style={{ color: 'var(--txt3)', fontWeight: 400 }}> - if BTC breaks {(btcGexFlip < (spotPrice || btcGexFlip)) ? 'below' : 'above'} this, the calming effect switches off and big, fast moves get more likely</span>
            </div>
          )}
          {btcGexLevels.length > 0 && (() => {
            const top = btcGexLevels.reduce((a, b) => Math.abs(a.gex) > Math.abs(b.gex) ? a : b);
            return (
              <div>
                Strongest magnet: <span>${top.strike.toLocaleString()}</span>
                <span style={{ color: 'var(--txt3)', fontWeight: 400 }}> - the price level BTC tends to get pulled toward</span>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
