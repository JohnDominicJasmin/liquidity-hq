'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useMarket, BINANCE_SYMS } from '@/lib/marketStore';

const TFS = ['5m', '15m', '1h', '4h'] as const;
type TF = typeof TFS[number];

const API_KEY = 'xai-oCDU5hc5nANrylf2x59rY1blsSvXbefwm0rnP6BSypnO6nijulzN6znv5Bepv2POY4L6EdBULh4GYNCO';
const CHART_H = 320;

interface Candle { t: number; o: number; h: number; l: number; c: number; v: number; }
interface ChartLevel { price: number; label: string; type: 'support' | 'resistance' | 'tp' | 'sl' | 'entry'; }
interface ChartResult {
  signal: 'LONG' | 'SHORT' | 'FLAT';
  levels: ChartLevel[];
  entryLow: number | null;
  entryHigh: number | null;
  analysis: string;
}

async function fetchCandles(symbol: string, interval: string): Promise<Candle[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=80`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Binance API error');
  const data: (string | number)[][] = await res.json();
  return data.map(k => ({
    t: Number(k[0]), o: Number(k[1]), h: Number(k[2]),
    l: Number(k[3]), c: Number(k[4]), v: Number(k[5]),
  }));
}

function buildChartPrompt(coin: string, tf: string, candles: Candle[]): string {
  const last  = candles[candles.length - 1];
  const hi50  = Math.max(...candles.map(c => c.h));
  const lo50  = Math.min(...candles.map(c => c.l));
  const recent = candles.slice(-20).map(c =>
    `O:${c.o.toFixed(0)} H:${c.h.toFixed(0)} L:${c.l.toFixed(0)} C:${c.c.toFixed(0)}`
  ).join(' | ');

  return `You are a professional derivatives trader doing technical chart analysis.
Coin: ${coin.toUpperCase()} | Timeframe: ${tf} | Current price: $${last.c.toFixed(0)}
80-candle range: High $${hi50.toFixed(0)} / Low $${lo50.toFixed(0)}
Last 20 candles (OHLC): ${recent}

Identify the most important price levels. Respond in EXACTLY this format (numbers only, no commas):

CHART_SIGNAL: [LONG or SHORT or FLAT]
ENTRY_LOW: [number]
ENTRY_HIGH: [number]
TAKE_PROFIT: [number]
STOP_LOSS: [number]
LEVELS:
- [number]: [short label max 15 chars] | [support or resistance]
- [number]: [short label max 15 chars] | [support or resistance]
- [number]: [short label max 15 chars] | [support or resistance]
CHART_ANALYSIS: [2 sentences max — what pattern, what to watch]`;
}

function parseChartResponse(text: string): ChartResult {
  const signal = ((text.match(/CHART_SIGNAL:\s*(LONG|SHORT|FLAT)/i)?.[1] ?? 'FLAT').toUpperCase()) as 'LONG' | 'SHORT' | 'FLAT';
  const pn = (s: string | undefined): number | null => {
    const v = parseFloat((s ?? '').replace(/,/g, ''));
    return isNaN(v) || v <= 0 ? null : v;
  };
  const entryLow  = pn(text.match(/ENTRY_LOW:\s*([\d,.]+)/i)?.[1]);
  const entryHigh = pn(text.match(/ENTRY_HIGH:\s*([\d,.]+)/i)?.[1]);
  const tp = pn(text.match(/TAKE_PROFIT:\s*([\d,.]+)/i)?.[1]);
  const sl = pn(text.match(/STOP_LOSS:\s*([\d,.]+)/i)?.[1]);
  const levels: ChartLevel[] = [];
  const levSect = text.match(/LEVELS:\s*\n([\s\S]*?)(?=CHART_ANALYSIS:|$)/i)?.[1] ?? '';
  for (const line of levSect.split('\n')) {
    const m = line.match(/-\s*\$?([\d,.]+):\s*([^|]+)\|\s*(support|resistance)/i);
    if (m) {
      const price = pn(m[1]);
      if (price) levels.push({ price, label: m[2].trim(), type: m[3].toLowerCase() as 'support' | 'resistance' });
    }
  }
  if (tp) levels.push({ price: tp, label: 'Take Profit', type: 'tp' });
  if (sl) levels.push({ price: sl, label: 'Stop Loss',   type: 'sl' });
  const analysis = text.match(/CHART_ANALYSIS:\s*([\s\S]+)/i)?.[1]?.trim() ?? '';
  return { signal, levels, entryLow, entryHigh, analysis };
}

function drawChart(canvas: HTMLCanvasElement, candles: Candle[], result: ChartResult | null) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !candles.length) return;

  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.clientWidth;
  const H   = canvas.clientHeight;
  if (!W || !H) return;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  const isDark  = document.documentElement.getAttribute('data-theme') !== 'light';
  const bgColor = isDark ? '#0f0f0f' : '#f8f8f8';
  const gridCol = isDark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.04)';
  const labelCol = isDark ? '#363636' : '#aaa';
  const greenC  = '#34d399';
  const redC    = '#f87171';

  const PAD = { top: 14, right: 72, bottom: 22, left: 4 };
  const cW  = W - PAD.left - PAD.right;
  const cH  = H - PAD.top  - PAD.bottom;

  // Price range — expand to include Grok levels
  let lo = Math.min(...candles.map(c => c.l));
  let hi = Math.max(...candles.map(c => c.h));
  result?.levels.forEach(lv => { if (lv.price > 0) { lo = Math.min(lo, lv.price); hi = Math.max(hi, lv.price); } });
  if (result?.entryLow)  lo = Math.min(lo, result.entryLow);
  if (result?.entryHigh) hi = Math.max(hi, result.entryHigh);
  const padPct = (hi - lo) * 0.04;
  lo -= padPct; hi += padPct;
  const range = hi - lo;
  const toY = (p: number) => PAD.top + cH * (1 - (p - lo) / range);

  // Background
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, W, H);

  // Grid lines + price labels
  for (let i = 0; i <= 4; i++) {
    const p = lo + (range / 4) * i;
    const y = toY(p);
    ctx.strokeStyle = gridCol; ctx.lineWidth = 0.5; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y); ctx.stroke();
    ctx.fillStyle = labelCol; ctx.font = '9px sans-serif'; ctx.textAlign = 'right';
    const lbl = p >= 10000 ? '$' + (p / 1000).toFixed(1) + 'K'
              : p >= 1000  ? '$' + p.toFixed(0)
              : '$' + p.toFixed(4);
    ctx.fillText(lbl, W - 3, y - 2);
  }

  // Volume bars (bottom 10% of chart area)
  const maxVol = Math.max(...candles.map(c => c.v)) || 1;
  const volH   = cH * 0.1;
  const slotW  = cW / candles.length;
  candles.forEach((c, i) => {
    const bX = PAD.left + i * slotW;
    const bW = Math.max(1, slotW * 0.75);
    const bH = (c.v / maxVol) * volH;
    ctx.fillStyle = c.c >= c.o ? 'rgba(52,211,153,0.15)' : 'rgba(248,113,113,0.15)';
    ctx.fillRect(bX + (slotW - bW) / 2, H - PAD.bottom - bH, bW, bH);
  });

  // Candles
  candles.forEach((c, i) => {
    const isUp  = c.c >= c.o;
    const col   = isUp ? greenC : redC;
    const bX    = PAD.left + i * slotW;
    const bW    = Math.max(2, slotW * 0.72);
    const midX  = bX + slotW / 2;
    const bodyT = Math.min(toY(c.o), toY(c.c));
    const bodyH = Math.max(1.5, Math.abs(toY(c.c) - toY(c.o)));

    ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(midX, toY(c.h)); ctx.lineTo(midX, toY(c.l)); ctx.stroke();
    ctx.fillStyle = col;
    ctx.fillRect(bX + (slotW - bW) / 2, bodyT, bW, bodyH);
  });

  if (!result) return;

  const LEVEL_COLS: Record<string, string> = {
    support: greenC, resistance: redC, tp: greenC, sl: '#ef4444', entry: '#a78bfa',
  };

  // Entry zone shading
  if (result.entryLow && result.entryHigh) {
    const y1 = toY(result.entryHigh);
    const y2 = toY(result.entryLow);
    ctx.fillStyle = 'rgba(167,139,250,0.06)';
    ctx.fillRect(PAD.left, y1, cW, y2 - y1);
    ctx.strokeStyle = 'rgba(167,139,250,0.25)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(PAD.left, y1); ctx.lineTo(W - PAD.right, y1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(PAD.left, y2); ctx.lineTo(W - PAD.right, y2); ctx.stroke();
    ctx.setLineDash([]);
  }

  // Key level lines
  result.levels.forEach(lv => {
    if (!lv.price) return;
    const y = toY(lv.price);
    if (y < 0 || y > H) return;
    const col = LEVEL_COLS[lv.type] ?? '#a78bfa';
    ctx.strokeStyle = col + 'bb'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right - 2, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = col; ctx.font = '9px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText('$' + lv.price.toLocaleString(undefined, { maximumFractionDigits: 0 }), W - 3, y - 2);
    ctx.fillStyle = col + '80'; ctx.font = '8px sans-serif';
    ctx.fillText(lv.label.slice(0, 16), W - 3, y + 8);
  });
}

export default function GrokSignalChart() {
  const { store }  = useMarket();
  const coin       = store.selectedCoin;
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const roRef      = useRef<ResizeObserver | null>(null);

  const [tf, setTf]             = useState<TF>('15m');
  const [candles, setCandles]   = useState<Candle[]>([]);
  const [result, setResult]     = useState<ChartResult | null>(null);
  const [loading, setLoading]   = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError]       = useState('');

  const loadCandles = useCallback(async () => {
    const sym = BINANCE_SYMS[coin];
    if (!sym) { setError('No Binance spot pair for ' + coin.toUpperCase()); return; }
    setLoading(true); setError(''); setResult(null);
    try {
      const data = await fetchCandles(sym, tf);
      setCandles(data);
    } catch {
      setError('Failed to load chart data');
    } finally {
      setLoading(false);
    }
  }, [coin, tf]);

  useEffect(() => { loadCandles(); }, [loadCandles]);

  // Redraw on data change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !candles.length) return;
    drawChart(canvas, candles, result);
  }, [candles, result]);

  // Redraw on container resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    roRef.current = new ResizeObserver(() => {
      if (candles.length) drawChart(canvas, candles, result);
    });
    roRef.current.observe(canvas.parentElement ?? canvas);
    return () => roRef.current?.disconnect();
  }, [candles, result]);

  const analyze = async () => {
    if (!candles.length || analyzing) return;
    setAnalyzing(true); setError('');
    try {
      const prompt = buildChartPrompt(coin, tf, candles);
      const res = await fetch('https://api.x.ai/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
        body: JSON.stringify({ model: 'grok-4.3', input: [{ role: 'user', content: prompt }] }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      const msgItem = data.output?.find((o: { type: string }) => o.type === 'message');
      const text: string = msgItem?.content?.[0]?.text ?? '';
      if (!text) throw new Error('Empty response');
      setResult(parseChartResponse(text));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const sigCol = result?.signal === 'LONG' ? '#34d399' : result?.signal === 'SHORT' ? '#f87171' : '#9ca3af';

  const fmt0 = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

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
          {TFS.map(t => (
            <button key={t} className={`gsc-tf-btn${tf === t ? ' on' : ''}`} onClick={() => { setTf(t); setResult(null); }}>
              {t}
            </button>
          ))}
          <button
            className="gsc-analyze-btn"
            onClick={analyze}
            disabled={analyzing || loading || !candles.length}
          >
            {analyzing ? '⏳ Analyzing…' : '⚡ Analyze'}
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="gsc-canvas-wrap">
        {loading && <div className="gsc-overlay">Loading chart…</div>}
        {error && !loading && <div className="gsc-overlay gsc-overlay-err">{error}</div>}
        <canvas
          ref={canvasRef}
          className="gsc-canvas"
          style={{ height: CHART_H }}
        />
      </div>

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
              <span>Take profit</span>
              <span>${fmt0(l.price)}</span>
            </div>
          ))}
          {result.levels.filter(l => l.type === 'sl').map((l, i) => (
            <div key={i} className="gsc-chip gsc-chip-sl">
              <span>Stop loss</span>
              <span>${fmt0(l.price)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
