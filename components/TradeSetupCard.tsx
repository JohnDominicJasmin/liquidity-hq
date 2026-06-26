'use client';
import { useMarket, COIN_DEC, fmtPrice, CoinData } from '@/lib/marketStore';

type SetupDir = 'LONG' | 'SHORT' | 'NONE';

interface Setup {
  dir:          SetupDir;
  confidence:   number;
  entryLow:     number | null;
  entryHigh:    number | null;
  invalidation: number | null;
  watchFor:     string;
  noSetupReason: string;
}

function computeSetup(d: CoinData | undefined, dec: number): Setup {
  const none = (reason: string): Setup => ({
    dir: 'NONE', confidence: 0,
    entryLow: null, entryHigh: null, invalidation: null,
    watchFor: '', noSetupReason: reason,
  });

  if (!d?.price) return none('Waiting for price data…');

  let bull = 0, bear = 0;

  // RSI per timeframe (1 pt each)
  if (d.rsi4h != null) { if (d.rsi4h > 55) bull++; else if (d.rsi4h < 45) bear++; }
  if (d.rsi1h != null) { if (d.rsi1h > 55) bull++; else if (d.rsi1h < 45) bear++; }
  if (d.rsi14 != null) { if (d.rsi14 > 55) bull++; else if (d.rsi14 < 45) bear++; }

  // OI trend (1 pt)
  if (d.oiTrend === 'strong_up')   bull++;
  if (d.oiTrend === 'strong_down') bear++;

  // CVD divergence (1 pt)
  if (d.cvdDivergence === 'bullish') bull++;
  if (d.cvdDivergence === 'bearish') bear++;

  // Taker flow (1 pt)
  if (d.takerBuyRatio != null) {
    if (d.takerBuyRatio >= 0.60) bull++;
    else if (d.takerBuyRatio <= 0.40) bear++;
  }

  // Funding — contrarian (1 pt): high FR = crowded longs = bearish
  if (d.fundingRate != null) {
    const fr = d.fundingRate * 100;
    if (fr >= 0.04) bear++;
    else if (fr <= -0.02) bull++;
  }

  // VWAP position (1 pt)
  if (d.vwap != null) {
    if (d.price > d.vwap) bull++;
    else bear++;
  }

  // Need ≥ 3 signals on one side for a valid setup
  const dir: SetupDir = bull > bear && bull >= 3 ? 'LONG'
                      : bear > bull && bear >= 3 ? 'SHORT'
                      : 'NONE';

  if (dir === 'NONE') {
    return none(bull === bear
      ? 'Signals are evenly split — no edge right now'
      : 'Not enough signals aligned — wait for confirmation');
  }

  const confidence = Math.min(Math.round(((dir === 'LONG' ? bull : bear) / 8) * 85), 82);

  // ── Entry zone ──
  let entryLow: number | null = null;
  let entryHigh: number | null = null;
  let invalidation: number | null = null;

  if (dir === 'LONG') {
    if (d.val != null && d.poc != null && d.val < d.price) {
      entryLow = d.val; entryHigh = d.poc;
    } else if (d.vwap != null) {
      entryLow = d.vwap * 0.998; entryHigh = d.vwap * 1.001;
    } else if (d.ma20 != null) {
      entryLow = d.ma20 * 0.998; entryHigh = d.ma20;
    }
    invalidation = d.val != null ? d.val * 0.998
                 : d.ma20 != null ? d.ma20 * 0.997
                 : d.vwap != null ? d.vwap * 0.995
                 : null;
  } else {
    if (d.poc != null && d.vah != null && d.vah > d.price) {
      entryLow = d.poc; entryHigh = d.vah;
    } else if (d.vwap != null) {
      entryLow = d.vwap * 0.999; entryHigh = d.vwap * 1.002;
    } else if (d.ma20 != null) {
      entryLow = d.ma20; entryHigh = d.ma20 * 1.002;
    }
    invalidation = d.vah != null ? d.vah * 1.002
                 : d.ma20 != null ? d.ma20 * 1.003
                 : d.vwap != null ? d.vwap * 1.005
                 : null;
  }

  // ── Watch for ──
  let watchFor = '';
  const p = (n: number) => '$' + fmtPrice(n, dec);

  if (dir === 'LONG') {
    if (d.ma20 != null)
      watchFor = `Candle close above EMA20 (${p(d.ma20)}) with volume — then hold`;
    else if (d.cvdDivergence === 'bullish')
      watchFor = 'CVD ticking up as price holds — accumulation in progress';
    else if (d.oiTrend === 'strong_up')
      watchFor = 'OI rising with price — new longs confirming the move';
    else if (d.vwap != null)
      watchFor = `Price reclaiming VWAP (${p(d.vwap)}) and holding on retests`;
    else
      watchFor = 'Entry zone holding with increasing buy volume';
  } else {
    if (d.ma20 != null)
      watchFor = `Price failing to close above EMA20 (${p(d.ma20)}) on retests`;
    else if (d.cvdDivergence === 'bearish')
      watchFor = 'CVD diverging down as price rises — distribution in progress';
    else if (d.oiTrend === 'strong_down')
      watchFor = 'OI increasing as price drops — fresh shorts entering';
    else if (d.vwap != null)
      watchFor = `Price rejected below VWAP (${p(d.vwap)}) on each bounce`;
    else
      watchFor = 'Entry zone rejecting price with increasing sell volume';
  }

  return { dir, confidence, entryLow, entryHigh, invalidation, watchFor, noSetupReason: '' };
}

