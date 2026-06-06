'use client';
import { useState, useEffect, useRef } from 'react';

/* ── Config ── */
const BUFFER_SIZE = 300;   // 5 min at 1 snap/sec
const DEPTH       = 20;    // levels per side

/* ── Types ── */
type WsStatus = 'connecting' | 'live' | 'error';
interface Snap { ts: number; bids: [number, number][]; asks: [number, number][] }
// [price, qty] — sorted bids desc, asks asc on write

export default function OrderBookHeatmap({ symbol = 'BTCUSDT' }: { symbol?: string }) {
  const [wsStatus, setWsStatus]   = useState<WsStatus>('connecting');
  const [snapCount, setSnapCount] = useState(0);

  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /* ── Circular buffer (all refs — zero state churn) ── */
  const bufferRef       = useRef<Snap[]>(new Array(BUFFER_SIZE));
  const headRef         = useRef(0);
  const countRef        = useRef(0);
  const lastMsgRef      = useRef(0);  // throttle gate
  const lastDrawRef     = useRef(-1); // skip identical frames

  /* ── WebSocket ── */
  useEffect(() => {
    const sym = symbol.toLowerCase();
    const URLS = [
      `wss://stream.binance.com:9443/stream?streams=${sym}@depth20@100ms`,
      `wss://stream.binance.com/stream?streams=${sym}@depth20@100ms`,
    ];
    let ws: WebSocket;
    let urlIdx = 0;
    let dead   = false;

    function connect() {
      if (dead) return;
      setWsStatus('connecting');
      ws = new WebSocket(URLS[urlIdx % URLS.length]);

      ws.onopen = () => { if (!dead) setWsStatus('live'); };

      ws.onmessage = (e) => {
        const now = Date.now();
        if (now - lastMsgRef.current < 900) return;   // ~1 snap/sec
        lastMsgRef.current = now;
        try {
          const outer = JSON.parse(e.data as string);
          const d = outer.data ?? outer;
          const bids = (d.bids as string[][] ?? [])
            .slice(0, DEPTH)
            .map(([p, q]) => [parseFloat(p), parseFloat(q)] as [number, number])
            .sort((a, b) => b[0] - a[0]); // desc
          const asks = (d.asks as string[][] ?? [])
            .slice(0, DEPTH)
            .map(([p, q]) => [parseFloat(p), parseFloat(q)] as [number, number])
            .sort((a, b) => a[0] - b[0]); // asc
          bufferRef.current[headRef.current] = { ts: now, bids, asks };
          headRef.current = (headRef.current + 1) % BUFFER_SIZE;
          if (countRef.current < BUFFER_SIZE) countRef.current++;
          if (countRef.current % 10 === 0) setSnapCount(countRef.current);
        } catch { /* ignore */ }
      };

      const retry = () => {
        if (dead) return;
        setWsStatus('error');
        setTimeout(() => { urlIdx++; connect(); }, 3000);
      };
      ws.onerror = retry;
      ws.onclose = retry;
    }

    connect();
    return () => { dead = true; try { ws?.close(); } catch { /* */ } };
  }, [symbol]);

  /* ── rAF render loop ── */
  useEffect(() => {
    let rafId: number;
    let dead  = false;

    function draw() {
      if (dead) return;
      rafId = requestAnimationFrame(draw);
      const count = countRef.current;
      if (count === lastDrawRef.current || count === 0) return;
      lastDrawRef.current = count;

      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      /* Read buffer oldest → newest */
      const snaps: Snap[] = [];
      if (count < BUFFER_SIZE) {
        for (let i = 0; i < count; i++) snaps.push(bufferRef.current[i]);
      } else {
        for (let i = 0; i < BUFFER_SIZE; i++) {
          snaps.push(bufferRef.current[(headRef.current + i) % BUFFER_SIZE]);
        }
      }

      const W = canvas.width;
      const H = canvas.height;
      const dpr = window.devicePixelRatio || 1;

      /* Reserve right margin for price labels, bottom for time labels */
      const LABEL_RIGHT  = Math.round(58 * dpr);
      const LABEL_BOTTOM = Math.round(16 * dpr);
      const CHART_W = W - LABEL_RIGHT;
      const CHART_H = H - LABEL_BOTTOM;

      ctx.fillStyle = '#0b0b0d';
      ctx.fillRect(0, 0, W, H);

      const cols  = snaps.length;
      const rows  = DEPTH * 2;   // 20 asks (top) + 20 bids (bottom)
      const colW  = CHART_W / Math.max(cols, 1);
      const rowH  = CHART_H / rows;

      /* Max qty normalization per side across visible snaps */
      let maxBid = 1, maxAsk = 1;
      for (const s of snaps) {
        for (const [, q] of s.bids) if (q > maxBid) maxBid = q;
        for (const [, q] of s.asks) if (q > maxAsk) maxAsk = q;
      }

      /* Draw cells */
      snaps.forEach((snap, ci) => {
        const x = ci * colW;
        /* Asks occupy rows 0 to DEPTH-1 (top = deepest = highest price) */
        for (let r = 0; r < DEPTH; r++) {
          const level = snap.asks[DEPTH - 1 - r]; // r=0 → deepest ask
          if (!level) continue;
          const [, qty] = level;
          if (qty <= 0) continue;
          const alpha = 0.04 + (qty / maxAsk) * 0.96;
          ctx.fillStyle = `rgba(248,113,113,${alpha.toFixed(3)})`;
          ctx.fillRect(x, r * rowH, Math.max(colW, 1), rowH + 0.5);
        }
        /* Bids occupy rows DEPTH to DEPTH*2-1 (top = best bid = highest price) */
        for (let r = 0; r < DEPTH; r++) {
          const level = snap.bids[r]; // r=0 → best bid
          if (!level) continue;
          const [, qty] = level;
          if (qty <= 0) continue;
          const alpha = 0.04 + (qty / maxBid) * 0.96;
          ctx.fillStyle = `rgba(52,211,153,${alpha.toFixed(3)})`;
          ctx.fillRect(x, (DEPTH + r) * rowH, Math.max(colW, 1), rowH + 0.5);
        }
      });

      /* Mid-price line between ask[0] and bid[0] */
      const midY = DEPTH * rowH;
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = dpr;
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(CHART_W, midY);
      ctx.stroke();
      ctx.setLineDash([]);

      /* Price labels (right edge, every 5th row, from latest snap) */
      const latest = snaps[snaps.length - 1];
      if (latest) {
        ctx.fillStyle = '#3a3a3a';
        ctx.font = `${Math.round(8 * dpr)}px monospace`;
        ctx.textAlign = 'left';

        /* Ask labels (top half) — row r corresponds to ask[DEPTH-1-r] */
        for (let r = 0; r < DEPTH; r += 5) {
          const level = latest.asks[DEPTH - 1 - r];
          if (!level) continue;
          const label = '$' + level[0].toLocaleString('en-US', { maximumFractionDigits: 0 });
          ctx.fillText(label, CHART_W + 4 * dpr, r * rowH + rowH * 0.6 + 2 * dpr);
        }
        /* Bid labels (bottom half) — row r corresponds to bid[r] */
        for (let r = 0; r < DEPTH; r += 5) {
          const level = latest.bids[r];
          if (!level) continue;
          const label = '$' + level[0].toLocaleString('en-US', { maximumFractionDigits: 0 });
          ctx.fillText(label, CHART_W + 4 * dpr, (DEPTH + r) * rowH + rowH * 0.6 + 2 * dpr);
        }

        /* Mid-price label */
        const bestBid = latest.bids[0]?.[0];
        const bestAsk = latest.asks[0]?.[0];
        if (bestBid && bestAsk) {
          const mid = (bestBid + bestAsk) / 2;
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.font = `bold ${Math.round(9 * dpr)}px monospace`;
          ctx.fillText('$' + mid.toLocaleString('en-US', { maximumFractionDigits: 1 }), CHART_W + 4 * dpr, midY + 3 * dpr);
        }
      }

      /* Time labels (bottom, every 60 cols ≈ 1 min) */
      ctx.fillStyle = '#2a2a2a';
      ctx.font = `${Math.round(8 * dpr)}px monospace`;
      ctx.textAlign = 'center';
      snaps.forEach((snap, ci) => {
        if (ci % 60 !== 0) return;
        const t = new Date(snap.ts);
        const label = t.getHours().toString().padStart(2, '0') + ':' + t.getMinutes().toString().padStart(2, '0');
        ctx.fillText(label, ci * colW + colW / 2, H - 4 * dpr);
      });
    }

    rafId = requestAnimationFrame(draw);
    return () => { dead = true; cancelAnimationFrame(rafId); };
  }, []);

  /* ── ResizeObserver ── */
  useEffect(() => {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const cssW = container!.clientWidth;
      const cssH = cssW < 520 ? 260 : 420;
      canvas!.width  = cssW * dpr;
      canvas!.height = cssH * dpr;
      canvas!.style.width  = cssW + 'px';
      canvas!.style.height = cssH + 'px';
      lastDrawRef.current = -1; // force redraw after resize
    }

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const coin = symbol.replace('USDT', '');

  return (
    <div className="heatmap-wrap" ref={containerRef}>
      <canvas ref={canvasRef} className="heatmap-canvas" />
      <div className="heatmap-status">
        <span className={`heatmap-dot heatmap-dot-${wsStatus}`} />
        <span>
          {wsStatus === 'connecting' ? 'Connecting to Binance…'
          : wsStatus === 'error'     ? 'Reconnecting…'
          : snapCount < 10           ? `Building buffer… ${snapCount} / 300`
          : `Live · ${snapCount} snaps · ${(snapCount / 60).toFixed(1)} min history`}
        </span>
        <span style={{ marginLeft: 'auto', color: '#2a2a2a' }}>
          {coin} depth 20 · 1s interval · 🟢 bids / 🔴 asks
        </span>
      </div>
    </div>
  );
}
