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
        <div className="gex-title">BTC Options Market Pressure <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.5 }}>(GEX)</span></div>
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
          <div className="gex-meta">Max pain: ${btcMaxPain.toLocaleString()} <span style={{ fontWeight: 400, opacity: 0.6 }}>(price where most options expire worthless — acts as magnet)</span></div>
        )}
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
              leanReason = `price above gamma flip ($${btcGexFlip.toLocaleString()})`;
            } else {
              lean = 'bear';
              leanReason = `price below gamma flip ($${btcGexFlip.toLocaleString()})`;
            }
          } else if (largestGexLevel && spotPrice > 0) {
            if (largestGexLevel.strike > spotPrice) {
              lean = 'bull';
              leanReason = `magnet at $${(largestGexLevel.strike / 1000).toFixed(0)}K is above`;
            } else {
              lean = 'bear';
              leanReason = `magnet at $${(largestGexLevel.strike / 1000).toFixed(0)}K is below`;
            }
          }

          const leanColor = lean === 'bull' ? '#34d399' : lean === 'bear' ? '#f87171' : '#9ca3af';
          const leanLabel = lean === 'bull' ? '↑ BULLISH LEAN' : lean === 'bear' ? '↓ BEARISH LEAN' : '→ NEUTRAL';
          const regimeLabel = isLongGamma ? 'RANGING' : 'TRENDING';
          const regimeColor = isLongGamma ? '#34d399' : '#f87171';
          const regimeDesc  = isLongGamma
            ? 'price bounces between levels — expect reversals, avoid chasing'
            : 'breakouts follow through — ride momentum, do not fade moves';

          return (
            <>
              <span style={{ color: leanColor, fontWeight: 700 }}>{leanLabel}</span>
              {leanReason && <span style={{ color: 'var(--txt2)' }}> — {leanReason}</span>}
              <span style={{ color: 'var(--txt3)' }}> · </span>
              <span style={{ color: regimeColor }}>{regimeLabel}</span>
              <span style={{ color: 'var(--txt2)' }}> regime — {regimeDesc}</span>
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
                return `Price is above the ${fK} gamma flip — options dealers are absorbing volatility and keeping BTC in a range${lK ? ` near ${lK}` : ''}.`;
              if (!above && !isLongGamma)
                return `Price broke below the ${fK} gamma flip — dealers are now amplifying moves${lK ? `, not absorbing them. Watch ${lK} as a key magnet` : ''}.`;
              if (above && !isLongGamma)
                return `Short gamma above ${fK} — options pressure is fueling volatility.${lK ? ` ${lK} is the key magnet strike to watch.` : ''}`;
              return `Price is below the ${fK} flip but gamma is still long — expect choppy, contained moves${lK ? ` around ${lK}` : ''}.`;
            }
            return isLongGamma
              ? `Long gamma regime — options dealers are stabilizing price${lK ? `. ${lK} is the key magnet for this week's expiry` : ''}.`
              : `Short gamma regime — options dealers are amplifying moves${lK ? `. Watch ${lK} as the key pin level` : ''}.`;
          })()}
        </div>
      )}

      {/* Strike chart */}
      {gexLoaded && btcGexLevels.length > 0 && (
        <>
          <div className="gex-hdr">
            <div>Strike</div><div>Gamma exposure</div><div>Options pressure</div>
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
                  {isAtm && <span style={{ fontSize: 10, color: 'var(--txt3)', marginLeft: 4 }}>← current price</span>}
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
              Zero-gamma flip: <span>${btcGexFlip.toLocaleString()}</span>
              <span style={{ color: 'var(--txt3)', fontWeight: 400 }}> — break {(btcGexFlip < (spotPrice || btcGexFlip)) ? 'below' : 'above'} = options market becomes unpredictable, big moves likely</span>
            </div>
          )}
          {btcGexLevels.length > 0 && (() => {
            const top = btcGexLevels.reduce((a, b) => Math.abs(a.gex) > Math.abs(b.gex) ? a : b);
            return (
              <div>
                Largest GEX: <span>${top.strike.toLocaleString()}</span>
                <span style={{ color: 'var(--txt3)', fontWeight: 400 }}> — options pin / magnet strike</span>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
