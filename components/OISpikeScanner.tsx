'use client';
import { useState, useEffect, useRef } from 'react';
import { useMarket, COINS, CoinId } from '@/lib/marketStore';

/* ── Binance/Bybit OI history endpoints ── */
const BINANCE_OI: Partial<Record<CoinId, string>> = {
  btc: 'BTCUSDT', eth: 'ETHUSDT', sol: 'SOLUSDT',
  xrp: 'XRPUSDT', bnb: 'BNBUSDT', near: 'NEARUSDT', sui: 'SUIUSDT',
};
const BYBIT_OI: Partial<Record<CoinId, string>> = {
  hype: 'HYPEUSDT',
};

/* ── OI trend → display meta ── */
const OI_SIG: Record<string, { txt: string; col: string }> = {
  strong_up:   { txt: 'New LONGS — real trend ▲', col: '#34d399' },
  strong_down: { txt: 'New SHORTS — real dump ▼', col: '#f87171' },
  weak_up:     { txt: 'Short covering — weak pump', col: '#fbbf24' },
  weak_down:   { txt: 'Long exits — no panic',     col: '#94a3b8' },
};

interface OIRow {
  coin: CoinId;
  oiUsd:  number | null;   // current OI in USD
  pct:    number | null;   // % change over last ~1h (13 × 5-min snaps)
}

function fmtOIVal(v: number): string {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
  return '$' + v.toFixed(0);
}

const BAR_MAX_PCT = 15; // 15 % = full half-bar width

