'use client';

import { useEffect, useRef, useState } from 'react';

/* ─── Constants ─────────────────────────────────────────────── */
const COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB'] as const;
type Coin = typeof COINS[number];

const SYMS: Record<Coin, string> = {
  BTC: 'btcusdt', ETH: 'ethusdt', SOL: 'solusdt', XRP: 'xrpusdt', BNB: 'bnbusdt',
};

const LEVELS   = 20;         // levels per side
const ROWS     = LEVELS * 2; // 40 total rows
const LERP     = 0.15;       // animation speed (0 = frozen, 1 = instant)
const BG       = '#0d0d0d';
const GREEN    = '#7de0a4';
const GREEN_DIM = 'rgba(125,224,164,';
const RED      = '#ff9a92';
const RED_DIM  = 'rgba(255,154,146,';
const MID_LINE = 'rgba(255,255,255,0.55)';

/* ─── Types ─────────────────────────────────────────────────── */
interface Level { price: number; qty: number; }

interface Tooltip {
  side:  'bid' | 'ask';
  price: number;
  qty:   number;
  cssx:  number;   // CSS x (for DOM tooltip)
  cssy:  number;   // CSS y (for DOM tooltip)
}

/* ─── Helpers ────────────────────────────────────────────────── */
function fmtPrice(p: number): string {
  if (p < 1)    return p.toFixed(5);
  if (p < 10)   return p.toFixed(4);
  if (p < 1000) return p.toFixed(2);
  return Math.round(p).toLocaleString();
}
function fmtQty(q: number, coin: Coin): string {
  const s = coin === 'BTC' || coin === 'ETH' ? 4 : 2;
  return q >= 1000 ? (q / 1000).toFixed(1) + 'K' : q.toFixed(s);
}

