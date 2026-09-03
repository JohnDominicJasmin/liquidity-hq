'use client';
import { useMarket } from '@/lib/marketStore';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';

function fmtGex(v: number): string {
  const abs = Math.abs(v);
  const sign = v >= 0 ? '+' : '−';
  if (abs >= 1e9) return sign + '$' + (abs / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(0) + 'M';
  return sign + '$' + abs.toFixed(0);
}

export default function GexTable() {
  const { t } = useLabels();
  const { store } = useMarket();
  const { btcNetGex, btcGexFlip, btcGexLevels, btcMaxPain } = store;

  const gexLoaded = btcNetGex !== null && btcGexLevels.length > 0;
  const isLongGamma = (btcNetGex ?? 0) >= 0;

  const gexCol     = isLongGamma ? 'var(--green-fg)' : 'var(--red)';
  const gexBg      = isLongGamma ? 'color-mix(in srgb, var(--green-2) 12%, transparent)' : 'color-mix(in srgb, var(--red) 12%, transparent)';
  const gexBorder  = isLongGamma ? 'color-mix(in srgb, var(--green-2) 30%, transparent)'  : 'color-mix(in srgb, var(--red) 30%, transparent)';

  const maxAbsGex = btcGexLevels.length
    ? Math.max(...btcGexLevels.map(l => Math.abs(l.gex)))
    : 1;

  const spotPrice = store.coins.btc?.price ?? 0;

  return (
    <div className="gex-table">
      {/* Title + net GEX chip */}
      <div className="gex-title-row">
        <div className="gex-title">{t('GEX_TABLE_TITLE')} <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 400, opacity: 0.5 }}>{t('GEX_TABLE_TITLE_SUFFIX')}</span></div>
        {gexLoaded ? (
          <div
            className="gex-net-chip"
            style={{ color: gexCol, background: gexBg, border: `0.5px solid ${gexBorder}` }}
          >
            {t('GEX_TABLE_NET_LABEL', { value: fmtGex(btcNetGex!) })}
          </div>
        ) : (
          <div className="gex-net-chip" style={{ background: 'transparent' }}>
            <SkeletonBar width={56} height={11} radius={4} />
            <span className="sr-only">{t('GEX_TABLE_FETCHING_SR')}</span>
          </div>
        )}
        {btcMaxPain != null && (
          <div className="gex-meta">{t('GEX_TABLE_MAX_PAIN_LABEL', { price: btcMaxPain.toLocaleString() })} <span style={{ fontWeight: 400, opacity: 0.6 }}>{t('GEX_TABLE_MAX_PAIN_DESC')}</span></div>
        )}
      </div>

      {/* Plain one-liner: what this whole panel is, for someone new to options */}
      <div className="gex-subtitle" style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', lineHeight: 1.5, margin: '2px 0 8px' }}>
        {t('GEX_TABLE_SUBTITLE')}
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
              leanReason = t('GEX_TABLE_LEAN_ABOVE_FLIP', { flip: btcGexFlip.toLocaleString() });
            } else {
              lean = 'bear';
              leanReason = t('GEX_TABLE_LEAN_BELOW_FLIP', { flip: btcGexFlip.toLocaleString() });
            }
          } else if (largestGexLevel && spotPrice > 0) {
            if (largestGexLevel.strike > spotPrice) {
              lean = 'bull';
              leanReason = t('GEX_TABLE_LEAN_MAGNET_ABOVE', { strike: (largestGexLevel.strike / 1000).toFixed(0) });
            } else {
              lean = 'bear';
              leanReason = t('GEX_TABLE_LEAN_MAGNET_BELOW', { strike: (largestGexLevel.strike / 1000).toFixed(0) });
            }
          }

          const leanColor = lean === 'bull' ? 'var(--green-2)' : lean === 'bear' ? 'var(--red)' : 'var(--txt3)';
          const leanLabel = lean === 'bull' ? t('GEX_TABLE_LEAN_BULLISH') : lean === 'bear' ? t('GEX_TABLE_LEAN_BEARISH') : t('GEX_TABLE_LEAN_NEUTRAL');
          const regimeLabel = isLongGamma ? t('GEX_TABLE_REGIME_RANGING') : t('GEX_TABLE_REGIME_TRENDING');
          const regimeColor = isLongGamma ? 'var(--green-2)' : 'var(--red)';
          const regimeDesc  = isLongGamma
            ? t('GEX_TABLE_REGIME_DESC_RANGING')
            : t('GEX_TABLE_REGIME_DESC_TRENDING');

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
          <>
            <SkeletonBar width="60%" height={12} radius={4} />
            <span className="sr-only">{t('GEX_TABLE_CALCULATING_SR')}</span>
          </>
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
            <div>{t('GEX_TABLE_COL_PRICE_LEVEL')}</div><div>{t('GEX_TABLE_COL_WALL_STRENGTH')}</div><div>{t('GEX_TABLE_COL_SIZE')}</div>
          </div>
          {btcGexLevels.map(({ strike, gex }) => {
            const pct   = maxAbsGex > 0 ? Math.abs(gex) / maxAbsGex * 100 : 0;
            const col   = gex >= 0 ? 'var(--green-2)' : 'var(--red)';
            const vcol  = gex >= 0 ? 'var(--green-fg)' : 'var(--red)';
            const isAtm = spotPrice > 0 && Math.abs(strike - spotPrice) / spotPrice < 0.005;
            return (
              <div key={strike} className={`gex-row${isAtm ? ' gex-row-atm' : ''}`}>
                <div className="gex-strike" style={isAtm ? { color: 'var(--txt)' } : {}}>
                  ${strike >= 1000 ? (strike / 1000).toFixed(0) + 'K' : strike}
                  {isAtm && <span className="gex-atm-marker">{t('GEX_TABLE_CURRENT_PRICE_MARKER')}</span>}
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
              {t('GEX_TABLE_FLIP_LINE_LABEL')} <span>${btcGexFlip.toLocaleString()}</span>
              <span style={{ color: 'var(--txt3)', fontWeight: 400 }}> {t('GEX_TABLE_FLIP_LINE_DESC', { dir: (btcGexFlip < (spotPrice || btcGexFlip)) ? t('GEX_TABLE_DIR_BELOW') : t('GEX_TABLE_DIR_ABOVE') })}</span>
            </div>
          )}
          {btcGexLevels.length > 0 && (() => {
            const top = btcGexLevels.reduce((a, b) => Math.abs(a.gex) > Math.abs(b.gex) ? a : b);
            return (
              <div>
                {t('GEX_TABLE_STRONGEST_MAGNET_LABEL')} <span>${top.strike.toLocaleString()}</span>
                <span style={{ color: 'var(--txt3)', fontWeight: 400 }}> {t('GEX_TABLE_STRONGEST_MAGNET_DESC')}</span>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