export default function OISpikeScanner() {
  const { store } = useMarket();
  const [rows, setRows]         = useState<OIRow[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [fetching, setFetching] = useState(false);

  const mountedRef  = useRef(true);
  const fetchingRef = useRef(false);

  /* keep a price snapshot for Bybit USD conversion (HYPE only) */
  const pricesRef = useRef<Partial<Record<CoinId, number>>>({});
  useEffect(() => {
    COINS.forEach(c => {
      const p = store.coins[c]?.price;
      if (p) pricesRef.current[c] = p;
    });
  }, [store.coins]);

  /* ── fetch loop ── */
  const loadRef = useRef<(() => Promise<void>) | undefined>(undefined);

  useEffect(() => {
    mountedRef.current = true;

    const load = async () => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      setFetching(true);

      const fetched: OIRow[] = await Promise.all(
        COINS.map(async (coin): Promise<OIRow> => {
          try {
            const binSym = BINANCE_OI[coin];
            const bbtSym = BYBIT_OI[coin];

            if (binSym) {
              const r = await fetch(
                `https://fapi.binance.com/futures/data/openInterestHist?symbol=${binSym}&period=5m&limit=13`,
                { cache: 'no-store' }
              );
              if (!r.ok) return { coin, oiUsd: null, pct: null };
              const d = await r.json() as Array<{
                sumOpenInterest: string;
                sumOpenInterestValue: string;
              }>;
              if (d.length < 2) return { coin, oiUsd: null, pct: null };
              const newest = parseFloat(d[d.length - 1].sumOpenInterest);
              const oldest = parseFloat(d[0].sumOpenInterest);
              const oiUsd  = parseFloat(d[d.length - 1].sumOpenInterestValue);
              const pct    = oldest > 0 ? (newest - oldest) / oldest * 100 : null;
              return { coin, oiUsd, pct };

            } else if (bbtSym) {
              const r = await fetch(
                `https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${bbtSym}&intervalTime=5min&limit=13`,
                { cache: 'no-store' }
              );
              if (!r.ok) return { coin, oiUsd: null, pct: null };
              const d = await r.json() as { result?: { list?: Array<{ openInterest: string }> } };
              const list = d.result?.list ?? [];
              if (list.length < 2) return { coin, oiUsd: null, pct: null };
              // Bybit newest-first; openInterest is in USD for USDT perps
              const newest = parseFloat(list[0].openInterest);
              const oldest = parseFloat(list[list.length - 1].openInterest);
              const pct    = oldest > 0 ? (newest - oldest) / oldest * 100 : null;
              return { coin, oiUsd: newest, pct };
            }

            return { coin, oiUsd: null, pct: null };
          } catch {
            return { coin, oiUsd: null, pct: null };
          }
        })
      );

      fetchingRef.current = false;
      if (mountedRef.current) {
        setRows(fetched);
        setUpdatedAt(Date.now());
        setFetching(false);
      }
    };

    loadRef.current = load;
    load();
    const iv  = setInterval(() => loadRef.current?.(), 60_000);
    const onVis = () => { if (!document.hidden) loadRef.current?.(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      mountedRef.current = false;
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── sort: largest absolute spike first ── */
  const sorted = rows.length > 0
    ? [...rows].sort((a, b) => Math.abs(b.pct ?? 0) - Math.abs(a.pct ?? 0))
    : COINS.map(coin => ({ coin, oiUsd: null, pct: null } as OIRow));

  /* ── age display — recomputed at render ── */
  const ageSecs = updatedAt ? Math.floor((Date.now() - updatedAt) / 1000) : null;
  const ageStr  = ageSecs == null ? '' : ageSecs < 10 ? 'just now' : ageSecs < 60 ? `${ageSecs}s ago` : `${Math.floor(ageSecs / 60)}m ago`;

  return (
    <div className="ois-table">
      {/* ── header ── */}
      <div className="ois-title">
        OI Spike Scanner
        <span className="ois-subtitle">
          {fetching ? 'Fetching…' : ageStr ? `Updated ${ageStr}` : 'Open interest 1h change · all 8 coins'}
        </span>
      </div>

      {/* ── column headers ── */}
      <div className="ois-hdr">
        <div>Coin</div>
        <div>OI</div>
        <div>1h Δ</div>
        <div>Signal</div>
      </div>

      {/* ── rows ── */}
      {sorted.map(({ coin, oiUsd, pct }) => {
        const coinData  = store.coins[coin];
        const oiTrend   = coinData?.oiTrend;
        const trendMeta = oiTrend ? OI_SIG[oiTrend] : null;

        /* bar sizing — each side is 50% of track */
        const halfBarPct = pct != null
          ? Math.min(Math.abs(pct) / BAR_MAX_PCT, 1) * 50
          : 0;
        const isPos  = (pct ?? 0) > 0;
        const isNeg  = (pct ?? 0) < 0;
        const isSpike = pct != null && Math.abs(pct) >= 10;

        /* pct color */
        const pctCol = pct == null     ? 'var(--txt3)'
          : isSpike && isPos           ? '#34d399'
          : isSpike && isNeg           ? '#f87171'
          : isPos                      ? '#86efac'
          : isNeg                      ? '#fca5a5'
          : 'var(--txt3)';

        /* signal text + color */
        let sigTxt = '—';
        let sigCol = 'var(--txt3)';
        if (pct != null) {
          if (isSpike) {
            sigTxt = trendMeta
              ? `🔥 ${trendMeta.txt}`
              : (isPos ? '🔥 OI spike — rising' : '🔥 OI spike — unwinding');
            sigCol = trendMeta?.col ?? (isPos ? '#34d399' : '#f87171');
          } else if (trendMeta) {
            sigTxt = trendMeta.txt;
            sigCol = trendMeta.col;
          } else if (Math.abs(pct) < 2) {
            sigTxt = 'Stable'; sigCol = 'var(--txt3)';
          } else {
            sigTxt = isPos ? 'Rising' : 'Unwinding';
            sigCol = isPos ? '#86efac' : '#fca5a5';
          }
        } else {
          sigTxt = '—'; sigCol = 'var(--txt3)';
        }

        return (
          <div key={coin} className="ois-row">
            <div className="ois-coin">{coin.toUpperCase()}</div>
            <div className="ois-oi">{oiUsd != null ? fmtOIVal(oiUsd) : '—'}</div>

            {/* bar + percentage */}
            <div className="ois-change-col">
              <div className="ois-bar-wrap">
                {isPos && <div className="ois-bar-pos" style={{ width: halfBarPct + '%', background: pctCol }} />}
                {isNeg && <div className="ois-bar-neg" style={{ width: halfBarPct + '%', background: pctCol }} />}
              </div>
              <div className="ois-pct" style={{ color: pctCol }}>
                {pct != null ? (isPos ? '+' : '') + pct.toFixed(1) + '%' : '—'}
              </div>
            </div>

            <div className="ois-signal" style={{ color: sigCol }}>{sigTxt}</div>
          </div>
        );
      })}
    </div>
  );
}
