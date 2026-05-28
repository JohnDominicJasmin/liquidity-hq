'use client';

import { useEffect, useRef, useState } from 'react';

/* ─────────────────────────────────────────────
   Types
───────────────────────────────────────────── */
interface Level { price: number; qty: number; }

interface Snapshot {
  ts:   number;
  bids: Level[];   // 20 levels, highest bid first
  asks: Level[];   // 20 levels, lowest ask first
}

/* ─────────────────────────────────────────────
   Constants
───────────────────────────────────────────── */
const BUFFER_SIZE  = 300;   // 5 min at 1 snap/sec
const SNAP_MS      = 1000;  // throttle: 1 snapshot per second
const ROWS         = 40;    // 20 asks (top) + 20 bids (bottom)
const H_DESKTOP    = 420;
const H_MOBILE     = 260;
const MOBILE_BP    = 520;

const WS_PRIMARY   = 'wss://stream.binance.com:9443/stream?streams=btcusdt@depth20@100ms';
const WS_FALLBACK  = 'wss://stream.binance.com/stream?streams=btcusdt@depth20@100ms';

const BID_COLOR    = [52,  211, 153] as const;  // --green
const ASK_COLOR    = [248, 113, 113] as const;  // --red

/* ─────────────────────────────────────────────
   Component
───────────────────────────────────────────── */
export default function OrderBookHeatmap() {
  const canvasRef       = useRef<HTMLCanvasElement>(null);
  const containerRef    = useRef<HTMLDivElement>(null);
  const wsRef           = useRef<WebSocket | null>(null);
  const reconnTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef          = useRef<number>(0);
  const lastSnapTimeRef = useRef<number>(0);
  const lastDrawCntRef  = useRef<number>(-1);
  const dpRef           = useRef<number>(1);

  // Circular buffer stored entirely in refs — zero React state churn during live data
  const bufferRef = useRef<Snapshot[]>(new Array(BUFFER_SIZE));
  const headRef   = useRef<number>(0);
  const countRef  = useRef<number>(0);

  const [wsStatus,  setWsStatus]  = useState<'connecting' | 'live' | 'error'>('connecting');
  const [snapCount, setSnapCount] = useState<number>(0);

  /* ── WebSocket ─────────────────────────────── */
  useEffect(() => {
    let useFallback = false;

    function connect() {
      const url = useFallback ? WS_FALLBACK : WS_PRIMARY;
      const ws  = new WebSocket(url);
      wsRef.current = ws;
      setWsStatus('connecting');

      ws.onopen = () => setWsStatus('live');

      ws.onmessage = (ev: MessageEvent) => {
        // Throttle: only record 1 snapshot per second
        const now = Date.now();
        if (now - lastSnapTimeRef.current < SNAP_MS) return;
        lastSnapTimeRef.current = now;

        try {
          const msg = JSON.parse(ev.data as string) as {
            data?: { bids: [string, string][]; asks: [string, string][] };
          };
          const d = msg.data;
          if (!d?.bids || !d?.asks) return;

          const snap: Snapshot = {
            ts:   now,
            bids: d.bids.map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) })),
            asks: d.asks.map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) })),
          };

          // Write into circular buffer
          bufferRef.current[headRef.current] = snap;
          headRef.current = (headRef.current + 1) % BUFFER_SIZE;
          if (countRef.current < BUFFER_SIZE) countRef.current++;

          // Update React state only every 10 snaps (for the progress label)
          if (countRef.current % 10 === 0) {
            setSnapCount(countRef.current);
          }
        } catch { /* malformed frame — ignore */ }
      };

      ws.onclose = () => {
        setWsStatus('error');
        if (!useFallback) useFallback = true;
        reconnTimerRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => ws.close();
    }

    connect();

    return () => {
      if (reconnTimerRef.current) clearTimeout(reconnTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  /* ── rAF draw loop ─────────────────────────── */
  useEffect(() => {
    function draw() {
      // Skip if no new data arrived since last paint
      if (countRef.current !== lastDrawCntRef.current) {
        lastDrawCntRef.current = countRef.current;
        renderHeatmap();
      }
      rafRef.current = requestAnimationFrame(draw);
    }
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  /* ── ResizeObserver ─────────────────────────── */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const w       = entry.contentRect.width;
      const isMob   = w < MOBILE_BP;
      const logH    = isMob ? H_MOBILE : H_DESKTOP;
      const dpr     = window.devicePixelRatio || 1;
      dpRef.current = dpr;

      canvas.style.width  = '100%';
      canvas.style.height = logH + 'px';
      canvas.width        = Math.floor(w * dpr);
      canvas.height       = logH * dpr;

      // Force a redraw on resize
      lastDrawCntRef.current = -1;
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── Canvas renderer ─────────────────────────── */
  function renderHeatmap() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W   = canvas.width;
    const H   = canvas.height;
    const dpr = dpRef.current;
    const cnt = countRef.current;

    ctx.clearRect(0, 0, W, H);

    if (cnt === 0) {
      // Loading placeholder
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.font      = `${13 * dpr}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for order book data…', W / 2, H / 2);
      return;
    }

    // ── Collect snapshots in chronological order ──
    const start = cnt < BUFFER_SIZE ? 0 : headRef.current;
    const snaps: Snapshot[] = new Array(cnt);
    for (let i = 0; i < cnt; i++) {
      snaps[i] = bufferRef.current[(start + i) % BUFFER_SIZE];
    }

    const latest = snaps[snaps.length - 1];

    // ── Build stable Y axis from latest snapshot ──
    // Rows: 0..19 = asks (highest ask first), 20..39 = bids (highest bid first)
    const asksSorted = latest.asks.slice().sort((a, b) => b.price - a.price);
    const bidsSorted = latest.bids.slice().sort((a, b) => b.price - a.price);
    const priceLevels = [...asksSorted, ...bidsSorted];

    if (priceLevels.length < ROWS) return; // not enough data yet

    // ── Global max qty per side (for colour normalisation) ──
    let maxBid = 0;
    let maxAsk = 0;
    for (const s of snaps) {
      for (const b of s.bids) if (b.qty > maxBid) maxBid = b.qty;
      for (const a of s.asks) if (a.qty > maxAsk) maxAsk = a.qty;
    }
    if (maxBid === 0) maxBid = 1;
    if (maxAsk === 0) maxAsk = 1;

    // ── Cell dimensions ──
    const cols  = cnt;
    const cellW = W / cols;
    const cellH = H / ROWS;

    // ── Draw cells ──
    for (let xi = 0; xi < cols; xi++) {
      const snap = snaps[xi];

      for (let yi = 0; yi < ROWS; yi++) {
        const isAsk   = yi < 20;
        const level   = priceLevels[yi];
        const side    = isAsk ? snap.asks : snap.bids;
        const maxQ    = isAsk ? maxAsk   : maxBid;
        const col     = isAsk ? ASK_COLOR : BID_COLOR;

        // Find matching level (price within 0.01%)
        let qty = 0;
        for (let k = 0; k < side.length; k++) {
          if (Math.abs(side[k].price - level.price) / level.price < 0.0001) {
            qty = side[k].qty;
            break;
          }
        }

        const alpha = 0.05 + (qty / maxQ) * 0.95;
        ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${alpha.toFixed(3)})`;
        ctx.fillRect(
          Math.floor(xi * cellW),
          Math.floor(yi * cellH),
          Math.ceil(cellW),
          Math.ceil(cellH),
        );
      }
    }

    // ── Mid-price line ──
    const midPrice    = (latest.asks[0].price + latest.bids[0].price) / 2;
    const topPrice    = priceLevels[0].price;
    const botPrice    = priceLevels[ROWS - 1].price;
    const priceRange  = topPrice - botPrice;
    const midY        = priceRange > 0
      ? ((topPrice - midPrice) / priceRange) * H
      : H / 2;

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth   = dpr;
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(W, midY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Mid-price label
    ctx.fillStyle = '#ffffff';
    ctx.font      = `bold ${11 * dpr}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText('$' + Math.round(midPrice).toLocaleString(), 6 * dpr, midY - 4 * dpr);
    ctx.restore();

    // ── Price labels (Y axis, right edge) ──
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font      = `${10 * dpr}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'right';
    for (let yi = 0; yi < ROWS; yi += 5) {
      const price = priceLevels[yi].price;
      const yPx   = (yi + 0.5) * cellH;
      ctx.fillText('$' + Math.round(price).toLocaleString(), W - 4 * dpr, yPx + 3 * dpr);
    }
    ctx.restore();

    // ── Time labels (X axis, bottom) ──
    if (cols > 10) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font      = `${10 * dpr}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      const step = Math.max(30, Math.floor(cols / 5));
      for (let xi = 0; xi < cols; xi += step) {
        const ts  = snaps[xi].ts;
        const lbl = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const xPx = (xi + 0.5) * cellW;
        ctx.fillText(lbl, xPx, H - 3 * dpr);
      }
      ctx.restore();
    }

    // ── Spread zone divider (thin line between bids and asks rows) ──
    const spreadY = 20 * cellH;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth   = dpr * 0.5;
    ctx.beginPath();
    ctx.moveTo(0, spreadY);
    ctx.lineTo(W, spreadY);
    ctx.stroke();
    ctx.restore();
  }

  /* ── Status text ─────────────────────────────── */
  const pct    = Math.min(100, Math.round((snapCount / BUFFER_SIZE) * 100));
  const secStr = snapCount >= BUFFER_SIZE
    ? '5m of history'
    : `${snapCount}s / ${BUFFER_SIZE}s`;

  return (
    <div ref={containerRef} className="heatmap-wrap">
      <canvas ref={canvasRef} className="heatmap-canvas" />

      {/* Legend */}
      <div className="heatmap-legend">
        <div className="heatmap-legend-item">
          <div className="heatmap-legend-swatch" style={{ background: 'rgba(52,211,153,0.8)' }} />
          <span>Bids (buy orders)</span>
        </div>
        <div className="heatmap-legend-item">
          <div className="heatmap-legend-swatch" style={{ background: 'rgba(248,113,113,0.8)' }} />
          <span>Asks (sell orders)</span>
        </div>
        <div className="heatmap-legend-item" style={{ marginLeft: 'auto', opacity: 0.6 }}>
          <span>Brighter = bigger wall</span>
        </div>
      </div>

      {/* Status bar */}
      <div className="heatmap-status">
        <div className={`heatmap-dot heatmap-dot-${wsStatus}`} />
        {wsStatus === 'live' && <span>LIVE · BTC/USDT depth</span>}
        {wsStatus === 'connecting' && <span>Connecting to Binance…</span>}
        {wsStatus === 'error' && <span>Reconnecting…</span>}
        {wsStatus === 'live' && snapCount > 0 && (
          <span style={{ marginLeft: 'auto' }}>
            {pct < 100
              ? `Building history: ${secStr} (${pct}%)`
              : `5 min · 1s resolution · 20-level depth`}
          </span>
        )}
      </div>
    </div>
  );
}
