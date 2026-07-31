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
import { computeSectorRotation, isAlt } from '@/lib/sectorRotation';
import type { PASignal } from '@/lib/priceAction';

const VERDICT_CONFIG: Record<string, { labelKey: LabelKey; color: string }> = {
  STRONG_BULL:  { labelKey: 'CONFLUENCE_SCORE_VERDICT_STRONG_BULL',  color: '#34d399' },
  LEANING_BULL: { labelKey: 'CONFLUENCE_SCORE_VERDICT_LEANING_BULL', color: '#86efac' },
  MIXED:        { labelKey: 'CONFLUENCE_SCORE_VERDICT_MIXED',        color: '#6b7280' },
  LEANING_BEAR: { labelKey: 'CONFLUENCE_SCORE_VERDICT_LEANING_BEAR', color: '#fca5a5' },
  STRONG_BEAR:  { labelKey: 'CONFLUENCE_SCORE_VERDICT_STRONG_BEAR',  color: '#f87171' },
};

export default function ConfluenceScore(
  { coin, emaSignal, jpyUsd, structure }:
  { coin: CoinId; emaSignal: StrategySignal; jpyUsd: number | null; structure: PASignal | null },
) {
  const { t } = useLabels();
  const { store } = useMarket();
  const d = store.coins[coin];
  // Reads the calendar NewsProvider already holds instead of fetching it again
  // on a 5-minute timer. Same data, one shared push-fed copy per tab.
  const { econRaw: econEvents } = useNews();

  if (!d?.price) return null;

  // RSI excluded here: the Multi-TF RSI factor below is built from the same
  // three values, so counting them inside order flow too voted the same
  // evidence twice. See scoreBias in StopLossZone.
  const of = scoreBias(d, { includeRsi: false });
  // Computed for alts only - majors get a null direction so the factor below
  // drops out entirely rather than voting neutral on a question that does not
  // apply to them.
  const rotation = isAlt(coin)
    ? computeSectorRotation(store, coin)
    : { line: '-', direction: null as null };

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
    // Sector rotation - ALTS ONLY, and only when there is data to judge it by.
    //
    // Alts are a money-flow game: capital rotating into BTC drains the alt
    // complex regardless of how clean an individual alt's technicals look, and
    // that headwind bites hardest in a bear market. So it votes directionally -
    // bull when capital is moving into alts, bear when it is moving into BTC.
    //
    // Excluded for BTC and the other majors on purpose: "is capital rotating
    // into alts" is not a meaningful question to ask about BTC itself, and
    // answering it for ETH would mislead, since ETH leads the alt complex
    // rather than following it. Same reasoning that keeps GEX BTC-only above.
    //
    // Weight 20 matches Multi-TF RSI - a real input, deliberately below the
    // coin's own trend (EMA 30) and order flow (25), because rotation shapes
    // the odds on a setup rather than being the setup.
    //
    // Omitted entirely when direction is null. A directional factor still adds
    // to the denominator even when it votes neutral, so emitting one on missing
    // data would quietly dilute every other signal to say nothing.
    ...(rotation.direction
      ? [{
          kind: 'directional' as const,
          label: t('CONFLUENCE_SCORE_FACTOR_SECTOR_ROTATION'),
          dir: (rotation.direction === 'to_alts' ? 'bull'
              : rotation.direction === 'to_btc' ? 'bear'
              : 'neutral') as 'bull' | 'bear' | 'neutral',
          weight: 20,
        }]
      : []),
    // Market structure - the only factor here read from price alone, and the
    // reason it is worth having: every other directional input above is derived
    // from the EMA ribbon or from derivatives positioning, so before this the
    // "confluence" could agree with itself while price was breaking the other
    // way. BOS and CHoCH vote the same direction; they differ in what they mean
    // (continuation vs a first hint of a turn), not in which way price broke.
    //
    // Weight 20, matching sector rotation and Multi-TF RSI - a real independent
    // vote, deliberately under the coin's own trend (EMA 30) and order flow
    // (25). A single swing break is evidence, not a thesis.
    //
    // Volume-backed breaks only. lib/priceAction flags a break as backed when
    // the breaking candle traded >=1.2x its trailing 20-bar average; a break on
    // thin volume is exactly the kind that gets retraced, and counting it the
    // same would put noise on equal footing with participation. Unbacked breaks
    // still draw on the chart - they are shown, just not voted on.
    //
    // Omitted entirely (not voted neutral) when there is no qualifying break: a
    // directional factor adds to the denominator even when neutral, so emitting
    // one on absent data would dilute every other signal to say nothing. Same
    // reasoning as sector rotation above.
    ...(structure?.volumeBacked
      ? [{
          kind: 'directional' as const,
          label: t('CONFLUENCE_SCORE_FACTOR_STRUCTURE'),
          dir: (structure.dir === 'bull' ? 'bull' : 'bear') as 'bull' | 'bear' | 'neutral',
          weight: 20,
        }]
      : []),
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
