'use client';
import { useMemo, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  useMarket, fmtPrice, computeCoinHealth, classifyFunding, COIN_DEC, FUNDING_TIP_KEY,
} from '@/lib/marketStore';
import type { CoinId } from '@/lib/marketStore';
import { COINS } from '@/lib/coins';
import { computeMarketRead } from '@/lib/marketRead';
import { coinBadgeColor } from '@/lib/coinBadge';
import CoinIcon from '@/components/CoinIcon';
import { useLabels } from '@/lib/labels';
import EconCalendarWidget from '@/components/EconCalendarWidget';
import SOTD from '@/components/SOTD';
import type { LabelKey } from '@/lib/labelKeys';

/* Dashboard in the Monochrome Terminal direction.
 *
 * SPEC:  design-handoff-dir/design_handoff_liquidityhq_terminal/README.md#2A
 * FRAME: Monochrome Terminal.dc.html · frame 2A (desktop 1440, mobile 390)
 *
 * CSS:   app/globals.css — [data-design="terminal"] .dk-* selector prefix.
 *        No inline styles from the prototype. Token layer only.
 *        IBM Plex Mono for numbers/labels, IBM Plex Sans for prose. Radius 0.
 *        Colour only where a signal fires.
 */

const DASH = '—';
const TABLE_COINS = 8;

interface MacroCache {
  dxy: number; dxyChg: number;
  tnx: number; tnxChg: number;
  gold: number; goldChg: number;
}

function useMacroCache(): MacroCache | null {
  const [data, setData] = useState<MacroCache | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('lhq_macro_context');
      if (raw) {
        const { ts, data: d } = JSON.parse(raw) as { ts: number; data: MacroCache };
        if (Date.now() - ts < 2 * 60 * 60 * 1000) setData(d);
      }
    } catch { /* ignore */ }
  }, []);
  return data;
}

function useVolLabel(): string | null {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('lhq_vol_regime');
      if (raw) {
        const parsed = JSON.parse(raw) as { ts: number; data?: { btc?: { label?: string } } };
        if (Date.now() - parsed.ts < 4 * 60 * 60 * 1000 && parsed.data?.btc?.label) {
          setLabel(parsed.data.btc.label);
        }
      }
    } catch { /* ignore */ }
  }, []);
  return label;
}

