'use client';
import { useMarket } from '@/lib/marketStore';
import type { CoinId } from '@/lib/marketStore';
import { Warn } from '@/components/icons';
import { withAlpha } from '@/lib/color';
import type { StrategySignal } from '@/lib/useEMAStrategy';
import { scoreBias } from './StopLossZone';
import {
  computeConfluence, orderFlowFactor, multiTfRsiFactor, gexRegimeFactor, computeMacroRisk,
  type ConfluenceFactorInput, type CalEvent,
} from '@/lib/confluence';
import Tip from './Tip';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';
import { useNews } from './NewsProvider';

const VERDICT_CONFIG: Record<string, { labelKey: LabelKey; color: string }> = {
  STRONG_BULL:  { labelKey: 'CONFLUENCE_SCORE_VERDICT_STRONG_BULL',  color: '#34d399' },
  LEANING_BULL: { labelKey: 'CONFLUENCE_SCORE_VERDICT_LEANING_BULL', color: '#86efac' },
  MIXED:        { labelKey: 'CONFLUENCE_SCORE_VERDICT_MIXED',        color: '#6b7280' },
  LEANING_BEAR: { labelKey: 'CONFLUENCE_SCORE_VERDICT_LEANING_BEAR', color: '#fca5a5' },
  STRONG_BEAR:  { labelKey: 'CONFLUENCE_SCORE_VERDICT_STRONG_BEAR',  color: '#f87171' },
};

export default function ConfluenceScore({ coin, emaSignal, jpyUsd }: { coin: CoinId; emaSignal: StrategySignal; jpyUsd: number | null }) {
  const { t } = useLabels();
  const { store } = useMarket();
  const d = store.coins[coin];
  // Reads the calendar NewsProvider already holds instead of fetching it again
  // on a 5-minute timer. Same data, one shared push-fed copy per tab.
  const { econRaw: econEvents } = useNews();

  if (!d?.price) return null;

  const of = scoreBias(d);

  const factors: ConfluenceFactorInput[] = [
    {
      kind: 'directional',
      label: t('CONFLUENCE_SCORE_FACTOR_EMA_RIBBON'),
      dir: (emaSignal.verdict === 'LONG_SETUP' || emaSignal.verdict === 'TRENDING_LONG') ? 'bull'
         : (emaSignal.verdict === 'SHORT_SETUP' || emaSignal.verdict === 'TRENDING_SHORT') ? 'bear' : 'neutral',
      weight: 30,
    },
    orderFlowFactor(of.bias),
    multiTfRsiFactor(d.rsi14, d.rsi1h, d.rsi4h),
    // GEX is BTC-only (options data) and a REGIME MODIFIER, not a directional
    // vote: long gamma = ranging → dampens confidence in the trend signals;
    // short gamma = trending → no penalty. Included only for BTC.
    ...(coin === 'btc' ? [gexRegimeFactor(store.btcNetGex)] : []),
    {
      kind: 'penalty',
      label: t('CONFLUENCE_SCORE_FACTOR_CHOPPINESS'),
      weight: 15, active: emaSignal.chopRegime === 'choppy',
    },
    {
      kind: 'penalty',
      label: t('CONFLUENCE_SCORE_FACTOR_RSI_DIVERGENCE'),
      weight: 15, active: emaSignal.reversalWarnings.length > 0,
    },
  ];

  const result = computeConfluence(factors);
  const cfg = VERDICT_CONFIG[result.verdict];
  const macro = computeMacroRisk(econEvents, jpyUsd);
  const macroCol = macro.level === 'danger' ? '#f87171' : macro.level === 'caution' ? '#fbbf24' : null;

  return (
    <div className="sms-card">
      <div className="sms-header">
        <div>
          <div className="sms-title">
            <Tip text={t('CONFLUENCE_SCORE_TOOLTIP')}>
              {t('CONFLUENCE_SCORE_TITLE')}
            </Tip>
          </div>
          <div className="sms-sub">{t('CONFLUENCE_SCORE_SUBTITLE', { coin: coin.toUpperCase() })}</div>
        </div>
        <div className="sms-verdict" style={{ color: cfg.color, background: withAlpha(cfg.color, '14') }}>
          {result.score >= 0 ? '+' : ''}{result.score}
        </div>
      </div>

      {macroCol && (
        <div style={{
          margin: '0 14px 10px', fontSize: 'var(--fs-caption)', fontWeight: 600, lineHeight: 1.5,
          color: macroCol, padding: '8px 10px', borderRadius: 8,
          background: withAlpha(macroCol, '14'), border: `0.5px solid ${withAlpha(macroCol, '44')}`,
        }}>
          {macro.reasons.map((r, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Warn /> {r}</div>)}
        </div>
      )}

      <div style={{
        margin: '0 14px 12px', fontSize: 'var(--fs-caption)', fontWeight: 700, color: cfg.color,
        padding: '6px 10px', borderRadius: 8, textAlign: 'center',
        background: withAlpha(cfg.color, '10'), border: `0.5px solid ${withAlpha(cfg.color, '33')}`,
        letterSpacing: '.03em',
      }}>
        {t(cfg.labelKey)}
      </div>

      <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {factors.map((f, i) => {
          const isPenalty = f.kind === 'penalty';
          const active = isPenalty ? f.active : f.dir !== 'neutral';
          const col = isPenalty ? (f.active ? '#fbbf24' : 'var(--txt3)')
            : f.dir === 'bull' ? '#34d399' : f.dir === 'bear' ? '#f87171' : 'var(--txt3)';
          const valueText = isPenalty
            ? (f.active ? t('CONFLUENCE_SCORE_PENALTY_ACTIVE', { weight: f.weight }) : t('CONFLUENCE_SCORE_PENALTY_CLEAR'))
            : (f.dir === 'neutral' ? '-' : `${f.dir === 'bull' ? '▲' : '▼'} ${f.weight}`);
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              fontSize: 'var(--fs-caption)', padding: '4px 8px', borderRadius: 6,
              background: active ? withAlpha(col, '0c') : 'transparent',
            }}>
              <span style={{ color: 'var(--txt2)' }}>{f.label}</span>
              <span style={{ color: col, fontWeight: 700 }}>{valueText}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
