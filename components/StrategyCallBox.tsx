'use client';
import { useLabels } from '@/lib/labels';
import type { StrategyDef } from '@/lib/strategies';
import type { StrategySignalState } from '@/lib/useStrategySignal';
import { priceText } from '@/lib/numberFormat';

/* THE STRATEGY CALL BOX (owner decision 2026-11-14, option A: ONE strategy menu). The picked strategy's call sits DIRECTLY UNDER the "Strategy set" dropdown, inside the Strategy
 * panel: its name, a one-line description, BUY / SELL / WAIT with the reason in plain words, the invalidation line where the strategy has one, and "Signals, not predictions". A failed read
 * says so (never drawn as WAIT: unknown is not neutral); loading has its own line.
 *
 * THE CALL'S HEIGHT IS RESERVED, per part (QA measured the first version: one 208 px reserve for the whole box was shorter than every strategy's box, 274 to 370 px, so the call
 * arriving still pushed the panels beneath it by 66 to 162 px). The name and the description are STATIC for a picked strategy (known the moment it is picked), so they need no reserve; the part
 * that changes is the call itself (loading -> BUY / SELL / WAIT with the reason, the invalidation line and the liquidity note), and THAT part sits in `.strat-call-dyn`, which keeps the
 * height of the tallest call (globals.css). Loading, unavailable and every verdict therefore occupy the same height, and the call arriving or changing moves nothing below it. */
interface Props {
  def: StrategyDef;
  state: StrategySignalState;
}

export default function StrategyCallBox({ def, state }: Props) {
  const { t } = useLabels();
  const r = state.result;
  const colour = r?.verdict === 'buy' ? 'var(--green)' : r?.verdict === 'sell' ? 'var(--red)' : 'var(--txt2)';
  const priceParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(r?.params ?? {})) if (typeof v === 'number') priceParams[k] = k === 'tag' || k.startsWith('count') ? String(v) : priceText(v);
  let reason = '';
  if (r) {
    const alt = def.reasonKeyFor?.(r) ?? null;
    if (alt) reason = t(alt, { ...priceParams, tag: String(r.params.tag ?? '') });
    else if (r.verdict === 'buy') reason = t(def.reasonBuyKey, priceParams);
    else if (r.verdict === 'sell') reason = t(def.reasonSellKey, priceParams);
    else reason = t(def.reasonWaitKey);
  }
  return (
    <div
      data-testid="strategy-call-box"
      data-strategy={def.id}
      aria-live="polite"
      style={{ marginTop: 10, padding: '10px 12px', border: '0.5px solid var(--bdr)', borderRadius: 8, background: 'var(--bg2)', display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <div data-testid="strategy-call-name" style={{ fontWeight: 700 }}>{t(def.nameKey)}</div>
      <p data-testid="strategy-call-desc" style={{ margin: 0, fontSize: 'var(--fs-caption)', color: 'var(--txt2)' }}>{t(def.descKey)}</p>
      <div className="strat-call-dyn" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {state.error ? (
        <div data-testid="strategy-call-unavailable" style={{ color: 'var(--amber)' }}>{t('STRAT_UNAVAILABLE')}</div>
      ) : !r ? (
        <div data-testid="strategy-call-loading" style={{ color: 'var(--txt2)' }}>{t('STRAT_LOADING')}</div>
      ) : (
        <>
          <div data-testid="strategy-call-verdict" data-verdict={r.verdict} style={{ fontWeight: 700, color: colour }}>
            {t(r.verdict === 'buy' ? 'STRAT_VERDICT_BUY' : r.verdict === 'sell' ? 'STRAT_VERDICT_SELL' : 'STRAT_VERDICT_WAIT')}
          </div>
          <p data-testid="strategy-call-reason" style={{ margin: 0 }}>{reason}</p>
          {r.verdict !== 'wait' && typeof r.params.inv === 'number' && (
            <p data-testid="strategy-call-invalidation" style={{ margin: 0, fontSize: 'var(--fs-caption)', color: 'var(--txt2)' }}>{t('STRAT_INVALIDATION', { price: priceText(r.params.inv) })}</p>
          )}
          {r.verdict !== 'wait' && r.params.liq === true && (
            <p style={{ margin: 0, fontSize: 'var(--fs-caption)', color: 'var(--txt2)' }}>{t('STRAT_LIQ_NOTE')}</p>
          )}
        </>
      )}
      </div>
      <p data-testid="strategy-call-note" style={{ margin: 0, fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('STRAT_NOT_PREDICTIONS')}</p>
    </div>
  );
}