export default function TradeSetupCard() {
  const { store } = useMarket();
  const coin = store.selectedCoin;
  const d    = store.coins[coin];
  const dec  = COIN_DEC[coin];
  const s    = computeSetup(d, dec);

  const isLong  = s.dir === 'LONG';
  const dirCol  = isLong ? '#34d399' : s.dir === 'SHORT' ? '#f87171' : 'var(--txt3)';
  const dirBg   = isLong ? 'rgba(52,211,153,0.1)' : s.dir === 'SHORT' ? 'rgba(248,113,113,0.1)' : 'transparent';
  const dirBdr  = isLong ? 'rgba(52,211,153,0.3)' : s.dir === 'SHORT' ? 'rgba(248,113,113,0.3)' : 'var(--bdr)';
  const confCol = s.confidence >= 60 ? '#34d399' : s.confidence >= 40 ? '#fbbf24' : '#f87171';

  const p = (n: number) => '$' + fmtPrice(n, dec);

  return (
    <div className="sms-card">
      {/* Header */}
      <div className="sms-header">
        <div>
          <div className="sms-title">Trade Setup — {coin.toUpperCase()}</div>
          <div className="sms-sub">Entry zone · Invalidation · Watch for</div>
        </div>
        <div style={{
          fontSize: 11, fontWeight: 800, letterSpacing: '.06em',
          padding: '3px 10px', borderRadius: 6,
          color: dirCol, background: dirBg, border: `0.5px solid ${dirBdr}`,
        }}>
          {s.dir === 'NONE' ? 'No Setup' : s.dir}
        </div>
      </div>

      {s.dir === 'NONE' ? (
        <div style={{ fontSize: 12, color: 'var(--txt3)', padding: '6px 0', lineHeight: 1.5 }}>
          {s.noSetupReason}
        </div>
      ) : (
        <>
          {/* Setup rows */}
          {([
            {
              label: 'Entry zone',
              value: s.entryLow != null && s.entryHigh != null
                ? `${p(s.entryLow)} – ${p(s.entryHigh)}`
                : '—',
              col: 'var(--txt)',
            },
            {
              label: 'Invalidation',
              value: s.invalidation != null
                ? `${isLong ? 'Below' : 'Above'} ${p(s.invalidation)}`
                : '—',
              col: '#f87171',
            },
            {
              label: 'Watch for',
              value: s.watchFor,
              col: 'var(--txt2)',
            },
          ] as const).map(row => (
            <div key={row.label} style={{
              display: 'grid', gridTemplateColumns: '88px 1fr',
              gap: 8, padding: '7px 0',
              borderBottom: row.label !== 'Watch for' ? '0.5px solid var(--bdr)' : 'none',
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--txt3)', paddingTop: 1 }}>
                {row.label}
              </div>
              <div style={{ fontSize: 12, fontWeight: row.label === 'Watch for' ? 600 : 700, color: row.col, lineHeight: 1.45 }}>
                {row.value}
              </div>
            </div>
          ))}

          {/* Confidence bar */}
          <div style={{ marginTop: 10 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', marginBottom: 5,
              fontSize: 10, fontWeight: 700, color: 'var(--txt3)',
              letterSpacing: '.04em', textTransform: 'uppercase',
            }}>
              <span>Signal confidence</span>
              <span style={{ color: confCol }}>{s.confidence}%</span>
            </div>
            <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
              <div style={{
                height: '100%', borderRadius: 2, transition: 'width 0.4s ease',
                width: `${s.confidence}%`,
                background: `linear-gradient(90deg, ${confCol}88, ${confCol})`,
              }} />
            </div>
            <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 6, lineHeight: 1.4 }}>
              Based on RSI alignment, OI trend, CVD, taker flow, VWAP and funding rate
            </div>
          </div>
        </>
      )}
    </div>
  );
}