function chgColor(chg: number | null, invert = false): string {
  if (chg == null || Math.abs(chg) < 0.05) return 'var(--txt3)';
  const pos = invert ? chg < 0 : chg > 0;
  return pos ? 'var(--green)' : 'var(--red)';
}
function chgStr(chg: number | null): string {
  if (chg == null) return DASH;
  return (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
}
function fmtNum(n: number | null, dp = 2): string {
  if (n == null) return DASH;
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/* Colour bands for scalar signals */
function fngColor(fng: number | null): string {
  if (fng == null) return 'var(--txt3)';
  if (fng <= 25) return 'var(--red)';
  if (fng <= 45) return 'var(--red-soft)';
  if (fng <= 55) return 'var(--txt2)';
  if (fng <= 75) return 'var(--green-soft)';
  return 'var(--green)';
}
function altColor(alt: number | null): string {
  if (alt == null) return 'var(--txt3)';
  if (alt >= 75) return 'var(--green)';
  if (alt >= 50) return 'var(--green-soft)';
  if (alt >= 25) return 'var(--red-soft)';
  return 'var(--red)';
}
function domColor(dom: number | null): string {
  if (dom == null) return 'var(--txt3)';
  if (dom >= 60) return 'var(--txt2)';
  if (dom >= 48) return 'var(--txt)';
  return 'var(--green)';
}

/* Coin signal — priority ordered, same logic as CoinSidebar */
function coinSignal(
  d: ReturnType<typeof useMarket>['store']['coins'][CoinId],
  t: (k: LabelKey, vars?: Record<string, string | number>) => string,
): { text: string; col: string } | null {
  if (!d) return null;
  const fr = d.fundingRate != null ? d.fundingRate * 100 : null;
  if (fr != null && fr >= 0.04)  return { text: t('DASH_SIDEBAR_SIG_LONGS_OVERCROWDED'), col: 'var(--red)' };
  if (fr != null && fr <= -0.02) return { text: t('DASH_SIDEBAR_SIG_SHORTS_SQUEEZED'),   col: 'var(--green)' };
  if (d.cvdDivergence === 'bullish') return { text: t('DASH_SIDEBAR_SIG_SMART_BUYERS'),  col: 'var(--green)' };
  if (d.cvdDivergence === 'bearish') return { text: t('DASH_SIDEBAR_SIG_SMART_SELLERS'), col: 'var(--red)' };
  if (d.oiTrend === 'strong_up')     return { text: t('DASH_SIDEBAR_SIG_NEW_BUYERS'),    col: 'var(--green)' };
  if (d.oiTrend === 'strong_down')   return { text: t('DASH_SIDEBAR_SIG_NEW_SELLERS'),   col: 'var(--red)' };
  if (d.chartPattern) {
    const isBull = /bull|higher high|engulf.*bull|hammer(?! man)|double bot/i.test(d.chartPattern);
    const isBear = /bear|lower high|engulf.*bear|shooting|double top/i.test(d.chartPattern);
    const label  = d.chartPattern.split(';')[0].split('(')[0].trim();
    if (isBull && label) return { text: label, col: 'var(--green)' };
    if (isBear && label) return { text: label, col: 'var(--red)' };
    if (label)           return { text: label, col: 'var(--txt3)' };
  }
  if (d.oiTrend === 'weak_up')   return { text: t('DASH_SIDEBAR_SIG_SHORTS_CLOSING'), col: 'var(--amber)' };
  if (d.oiTrend === 'weak_down') return { text: t('DASH_SIDEBAR_SIG_BUYERS_PROFIT'),  col: 'var(--txt3)' };
  return null;
}

/* One row of the coins table */
function CoinRow({ id }: { id: CoinId }) {
  const { store, selectCoin } = useMarket();
  const { t } = useLabels();
  const d   = store.coins[id];
  const dec = COIN_DEC[id];
  const chg = d?.change ?? 0;
  const up  = chg >= 0;
  const tbp    = d?.takerBuyRatio != null ? Math.round(d.takerBuyRatio * 100) : 50;
  const health = computeCoinHealth(d);
  const sig    = coinSignal(d, t);
  const fr     = d?.fundingRate != null ? d.fundingRate * 100 : null;
  const frInfo = fr != null ? classifyFunding(fr) : null;
  const badgeCol = coinBadgeColor(id);
  const sel    = store.selectedCoin === id;

  const barFill = tbp >= 60 ? 'var(--green)' : tbp <= 40 ? 'var(--red)' : 'var(--txt4)';
  const oiLabel = d?.oiTrend === 'strong_up'   ? '▲▲'
                : d?.oiTrend === 'strong_down'  ? '▼▼'
                : d?.oiTrend === 'weak_up'      ? '▲'
                : d?.oiTrend === 'weak_down'    ? '▼'
                : DASH;
  const oiCol   = d?.oiTrend === 'strong_up'   ? 'var(--green)'
                : d?.oiTrend === 'strong_down'  ? 'var(--red)'
                : d?.oiTrend === 'weak_up'      ? 'var(--green-soft)'
                : d?.oiTrend === 'weak_down'    ? 'var(--red-soft)'
                : 'var(--txt4)';
  const frCol   = fr == null ? 'var(--txt3)'
                : fr >= 0.04  ? 'var(--red)'
                : fr <= -0.02 ? 'var(--green)'
                : Math.abs(fr) < 0.005 ? 'var(--txt3)'
                : fr > 0 ? 'var(--txt2)' : 'var(--txt2)';

  return (
    <tr className={`dk-tr${sel ? ' dk-tr-sel' : ''}`} onClick={() => selectCoin(id)}>
      <td className="dk-td dk-td-coin">
        <CoinIcon coin={id} size={14} color={badgeCol} bg="transparent" />
        <span className="dk-coin-ticker">{id.toUpperCase()}</span>
      </td>
      <td className="dk-td dk-td-num">
        {d?.price ? '$' + fmtPrice(d.price, dec) : DASH}
      </td>
      <td className="dk-td dk-td-num" style={{ color: up ? 'var(--green)' : 'var(--red)' }}>
        {up ? '+' : ''}{chg.toFixed(2)}%
      </td>
      <td className="dk-td dk-td-num" style={{ color: frCol }}>
        {fr != null ? (fr >= 0 ? '+' : '') + fr.toFixed(4) + '%' : DASH}
      </td>
      <td className="dk-td dk-td-num" style={{ color: oiCol }}>
        {oiLabel}
      </td>
      <td className="dk-td dk-td-bar">
        <div className="dk-bar-track">
          <div className="dk-bar-fill" style={{ width: tbp + '%', background: barFill }} />
        </div>
      </td>
      <td className="dk-td dk-td-sig" style={{ color: sig?.col ?? 'var(--txt4)' }}>
        {sig?.text ?? DASH}
      </td>
      <td className="dk-td dk-td-grade" style={{ color: health.color }}>
        {health.grade}
      </td>
    </tr>
  );
}

/* Macro backdrop — 5 rows from localStorage cache + market store */
function MacroBackdrop() {
  const { store } = useMarket();
  const macro = useMacroCache();

  const rows: { label: string; value: string; chg: string; col: string }[] = [
    {
      label: 'DXY',
      value: macro ? macro.dxy.toFixed(2)  : DASH,
      chg:   chgStr(macro?.dxyChg ?? null),
      col:   chgColor(macro?.dxyChg ?? null, true),
    },
    {
      label: 'US 10Y',
      value: macro ? macro.tnx.toFixed(2) + '%' : DASH,
      chg:   chgStr(macro?.tnxChg ?? null),
      col:   chgColor(macro?.tnxChg ?? null, true),
    },
    {
      label: 'S&P 500',
      value: store.spx != null ? store.spx.toLocaleString('en-US', { maximumFractionDigits: 0 }) : DASH,
      chg:   chgStr(store.spxChg),
      col:   chgColor(store.spxChg),
    },
    {
      label: 'GOLD',
      value: macro ? '$' + macro.gold.toLocaleString('en-US', { maximumFractionDigits: 0 }) : DASH,
      chg:   chgStr(macro?.goldChg ?? null),
      col:   chgColor(macro?.goldChg ?? null),
    },
    {
      label: 'ETF FLOW',
      value: store.etfNetFlow != null
        ? (store.etfNetFlow >= 0 ? '+' : '') + '$' + Math.abs(store.etfNetFlow).toFixed(0) + 'M'
        : DASH,
      chg:   '',
      col:   store.etfNetFlow == null ? 'var(--txt3)'
           : store.etfNetFlow > 50  ? 'var(--green)'
           : store.etfNetFlow < -50 ? 'var(--red)'
           : 'var(--txt2)',
    },
  ];

  return (
    <div className="dk-macro-rows">
      {rows.map(row => (
        <div key={row.label} className="dk-macro-row">
          <span className="dk-macro-label">{row.label}</span>
          <span className="dk-macro-value" style={{ color: row.col }}>{row.value}</span>
          {row.chg && <span className="dk-macro-chg" style={{ color: row.col }}>{row.chg}</span>}
        </div>
      ))}
    </div>
  );
}

/* Main export */
export default function DeskTerminal() {
  const { store } = useMarket();
  const { t } = useLabels();
  const volLabel = useVolLabel();

  const selectedCoinData = store.coins[store.selectedCoin];
  const read = useMemo(
    () => computeMarketRead(store, null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.fng, store.selectedCoin, store.cbPremiumPct, store.btcExchangeNetFlow, selectedCoinData],
  );

  /* Pulse cells */
  const dom = store.btcDom;
  const alt = store.altSeasonScore;
  const fng = store.fng;
  const volCol = volLabel === 'Low Vol' ? 'var(--green)'
               : volLabel === 'High Vol' ? 'var(--red)'
               : 'var(--txt2)';

  const coins = (COINS as CoinId[]).slice(0, TABLE_COINS);

  return (
    <div className="dk-root">

      {/* ── Band ── */}
      <div className="dk-band">
        <div className="dk-band-verdict">
          <div className="dk-verdict-label" data-band={read.band}>{read.verdict}</div>
          <p className="dk-verdict-sub">{read.sub}</p>
        </div>

        <div className="dk-pulse">
          <div className="dk-pulse-cell">
            <span className="dk-pulse-label">BTC DOM</span>
            <span className="dk-pulse-value" style={{ color: domColor(dom) }}>
              {dom != null ? dom.toFixed(1) + '%' : DASH}
            </span>
          </div>
          <div className="dk-pulse-cell">
            <span className="dk-pulse-label">ALTSEASON</span>
            <span className="dk-pulse-value" style={{ color: altColor(alt) }}>
              {alt != null ? String(alt) : DASH}
            </span>
          </div>
          <div className="dk-pulse-cell">
            <span className="dk-pulse-label">VOLATILITY</span>
            <span className="dk-pulse-value" style={{ color: volCol }}>
              {volLabel ? volLabel.replace(' Vol', '').toUpperCase() : DASH}
            </span>
          </div>
          <div className="dk-pulse-cell">
            <span className="dk-pulse-label">FEAR / GREED</span>
            <span className="dk-pulse-value" style={{ color: fngColor(fng) }}>
              {fng != null ? String(fng) : DASH}
            </span>
            {store.fngLabel && (
              <span className="dk-pulse-sub">{store.fngLabel}</span>
            )}
          </div>
        </div>

        <Link href="/arena" className="dk-arena-btn">OPEN ARENA</Link>
      </div>

      {/* ── Body ── */}
      <div className="dk-body">

        {/* LEFT: coins table */}
        <div className="dk-table-wrap">
          <table className="dk-table">
            <thead>
              <tr>
                <th className="dk-th">COIN</th>
                <th className="dk-th dk-th-num">PRICE</th>
                <th className="dk-th dk-th-num">24H</th>
                <th className="dk-th dk-th-num">FUNDING</th>
                <th className="dk-th dk-th-num">OI 1H</th>
                <th className="dk-th">TAKER</th>
                <th className="dk-th">SIGNAL</th>
                <th className="dk-th dk-th-num">GRADE</th>
              </tr>
            </thead>
            <tbody>
              {coins.map(id => <CoinRow key={id} id={id} />)}
            </tbody>
          </table>
          <Link href="/markets" className="dk-all-markets">
            ALL MARKETS →
          </Link>
        </div>

        {/* RIGHT: rail */}
        <aside className="dk-rail">

          {/* SOTD */}
          <section className="dk-rail-sec">
            <div className="dk-rail-head">BEST SETUP TODAY</div>
            <SOTD />
          </section>

          {/* Macro backdrop */}
          <section className="dk-rail-sec">
            <div className="dk-rail-head">MACRO BACKDROP</div>
            <MacroBackdrop />
          </section>

          {/* Next events */}
          <section className="dk-rail-sec">
            <div className="dk-rail-head">NEXT EVENTS</div>
            <EconCalendarWidget />
          </section>

        </aside>
      </div>

    </div>
  );
}
