'use client';

import { useEffect, useRef, useState } from 'react';

/* ─── Config ─────────────────────────────────────────────────── */
const COINS    = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB'] as const;
type Coin = typeof COINS[number];

const SYMS: Record<Coin, string> = {
  BTC: 'btcusdt', ETH: 'ethusdt', SOL: 'solusdt', XRP: 'xrpusdt', BNB: 'bnbusdt',
};

const BUFFER  = 300;   // max snapshots (5 min @ 1/sec)
const SNAP_MS = 1000;  // 1 snapshot per second

/* ─── Types ──────────────────────────────────────────────────── */
interface Level    { price: number; qty: number; }
interface Snapshot {
  ts:       number;
  bids:     Level[];   // highest first
  asks:     Level[];   // lowest first
  midPrice: number;
}

/* ─── Heat-map color function ────────────────────────────────── */
// Maps normalised qty 0→1 to a Bookmap-style colour.
// dark → navy → cyan → green → yellow → orange → white
function heatColor(norm: number): string | null {
  if (norm < 0.012) return null;           // skip near-invisible cells

  const t = Math.pow(norm, 0.52);          // sqrt-ish curve for visual spread

  // [threshold, r, g, b, alpha]
  const S = [
    [0.00,   4,   8,  28, 0.00],
    [0.07,   8,  38,  90, 0.28],
    [0.18,   0, 100, 155, 0.58],
    [0.34,   0, 175, 165, 0.78],
    [0.52,  30, 200,  75, 0.88],
    [0.68, 195, 215,   0, 0.94],
    [0.84, 255, 140,   0, 1.00],
    [1.00, 255, 252, 155, 1.00],
  ] as const;

  for (let i = 1; i < S.length; i++) {
    if (t <= S[i][0]) {
      const p = S[i - 1], n = S[i];
      const f = (t - p[0]) / (n[0] - p[0]);
      const r = Math.round(p[1] + (n[1] - p[1]) * f);
      const g = Math.round(p[2] + (n[2] - p[2]) * f);
      const b = Math.round(p[3] + (n[3] - p[3]) * f);
      const a = p[4] + (n[4] - p[4]) * f;
      return `rgba(${r},${g},${b},${a.toFixed(3)})`;
    }
  }
  return 'rgba(255,252,155,1.0)';
}

