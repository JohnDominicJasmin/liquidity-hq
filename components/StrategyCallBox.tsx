'use client';
import { useState } from 'react';
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
  /* The description is ONE line with an ellipsis; the toggle opens it in place (owner, 2026-11-15: the box took too much room). Opened text is the user's own action, so it is not part of the reserve. */
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === def.id;
  const r = state.result;
  const colour = r?.verdict === 'buy' ? 'var(--green)' : r?.verdict === 'sell' ? 'var(--red)' : 'var(--txt2)';
  const priceParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(r?.params ?? {})) if (typeof v === 'number') priceParams[k] = k === 'tag' || k.startsWith('count') ? String(v) : priceText(v);
  /* ON WAIT THE CALL BLOCK WOULD BE MOSTLY EMPTY (its height is reserved for the tallest call), so it lists the levels the strategy is watching, as text, from the same overlay data the chart draws: only 'watch' and 'confirm' levels (the wrong-if level is a BUY/SELL concern), lowest price first, at most four. Nothing is invented: no levels, no line. */
  const watched = r && r.verdict === 'wait' ? (r.overlay?.levels ?? []).filter(l => l.role === 'watch' || l.role === 'confirm').sort((a, b) => a.price - b.price).slice(0, 4) : [];
  let reason = '';
  if (r) {
    const alt = def.reasonKeyFor?.(r) ?? null;
    if (alt) reason = t(alt, { ...priceParams, tag: String(r.params.tag ?? '') });
    else if (r.verdict === 'buy') reason = t(def.reasonBuyKey, priceParams);
    else if (r.verdict === 'sell') reason = t(def.reasonSellKey, priceParams);
    else reason = t(def.reasonWaitKey);
  }
  /* FLAT, ANSWER FIRST (owner, 2026-11-15, PM distill pass): no card inside the panel's card and no name heading (the dropdown above already shows it). Order: the call (verdict, reason, invalidation) in the
     reserved .strat-call-dyn block, then the one-line description with its Expand / Collapse link, then "Signals, not predictions" directly after it. Spare reserved height falls at the bottom of the call block. */
  return (
    <div data-testid="strategy-call-box" data-strategy={def.id} aria-live="polite" className="strat-call-box" style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="strat-call-dyn" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {state.unsupportedTf ? (
        <div data-testid="strategy-call-tf-unavailable" style={{ color: 'var(--txt2)', fontSize: 'var(--fs-caption)' }}>{t('STRAT_TF_UNAVAILABLE')}</div>
      ) : state.error ? (
        <>
          <div data-testid="strategy-call-unavailable" style={{ color: 'var(--amber)', fontSize: 'var(--fs-label)', fontWeight: 600 }}>{t('STRAT_UNAVAILABLE')}</div>
          <p data-testid="strategy-call-unavailable-detail" style={{ margin: 0, fontSize: 'var(--fs-caption)', color: 'var(--txt2)' }}>{t('STRAT_UNAVAILABLE_DETAIL')}</p>
          {state.retry && (
            <button type="button" data-testid="strategy-call-retry" onClick={state.retry} style={{ alignSelf: 'flex-start', minHeight: 32, padding: '0 14px', border: '0.5px solid var(--bdr)', borderRadius: 8, background: 'transparent', color: 'var(--txt)', fontSize: 'var(--fs-caption)', fontWeight: 600, cursor: 'pointer' }}>{t('SETTINGS_SAVE_RETRY_BUTTON')}</button>
          )}
        </>
      ) : !r ? (
        <>
          {/* Static placeholder bars in the shape of a call (no shimmer): they fill the reserved height while the read loads. */}
          <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ width: 46, height: 12, borderRadius: 3, background: 'var(--bg3)' }} />
            <div style={{ width: '100%', height: 11, borderRadius: 3, background: 'var(--bg3)' }} />
            <div style={{ width: '74%', height: 11, borderRadius: 3, background: 'var(--bg3)' }} />
          </div>
          <div data-testid="strategy-call-loading" style={{ color: 'var(--txt2)', fontSize: 'var(--fs-caption)' }}>{t('STRAT_LOADING')}</div>
        </>
      ) : (
        <>
          <div data-testid="strategy-call-verdict" data-verdict={r.verdict} style={{ fontSize: 'var(--fs-label)', fontWeight: 700, letterSpacing: '0.04em', color: colour }}>
            {t(r.verdict === 'buy' ? 'STRAT_VERDICT_BUY' : r.verdict === 'sell' ? 'STRAT_VERDICT_SELL' : 'STRAT_VERDICT_WAIT')}
          </div>
          <p data-testid="strategy-call-reason" className={open ? undefined : 'strat-call-reason-clamp'} style={{ margin: 0, fontSize: 'var(--fs-label)', color: 'var(--txt)', lineHeight: 1.4 }}>{reason}</p>
          {/* THE REST OF THE CALL (levels watched, invalidation, liquidity note) shows when the chevron opens the box: the closed call is the verdict plus three lines, a fixed height. */}
          {open && watched.length > 0 && (
            <p data-testid="strategy-call-watching" style={{ margin: 0, fontSize: 'var(--fs-caption)', color: 'var(--txt2)', lineHeight: 1.5 }}>
              <span style={{ fontWeight: 600 }}>{t('STRAT_WATCHING')}: </span>
              {watched.map(l => `${t(l.labelKey, l.labelParams)} ${priceText(l.price)}`).join(' · ')}
            </p>
          )}
          {open && r.verdict !== 'wait' && typeof r.params.inv === 'number' && (
            <p data-testid="strategy-call-invalidation" style={{ margin: 0, fontSize: 'var(--fs-caption)', color: 'var(--txt2)' }}>{t('STRAT_INVALIDATION', { price: priceText(r.params.inv) })}</p>
          )}
          {open && r.verdict !== 'wait' && r.params.liq === true && (
            <p style={{ margin: 0, fontSize: 'var(--fs-caption)', color: 'var(--txt2)' }}>{t('STRAT_LIQ_NOTE')}</p>
          )}
        </>
      )}
      </div>
      <div style={{ display: 'flex', alignItems: open ? 'flex-start' : 'center', gap: 8 }}>
        <p data-testid="strategy-call-desc" style={{ margin: 0, fontSize: 'var(--fs-caption)', color: 'var(--txt3)', flex: '1 1 auto', minWidth: 0, ...(open ? {} : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }) }}>{t(def.descKey)}</p>
        {/* An ICON, not text (owner, 2026-11-15): inline SVG chevron (a glyph renders differently in ko/zh fonts), 28 px hit area pulled back with a negative margin so the row keeps its height. */}
        <button type="button" className="strat-desc-toggle" data-testid="strategy-call-desc-toggle" aria-expanded={open} aria-label={open ? t('CHAT_COLLAPSE') : t('CHAT_EXPAND')} title={open ? t('CHAT_COLLAPSE') : t('CHAT_EXPAND')} onClick={() => setOpenFor(open ? null : def.id)}>
          <svg className="strat-desc-chevron" data-open={open ? 'true' : 'false'} width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 5l4 4 4-4" /></svg>
        </button>
      </div>
      <p data-testid="strategy-call-note" style={{ margin: 0, fontSize: 'var(--fs-caption)', color: 'var(--txt3)', lineHeight: 1.35 }}>{t('STRAT_NOT_PREDICTIONS')}</p>
    </div>
  );
}
