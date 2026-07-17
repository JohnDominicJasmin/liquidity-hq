'use client';
import { useEffect, useState } from 'react';
import { useMarket } from '@/lib/marketStore';
import type { CoinId } from '@/lib/marketStore';
import { Warn } from '@/components/icons';
import type { StrategySignal } from '@/lib/useEMAStrategy';
import { scoreBias } from './StopLossZone';
import {
  computeConfluence, orderFlowFactor, multiTfRsiFactor, computeMacroRisk,
  type ConfluenceFactorInput, type CalEvent,
} from '@/lib/confluence';
import Tip from './Tip';

const VERDICT_CONFIG: Record<string, { label: string; color: string }> = {
  STRONG_BULL:  { label: 'STRONG BULL CONFLUENCE',  color: '#34d399' },
  LEANING_BULL: { label: 'LEANING BULL',              color: '#86efac' },
  MIXED:        { label: 'MIXED / NO EDGE',            color: '#6b7280' },
  LEANING_BEAR: { label: 'LEANING BEAR',              color: '#fca5a5' },
  STRONG_BEAR:  { label: 'STRONG BEAR CONFLUENCE',  color: '#f87171' },
};

const ECON_REFRESH_MS = 5 * 60_000;

export default function ConfluenceScore({ coin, emaSignal, jpyUsd }: { coin: CoinId; emaSignal: StrategySignal; jpyUsd: number | null }) {
  const { store } = useMarket();
  const d = store.coins[coin];
  const [econEvents, setEconEvents] = useState<CalEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch('/api/econ-calendar');
        if (!r.ok) return;
        const j = await r.json() as { events?: CalEvent[] };
        if (!cancelled) setEconEvents(j.events ?? []);
      } catch { /* silent - macro overlay is best-effort */ }
    }
    load();
    const id = setInterval(load, ECON_REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!d?.price) return null;

  const of = scoreBias(d);

  const factors: ConfluenceFactorInput[] = [
    {
      kind: 'directional',
      label: 'EMA Ribbon Strategy',
      dir: (emaSignal.verdict === 'LONG_SETUP' || emaSignal.verdict === 'TRENDING_LONG') ? 'bull'
         : (emaSignal.verdict === 'SHORT_SETUP' || emaSignal.verdict === 'TRENDING_SHORT') ? 'bear' : 'neutral',
      weight: 30,
    },
    orderFlowFactor(of.bias),
    multiTfRsiFactor(d.rsi14, d.rsi1h, d.rsi4h),
    {
      kind: 'penalty',
      label: 'Choppiness Index',
      weight: 15, active: emaSignal.chopRegime === 'choppy',
    },
    {
      kind: 'penalty',
      label: 'RSI Divergence Warning',
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
            <Tip text="Weighted blend of the EMA Ribbon verdict, the 9-signal Order Flow bias, and 15m/1h/4h RSI alignment. Choppiness and an active RSI-divergence warning reduce confidence without flipping direction. Macro/event risk is shown separately below - it's not blended into this number since an FOMC print doesn't change the technicals, only the risk of holding through it.">
              Confluence Score
            </Tip>
          </div>
          <div className="sms-sub">{coin.toUpperCase()} · technical signals combined</div>
        </div>
        <div className="sms-verdict" style={{ color: cfg.color, background: cfg.color + '14' }}>
          {result.score >= 0 ? '+' : ''}{result.score}
        </div>
      </div>

      {macroCol && (
        <div style={{
          margin: '0 14px 10px', fontSize: 'var(--fs-caption)', fontWeight: 600, lineHeight: 1.5,
          color: macroCol, padding: '8px 10px', borderRadius: 8,
          background: macroCol + '14', border: `0.5px solid ${macroCol}44`,
        }}>
          {macro.reasons.map((r, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Warn /> {r}</div>)}
        </div>
      )}

      <div style={{
        margin: '0 14px 12px', fontSize: 'var(--fs-caption)', fontWeight: 700, color: cfg.color,
        padding: '6px 10px', borderRadius: 8, textAlign: 'center',
        background: cfg.color + '10', border: `0.5px solid ${cfg.color}33`,
        letterSpacing: '.03em',
      }}>
        {cfg.label}
      </div>

      <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {factors.map((f, i) => {
          const isPenalty = f.kind === 'penalty';
          const active = isPenalty ? f.active : f.dir !== 'neutral';
          const col = isPenalty ? (f.active ? '#fbbf24' : 'var(--txt3)')
            : f.dir === 'bull' ? '#34d399' : f.dir === 'bear' ? '#f87171' : 'var(--txt3)';
          const valueText = isPenalty
            ? (f.active ? `−${f.weight} confidence` : 'clear')
            : (f.dir === 'neutral' ? '-' : `${f.dir === 'bull' ? '▲' : '▼'} ${f.weight}`);
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              fontSize: 'var(--fs-caption)', padding: '4px 8px', borderRadius: 6,
              background: active ? col + '0c' : 'transparent',
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
