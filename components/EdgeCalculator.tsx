'use client';
import { useState, useMemo } from 'react';
import { useMarket } from '@/lib/marketStore';
import { binaryCallProbability, interpolateIV } from '@/lib/blackScholes';
import { computeKelly, fractionalKelly } from '@/lib/kelly';
import Tip from './Tip';

const KELLY_OPTIONS = [
  { label: 'Quarter Kelly', value: 0.25 },
  { label: 'Half Kelly', value: 0.5 },
  { label: 'Full Kelly', value: 1 },
] as const;

function fmtUsd(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function StepLabel({ n, title }: { n: number; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <span style={{
        width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
        background: 'var(--accent-bg)', border: '0.5px solid var(--accent-bdr)', color: 'var(--accent-2)',
        fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {n}
      </span>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--txt2)' }}>
        {title}
      </span>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 6 }}>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', fontSize: 13, borderRadius: 10,
  border: '0.5px solid var(--bdr)', background: 'var(--bg1)', color: 'var(--txt)',
  outline: 'none', fontFamily: 'var(--font-mono), monospace',
};

export default function EdgeCalculator() {
  const { store } = useMarket();
  const spot = store.coins.btc?.price ?? null;
  const ivTerm = store.btcIVTermStructure;

  const [strike, setStrike]           = useState('90000');
  const [expiryDate, setExpiryDate]   = useState('');
  const [marketCents, setMarketCents] = useState('63');
  const [feePct, setFeePct]           = useState('2');
  const [slippagePct, setSlippagePct] = useState('1');
  const [bufferPct, setBufferPct]     = useState('2');
  const [bankroll, setBankroll]       = useState('1000');
  const [kellyMult, setKellyMult]     = useState<0.25 | 0.5 | 1>(0.5);

  const daysToExpiry = useMemo(() => {
    if (!expiryDate) return null;
    const ms = new Date(`${expiryDate}T00:00:00Z`).getTime() - Date.now();
    return ms > 0 ? ms / (24 * 3600 * 1000) : null;
  }, [expiryDate]);

  const iv = daysToExpiry != null ? interpolateIV(ivTerm, daysToExpiry) : null;
  const strikeNum = parseFloat(strike);
  const marketProb = marketCents !== '' ? parseFloat(marketCents) / 100 : null;

  const bs = (spot != null && strikeNum > 0 && daysToExpiry != null && iv != null)
    ? binaryCallProbability({ spot, strike: strikeNum, daysToExpiry, ivPct: iv })
    : null;

  const costPct = Math.max(0,
    (parseFloat(feePct || '0') + parseFloat(slippagePct || '0') + parseFloat(bufferPct || '0')) / 100
  );

  const kelly = (bs && marketProb != null && marketProb > 0 && marketProb < 1)
    ? computeKelly({ modelProb: bs.probAbove, marketProb, costPct })
    : null;

  const appliedFraction = kelly ? fractionalKelly(kelly.kellyFraction, kellyMult) : 0;
  const bankrollNum = parseFloat(bankroll || '0');
  const betSize = bankrollNum * appliedFraction;
  const shares = kelly && kelly.tradePrice > 0 ? Math.floor(betSize / kelly.tradePrice) : 0;

  const ready = spot != null && iv != null && strikeNum > 0 && marketProb != null;
  const hasTrade = kelly != null && kelly.side !== 'NONE' && shares > 0;

  return (
    <div style={{
      margin: '16px 0', padding: 18, borderRadius: 14,
      border: '0.5px solid var(--bdr)', background: 'var(--bg2)',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--txt)', margin: 0 }}>Edge Calculator</h3>
        <span style={{ fontSize: 11, color: 'var(--txt3)' }}>Black-Scholes vs. prediction-market pricing</span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--txt3)', margin: '4px 0 18px' }}>
        For a binary contract like &ldquo;BTC above $X by date Y,&rdquo; this runs the same
        probability model options markets use, compares it to the market&rsquo;s price, and sizes
        the bet with the Kelly criterion.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>

        {/* ── Step 1: Market Data ── */}
        <div>
          <StepLabel n={1} title="Market Data" />
          <div style={{
            display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 10,
            background: 'var(--bg1)', border: '0.5px solid var(--bdr)',
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: 'var(--txt3)', marginBottom: 3 }}>BTC Spot</div>
              <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-mono), monospace', color: 'var(--txt)' }}>
                {spot != null ? `$${fmtUsd(spot)}` : '—'}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: 'var(--txt3)', marginBottom: 3 }}>
                <Tip width={220} iconColor="rgba(255,255,255,0.4)" text="ATM implied volatility from live Deribit BTC options, interpolated to your chosen expiry date.">
                  Implied Vol
                </Tip>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-mono), monospace', color: 'var(--txt)' }}>
                {iv != null ? `${iv.toFixed(1)}%` : expiryDate ? '—' : 'set expiry →'}
              </div>
            </div>
          </div>
        </div>

        {/* ── Step 2: Target Market ── */}
        <div>
          <StepLabel n={2} title="Target Market" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <FieldLabel>Strike ($)</FieldLabel>
                <input type="number" value={strike} onChange={e => setStrike(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <FieldLabel>Expiry</FieldLabel>
                <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} style={inputStyle} />
              </div>
            </div>
            <div>
              <FieldLabel>Market Price (¢ for YES)</FieldLabel>
              <input type="number" min={1} max={99} value={marketCents} onChange={e => setMarketCents(e.target.value)} style={inputStyle} />
            </div>
          </div>
        </div>

        {/* ── Step 3: Black-Scholes ── */}
        <div>
          <StepLabel n={3} title="Black-Scholes" />
          <div style={{
            padding: '10px 12px', borderRadius: 10, background: 'var(--bg1)', border: '0.5px solid var(--bdr)',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: 'var(--txt3)' }}>Model probability</span>
              <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono), monospace', color: 'var(--txt)' }}>
                {bs ? `${(bs.probAbove * 100).toFixed(1)}%` : '—'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
              <span style={{ color: 'var(--txt3)' }}>Market price</span>
              <span style={{ fontFamily: 'var(--font-mono), monospace', color: 'var(--txt2)' }}>
                {marketProb != null ? `${(marketProb * 100).toFixed(0)}%` : '—'}
              </span>
            </div>
            {bs && (
              <div style={{ fontSize: 10, color: 'var(--txt3)', fontFamily: 'var(--font-mono), monospace', marginTop: 2 }}>
                d1={bs.d1.toFixed(3)} · d2={bs.d2.toFixed(3)} · T={bs.T.toFixed(3)}y
              </div>
            )}
          </div>
        </div>

        {/* ── Step 4: Edge Detection ── */}
        <div>
          <StepLabel n={4} title="Edge Detection" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ flex: 1 }}>
                <FieldLabel>Fees %</FieldLabel>
                <input type="number" value={feePct} onChange={e => setFeePct(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <FieldLabel>Slippage %</FieldLabel>
                <input type="number" value={slippagePct} onChange={e => setSlippagePct(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <FieldLabel>Buffer %</FieldLabel>
                <input type="number" value={bufferPct} onChange={e => setBufferPct(e.target.value)} style={inputStyle} />
              </div>
            </div>
            {kelly && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 2px 0' }}>
                <span style={{ color: 'var(--txt3)' }}>Raw edge → net edge</span>
                <span style={{ fontFamily: 'var(--font-mono), monospace', color: kelly.netEdge > 0 ? 'var(--accent-2)' : 'var(--txt3)' }}>
                  {(kelly.rawEdge * 100).toFixed(1)}¢ → {(kelly.netEdge * 100).toFixed(1)}¢
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── Step 5: Kelly Criterion ── */}
        <div>
          <StepLabel n={5} title="Kelly Criterion" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ flex: 1 }}>
                <FieldLabel>Bankroll ($)</FieldLabel>
                <input type="number" value={bankroll} onChange={e => setBankroll(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <FieldLabel>Sizing</FieldLabel>
                <select
                  value={kellyMult}
                  onChange={e => setKellyMult(parseFloat(e.target.value) as 0.25 | 0.5 | 1)}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                >
                  {KELLY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
            {kelly && kelly.side !== 'NONE' && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: 'var(--txt3)' }}>Kelly fraction (full → applied)</span>
                <span style={{ fontFamily: 'var(--font-mono), monospace', color: 'var(--txt)' }}>
                  {(kelly.kellyFraction * 100).toFixed(1)}% → {(appliedFraction * 100).toFixed(1)}%
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── Step 6: Trade Signal ── */}
        <div>
          <StepLabel n={6} title="Trade Signal" />
          <div style={{
            padding: '12px 14px', borderRadius: 10, height: 'calc(100% - 28px)',
            background: !ready ? 'var(--bg1)'
              : hasTrade ? (kelly!.side === 'YES' ? 'var(--green-bg)' : 'var(--red-bg)')
              : 'var(--bg1)',
            border: `0.5px solid ${!ready ? 'var(--bdr)' : hasTrade ? (kelly!.side === 'YES' ? '#4ade8055' : '#f8717155') : 'var(--bdr)'}`,
            display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4,
          }}>
            {!ready ? (
              <span style={{ fontSize: 12, color: 'var(--txt3)' }}>Fill in the target market to see a signal.</span>
            ) : !hasTrade ? (
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt2)' }}>NO TRADE — no edge after costs</span>
            ) : (
              <>
                <span style={{
                  fontSize: 15, fontWeight: 800,
                  color: kelly!.side === 'YES' ? '#4ade80' : '#f87171',
                }}>
                  BUY {kelly!.side} — {shares} shares
                </span>
                <span style={{ fontSize: 11, color: 'var(--txt2)' }}>
                  {(kelly!.netEdge * 100).toFixed(1)}¢ edge/contract · Kelly {(appliedFraction * 100).toFixed(1)}% · ${fmtUsd(betSize)} risked
                </span>
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
