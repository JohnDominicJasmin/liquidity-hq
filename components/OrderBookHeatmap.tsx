'use client';
import { useEffect, useRef, useState, useCallback } from 'react';

interface Snapshot {
  ts: number;
  bids: { price: number; qty: number }[];
  asks: { price: number; qty: number }[];
}

const BUFFER_SIZE = 300; // 5 min at 1 snap/sec
const ROWS        = 20;  // depth rows each side

export default function OrderBookHeatmap() {
  const canvasRef       = useRef<HTMLCanvasElement>(null);
  const containerRef    = useRef<HTMLDivElement>(null);

  /* circular buffer (all refs → zero state churn during live data) */
  const bufferRef         = useRef<Snapshot[]>(new Array(BUFFER_SIZE));
  const headRef           = useRef(0);
  const countRef          = useRef(0);
  const lastDrawCountRef  = useRef(-1); // -1 forces first draw
  const lastTsRef         = useRef(0);  // throttle gate (1 snap/sec)

  /* display state — updated infrequently */
  const [wsStatus,  setWsStatus]  = useState<'connecting' | 'live' | 'error'>('connecting');
  const [snapCount, setSnapCount] = useState(0);
  const snapDisplayRef = useRef(0);

  const wsRef  = useRef<WebSocket | null>(null);
  const rafRef = useRef<number>(0);

  /* ── WebSocket ─────────────────────────────────────────────── */
  const connect = useCallback(() => {
    const PRIMARY  = 'wss://stream.binance.com:9443/stream?streams=btcusdt@depth20@100ms';
    const FALLBACK = 'wss://stream.binance.com/stream?streams=btcusdt@depth20@100ms';

    function tryConnect(url: string, isFallback: boolean) {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => setWsStatus('live');

      ws.onerror = () => {
        if (!isFallback) {
          ws.close();
          tryConnect(FALLBACK, true);
        } else {
          setWsStatus('error');
        }
      };

      ws.onclose = () => {
        setWsStatus('error');
        setTimeout(() => {
          if (wsRef.current?.readyState !== WebSocket.OPEN) connect();
        }, 3000);
      };

      ws.onmessage = (ev) => {
        try {
          const now = Date.now();
          if (now - lastTsRef.current < 900) return; // ~1 snap/sec
          lastTsRef.current = now;

          const msg = JSON.parse(ev.data as string);
          const d   = msg?.data;
          if (!Array.isArray(d?.bids) || !Array.isArray(d?.asks)) return;

          const snap: Snapshot = {
            ts:   now,
            bids: (d.bids as [string, string][])
              .slice(0, ROWS)
              .map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) })),
            asks: (d.asks as [string, string][])
              .slice(0, ROWS)
              .map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) })),
          };

          bufferRef.current[headRef.current] = snap;
          headRef.current = (headRef.current + 1) % BUFFER_SIZE;
          if (countRef.current < BUFFER_SIZE) countRef.current++;

          snapDisplayRef.current++;
          if (snapDisplayRef.current % 10 === 0) setSnapCount(snapDisplayRef.current);
        } catch {
          /* ignore parse errors */
        }
      };
    }

    tryConnect(PRIMARY, false);
  }, []);

  /* ── rAF draw loop ─────────────────────────────────────────── */
  useEffect(() => {
    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);

      const count = countRef.current;
      if (count === 0 || count === lastDrawCountRef.current) return;
      lastDrawCountRef.current = count;

      const canvas    = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const dpr = window.devicePixelRatio || 1;
      const W   = container.clientWidth;
      if (W === 0) return;
      const H   = W < 520 ? 250 : 400;

      /* resize canvas backing store if needed */
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width        = Math.round(W * dpr);
        canvas.height       = Math.round(H * dpr);
        canvas.style.width  = W + 'px';
        canvas.style.height = H + 'px';
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      /* reset transform each frame — prevents scale accumulation */
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      /* ── read ordered snapshots (oldest → newest) ── */
      const snaps: Snapshot[] = [];
      if (count < BUFFER_SIZE) {
        for (let i = 0; i < count; i++) snaps.push(bufferRef.current[i]);
      } else {
        for (let i = 0; i < BUFFER_SIZE; i++) {
          snaps.push(bufferRef.current[(headRef.current + i) % BUFFER_SIZE]);
        }
      }
      const numCols = snaps.length;
      if (numCols === 0) return;

      /* ── layout ── */
      const RIGHT_LABEL_W = 64;
      const BOTTOM_H      = 18;
      const plotW = W - RIGHT_LABEL_W;
      const plotH = H - BOTTOM_H;
      const cellW = plotW / numCols;
      const halfH = plotH / 2; // ask section height = bid section height

      /* ── latest snapshot for Y-axis anchor ── */
      const latest   = snaps[snaps.length - 1];
      const latestAsks = [...latest.asks].sort((a, b) => a.price - b.price).slice(0, ROWS);
      const latestBids = [...latest.bids].sort((a, b) => b.price - a.price).slice(0, ROWS);

      /* ── max qty normalisation (per side, across all snaps) ── */
      let maxAsk = 0.001, maxBid = 0.001;
      for (const s of snaps) {
        for (const a of s.asks) if (a.qty > maxAsk) maxAsk = a.qty;
        for (const b of s.bids) if (b.qty > maxBid) maxBid = b.qty;
      }

      const rowHask = halfH / ROWS;
      const rowHbid = halfH / ROWS;

      /* ── draw cells ── */
      for (let col = 0; col < numCols; col++) {
        const snap = snaps[col];
        const x = col * cellW;
        const cw = Math.ceil(cellW) + 0.5; // avoid hairline gaps

        /* asks — sorted ascending, lowest ask nearest midpoint */
        const asks = [...snap.asks].sort((a, b) => a.price - b.price).slice(0, ROWS);
        for (let row = 0; row < asks.length; row++) {
          const alpha = 0.04 + (asks[row].qty / maxAsk) * 0.93;
          ctx.fillStyle = `rgba(248,113,113,${alpha.toFixed(3)})`;
          const y = halfH - (row + 1) * rowHask;
          ctx.fillRect(x, y, cw, Math.ceil(rowHask) + 0.5);
        }

        /* bids — sorted descending, highest bid nearest midpoint */
        const bids = [...snap.bids].sort((a, b) => b.price - a.price).slice(0, ROWS);
        for (let row = 0; row < bids.length; row++) {
          const alpha = 0.04 + (bids[row].qty / maxBid) * 0.93;
          ctx.fillStyle = `rgba(52,211,153,${alpha.toFixed(3)})`;
          const y = halfH + row * rowHbid;
          ctx.fillRect(x, y, cw, Math.ceil(rowHbid) + 0.5);
        }
      }

      /* ── mid-price dashed line ── */
      const midPrice = latestBids[0] && latestAsks[0]
        ? (latestBids[0].price + latestAsks[0].price) / 2
        : 0;

      ctx.save();
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, halfH);
      ctx.lineTo(plotW, halfH);
      ctx.stroke();
      ctx.setLineDash([]);

      /* mid-price label floating on line */
      if (midPrice > 0) {
        const label = '$' + midPrice.toLocaleString('en-US', { maximumFractionDigits: 0 });
        ctx.font = 'bold 10px Inter, system-ui, sans-serif';
        ctx.textAlign = 'left';
        const tw = ctx.measureText(label).width + 6;
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(6, halfH - 10, tw, 13);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, 9, halfH - 1);
      }
      ctx.restore();

      /* ── right axis: price labels ── */
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.92)';
      ctx.fillRect(plotW, 0, RIGHT_LABEL_W, plotH);

      /* separator */
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(plotW, 0);
      ctx.lineTo(plotW, plotH);
      ctx.stroke();

      ctx.font = '9px "JetBrains Mono", "SF Mono", monospace';
      ctx.textAlign = 'left';

      /* ask prices every 5th row */
      for (let i = 0; i < ROWS; i += 4) {
        const p = latestAsks[i]?.price;
        if (!p) continue;
        const y = halfH - (i + 1) * rowHask + rowHask * 0.5 + 3;
        ctx.fillStyle = 'rgba(248,113,113,0.7)';
        ctx.fillText('$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 }), plotW + 4, y);
      }

      /* bid prices every 5th row */
      for (let i = 0; i < ROWS; i += 4) {
        const p = latestBids[i]?.price;
        if (!p) continue;
        const y = halfH + i * rowHbid + rowHbid * 0.5 + 3;
        ctx.fillStyle = 'rgba(52,211,153,0.7)';
        ctx.fillText('$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 }), plotW + 4, y);
      }
      ctx.restore();

      /* ── bottom axis: time labels ── */
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.92)';
      ctx.fillRect(0, plotH, plotW, BOTTOM_H);
      ctx.font = '9px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#48484a';
      ctx.textAlign = 'center';

      const labelEvery = Math.max(30, Math.floor(numCols / 8)); // ~8 labels across
      for (let col = 0; col < numCols; col += labelEvery) {
        const snap = snaps[col];
        if (!snap) continue;
        const d   = new Date(snap.ts);
        const lbl = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
        ctx.fillText(lbl, col * cellW + cellW / 2, plotH + BOTTOM_H - 4);
      }
      ctx.restore();

      /* ── legend ── */
      ctx.save();
      ctx.font = '9px Inter, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(248,113,113,0.85)';
      ctx.fillText('▬ Asks', plotW - 82, 13);
      ctx.fillStyle = 'rgba(52,211,153,0.85)';
      ctx.fillText('▬ Bids', plotW - 82, 25);
      ctx.restore();
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  /* ── mount / unmount ─────────────────────────────────────── */
  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  /* ── ResizeObserver ──────────────────────────────────────── */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      lastDrawCountRef.current = -1; // force redraw on resize
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="heatmap-wrap">
      {/* header */}
      <div className="heatmap-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#e8e8e8' }}>📈 Order Book Heatmap</span>
          <span className={`heatmap-dot heatmap-dot-${wsStatus}`} title={wsStatus} />
        </div>
        <span style={{ fontSize: 11, color: '#444' }}>BTC/USDT · 20-level depth · 5 min window</span>
      </div>

      {/* canvas container */}
      <div ref={containerRef} style={{ width: '100%', position: 'relative', background: '#0a0a0a' }}>
        <canvas ref={canvasRef} className="heatmap-canvas" />
        {countRef.current === 0 && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#444', fontSize: 12, pointerEvents: 'none',
          }}>
            {wsStatus === 'connecting' ? 'Connecting to Binance depth stream…' : 'Waiting for order book data…'}
          </div>
        )}
      </div>

      {/* status bar */}
      <div className="heatmap-status">
        <span className={`heatmap-dot heatmap-dot-${wsStatus}`} />
        <span style={{ fontSize: 11, color: '#606060' }}>
          {wsStatus === 'live'
            ? `Live · ${snapCount} snapshots captured`
            : wsStatus === 'connecting'
            ? 'Connecting…'
            : 'Reconnecting…'}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#383838' }}>
          Bright = thick wall · Faded = thin book · Red = asks · Green = bids
        </span>
      </div>
    </div>
  );
}
