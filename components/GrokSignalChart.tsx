'use client';
import { useState } from 'react';
import { useMarket, BINANCE_SYMS } from '@/lib/marketStore';

// TF used when fetching candles for Grok analysis context
const GROK_TF = '15m';

const API_KEY   = 'xai-oCDU5hc5nANrylf2x59rY1blsSvXbefwm0rnP6BSypnO6nijulzN6znv5Bepv2POY4L6EdBULh4GYNCO';
const FETCH_N   = 300;
const DISPLAY_N = 80;

interface Candle { t: number; o: number; h: number; l: number; c: number; v: number; }
interface ChartLevel { price: number; label: string; type: 'support' | 'resistance' | 'tp' | 'sl' | 'entry'; }
interface ChartResult {
  signal: 'LONG' | 'SHORT' | 'FLAT';
  levels: ChartLevel[];
  entryLow: number | null;
  entryHigh: number | null;
  analysis: string;
}

// ── Indicator helpers (used to enrich Grok context) ────────────────────────

function calcEMA(closes: number[], period: number): (number | null)[] {
  const n = closes.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (n < period) return out;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = ema;
  for (let i = period; i < n; i++) {
    ema = closes[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

function calcRSI(closes: number[], period = 14): (number | null)[] {
  const n = closes.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (n <= period) return out;
  const gains: number[] = [], losses: number[] = [];
  for (let i = 1; i < n; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(d > 0 ? d : 0);
    losses.push(d < 0 ? -d : 0);
  }
  let ag = gains.slice(0, period).reduce((s, v) => s + v, 0) / period;
  let al = losses.slice(0, period).reduce((s, v) => s + v, 0) / period;
  const rsi = (g: number, l: number) => l === 0 ? 100 : 100 - 100 / (1 + g / l);
  out[period] = rsi(ag, al);
  for (let i = period; i < n - 1; i++) {
    ag = (ag * (period - 1) + gains[i]) / period;
    al = (al * (period - 1) + losses[i]) / period;
    out[i + 1] = rsi(ag, al);
  }
  return out;
}

// ── Grok prompt / parse ────────────────────────────────────────────────────

function buildChartPrompt(coin: string, tf: string, candles: Candle[]): string {
  const vis    = candles.slice(-DISPLAY_N);
  const last   = vis[vis.length - 1];
  const hi     = Math.max(...vis.map(c => c.h));
  const lo     = Math.min(...vis.map(c => c.l));
  const closes = candles.map(c => c.c);
  const e9     = calcEMA(closes, 9).at(-1);
  const e200   = calcEMA(closes, 200).at(-1);
  const rsi    = calcRSI(closes, 14).at(-1);
  const recent = vis.slice(-20).map(c =>
    `O:${c.o.toFixed(0)} H:${c.h.toFixed(0)} L:${c.l.toFixed(0)} C:${c.c.toFixed(0)}`
  ).join(' | ');
  return `You are a professional derivatives trader doing technical chart analysis.
Coin: ${coin.toUpperCase()} | Timeframe: ${tf} | Price: $${last.c.toFixed(0)}
Range: High $${hi.toFixed(0)} / Low $${lo.toFixed(0)}
EMA 9: $${e9?.toFixed(0) ?? '—'} | EMA 200: $${e200?.toFixed(0) ?? '—'} | RSI(14): ${rsi?.toFixed(1) ?? '—'}
Last 20 candles (OHLC): ${recent}

Respond in EXACTLY this format (numbers only, no commas):
CHART_SIGNAL: [LONG or SHORT or FLAT]
ENTRY_LOW: [number]
ENTRY_HIGH: [number]
TAKE_PROFIT: [number]
STOP_LOSS: [number]
LEVELS:
- [number]: [label max 15 chars] | [support or resistance]
- [number]: [label max 15 chars] | [support or resistance]
- [number]: [label max 15 chars] | [support or resistance]
CHART_ANALYSIS: [2 sentences max]`;
}

function parseChartResponse(text: string): ChartResult {
  const signal = ((text.match(/CHART_SIGNAL:\s*(LONG|SHORT|FLAT)/i)?.[1] ?? 'FLAT').toUpperCase()) as 'LONG'|'SHORT'|'FLAT';
  const pn = (s?: string): number | null => { const v = parseFloat((s ?? '').replace(/,/g, '')); return isNaN(v) || v <= 0 ? null : v; };
  const entryLow  = pn(text.match(/ENTRY_LOW:\s*([\d,.]+)/i)?.[1]);
  const entryHigh = pn(text.match(/ENTRY_HIGH:\s*([\d,.]+)/i)?.[1]);
  const tp = pn(text.match(/TAKE_PROFIT:\s*([\d,.]+)/i)?.[1]);
  const sl = pn(text.match(/STOP_LOSS:\s*([\d,.]+)/i)?.[1]);
  const levels: ChartLevel[] = [];
  const levSect = text.match(/LEVELS:\s*\n([\s\S]*?)(?=CHART_ANALYSIS:|$)/i)?.[1] ?? '';
  for (const line of levSect.split('\n')) {
    const m = line.match(/-\s*\$?([\d,.]+):\s*([^|]+)\|\s*(support|resistance)/i);
    if (m) { const p = pn(m[1]); if (p) levels.push({ price: p, label: m[2].trim(), type: m[3].toLowerCase() as 'support'|'resistance' }); }
  }
  if (tp) levels.push({ price: tp, label: 'Take Profit', type: 'tp' });
  if (sl) levels.push({ price: sl, label: 'Stop Loss',   type: 'sl' });
  return { signal, levels, entryLow, entryHigh, analysis: text.match(/CHART_ANALYSIS:\s*([\s\S]+)/i)?.[1]?.trim() ?? '' };
}

// ── Component ──────────────────────────────────────────────────────────────

export default function GrokSignalChart({ coin: coinProp }: { coin?: string }) {
  const { store } = useMarket();
  const coin      = (coinProp ?? store.selectedCoin) as string;

  const [result, setResult]       = useState<ChartResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError]         = useState('');

  const sym   = BINANCE_SYMS[coin] as string | undefined;
  const tvSym = sym ? `BINANCE:${sym}` : 'BINANCE:BTCUSDT';
  const tvSrc = `https://www.tradingview.com/widgetembed/?symbol=${encodeURIComponent(tvSym)}&interval=15&theme=dark&style=1&locale=en&hide_top_toolbar=0&save_image=0&allow_symbol_change=0&timezone=${encodeURIComponent('Asia/Manila')}`;

  const analyze = async () => {
    if (!sym || analyzing) return;
    setAnalyzing(true); setError('');
    try {
      // Fetch candles for Grok context (indicators: EMA 9/200, RSI)
      const r = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${GROK_TF}&limit=${FETCH_N}`
      );
      if (!r.ok) throw new Error('Binance API error');
      const data: (string | number)[][] = await r.json();
      const candles: Candle[] = data.map(k => ({
        t: Number(k[0]), o: Number(k[1]), h: Number(k[2]),
        l: Number(k[3]), c: Number(k[4]), v: Number(k[5]),
      }));

      const gr = await fetch('https://api.x.ai/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
        body: JSON.stringify({ model: 'grok-4.3', input: [{ role: 'user', content: buildChartPrompt(coin, GROK_TF, candles) }] }),
      });
      if (!gr.ok) throw new Error(`Grok API ${gr.status}`);
      const gd = await gr.json();
      const text: string = gd.output?.find((o: { type: string }) => o.type === 'message')?.content?.[0]?.text ?? '';
      if (!text) throw new Error('Empty response');
      setResult(parseChartResponse(text));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const sigCol = result?.signal === 'LONG' ? '#34d399' : result?.signal === 'SHORT' ? '#f87171' : '#9ca3af';
  const fmt0   = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

  return (
    <div className="gsc-wrap">
      {/* Header */}
      <div className="gsc-header">
        <div className="gsc-title">
          <span>📈</span>
          <span>{coin.toUpperCase()} / USDT</span>
          {result && (
            <span className="gsc-sig-badge" style={{ color: sigCol, background: sigCol + '18', border: `0.5px solid ${sigCol}44` }}>
              {result.signal}
            </span>
          )}
        </div>
        <div className="gsc-controls">
          <button className="gsc-analyze-btn" onClick={analyze} disabled={analyzing}>
            {analyzing ? '⏳ Analyzing…' : '⚡ Analyze'}
          </button>
        </div>
      </div>

      {/* TradingView chart — key forces full reload on coin/tf change */}
      <div className="gsc-tv-wrap">
        <iframe
          key={coin}
          src={tvSrc}
          className="gsc-tv-frame"
          frameBorder="0"
          allowFullScreen
        />
      </div>

      {/* Error */}
      {error && <div className="gsc-error">{error}</div>}

      {/* Grok analysis text */}
      {result?.analysis && (
        <div className="gsc-analysis">
          <span className="gsc-analysis-label">Grok reads</span>
          <span className="gsc-analysis-text">{result.analysis}</span>
        </div>
      )}

      {/* Entry / TP / SL chips */}
      {result && (result.entryLow || result.levels.some(l => l.type === 'tp' || l.type === 'sl')) && (
        <div className="gsc-levels-row">
          {result.entryLow && result.entryHigh && (
            <div className="gsc-chip gsc-chip-entry">
              <span>Entry zone</span>
              <span>${fmt0(result.entryLow)} – ${fmt0(result.entryHigh)}</span>
            </div>
          )}
          {result.levels.filter(l => l.type === 'tp').map((l, i) => (
            <div key={i} className="gsc-chip gsc-chip-tp">
              <span>Take profit</span><span>${fmt0(l.price)}</span>
            </div>
          ))}
          {result.levels.filter(l => l.type === 'sl').map((l, i) => (
            <div key={i} className="gsc-chip gsc-chip-sl">
              <span>Stop loss</span><span>${fmt0(l.price)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
