'use client';
import { useLabels } from '@/lib/labels';
import { STRATEGIES, findStrategy } from '@/lib/strategies';
import type { StrategySignalState } from '@/lib/useStrategySignal';
import { priceText } from '@/lib/numberFormat';

/* THE ARENA STRATEGY CARD (owner-requested, 2026-11-14): pick one rule set, see its verdict on the closed candles of the chart's coin and timeframe, with the reason in
 * plain words. Always carries "Signals, not predictions". A failed read says so; it is never drawn as WAIT (unknown is not neutral). */

interface Props {
  selected: string | null;
  onSelect: (id: string | null) => void;
  state: StrategySignalState;
  /** The settings read is not 'ready' yet: the saved choice is unknown, so a click must not persist over it. */
  disabled?: boolean;
}

export default function ArenaStrategyCard({ selected, onSelect, state, disabled }: Props) {
  const { t } = useLabels();
  const def = findStrategy(selected);
  const r = state.result;
  const verdict = r?.verdict ?? null;
  const colour = verdict === 'buy' ? 'var(--green)' : verdict === 'sell' ? 'var(--red)' : 'var(--txt2)';
  const priceParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(r?.params ?? {})) if (typeof v === 'number') priceParams[k] = priceText(v);
  let reason = '';
  if (def && r) {
    const alt = r.verdict === 'wait' ? null : def.reasonKeyFor?.(r) ?? null;
    if (alt) reason = t(alt, { ...priceParams, tag: String(r.params.tag ?? '') });
    else if (r.verdict === 'buy') reason = t(def.reasonBuyKey, priceParams);
    else if (r.verdict === 'sell') reason = t(def.reasonSellKey, priceParams);
    else reason = t(def.reasonWaitKey);
  }
  return (
    <section data-testid="arena-strategy-card" aria-label={t('STRAT_CARD_TITLE')} style={{ border: '0.5px solid var(--bdr)', borderRadius: 8, padding: 12, marginTop: 12, background: 'var(--bg2)' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)' }}>{t('STRAT_CARD_TITLE')}</span>
        <select
          data-testid="arena-strategy-select"
          value={selected ?? ''}
          disabled={disabled}
          onChange={e => onSelect(e.target.value || null)}
          style={{ minHeight: 32, flex: '1 1 160px', minWidth: 0 }}
        >
          <option value="">{t('STRAT_NONE')}</option>
          {STRATEGIES.map(s => <option key={s.id} value={s.id}>{t(s.nameKey)}</option>)}
        </select>
      </label>
      {def && (
        <div style={{ marginTop: 10 }} aria-live="polite">
          <p style={{ margin: '0 0 8px', fontSize: 'var(--fs-caption)', color: 'var(--txt2)' }}>{t(def.descKey)}</p>
          {state.error ? (
            <div data-testid="arena-strategy-error" style={{ color: 'var(--amber)' }}>{t('STRAT_UNAVAILABLE')}</div>
          ) : !r ? (
            <div style={{ color: 'var(--txt2)' }}>{t('STRAT_LOADING')}</div>
          ) : (
            <>
              <div data-testid="arena-strategy-verdict" data-verdict={r.verdict} style={{ fontWeight: 700, color: colour }}>
                {t(r.verdict === 'buy' ? 'STRAT_VERDICT_BUY' : r.verdict === 'sell' ? 'STRAT_VERDICT_SELL' : 'STRAT_VERDICT_WAIT')}
              </div>
              <p style={{ margin: '4px 0 0' }}>{reason}</p>
              {r.verdict !== 'wait' && typeof r.params.inv === 'number' && (
                <p style={{ margin: '4px 0 0', fontSize: 'var(--fs-caption)', color: 'var(--txt2)' }}>{t('STRAT_INVALIDATION', { price: priceText(r.params.inv) })}</p>
              )}
              {r.verdict !== 'wait' && r.params.liq === true && (
                <p style={{ margin: '4px 0 0', fontSize: 'var(--fs-caption)', color: 'var(--txt2)' }}>{t('STRAT_LIQ_NOTE')}</p>
              )}
            </>
          )}
        </div>
      )}
      <p style={{ margin: '10px 0 0', fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('STRAT_NOT_PREDICTIONS')}</p>
    </section>
  );
}
