'use client';
import { useEffect, useRef, useState } from 'react';
import { useMarket, BINANCE_SYMS } from '@/lib/marketStore';

const TFS = ['5m', '15m', '1h', '4h'] as const;
type TF = typeof TFS[number];
type WsStatus = 'connecting' | 'live' | 'error';

const API_KEY   = 'xai-oCDU5hc5nANrylf2x59rY1blsSvXbefwm0rnP6BSypnO6nijulzN6znv5Bepv2POY4L6EdBULh4GYNCO';
const CHART_H   = 480;
const DISPLAY_N = 80;
const FETCH_N   = 300;

interface Candle { t: number; o: number; h: number; l: number; c: number; v: number; }
interface ChartLevel { price: number; label: string; type: 'support' | 'resistance' | 'tp' | 'sl' | 'entry'; }
interface ChartResult {
  signal: 'LONG' | 'SHORT' | 'FLAT';
  levels: ChartLevel[];
  entryLow: number | null;
  entryHigh: number | null;
  analysis: string;
}

// ── Indicator helpers ──────────────────────────────────────────────────────

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
  const gains: number[] = [];
  const losses: number[] = [];
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

// ── Grok chart prompt / parse ──────────────────────────────────────────────

function buildChartPrompt(coin: string, tf: string, candles: Candle[]): string {
  const vis    = candles.slice(-DISPLAY_N);
  const last   = vis[vis.length - 1];
  const hi     = Math.max(...vis.map(c => c.h));
  const lo     = Math.min(...vis.map(c => c.l));
  const closes = candles.map(c => c.c);
  const e9     = calcEMA(closes, 9).at(-1);
  const e200   = calcEMA(closes, 200).at(-1);
  const recent = vis.slice(-20).map(c =>
    `O:${c.o.toFixed(0)} H:${c.h.toFixed(0)} L:${c.l.toFixed(0)} C:${c.c.toFixed(0)}`
  ).join(' | ');
  return `You are a professional derivatives trader doing technical chart analysis.
Coin: ${coin.toUpperCase()} | Timeframe: ${tf} | Price: $${last.c.toFixed(0)}
Range: High $${hi.toFixed(0)} / Low $${lo.toFixed(0)}
EMA 9: $${e9?.toFixed(0) ?? '—'} | EMA 200: $${e200?.toFixed(0) ?? '—'}
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

// ── Canvas renderer ────────────────────────────────────────────────────────

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

  const dark    = document.documentElement.getAttribute('data-theme') !== 'light';
  const BG      = dark ? '#0f0f0f' : '#f9f9f9';
  const GRID    = dark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.04)';
  const LABEL   = dark ? '#383838' : '#aaa';
  const GREEN   = '#34d399';
  const RED     = '#f87171';
  const EMA9C   = '#fbbf24';
  const EMA200C = '#818cf8';
  const RSIC    = '#a78bfa';

  // ── Panel layout ──
  const MAIN_RATIO = 0.70;
  const mainH      = Math.floor(H * MAIN_RATIO);
  const SEP        = 5;
  const rsiY0      = mainH + SEP;
  const rsiTotalH  = H - rsiY0;
  const MP = { t: 14, r: 72, b: 2, l: 4 };
  const RP = { t: 6,  r: 72, b: 18, l: 4 };
  const mcW = W - MP.l - MP.r;
  const mcH = mainH - MP.t - MP.b;
  const rcH = rsiTotalH - RP.t - RP.b;

  // ── Slice visible + compute indicators ──
  const vis     = candles.slice(-DISPLAY_N);
  const offset  = candles.length - vis.length;
  const closes  = candles.map(c => c.c);
  const ema9v   = calcEMA(closes, 9).slice(offset);
  const ema200v = calcEMA(closes, 200).slice(offset);
  const rsiv    = calcRSI(closes, 14).slice(offset);
  const slotW   = mcW / vis.length;

  // ── Price range ──
  let lo = Math.min(...vis.map(c => c.l));
  let hi = Math.max(...vis.map(c => c.h));
  ema9v.forEach(v => { if (v) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
  ema200v.forEach(v => { if (v) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
  result?.levels.forEach(lv => { if (lv.price > 0) { lo = Math.min(lo, lv.price); hi = Math.max(hi, lv.price); } });
  if (result?.entryLow)  lo = Math.min(lo, result.entryLow);
  if (result?.entryHigh) hi = Math.max(hi, result.entryHigh);
  const pp = (hi - lo) * 0.04;
  lo -= pp; hi += pp;
  const pr = hi - lo;
  const toY  = (p: number) => MP.t + mcH * (1 - (p - lo) / pr);

  // ── RSI scale ──
  const RI_LO = 15, RI_HI = 85;
  const toRY = (v: number) => rsiY0 + RP.t + rcH * (1 - (v - RI_LO) / (RI_HI - RI_LO));

  // ── Background ──
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // ── Main panel grid lines + price labels ──
  for (let i = 0; i <= 4; i++) {
    const p = lo + (pr / 4) * i;
    const y = toY(p);
    ctx.strokeStyle = GRID; ctx.lineWidth = 0.5; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(MP.l, y); ctx.lineTo(W - MP.r, y); ctx.stroke();
    ctx.fillStyle = LABEL; ctx.font = '9px sans-serif'; ctx.textAlign = 'right';
    const lbl = p >= 10000 ? '$' + (p / 1000).toFixed(1) + 'K'
              : p >= 1000  ? '$' + p.toFixed(0)
              : '$' + p.toFixed(4);
    ctx.fillText(lbl, W - 3, y - 2);
  }

  // ── Volume bars (bottom 10% of main panel) ──
  const maxVol = Math.max(...vis.map(c => c.v)) || 1;
  const volH   = mcH * 0.10;
  vis.forEach((c, i) => {
    const bX = MP.l + i * slotW;
    const bW = Math.max(1, slotW * 0.75);
    const bH = (c.v / maxVol) * volH;
    ctx.fillStyle = c.c >= c.o ? 'rgba(52,211,153,0.15)' : 'rgba(248,113,113,0.15)';
    ctx.fillRect(bX + (slotW - bW) / 2, mainH - MP.b - bH, bW, bH);
  });

  // ── Candles ──
  vis.forEach((c, i) => {
    const isUp  = c.c >= c.o;
    const col   = isUp ? GREEN : RED;
    const midX  = MP.l + (i + 0.5) * slotW;
    const bW    = Math.max(2, slotW * 0.72);
    const bX    = MP.l + i * slotW + (slotW - bW) / 2;
    const bodyT = Math.min(toY(c.o), toY(c.c));
    const bodyH = Math.max(1.5, Math.abs(toY(c.c) - toY(c.o)));
    ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(midX, toY(c.h)); ctx.lineTo(midX, toY(c.l)); ctx.stroke();
    ctx.fillStyle = col;
    ctx.fillRect(bX, bodyT, bW, bodyH);
  });

  // ── EMA 200 (behind EMA 9) ──
  ctx.strokeStyle = EMA200C + 'bb'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
  ctx.beginPath(); let s200 = false;
  ema200v.forEach((v, i) => {
    if (!v) return;
    const x = MP.l + (i + 0.5) * slotW, y = toY(v);
    s200 ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), (s200 = true));
  });
  ctx.stroke();

  // ── EMA 9 ──
  ctx.strokeStyle = EMA9C + 'cc'; ctx.lineWidth = 1.2; ctx.setLineDash([]);
  ctx.beginPath(); let s9 = false;
  ema9v.forEach((v, i) => {
    if (!v) return;
    const x = MP.l + (i + 0.5) * slotW, y = toY(v);
    s9 ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), (s9 = true));
  });
  ctx.stroke();

  // ── EMA legend (top-left of main panel) ──
  ctx.font = '9px sans-serif'; ctx.textAlign = 'left';
  ctx.fillStyle = EMA9C + 'cc';   ctx.fillText('EMA 9',   MP.l + 4,  MP.t + 12);
  ctx.fillStyle = EMA200C + 'bb'; ctx.fillText('EMA 200', MP.l + 54, MP.t + 12);

  // ── Grok level overlays ──
  if (result) {
    const LC: Record<string, string> = { support: GREEN, resistance: RED, entry: '#a78bfa', tp: GREEN, sl: '#ef4444' };
    if (result.entryLow && result.entryHigh) {
      const y1 = toY(result.entryHigh), y2 = toY(result.entryLow);
      ctx.fillStyle = 'rgba(167,139,250,0.06)';
      ctx.fillRect(MP.l, y1, mcW, y2 - y1);
      ctx.strokeStyle = 'rgba(167,139,250,0.25)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(MP.l, y1); ctx.lineTo(W - MP.r, y1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(MP.l, y2); ctx.lineTo(W - MP.r, y2); ctx.stroke();
      ctx.setLineDash([]);
    }
    result.levels.forEach(lv => {
      if (!lv.price) return;
      const y = toY(lv.price);
      if (y < 0 || y > mainH) return;
      const col = LC[lv.type] ?? '#a78bfa';
      ctx.strokeStyle = col + 'bb'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(MP.l, y); ctx.lineTo(W - MP.r - 2, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col; ctx.font = '9px sans-serif'; ctx.textAlign = 'right';
      ctx.fillText('$' + lv.price.toLocaleString(undefined, { maximumFractionDigits: 0 }), W - 3, y - 2);
      ctx.fillStyle = col + '80'; ctx.font = '8px sans-serif';
      ctx.fillText(lv.label.slice(0, 16), W - 3, y + 8);
    });
  }

  // ── RSI PANEL ──────────────────────────────────────────────────────────
  ctx.fillStyle = dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)';
  ctx.fillRect(0, mainH, W, SEP);
  ctx.fillStyle = dark ? '#0d0d0d' : '#f5f5f5';
  ctx.fillRect(0, rsiY0, W, rsiTotalH);

  const refLines = [{ v: 70, col: RED + '44', lbl: '70' }, { v: 50, col: GRID, lbl: '50' }, { v: 30, col: GREEN + '44', lbl: '30' }];
  refLines.forEach(({ v, col, lbl }) => {
    const y = toRY(v);
    ctx.strokeStyle = col; ctx.lineWidth = 0.5; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(RP.l, y); ctx.lineTo(W - RP.r, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = LABEL; ctx.font = '8px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(lbl, W - 3, y - 1);
  });

  ctx.strokeStyle = RSIC; ctx.lineWidth = 1.5; ctx.setLineDash([]);
  ctx.beginPath(); let sr = false;
  rsiv.forEach((v, i) => {
    if (v == null) return;
    const cv = Math.max(RI_LO, Math.min(RI_HI, v));
    const x  = RP.l + (i + 0.5) * slotW;
    const y  = toRY(cv);
    sr ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), (sr = true));
  });
  ctx.stroke();

  let lastRsi: number | null = null;
  for (let i = rsiv.length - 1; i >= 0; i--) { if (rsiv[i] != null) { lastRsi = rsiv[i] as number; break; } }
  const rsiValCol = lastRsi != null ? (lastRsi >= 70 ? RED : lastRsi <= 30 ? GREEN : RSIC) : RSIC;
  ctx.font = '9px sans-serif'; ctx.textAlign = 'left';
  ctx.fillStyle = RSIC + '99'; ctx.fillText('RSI', RP.l + 4, rsiY0 + RP.t + 10);
  if (lastRsi != null) {
    ctx.fillStyle = rsiValCol;
    ctx.fillText(lastRsi.toFixed(1), RP.l + 28, rsiY0 + RP.t + 10);
  }
}

// ── Component ──────────────────────────────────────────────────────────────

export default function GrokSignalChart({ coin: coinProp }: { coin?: string }) {
  const { store } = useMarket();
  const coin      = (coinProp ?? store.selectedCoin) as string;

  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const roRef      = useRef<ResizeObserver | null>(null);
  const wsRef      = useRef<WebSocket | null>(null);
  const retryRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const candlesRef = useRef<Candle[]>([]);   // always-fresh mirror for WS handler
  const resultRef  = useRef<ChartResult | null>(null); // for ResizeObserver

  const [tf, setTf]               = useState<TF>('15m');
  const [candles, setCandles]     = useState<Candle[]>([]);
  const [result, setResult]       = useState<ChartResult | null>(null);
  const [wsStatus, setWsStatus]   = useState<WsStatus>('connecting');
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError]         = useState('');

  // Keep refs in sync with state (for WS/rO callbacks)
  useEffect(() => { candlesRef.current = candles; }, [candles]);
  useEffect(() => { resultRef.current = result; },  [result]);

  // ── REST fetch + WebSocket — runs on coin or tf change ──────────────────
  useEffect(() => {
    const sym = BINANCE_SYMS[coin] as string | undefined;
    if (!sym) { setError('No Binance symbol for ' + coin.toUpperCase()); return; }

    let active = true;
    setError('');
    setResult(null);
    resultRef.current = null;
    setWsStatus('connecting');

    // 1. Load historical candles via REST
    fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${tf}&limit=${FETCH_N}`)
      .then(r => { if (!r.ok) throw new Error('Binance API error'); return r.json(); })
      .then((data: (string | number)[][]) => {
        if (!active) return;
        const cs: Candle[] = data.map(k => ({
          t: Number(k[0]), o: Number(k[1]), h: Number(k[2]),
          l: Number(k[3]), c: Number(k[4]), v: Number(k[5]),
        }));
        candlesRef.current = cs;
        setCandles(cs);
      })
      .catch(() => { if (active) setError('Failed to load chart data'); });

    // 2. Connect Binance kline WebSocket
    function connect() {
      if (!active) return;
      const stream = `${sym!.toLowerCase()}@kline_${tf}`;
      const ws = new WebSocket(`wss://stream.binance.com/ws/${stream}`);
      wsRef.current = ws;

      ws.onopen = () => { if (active) setWsStatus('live'); };

      ws.onerror = () => { if (active) setWsStatus('error'); };

      ws.onclose = () => {
        if (!active) return;
        setWsStatus('error');
        retryRef.current = setTimeout(() => { if (active) connect(); }, 3000);
      };

      ws.onmessage = (evt) => {
        if (!active) return;
        try {
          const msg = JSON.parse(evt.data as string);
          if (msg.e !== 'kline') return;
          const k = msg.k;
          const incoming: Candle = {
            t: k.t,
            o: parseFloat(k.o),
            h: parseFloat(k.h),
            l: parseFloat(k.l),
            c: parseFloat(k.c),
            v: parseFloat(k.v),
          };

          const cur = candlesRef.current;
          if (!cur.length) return; // REST not loaded yet — skip

          let updated: Candle[];
          if (cur[cur.length - 1].t === incoming.t) {
            // Same open-time → update forming candle in place
            updated = [...cur.slice(0, -1), incoming];
          } else {
            // New candle opened (previous closed) → append + trim to FETCH_N
            updated = [...cur, incoming].slice(-FETCH_N);
          }

          candlesRef.current = updated;
          setCandles(updated);
        } catch {
          // ignore malformed frames
        }
      };
    }

    connect();

    return () => {
      active = false;
      retryRef.current && clearTimeout(retryRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [coin, tf]);

  // ── Redraw on new candle data or new Grok result ─────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !candles.length) return;
    drawChart(canvas, candles, result);
  }, [candles, result]);

  // ── ResizeObserver — uses refs so no deps churn ──────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    roRef.current = new ResizeObserver(() => {
      const c = candlesRef.current;
      if (c.length) drawChart(canvas, c, resultRef.current);
    });
    roRef.current.observe(canvas.parentElement ?? canvas);
    return () => roRef.current?.disconnect();
  }, []); // intentionally empty — always reads from refs

  // ── Grok analysis ────────────────────────────────────────────────────────
  const analyze = async () => {
    const cur = candlesRef.current;
    if (!cur.length || analyzing) return;
    setAnalyzing(true); setError('');
    try {
      const res = await fetch('https://api.x.ai/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
        body: JSON.stringify({ model: 'grok-4.3', input: [{ role: 'user', content: buildChartPrompt(coin, tf, cur) }] }),
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
  const fmt0   = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  const noData = candles.length === 0;

  return (
    <div className="gsc-wrap">
      {/* Header */}
      <div className="gsc-header">
        <div className="gsc-title">
          <span>📈</span>
          <span>{coin.toUpperCase()} / USDT</span>
          {/* Live WS status dot */}
          <span className={`gsc-live-dot gsc-live-dot-${wsStatus}`} title={wsStatus} />
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
          <button className="gsc-analyze-btn" onClick={analyze} disabled={analyzing || noData}>
            {analyzing ? '⏳ Analyzing…' : '⚡ Analyze'}
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="gsc-canvas-wrap">
        {noData && wsStatus !== 'error' && <div className="gsc-overlay">Connecting…</div>}
        {error && <div className="gsc-overlay gsc-overlay-err">{error}</div>}
        <canvas ref={canvasRef} className="gsc-canvas" style={{ height: CHART_H }} />
      </div>

      {/* Grok analysis */}
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
