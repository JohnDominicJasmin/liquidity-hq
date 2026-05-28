'use client';

import { useEffect, useRef, useState } from 'react';

/* ─────────────────────────────────────────────
   Types
───────────────────────────────────────────── */
interface Level { price: number; qty: number; }

interface Snapshot {
  ts:   number;
  bids: Level[];   // 20 levels, highest bid first  (Binance order)
  asks: Level[];   // 20 levels, lowest ask first   (Binance order)
}

/* ─────────────────────────────────────────────
   Constants
───────────────────────────────────────────── */
const BUFFER_SIZE = 300;    // 5 min at 1 snap/sec
const SNAP_MS     = 1000;   // 1 snapshot per second
const ASK_ROWS    = 20;
const BID_ROWS    = 20;
const ROWS        = ASK_ROWS + BID_ROWS;
const H_DESKTOP   = 440;
const H_MOBILE    = 280;
const MOBILE_BP   = 520;

const WS_PRIMARY  = 'wss://stream.binance.com:9443/stream?streams=btcusdt@depth20@100ms';
const WS_FALLBACK = 'wss://stream.binance.com/stream?streams=btcusdt@depth20@100ms';

const BG_COLOR    = '#0a0a0a';
const ASK_R = 248; const ASK_G = 100; const ASK_B = 100;
const BID_R =  52; const BID_G = 211; const BID_B = 153;

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

  const bufferRef = useRef<Snapshot[]>(new Array(BUFFER_SIZE));
  const headRef   = useRef<number>(0);
  const countRef  = useRef<number>(0);

  const [wsStatus,  setWsStatus]  = useState<'connecting' | 'live' | 'error'>('connecting');
  const [snapCount, setSnapCount] = useState<number>(0);

  /* ── WebSocket ──────────────────────────────── */
  useEffect(() => {
    let useFallback = false;

    function connect() {
      const url = useFallback ? WS_FALLBACK : WS_PRIMARY;
      const ws  = new WebSocket(url);
      wsRef.current = ws;
      setWsStatus('connecting');

      ws.onopen = () => setWsStatus('live');

      ws.onmessage = (ev: MessageEvent) => {
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

          bufferRef.current[headRef.current] = snap;
          headRef.current = (headRef.current + 1) % BUFFER_SIZE;
          if (countRef.current < BUFFER_SIZE) countRef.current++;

          if (countRef.current % 10 === 0) setSnapCount(countRef.current);
        } catch { /* ignore malformed frames */ }
      };

      ws.onclose = () => {
        setWsStatus('error');
        useFallback = true;
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

  /* ── rAF draw loop ──────────────────────────── */
  useEffect(() => {
    function loop() {
      if (countRef.current !== lastDrawCntRef.current) {
        lastDrawCntRef.current = countRef.current;
        render();
      }
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
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
      const w     = entry.contentRect.width;
      const logH  = w < MOBILE_BP ? H_MOBILE : H_DESKTOP;
      const dpr   = window.devicePixelRatio || 1;
      dpRef.current    = dpr;
      canvas.style.width  = '100%';
      canvas.style.height = logH + 'px';
      canvas.width  = Math.floor(w * dpr);
      canvas.height = logH * dpr;
      lastDrawCntRef.current = -1; // force redraw
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── Renderer ───────────────────────────────── */
  function render() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W   = canvas.width;
    const H   = canvas.height;
    const dpr = dpRef.current;
    const cnt = countRef.current;

    // Dark base
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, W, H);

    if (cnt === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.font      = `${13 * dpr}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('Connecting to Binance order book…', W / 2, H / 2);
      return;
    }

    // ── Build chronological snapshot array ──
    const start = cnt < BUFFER_SIZE ? 0 : headRef.current;
    const snaps: Snapshot[] = new Array(cnt);
    for (let i = 0; i < cnt; i++) {
      snaps[i] = bufferRef.current[(start + i) % BUFFER_SIZE];
    }
    const latest = snaps[snaps.length - 1];

    // ── Global max qty per side (for colour normalisation) ──
    let maxBid = 0, maxAsk = 0;
    for (const s of snaps) {
      for (const b of s.bids) if (b.qty > maxBid) maxBid = b.qty;
      for (const a of s.asks) if (a.qty > maxAsk) maxAsk = a.qty;
    }
    if (maxBid < 1) maxBid = 1;
    if (maxAsk < 1) maxAsk = 1;

    const cellW = W / cnt;
    const cellH = H / ROWS;

    // ── Draw cells (index-based — no price matching needed) ──
    // Layout:
    //   rows  0–19 = asks (yi=0 = highest ask / farthest from spread)
    //   rows 20–39 = bids (yi=20 = highest bid / closest to spread)
    //
    // Binance order: asks ascending (asks[0]=best), bids descending (bids[0]=best)
    // Mapping:
    //   ask yi   → asks[19 - yi]   (flip so closest-to-spread is at bottom of ask zone)
    //   bid yi   → bids[yi - 20]   (bids[0]=best bid = just below spread)

    for (let xi = 0; xi < cnt; xi++) {
      const snap  = snaps[xi];
      const xLeft = Math.floor(xi * cellW);
      const colW  = Math.ceil((xi + 1) * cellW) - xLeft;

      for (let yi = 0; yi < ROWS; yi++) {
        const yTop = Math.floor(yi * cellH);
        const rowH = Math.ceil((yi + 1) * cellH) - yTop;

        let qty: number;
        let maxQ: number;
        let isAsk: boolean;

        if (yi < ASK_ROWS) {
          isAsk = true;
          const idx = (ASK_ROWS - 1) - yi;           // flip: yi=0 → asks[19], yi=19 → asks[0]
          qty  = idx < snap.asks.length ? snap.asks[idx].qty : 0;
          maxQ = maxAsk;
        } else {
          isAsk = false;
          const idx = yi - ASK_ROWS;                  // yi=20 → bids[0], yi=39 → bids[19]
          qty  = idx < snap.bids.length ? snap.bids[idx].qty : 0;
          maxQ = maxBid;
        }

        // Non-linear alpha: large walls pop, small orders fade
        const norm  = maxQ > 0 ? qty / maxQ : 0;
        const alpha = Math.pow(norm, 1.4);            // 0→0, small→dim, large→bright

        if (alpha < 0.015) continue;                  // skip near-invisible cells

        const r = isAsk ? ASK_R : BID_R;
        const g = isAsk ? ASK_G : BID_G;
        const b = isAsk ? ASK_B : BID_B;

        // Shift toward white for the very largest walls (>85% intensity)
        if (alpha > 0.85) {
          const blend = (alpha - 0.85) / 0.15;        // 0→1 as alpha goes 0.85→1.0
          const wr = Math.round(r + (255 - r) * blend * 0.6);
          const wg = Math.round(g + (255 - g) * blend * 0.6);
          const wb = Math.round(b + (255 - b) * blend * 0.6);
          ctx.fillStyle = `rgba(${wr},${wg},${wb},${alpha.toFixed(3)})`;
        } else {
          ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
        }
        ctx.fillRect(xLeft, yTop, colW, rowH);
      }
    }

    // ── Thin separator lines between rows (grid) ──
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let yi = 1; yi < ROWS; yi++) {
      const y = Math.floor(yi * cellH);
      ctx.fillRect(0, y, W, 1);
    }

    // ── Spread zone (divider between asks and bids) ──
    const spreadY = ASK_ROWS * cellH;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, spreadY - 1, W, 2);

    // ── Mid-price dashed line ──
    const midPrice = (latest.asks[0].price + latest.bids[0].price) / 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth   = dpr;
    ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.beginPath();
    ctx.moveTo(0, spreadY);
    ctx.lineTo(W, spreadY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Mid-price label background
    const priceLabel = '$' + Math.round(midPrice).toLocaleString();
    ctx.font = `bold ${11 * dpr}px Inter, system-ui, sans-serif`;
    const lblW = ctx.measureText(priceLabel).width + 8 * dpr;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(4 * dpr, spreadY - 16 * dpr, lblW, 14 * dpr);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(priceLabel, 8 * dpr, spreadY - 5 * dpr);
    ctx.restore();

    // ── Price axis labels (right edge) ──
    ctx.save();
    ctx.fillStyle  = 'rgba(255,255,255,0.28)';
    ctx.font       = `${10 * dpr}px Inter, system-ui, sans-serif`;
    ctx.textAlign  = 'right';

    // Ask labels: asks are ascending (asks[0]=best ask=closest to spread=row 19)
    for (let yi = 0; yi < ASK_ROWS; yi += 4) {
      const idx = (ASK_ROWS - 1) - yi;
      if (idx < latest.asks.length) {
        const yPx = (yi + 0.5) * cellH;
        ctx.fillText('$' + Math.round(latest.asks[idx].price).toLocaleString(), W - 4 * dpr, yPx + 3 * dpr);
      }
    }
    // Bid labels: bids[0]=best bid=closest to spread=row 20
    for (let yi = ASK_ROWS; yi < ROWS; yi += 4) {
      const idx = yi - ASK_ROWS;
      if (idx < latest.bids.length) {
        const yPx = (yi + 0.5) * cellH;
        ctx.fillText('$' + Math.round(latest.bids[idx].price).toLocaleString(), W - 4 * dpr, yPx + 3 * dpr);
      }
    }
    ctx.restore();

    // ── Time labels (bottom) ──
    if (cnt > 15) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.font      = `${10 * dpr}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      const step = Math.max(20, Math.floor(cnt / 6));
      for (let xi = 0; xi < cnt; xi += step) {
        const lbl = new Date(snaps[xi].ts).toLocaleTimeString([], {
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
        ctx.fillText(lbl, (xi + 0.5) * cellW, H - 4 * dpr);
      }
      ctx.restore();
    }

    // ── Zone labels (ASKS / BIDS) ──
    ctx.save();
    ctx.fillStyle = 'rgba(248,100,100,0.35)';
    ctx.font      = `bold ${9 * dpr}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText('ASKS', 6 * dpr, 12 * dpr);
    ctx.fillStyle = 'rgba(52,211,153,0.35)';
    ctx.fillText('BIDS', 6 * dpr, spreadY + 12 * dpr);
    ctx.restore();
  }

  /* ── Status / progress ─────────────────────── */
  const pct    = Math.min(100, Math.round((snapCount / BUFFER_SIZE) * 100));
  const secStr = snapCount >= BUFFER_SIZE
    ? '5 min · 1s resolution · 20-level depth'
    : `Building: ${snapCount}s / ${BUFFER_SIZE}s  (${pct}%)`;

  return (
    <div ref={containerRef} className="heatmap-wrap">
      <canvas ref={canvasRef} className="heatmap-canvas" />

      <div className="heatmap-legend">
        <div className="heatmap-legend-item">
          <div className="heatmap-legend-swatch" style={{ background: 'rgba(248,100,100,0.9)' }} />
          <span>Asks — sell orders</span>
        </div>
        <div className="heatmap-legend-item">
          <div className="heatmap-legend-swatch" style={{ background: 'rgba(52,211,153,0.9)' }} />
          <span>Bids — buy orders</span>
        </div>
        <div className="heatmap-legend-item" style={{ opacity: 0.5 }}>
          <span>Brighter = bigger wall · near-white = massive wall</span>
        </div>
      </div>

      <div className="heatmap-status">
        <div className={`heatmap-dot heatmap-dot-${wsStatus}`} />
        {wsStatus === 'live'       && <span>LIVE · BTC/USDT depth</span>}
        {wsStatus === 'connecting' && <span>Connecting to Binance…</span>}
        {wsStatus === 'error'      && <span>Reconnecting…</span>}
        {wsStatus === 'live' && snapCount > 0 && (
          <span style={{ marginLeft: 'auto' }}>{secStr}</span>
        )}
      </div>
    </div>
  );
}