/* ─── Component ──────────────────────────────────────────────── */
export default function BookmapChart() {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const wrapRef     = useRef<HTMLDivElement>(null);
  const wsRef       = useRef<WebSocket | null>(null);
  const rafRef      = useRef<number>(0);
  const dpRef       = useRef<number>(1);
  const lastSnapRef = useRef<number>(0);

  // Circular buffer (all in refs — zero re-renders during live data)
  const bufRef   = useRef<Snapshot[]>(new Array(BUFFER));
  const headRef  = useRef<number>(0);
  const cntRef   = useRef<number>(0);
  const drawCntRef = useRef<number>(-1);

  const [coin, setCoin]         = useState<Coin>('BTC');
  const [wsStatus, setWsStatus] = useState<'connecting' | 'live' | 'error'>('connecting');
  const [spread, setSpread]     = useState<{ abs: number; pct: number } | null>(null);

  /* ── WebSocket ─────────────────────────────────────────────── */
  useEffect(() => {
    // Reset buffer on coin switch
    cntRef.current  = 0;
    headRef.current = 0;
    drawCntRef.current = -1;
    setSpread(null);

    let closed = false;
    let reconnTimer: ReturnType<typeof setTimeout> | null = null;

    function connect(fallback = false) {
      if (closed) return;
      const sym = SYMS[coin];
      const url = fallback
        ? `wss://stream.binance.com/ws/${sym}@depth20@100ms`
        : `wss://stream.binance.com:9443/ws/${sym}@depth20@100ms`;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      setWsStatus('connecting');

      ws.onopen  = () => { if (!closed) setWsStatus('live'); };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (closed) return;
        setWsStatus('error');
        reconnTimer = setTimeout(() => connect(true), 3000);
      };

      ws.onmessage = (ev: MessageEvent) => {
        if (closed) return;
        const now = Date.now();
        if (now - lastSnapRef.current < SNAP_MS) return;
        lastSnapRef.current = now;

        try {
          const d = JSON.parse(ev.data as string) as {
            bids: [string, string][];
            asks: [string, string][];
          };
          if (!d.bids?.length || !d.asks?.length) return;

          const bids = d.bids.map(([p, q]) => ({ price: +p, qty: +q }));
          const asks = d.asks.map(([p, q]) => ({ price: +p, qty: +q }));
          const mid  = (bids[0].price + asks[0].price) / 2;

          // Write into circular buffer
          bufRef.current[headRef.current] = { ts: now, bids, asks, midPrice: mid };
          headRef.current = (headRef.current + 1) % BUFFER;
          if (cntRef.current < BUFFER) cntRef.current++;

          // Update spread in React state (cheap – only every snap)
          const sp = asks[0].price - bids[0].price;
          setSpread({ abs: sp, pct: (sp / mid) * 100 });
        } catch { /* ignore */ }
      };
    }

    connect();
    return () => {
      closed = true;
      if (reconnTimer) clearTimeout(reconnTimer);
      wsRef.current?.close();
    };
  }, [coin]);

  /* ── rAF loop ──────────────────────────────────────────────── */
  useEffect(() => {
    function loop() {
      if (cntRef.current !== drawCntRef.current) {
        drawCntRef.current = cntRef.current;
        render();
      }
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── ResizeObserver ────────────────────────────────────────── */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const w   = entries[0].contentRect.width;
      const dpr = window.devicePixelRatio || 1;
      dpRef.current = dpr;
      const logH = w < 520 ? 340 : 480;
      canvas.style.width  = '100%';
      canvas.style.height = logH + 'px';
      canvas.width  = Math.floor(w * dpr);
      canvas.height = logH * dpr;
      drawCntRef.current = -1;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── Renderer ──────────────────────────────────────────────── */
  function render() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W   = canvas.width;
    const H   = canvas.height;
    const dpr = dpRef.current;
    const cnt = cntRef.current;

    // Dark base
    ctx.fillStyle = '#050507';
    ctx.fillRect(0, 0, W, H);

    if (cnt === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font      = `${13 * dpr}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('Connecting to Binance order book…', W / 2, H / 2);
      return;
    }

    // ── Collect snapshots (chronological order) ──
    const start = cnt < BUFFER ? 0 : headRef.current;
    const snaps: Snapshot[] = new Array(cnt);
    for (let i = 0; i < cnt; i++) {
      snaps[i] = bufRef.current[(start + i) % BUFFER];
    }
    const latest = snaps[snaps.length - 1];

    // ── Dynamic Y-axis price range (based on latest book spread) ──
    // Covers the full depth of the order book + 25% padding
    const allLatestPrices = [
      ...latest.bids.map(b => b.price),
      ...latest.asks.map(a => a.price),
    ];
    const rawLow  = Math.min(...allLatestPrices);
    const rawHigh = Math.max(...allLatestPrices);
    const spread  = rawHigh - rawLow;
    const pad     = spread * 0.25;
    const topPx   = rawHigh + pad;   // top price on canvas
    const botPx   = rawLow  - pad;   // bottom price on canvas
    const pxRange = topPx - botPx;
    if (pxRange <= 0) return;

    function priceToY(p: number): number {
      return ((topPx - p) / pxRange) * H;
    }

    // ── 95th-percentile normalization for vivid colour contrast ──
    const allQty: number[] = [];
    for (const s of snaps) {
      for (const b of s.bids) allQty.push(b.qty);
      for (const a of s.asks) allQty.push(a.qty);
    }
    allQty.sort((a, b) => a - b);
    const p95 = allQty[Math.floor(allQty.length * 0.95)] || 1;

    // ── Cell dimensions ──
    const cellW  = W / cnt;
    // Level height = height of one price bucket in pixels
    const levelH = Math.max(dpr * 1.5, (spread / 20) / pxRange * H);

    // ── Draw heatmap cells ──
    for (let xi = 0; xi < cnt; xi++) {
      const snap  = snaps[xi];
      const xLeft = Math.floor(xi * cellW);
      const colW  = Math.max(1, Math.ceil((xi + 1) * cellW) - xLeft);

      // Bids
      for (const lv of snap.bids) {
        const y = priceToY(lv.price);
        if (y < -levelH || y > H + levelH) continue;
        const norm  = Math.min(1, lv.qty / p95);
        const color = heatColor(norm);
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(xLeft, y - levelH * 0.5, colW, levelH);
      }

      // Asks
      for (const lv of snap.asks) {
        const y = priceToY(lv.price);
        if (y < -levelH || y > H + levelH) continue;
        const norm  = Math.min(1, lv.qty / p95);
        const color = heatColor(norm);
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(xLeft, y - levelH * 0.5, colW, levelH);
      }
    }

    // ── Mid-price trajectory line ──
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth   = dpr * 1.5;
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    for (let xi = 0; xi < cnt; xi++) {
      const y = priceToY(snaps[xi].midPrice);
      const x = (xi + 0.5) * cellW;
      xi === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    // ── Current price dot ──
    const curY = priceToY(latest.midPrice);
    ctx.save();
    ctx.fillStyle   = '#ffffff';
    ctx.shadowColor = 'rgba(255,255,255,0.7)';
    ctx.shadowBlur  = 6 * dpr;
    ctx.beginPath();
    ctx.arc(W - cellW * 0.5, curY, 3.5 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ── Price axis (right edge) ──
    const labelStep = pxRange / 6;   // ~6 labels
    const firstLabelPrice = Math.ceil(botPx / labelStep) * labelStep;
    ctx.save();
    ctx.fillStyle  = 'rgba(255,255,255,0.28)';
    ctx.font       = `${10 * dpr}px Inter, system-ui, sans-serif`;
    ctx.textAlign  = 'right';
    for (let p = firstLabelPrice; p <= topPx; p += labelStep) {
      const y = priceToY(p);
      if (y < 8 * dpr || y > H - 8 * dpr) continue;
      // Subtle tick line
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(0, y, W, dpr);
      // Price label
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      const lbl = p >= 1000 ? '$' + Math.round(p).toLocaleString()
                : p >= 1    ? '$' + p.toFixed(2)
                :              '$' + p.toFixed(4);
      ctx.fillText(lbl, W - 5 * dpr, y - 2 * dpr);
    }
    ctx.restore();

    // ── Current price label ──
    const priceStr = latest.midPrice >= 1000
      ? '$' + Math.round(latest.midPrice).toLocaleString()
      : latest.midPrice >= 1
        ? '$' + latest.midPrice.toFixed(2)
        : '$' + latest.midPrice.toFixed(4);
    ctx.save();
    ctx.font         = `bold ${11 * dpr}px Inter, system-ui, sans-serif`;
    const lblW       = ctx.measureText(priceStr).width + 10 * dpr;
    const lblH       = 14 * dpr;
    const lblX       = W - lblW - 3 * dpr;
    const lblY       = curY - lblH * 0.65;
    ctx.fillStyle    = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    // rounded pill background
    ctx.roundRect(lblX, lblY, lblW, lblH, 3 * dpr);
    ctx.fill();
    ctx.fillStyle    = '#050507';
    ctx.textAlign    = 'right';
    ctx.fillText(priceStr, W - 8 * dpr, lblY + 10 * dpr);
    ctx.restore();

    // ── Time labels (bottom row) ──
    if (cnt > 15) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.font      = `${10 * dpr}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      const step = Math.max(30, Math.floor(cnt / 5));
      for (let xi = 0; xi < cnt; xi += step) {
        const lbl = new Date(snaps[xi].ts).toLocaleTimeString([], {
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
        ctx.fillText(lbl, (xi + 0.5) * cellW, H - 5 * dpr);
      }
      ctx.restore();
    }

    // ── Spread / bid-ask band ──
    // Draw a subtle band between best bid and best ask
    const yAsk = priceToY(latest.asks[0].price);
    const yBid = priceToY(latest.bids[0].price);
    if (yAsk < yBid) {
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(0, yAsk, W, yBid - yAsk);
    }

    // ── Colour scale legend ──
    const legW  = 80 * dpr;
    const legH  = 8 * dpr;
    const legX  = 8 * dpr;
    const legY  = H - 28 * dpr;
    const grad  = ctx.createLinearGradient(legX, 0, legX + legW, 0);
    grad.addColorStop(0,    'rgba(4,8,28,0.6)');
    grad.addColorStop(0.2,  'rgba(0,100,155,0.7)');
    grad.addColorStop(0.45, 'rgba(0,175,165,0.85)');
    grad.addColorStop(0.65, 'rgba(195,215,0,0.95)');
    grad.addColorStop(0.85, 'rgba(255,140,0,1)');
    grad.addColorStop(1.0,  'rgba(255,252,155,1)');
    ctx.fillStyle = grad;
    ctx.fillRect(legX, legY, legW, legH);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth   = dpr * 0.5;
    ctx.strokeRect(legX, legY, legW, legH);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font      = `${9 * dpr}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText('small', legX, legY + legH + 10 * dpr);
    ctx.textAlign = 'right';
    ctx.fillText('wall', legX + legW, legY + legH + 10 * dpr);

    // ── Progress bar (history filling) ──
    if (cnt < BUFFER) {
      const pct = cnt / BUFFER;
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(0, H - dpr, W * pct, dpr);
    }
  }

  /* ── Spread text ─────────────────────────────────────────────── */
  const spreadTxt = spread
    ? `$${spread.abs < 1 ? spread.abs.toFixed(4) : spread.abs.toFixed(2)}  (${spread.pct.toFixed(3)}%)`
    : '—';

  /* ── JSX ─────────────────────────────────────────────────────── */
  return (
    <div className="depth-outer">
      {/* Header */}
      <div className="depth-header">
        <div className="depth-tabs">
          {COINS.map(c => (
            <button
              key={c}
              className={`depth-tab${coin === c ? ' depth-tab-on' : ''}`}
              onClick={() => setCoin(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="depth-spread-box">
          <span className="depth-spread-label">SPREAD</span>
          <span className="depth-spread-val">{spreadTxt}</span>
        </div>
        <div
          className={`heatmap-dot heatmap-dot-${wsStatus}`}
          style={{ marginLeft: 6 }}
          title={wsStatus}
        />
      </div>

      {/* Canvas */}
      <div ref={wrapRef} style={{ background: '#050507' }}>
        <canvas ref={canvasRef} className="heatmap-canvas" />
      </div>

      {/* Footer */}
      <div className="depth-footer">
        <span style={{ color: 'rgba(255,252,155,0.8)', fontWeight: 600 }}>■</span> Large wall
        <span style={{ margin: '0 8px', opacity: 0.3 }}>|</span>
        <span style={{ color: 'rgba(0,175,165,0.9)', fontWeight: 600 }}>■</span> Medium
        <span style={{ margin: '0 8px', opacity: 0.3 }}>|</span>
        <span style={{ color: 'rgba(8,38,90,0.9)', fontWeight: 600 }}>■</span> Small
        <span style={{ margin: '0 8px', opacity: 0.3 }}>|</span>
        White line = price path
        <span style={{ marginLeft: 'auto', opacity: 0.4 }}>
          {wsStatus === 'live'
            ? `LIVE · ${coin}/USDT · ${cntRef.current}s history`
            : wsStatus}
        </span>
      </div>
    </div>
  );
}