/* ─── Component ─────────────────────────────────────────────── */
export default function OrderBookDepth() {
  /* refs */
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const wrapRef      = useRef<HTMLDivElement>(null);
  const wsRef        = useRef<WebSocket | null>(null);
  const rafRef       = useRef<number>(0);
  const dpRef        = useRef<number>(1);

  // data refs (never trigger re-render)
  const targetBids   = useRef<Level[]>([]);
  const targetAsks   = useRef<Level[]>([]);
  const animBids     = useRef<Level[]>([]);
  const animAsks     = useRef<Level[]>([]);
  const hoverRowRef  = useRef<number | null>(null); // row index under mouse

  /* state (triggers re-render only for UI chrome) */
  const [coin, setCoin]         = useState<Coin>('BTC');
  const [wsStatus, setWsStatus] = useState<'connecting' | 'live' | 'error'>('connecting');
  const [spread, setSpread]     = useState<{ abs: number; pct: number } | null>(null);
  const [tooltip, setTooltip]   = useState<Tooltip | null>(null);

  /* ── WebSocket ─────────────────────────────────────────────── */
  useEffect(() => {
    // reset data on coin switch
    targetBids.current = [];
    targetAsks.current = [];
    animBids.current   = [];
    animAsks.current   = [];
    setSpread(null);
    setTooltip(null);
    hoverRowRef.current = null;

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
        try {
          const d = JSON.parse(ev.data as string) as {
            bids: [string, string][];
            asks: [string, string][];
          };

          // Binance: bids descending (best bid first), asks ascending (best ask first)
          targetBids.current = d.bids.map(([p, q]) => ({ price: +p, qty: +q }));
          targetAsks.current = d.asks.map(([p, q]) => ({ price: +p, qty: +q }));

          if (d.bids.length && d.asks.length) {
            const bestBid = +d.bids[0][0];
            const bestAsk = +d.asks[0][0];
            const mid     = (bestBid + bestAsk) / 2;
            setSpread({ abs: bestAsk - bestBid, pct: ((bestAsk - bestBid) / mid) * 100 });
          }
        } catch { /* ignore malformed */ }
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
      lerpBook();
      render();
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coin]); // re-start loop on coin change so fmtQty picks up new coin

  /* ── ResizeObserver ────────────────────────────────────────── */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const w   = entries[0].contentRect.width;
      const dpr = window.devicePixelRatio || 1;
      dpRef.current     = dpr;
      const logH        = w < 480 ? 520 : 620;
      canvas.style.width  = '100%';
      canvas.style.height = logH + 'px';
      canvas.width  = Math.floor(w * dpr);
      canvas.height = logH * dpr;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── Lerp ──────────────────────────────────────────────────── */
  function lerpBook() {
    const tb = targetBids.current;
    const ta = targetAsks.current;
    if (!tb.length || !ta.length) return;

    // Init from target on first data or length change
    if (animBids.current.length !== tb.length) {
      animBids.current = tb.map(l => ({ ...l }));
    }
    if (animAsks.current.length !== ta.length) {
      animAsks.current = ta.map(l => ({ ...l }));
    }

    const n = Math.min(animBids.current.length, tb.length);
    for (let i = 0; i < n; i++) {
      animBids.current[i].price = tb[i].price; // price snaps (no visual drift needed)
      animBids.current[i].qty  += (tb[i].qty - animBids.current[i].qty) * LERP;
    }
    const m = Math.min(animAsks.current.length, ta.length);
    for (let i = 0; i < m; i++) {
      animAsks.current[i].price = ta[i].price;
      animAsks.current[i].qty  += (ta[i].qty - animAsks.current[i].qty) * LERP;
    }
  }

  /* ── Renderer ──────────────────────────────────────────────── */
  function render() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W   = canvas.width;
    const H   = canvas.height;
    const dpr = dpRef.current;

    const bids = animBids.current;
    const asks = animAsks.current;

    // ── Background ──
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    if (!bids.length || !asks.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font      = `${13 * dpr}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('Connecting to order book…', W / 2, H / 2);
      return;
    }

    // ── Layout metrics ──
    const PRICE_W  = 78 * dpr;              // center price column width
    const SIDE_W   = (W - PRICE_W) / 2;     // left (bids) and right (asks) bar area
    const PRICE_X  = SIDE_W;                // X where price column starts
    const ASK_X    = PRICE_X + PRICE_W;     // X where ask bars start
    const ROW_H    = H / ROWS;
    const BAR_PAD  = Math.max(1, ROW_H * 0.1);   // vertical padding inside row
    const BAR_H    = ROW_H - BAR_PAD * 2;

    // ── Global max qty (normalize both sides together for fair comparison) ──
    let maxAll = 0;
    for (const b of bids) if (b.qty > maxAll) maxAll = b.qty;
    for (const a of asks) if (a.qty > maxAll) maxAll = a.qty;
    if (maxAll < 1e-9) maxAll = 1;

    // ── Top 3 wall thresholds ──
    const bidsSorted = [...bids].sort((a, b) => b.qty - a.qty);
    const asksSorted = [...asks].sort((a, b) => b.qty - a.qty);
    const bidTop3    = bidsSorted[2]?.qty ?? 0;
    const askTop3    = asksSorted[2]?.qty ?? 0;

    // ── Draw rows ──
    // Layout:
    //  rows  0..LEVELS-1 → asks (yi=0 = highest ask, yi=LEVELS-1 = best ask nearest spread)
    //  rows LEVELS..ROWS-1 → bids (yi=LEVELS = best bid nearest spread, yi=ROWS-1 = lowest bid)
    //
    // Binance: asks ascending (asks[0]=best), bids descending (bids[0]=best)
    //  ask row yi → asks[LEVELS-1 - yi]    (flip: row 0 = asks[19] = highest)
    //  bid row yi → bids[yi - LEVELS]      (row LEVELS = bids[0] = best bid)

    const hoverRow = hoverRowRef.current;

    for (let yi = 0; yi < ROWS; yi++) {
      const isAsk  = yi < LEVELS;
      const idx    = isAsk ? (LEVELS - 1 - yi) : (yi - LEVELS);
      const levels = isAsk ? asks : bids;
      if (idx >= levels.length) continue;
      const lv = levels[idx];

      const rowY  = yi * ROW_H;
      const barY  = rowY + BAR_PAD;
      const norm  = lv.qty / maxAll;
      const barW  = norm * SIDE_W;

      const isTop3 = isAsk ? lv.qty >= askTop3 && askTop3 > 0
                           : lv.qty >= bidTop3 && bidTop3 > 0;
      const isHovered = hoverRow === yi;

      // ── Row background (hover + alternating subtle stripe) ──
      if (isHovered) {
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(0, rowY, W, ROW_H);
      } else if (yi % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.012)';
        ctx.fillRect(0, rowY, W, ROW_H);
      }

      // ── Bar ──
      // Top-3 walls: full opacity + slightly lighter colour
      // Others: alpha based on relative size (min 0.2 so thin walls are visible)
      const alpha  = isTop3 ? 1.0 : Math.max(0.18, 0.18 + norm * 0.82);
      const colStr = isAsk
        ? (isTop3 ? RED      : RED_DIM   + alpha.toFixed(3) + ')')
        : (isTop3 ? GREEN    : GREEN_DIM + alpha.toFixed(3) + ')');

      ctx.fillStyle = colStr;
      if (isAsk) {
        ctx.fillRect(ASK_X, barY, barW, BAR_H);
      } else {
        ctx.fillRect(PRICE_X - barW, barY, barW, BAR_H);
      }

      // ── Top-3 accent line (bright edge) ──
      if (isTop3) {
        ctx.fillStyle = isAsk ? 'rgba(255,220,210,0.7)' : 'rgba(200,255,225,0.7)';
        if (isAsk) {
          ctx.fillRect(ASK_X + barW - dpr, barY, dpr * 2, BAR_H);
        } else {
          ctx.fillRect(PRICE_X - barW, barY, dpr * 2, BAR_H);
        }
      }

      // ── Price label (center column) ──
      const rowMidY = rowY + ROW_H / 2 + 3.5 * dpr;
      ctx.fillStyle = isTop3
        ? (isAsk ? 'rgba(255,200,195,0.95)' : 'rgba(170,255,210,0.95)')
        : 'rgba(200,200,200,0.55)';
      ctx.font      = `${isTop3 ? 'bold ' : ''}${10 * dpr}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('$' + fmtPrice(lv.price), PRICE_X + PRICE_W / 2, rowMidY);

      // ── Qty label (outside the bar end) ──
      if (norm > 0.04) { // only show if bar is wide enough
        ctx.fillStyle = isTop3 ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.28)';
        ctx.font      = `${9 * dpr}px Inter, system-ui, sans-serif`;
        if (isAsk) {
          ctx.textAlign = 'left';
          ctx.fillText(fmtQty(lv.qty, coin), ASK_X + barW + 3 * dpr, rowMidY);
        } else {
          ctx.textAlign = 'right';
          ctx.fillText(fmtQty(lv.qty, coin), PRICE_X - barW - 3 * dpr, rowMidY);
        }
      }
    }

    // ── Thin horizontal separators ──
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    for (let yi = 1; yi < ROWS; yi++) {
      ctx.fillRect(0, Math.round(yi * ROW_H), W, 1);
    }

    // ── Center price column borders ──
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(PRICE_X,             0, 1,       H);
    ctx.fillRect(PRICE_X + PRICE_W - 1, 0, 1,     H);

    // ── Mid-price dashed line ──
    const midY = LEVELS * ROW_H;
    ctx.save();
    ctx.strokeStyle = MID_LINE;
    ctx.lineWidth   = dpr;
    ctx.setLineDash([5 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(W, midY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // ── Mid-price label ──
    if (bids.length > 0 && asks.length > 0) {
      const midPrice  = (bids[0].price + asks[0].price) / 2;
      const midLabel  = '  $' + fmtPrice(midPrice) + '  ';
      ctx.font        = `bold ${10 * dpr}px Inter, system-ui, sans-serif`;
      const lblW      = ctx.measureText(midLabel).width;
      const lblX      = PRICE_X + (PRICE_W - lblW) / 2;
      ctx.fillStyle   = 'rgba(10,10,10,0.85)';
      ctx.fillRect(lblX, midY - 12 * dpr, lblW, 12 * dpr);
      ctx.fillStyle   = '#ffffff';
      ctx.textAlign   = 'left';
      ctx.fillText(midLabel, lblX, midY - 3 * dpr);
    }

    // ── Column headers ──
    ctx.font      = `bold ${10 * dpr}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(125,224,164,0.5)';
    ctx.textAlign = 'right';
    ctx.fillText('◄ BIDS', PRICE_X - 8 * dpr, 15 * dpr);
    ctx.fillStyle = 'rgba(255,154,146,0.5)';
    ctx.textAlign = 'left';
    ctx.fillText('ASKS ►', ASK_X + 8 * dpr, 15 * dpr);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.textAlign = 'center';
    ctx.fillText('PRICE', PRICE_X + PRICE_W / 2, 15 * dpr);

    // ── Top-3 legend (bottom-right corner) ──
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.font      = `${9 * dpr}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText('★ = top 3 wall', W - 8 * dpr, H - 6 * dpr);
  }

  /* ── Mouse handlers ────────────────────────────────────────── */
  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect  = canvas.getBoundingClientRect();
    const cssY  = e.clientY - rect.top;
    const dpr   = dpRef.current;
    const H     = canvas.height;
    const ROW_H = H / ROWS;
    const yi    = Math.floor((cssY * dpr) / ROW_H);

    if (yi < 0 || yi >= ROWS) {
      hoverRowRef.current = null;
      setTooltip(null);
      return;
    }

    hoverRowRef.current = yi;

    const isAsk = yi < LEVELS;
    const idx   = isAsk ? (LEVELS - 1 - yi) : (yi - LEVELS);
    const lv    = isAsk ? animAsks.current[idx] : animBids.current[idx];
    if (!lv) { setTooltip(null); return; }

    setTooltip({
      side:  isAsk ? 'ask' : 'bid',
      price: lv.price,
      qty:   lv.qty,
      cssx:  e.clientX - rect.left,
      cssy:  cssY,
    });
  }

  function handleMouseLeave() {
    hoverRowRef.current = null;
    setTooltip(null);
  }

  /* ── Spread formatting ─────────────────────────────────────── */
  const spreadTxt = spread
    ? `$${spread.abs < 1 ? spread.abs.toFixed(4) : spread.abs.toFixed(2)}  (${spread.pct.toFixed(3)}%)`
    : '—';

  /* ── JSX ───────────────────────────────────────────────────── */
  return (
    <div className="depth-outer">
      {/* Header: coin tabs + spread + status dot */}
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
          title={wsStatus === 'live' ? 'Live' : wsStatus === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
        />
      </div>

      {/* Canvas + tooltip */}
      <div ref={wrapRef} style={{ position: 'relative', background: BG }}>
        <canvas
          ref={canvasRef}
          className="heatmap-canvas"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />

        {/* HTML tooltip overlay */}
        {tooltip && (
          <div
            style={{
              position:      'absolute',
              left:          Math.min(tooltip.cssx + 14, (wrapRef.current?.clientWidth ?? 400) - 160),
              top:           Math.max(tooltip.cssy - 12, 4),
              background:    'rgba(12,12,12,0.96)',
              border:        `1px solid ${tooltip.side === 'ask' ? RED : GREEN}`,
              borderRadius:  6,
              padding:       '7px 11px',
              pointerEvents: 'none',
              zIndex:        20,
              minWidth:      140,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', marginBottom: 3 }}>
              ${fmtPrice(tooltip.price)}
            </div>
            <div style={{ fontSize: 10, color: tooltip.side === 'ask' ? RED : GREEN }}>
              {fmtQty(tooltip.qty, coin)} {coin}
            </div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>
              {tooltip.side === 'ask' ? 'ASK (sell wall)' : 'BID (buy wall)'}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="depth-footer">
        <span style={{ color: GREEN, fontWeight: 600 }}>■</span> Bids
        <span style={{ margin: '0 10px', opacity: 0.3 }}>|</span>
        <span style={{ color: RED, fontWeight: 600 }}>■</span> Asks
        <span style={{ margin: '0 10px', opacity: 0.3 }}>|</span>
        Bar width = order size
        <span style={{ margin: '0 10px', opacity: 0.3 }}>|</span>
        Brighter edge = top 3 wall
        <span style={{ marginLeft: 'auto', opacity: 0.45 }}>
          {wsStatus === 'live' ? `LIVE · ${coin}/USDT · 20-level depth` : wsStatus}
        </span>
      </div>
    </div>
  );
}
