'use client';
import { useEffect, useRef, useState } from 'react';
import type { Chart as KChart, DataLoader, OverlayCreate, Period } from 'klinecharts';
import { BINANCE_SYMS, BYBIT_SYMS, CoinId, useMarket, computeSqueezeScore } from '@/lib/marketStore';
import type { CombinedResult } from '@/lib/grok';
import type { StrategySignal } from '@/lib/useEMAStrategy';

// ── v10 Period mapping ────────────────────────────────────────────────────

const TF_TO_PERIOD: Record<string, Period> = {
  '1m':  { type: 'minute', span: 1  },
  '5m':  { type: 'minute', span: 5  },
  '15m': { type: 'minute', span: 15 },
  '30m': { type: 'minute', span: 30 },
  '1h':  { type: 'hour',   span: 1  },
  '4h':  { type: 'hour',   span: 4  },
  '1d':  { type: 'day',    span: 1  },
};

function periodToBnInterval(p: Period): string {
  if (p.type === 'minute') return `${p.span}m`;
  if (p.type === 'hour')   return `${p.span}h`;
  if (p.type === 'day')    return `${p.span}d`;
  if (p.type === 'week')   return `${p.span}w`;
  return '15m';
}
function periodToBybitInterval(p: Period): string {
  if (p.type === 'minute') return String(p.span);
  if (p.type === 'hour')   return String(p.span * 60);
  if (p.type === 'day')    return 'D';
  return '15';
}

// ── Drawing tools ─────────────────────────────────────────────────────────

const TOOLS = [
  { id: 'horizontalStraightLine', label: '― H-Line'  },
  { id: 'straightLine',           label: '⟋ Trend'   },
  { id: 'fibonacciLine',          label: '≡ Fib'     },
  { id: 'segment',                label: '╱ Seg'     },
  { id: 'rect',                   label: '▭ Rect'    },
] as const;

// ── Theme configs — use setStyles after init to avoid deep-type gymnastics ──

const DARK: Record<string, unknown> = {
  grid: {
    horizontal: { color: 'rgba(255,255,255,0.04)', size: 1 },
    vertical:   { color: 'rgba(255,255,255,0.04)', size: 1 },
  },
  candle: {
    bar: {
      upColor:            '#26a69a',
      downColor:          '#ef5350',
      upBorderColor:      '#26a69a',
      downBorderColor:    '#ef5350',
      noChangeBorderColor:'#888',
      upWickColor:        '#26a69a',
      downWickColor:      '#ef5350',
    },
    priceMark: {
      high: { show: true, color: 'rgba(255,255,255,0.45)', textSize: 10 },
      low:  { show: true, color: 'rgba(255,255,255,0.45)', textSize: 10 },
      last: {
        show: true,
        line: { show: true, color: 'rgba(255,255,255,0.18)' },
        text: { show: true, color: '#e8e8e8', size: 11 },
      },
    },
  },
  xAxis: {
    tickText: { color: 'rgba(255,255,255,0.35)', size: 10 },
    axisLine: { color: 'rgba(255,255,255,0.07)' },
    tickLine: { color: 'rgba(255,255,255,0.07)' },
  },
  yAxis: {
    tickText: { color: 'rgba(255,255,255,0.35)', size: 10 },
    axisLine: { color: 'rgba(255,255,255,0.07)' },
    tickLine: { color: 'rgba(255,255,255,0.07)' },
  },
  crosshair: {
    horizontal: {
      line:  { color: 'rgba(255,255,255,0.12)' },
      text:  { color: '#e8e8e8', background: '#1e1e1e', size: 11 },
    },
    vertical: {
      line:  { color: 'rgba(255,255,255,0.12)' },
      text:  { color: '#e8e8e8', background: '#1e1e1e', size: 11 },
    },
  },
  overlay: {
    line: { color: '#b8aeff', size: 1 },
  },
};

const LIGHT: Record<string, unknown> = {
  grid: {
    horizontal: { color: 'rgba(0,0,0,0.06)', size: 1 },
    vertical:   { color: 'rgba(0,0,0,0.06)', size: 1 },
  },
  candle: {
    bar: {
      upColor:            '#16a34a',
      downColor:          '#dc2626',
      upBorderColor:      '#16a34a',
      downBorderColor:    '#dc2626',
      noChangeBorderColor:'#888',
      upWickColor:        '#16a34a',
      downWickColor:      '#dc2626',
    },
    priceMark: {
      high: { show: true, color: 'rgba(0,0,0,0.35)', textSize: 10 },
      low:  { show: true, color: 'rgba(0,0,0,0.35)', textSize: 10 },
      last: {
        show: true,
        line: { show: true, color: 'rgba(0,0,0,0.12)' },
        text: { show: true, color: '#1A1916', size: 11 },
      },
    },
  },
  xAxis: {
    tickText: { color: 'rgba(0,0,0,0.4)', size: 10 },
    axisLine: { color: 'rgba(0,0,0,0.08)' },
    tickLine: { color: 'rgba(0,0,0,0.08)' },
  },
  yAxis: {
    tickText: { color: 'rgba(0,0,0,0.4)', size: 10 },
    axisLine: { color: 'rgba(0,0,0,0.08)' },
    tickLine: { color: 'rgba(0,0,0,0.08)' },
  },
  crosshair: {
    horizontal: {
      line:  { color: 'rgba(0,0,0,0.15)' },
      text:  { color: '#1A1916', background: '#E8E5DC', size: 11 },
    },
    vertical: {
      line:  { color: 'rgba(0,0,0,0.15)' },
      text:  { color: '#1A1916', background: '#E8E5DC', size: 11 },
    },
  },
  overlay: {
    line: { color: '#5b21b6', size: 1 },
  },
};

// ── Component ─────────────────────────────────────────────────────────────

export type ChartTf = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export interface ChartAlert {
  id:           string;
  target_price: number;
  direction:    'above' | 'below';
  label?:       string;
}

interface Props {
  coin:          CoinId;
  tf:            ChartTf;
  onTfChange?:   (tf: ChartTf) => void;
  result?:       CombinedResult | null;
  emaSignal?:    StrategySignal | null;
  chartAlerts?:  ChartAlert[];
  onAlertMove?:  (id: string, newPrice: number) => void;
}

const TFS: ChartTf[] = ['1m','5m','15m','30m','1h','4h','1d'];

let emaSignalOverlayRegistered = false;
let srLevelLineRegistered = false;

interface SRLevel { price: number; type: 'support' | 'resistance'; touches: number; }

function computeSRLevels(
  bars: { high: number; low: number; close: number }[],
  currentPrice: number,
): SRLevel[] {
  const lookback = 3;
  const recent = bars.slice(-200);
  const CLUSTER_PCT = 0.003;

  const swingHighs: number[] = [];
  const swingLows: number[] = [];

  for (let i = lookback; i < recent.length - lookback; i++) {
    const hi = recent[i].high;
    const lo = recent[i].low;
    if (
      recent.slice(i - lookback, i).every(b => b.high <= hi) &&
      recent.slice(i + 1, i + lookback + 1).every(b => b.high <= hi)
    ) swingHighs.push(hi);
    if (
      recent.slice(i - lookback, i).every(b => b.low >= lo) &&
      recent.slice(i + 1, i + lookback + 1).every(b => b.low >= lo)
    ) swingLows.push(lo);
  }

  const cluster = (prices: number[]) => {
    const sorted = [...prices].sort((a, b) => a - b);
    const clusters: { price: number; count: number }[] = [];
    for (const p of sorted) {
      const ex = clusters.find(c => Math.abs(c.price - p) / p < CLUSTER_PCT);
      if (ex) { ex.price = (ex.price * ex.count + p) / (ex.count + 1); ex.count++; }
      else clusters.push({ price: p, count: 1 });
    }
    return clusters.sort((a, b) => b.count - a.count);
  };

  const resistances = cluster(swingHighs)
    .filter(c => c.price > currentPrice * 0.999)
    .slice(0, 3)
    .map(c => ({ price: c.price, type: 'resistance' as const, touches: c.count }));

  const supports = cluster(swingLows)
    .filter(c => c.price < currentPrice * 1.001)
    .slice(0, 3)
    .map(c => ({ price: c.price, type: 'support' as const, touches: c.count }));

  return [...resistances, ...supports];
}

export default function KLineProChart({ coin, tf, onTfChange, result, emaSignal, chartAlerts, onAlertMove }: Props) {
  const containerRef   = useRef<HTMLDivElement>(null);
  const wrapRef        = useRef<HTMLDivElement>(null);
  const canvasFadeRef  = useRef<HTMLDivElement>(null);
  const chartRef       = useRef<KChart | null>(null);
  const wsRef          = useRef<{ close: () => void } | null>(null);
  const analysisIds    = useRef<string[]>([]);
  const alertOverlayMap  = useRef<Map<string, string>>(new Map()); // alert.id → overlay id
  const onAlertMoveRef = useRef(onAlertMove);
  const coinRef        = useRef<CoinId>(coin);

  // Screenshot the live canvas → show it as a frozen image while new data loads → crossfade out
  const startFade = () => {
    const el = canvasFadeRef.current;
    if (!el) return;
    const canvas = containerRef.current?.querySelector('canvas');
    if (canvas) {
      try {
        el.style.backgroundImage = `url(${canvas.toDataURL()})`;
      } catch { /* cross-origin guard */ }
    }
    el.style.transition = 'none';
    el.style.opacity = '1';
  };
  const endFade = () => {
    const el = canvasFadeRef.current;
    if (!el) return;
    el.style.transition = 'opacity 0.35s ease';
    el.style.opacity = '0';
    setTimeout(() => { if (canvasFadeRef.current) canvasFadeRef.current.style.backgroundImage = 'none'; }, 400);
  };
  const [activeTool,   setActiveTool]  = useState<string | null>(null);
  const [wsStatus,     setWsStatus]    = useState<'connecting' | 'live' | 'error'>('connecting');
  const [fullscreen,   setFullscreen]  = useState(false);
  const [copiedMsg,    setCopiedMsg]   = useState<string | null>(null);
  const [chartReady,   setChartReady]  = useState(false);
  const [countdown,    setCountdown]   = useState('—');
  const [priceLabelY,  setPriceLabelY] = useState<number | null>(null);
  const lastCloseRef   = useRef<number>(0);
  const copyToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showSR, setShowSR]       = useState(true);
  const [srLevels, setSrLevels]   = useState<SRLevel[]>([]);
  const srSetRef                  = useRef(setSrLevels);
  const [sqHover, setSqHover]     = useState(false);
  const { store } = useMarket();
  const coinData = store.coins[coin];
  const srOverlayIds              = useRef<string[]>([]);
  // Track the last loaded coin/tf so we only re-fetch what actually changed,
  // and a monotonic load token so stale in-flight fetches are dropped on arrival.
  const prevCoinRef    = useRef<CoinId>(coin);
  const prevTfRef      = useRef<ChartTf>(tf);
  const loadGenRef     = useRef(0);

  // ── Candle-close countdown ───────────────────────────────────────────
  useEffect(() => {
    const MS: Record<string, number> = {
      '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
      '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000,
    };
    const periodMs = MS[tf];
    if (!periodMs) return;
    const tick = () => {
      const remain = periodMs - (Date.now() % periodMs);
      const h = Math.floor(remain / 3_600_000);
      const m = Math.floor((remain % 3_600_000) / 60_000);
      const s = Math.floor((remain % 60_000) / 1_000);
      setCountdown(h > 0 ? `${h}h ${String(m).padStart(2,'0')}m` : m > 0 ? `${m}m ${String(s).padStart(2,'0')}s` : `${s}s`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [tf]);

  useEffect(() => { onAlertMoveRef.current = onAlertMove; }, [onAlertMove]);

  // ── Price-label Y position — used to anchor the countdown below the price mark ──
  useEffect(() => {
    if (!chartReady) return;
    const chart = chartRef.current;
    if (!chart) return;

    const compute = () => {
      const price = lastCloseRef.current;
      if (!price) return;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const px = (chart as any).convertToPixel?.({ value: price }, { paneId: 'candle_pane' });
        if (px && typeof px.y === 'number' && isFinite(px.y) && px.y > 0) {
          setPriceLabelY(px.y);
        }
      } catch { /* ignore */ }
    };

    compute();
    // Re-run on zoom / scroll / new data
    const events = ['onVisibleRangeChange', 'onScroll', 'onZoom'] as const;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    events.forEach(ev => (chart as any).subscribeAction?.(ev, compute));
    // Polling fallback: picks up live price movement that doesn't fire scroll/zoom events
    const poll = setInterval(compute, 1500);

    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      events.forEach(ev => (chart as any).unsubscribeAction?.(ev, compute));
      clearInterval(poll);
    };
  }, [chartReady]);

  // ── Theme sync — apply DARK/LIGHT styles when theme changes ─────────────
  useEffect(() => {
    const apply = () => {
      const dark = document.documentElement.getAttribute('data-theme') !== 'light';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chartRef.current?.setStyles((dark ? DARK : LIGHT) as any);
    };
    apply();
    window.addEventListener('theme-change', apply);
    return () => window.removeEventListener('theme-change', apply);
  }, []);

  // Keep coinRef fresh for the DataLoader closure
  useEffect(() => { coinRef.current = coin; }, [coin]);

  // ── Init chart once ──────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;

    (async () => {
      const kc = await import('klinecharts');
      if (disposed || !containerRef.current) return;

      const chart = kc.init(containerRef.current);
      if (!chart) return;
      chartRef.current = chart;

      // Apply current theme via setStyles (avoids DeepPartial type gymnastics)
      const dark = document.documentElement.getAttribute('data-theme') !== 'light';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chart.setStyles((dark ? DARK : LIGHT) as any);

      // Register custom ribbon: EMA 9/20/50 + SMA 200 as one indicator
      kc.registerIndicator({
        name: 'EMARibbon',
        calc: (dataList) => {
          const closes = dataList.map((d: { close: number }) => d.close);
          const n = closes.length;

          const emaArr = (period: number) => {
            const out = new Array<number | null>(n).fill(null);
            if (n < period) return out;
            const k = 2 / (period + 1);
            let e = closes.slice(0, period).reduce((a: number, b: number) => a + b, 0) / period;
            out[period - 1] = e;
            for (let i = period; i < n; i++) { e = closes[i] * k + e * (1 - k); out[i] = e; }
            return out;
          };
          const smaArr = (period: number) => {
            const out = new Array<number | null>(n).fill(null);
            for (let i = period - 1; i < n; i++) {
              out[i] = closes.slice(i - period + 1, i + 1).reduce((a: number, b: number) => a + b, 0) / period;
            }
            return out;
          };

          const e9 = emaArr(9), e20 = emaArr(20), e50 = emaArr(50), s200 = smaArr(200);
          return dataList.map((_: unknown, i: number) => ({ e9: e9[i], e20: e20[i], e50: e50[i], s200: s200[i] }));
        },
        figures: [
          { key: 'e9',   type: 'line' },
          { key: 'e20',  type: 'line' },
          { key: 'e50',  type: 'line' },
          { key: 's200', type: 'line' },
        ],
        styles: {
          lines: [
            { color: '#fbbf24', size: 1   },  // EMA 9  — gold
            { color: '#60a5fa', size: 1.5 },  // EMA 20 — blue
            { color: '#f97316', size: 1.5 },  // EMA 50 — orange
            { color: '#a78bfa', size: 2   },  // SMA 200 — purple
          ],
        },
      });
      chart.createIndicator(
        { name: 'EMARibbon' },
        { isStack: false, pane: { id: 'candle_pane' } }
      );
      chart.createIndicator('VOL', { pane: { height: 60, minHeight: 30 } });

      if (!emaSignalOverlayRegistered) {
        emaSignalOverlayRegistered = true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kc as any).registerOverlay({
          name: 'emaSignal',
          totalStep: 1,
          needDefaultPointFigure: false,
          needDefaultXAxisFigure: false,
          needDefaultYAxisFigure: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          createPointFigures: ({ overlay, coordinates }: { overlay: any; coordinates: Array<{ x: number; y: number }> }) => {
            const { dir } = overlay.extendData as { dir: 'long' | 'short' };
            const coord = coordinates[0];
            if (!coord || !isFinite(coord.x) || !isFinite(coord.y) || coord.y < 0) return [];
            const x = coord.x;
            const y = coord.y;
            if (dir === 'long') {
              return [
                {
                  type: 'polygon',
                  attrs: { coordinates: [{ x, y: y + 4 }, { x: x - 14, y: y + 28 }, { x: x + 14, y: y + 28 }] },
                  styles: { style: 'fill', color: '#22c55e' },
                },
                {
                  type: 'text',
                  attrs: { x, y: y + 20, text: 'Buy', align: 'center', baseline: 'middle' },
                  styles: { color: '#ffffff', size: 9, weight: 'bold', backgroundColor: 'transparent' },
                },
              ];
            }
            return [
              {
                type: 'polygon',
                attrs: { coordinates: [{ x, y: y - 4 }, { x: x - 14, y: y - 28 }, { x: x + 14, y: y - 28 }] },
                styles: { style: 'fill', color: '#ef4444' },
              },
              {
                type: 'text',
                attrs: { x, y: y - 20, text: 'Sell', align: 'center', baseline: 'middle' },
                styles: { color: '#ffffff', size: 9, weight: 'bold', backgroundColor: 'transparent' },
              },
            ];
          },
        });
      }

      if (!srLevelLineRegistered) {
        srLevelLineRegistered = true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (kc as any).registerOverlay({
          name: 'srLevelLine',
          totalStep: 1,
          needDefaultPointFigure: false,
          needDefaultXAxisFigure: false,
          needDefaultYAxisFigure: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          createPointFigures: ({ overlay, coordinates, bounding }: { overlay: any; coordinates: Array<{ x: number; y: number }>; bounding: any }) => {
            const { srType, price } = overlay.extendData as { srType: 'support' | 'resistance'; price: number };
            const y = coordinates[0]?.y;
            if (y == null || !isFinite(y) || y < 0) return [];
            const color = srType === 'resistance' ? '#f87171' : '#34d399';
            const rightX = (bounding?.width ?? 9999);
            return [
              {
                type: 'line',
                attrs: { coordinates: [{ x: 0, y }, { x: rightX, y }] },
                styles: { style: 'dashed', color, size: 1, dashedValue: [4, 3] },
              },
              {
                type: 'text',
                attrs: { x: rightX - 6, y: y - 3, text: `${srType === 'resistance' ? 'R' : 'S'} $${fmtPx(price)}`, align: 'right', baseline: 'bottom' },
                styles: { color, size: 9, weight: '700' },
              },
            ];
          },
        });
      }

      // DataLoader
      const loader: DataLoader = {
        getBars: async ({ symbol, period, callback }) => {
          // Snapshot the load token; if a newer coin/tf switch happens while this
          // fetch is in flight, the result is stale and must be discarded so it
          // can't overwrite the chart with the wrong timeframe/coin.
          const myGen = loadGenRef.current;
          const stale = () => myGen !== loadGenRef.current;
          const c   = coinRef.current;
          const bnSym    = BINANCE_SYMS[c] as string | undefined;
          const bybitSym = BYBIT_SYMS[c]   as string | undefined;
          try {
            if (bnSym) {
              const iv = periodToBnInterval(period);
              const r  = await fetch(`https://api.binance.com/api/v3/klines?symbol=${bnSym}&interval=${iv}&limit=1500`);
              const raw = await r.json() as (string | number)[][];
              if (stale()) return; // superseded by a newer switch — drop it
              const bars = raw.map(k => ({
                timestamp: Number(k[0]), open: Number(k[1]), high: Number(k[2]),
                low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]),
              }));
              if (bars.length) {
                lastCloseRef.current = bars[bars.length - 1].close;
                srSetRef.current(computeSRLevels(bars, bars[bars.length - 1].close));
              }
              callback(bars, false);
            } else if (bybitSym) {
              const iv = periodToBybitInterval(period);
              const r  = await fetch(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${bybitSym}&interval=${iv}&limit=1000`);
              const d  = await r.json() as { result?: { list?: string[][] } };
              if (stale()) return; // superseded by a newer switch — drop it
              const list = [...(d?.result?.list ?? [])].reverse();
              const bars = list.map(k => ({
                timestamp: Number(k[0]), open: Number(k[1]), high: Number(k[2]),
                low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]),
              }));
              if (bars.length) {
                lastCloseRef.current = bars[bars.length - 1].close;
                srSetRef.current(computeSRLevels(bars, bars[bars.length - 1].close));
              }
              callback(bars, false);
            } else {
              callback([], false);
            }
            endFade();
          } catch { if (!stale()) { callback([], false); endFade(); } }
          void symbol; // suppress unused
        },

        subscribeBar: ({ period, callback }) => {
          const c        = coinRef.current;
          const bnSym    = BINANCE_SYMS[c] as string | undefined;
          const bybitSym = BYBIT_SYMS[c]   as string | undefined;
          wsRef.current?.close();

          if (bnSym) {
            const iv = periodToBnInterval(period);
            const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${bnSym.toLowerCase()}@kline_${iv}`);
            ws.onopen    = () => setWsStatus('live');
            ws.onerror   = () => setWsStatus('error');
            ws.onclose   = (e) => { if (!e.wasClean) setWsStatus('connecting'); };
            ws.onmessage = (e: MessageEvent) => {
              const { k } = JSON.parse(e.data as string) as { k: Record<string, string | number> };
              const bar = { timestamp: Number(k.t), open: Number(k.o), high: Number(k.h), low: Number(k.l), close: Number(k.c), volume: Number(k.v) };
              lastCloseRef.current = bar.close;
              callback(bar);
            };
            wsRef.current = ws;
          } else if (bybitSym) {
            // Bybit: 5s polling
            setWsStatus('live');
            const iv = periodToBybitInterval(period);
            const timer = setInterval(async () => {
              try {
                const r = await fetch(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${bybitSym}&interval=${iv}&limit=1`);
                const d = await r.json() as { result?: { list?: string[][] } };
                const k = d?.result?.list?.[0];
                if (k) {
                  lastCloseRef.current = Number(k[4]);
                  callback({ timestamp: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]) });
                }
              } catch { /* silent */ }
            }, 5000);
            wsRef.current = { close: () => clearInterval(timer) };
          }
        },

        unsubscribeBar: () => {
          wsRef.current?.close();
          wsRef.current = null;
          setWsStatus('connecting');
        },
      };

      chart.setDataLoader(loader);
      setChartSymbolPeriod(chart, coin, tf);

      if (!disposed) {
        setTimeout(() => chartRef.current?.resize(), 100);
        setChartReady(true);
      }
    })();

    // Resize chart whenever the container changes dimensions (handles mobile viewport changes)
    const ro = new ResizeObserver(() => { chartRef.current?.resize(); });
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      disposed = true;
      ro.disconnect();
      wsRef.current?.close();
      wsRef.current = null;
      import('klinecharts').then(({ dispose }) => {
        if (containerRef.current) dispose(containerRef.current);
      });
      chartRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reload on coin / tf change ───────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const coinChanged = prevCoinRef.current !== coin;
    const tfChanged   = prevTfRef.current   !== tf;
    if (!coinChanged && !tfChanged) return; // nothing actually changed

    startFade();
    analysisIds.current.forEach(id => chart.removeOverlay({ id }));
    analysisIds.current = [];
    alertOverlayMap.current.forEach(oid => chart.removeOverlay({ id: oid }));
    alertOverlayMap.current.clear();
    chart.removeOverlay({ name: 'emaSignal' });
    srOverlayIds.current.forEach(id => chart.removeOverlay({ id }));
    srOverlayIds.current = [];
    setSrLevels([]);
    setActiveTool(null);

    // klinecharts' setSymbol AND setPeriod each call resetData() -> getBars().
    // Calling both on one switch fires two parallel fetches whose init callbacks
    // race — the slower (stale) one can win and paint the wrong timeframe/coin.
    // So only call the setter that actually changed, and bump loadGenRef before
    // each so any in-flight fetch from a previous switch is discarded on arrival.
    if (coinChanged) {
      loadGenRef.current += 1;
      const bnSym    = BINANCE_SYMS[coin] as string | undefined;
      const bybitSym = BYBIT_SYMS[coin]   as string | undefined;
      const baseSym  = bnSym ?? bybitSym ?? 'BTCUSDT';
      chart.setSymbol({ ticker: baseSym, shortName: coin.toUpperCase() + '/USDT' });
    }
    if (tfChanged) {
      loadGenRef.current += 1;
      chart.setPeriod(TF_TO_PERIOD[tf] ?? TF_TO_PERIOD['15m']);
    }

    prevCoinRef.current = coin;
    prevTfRef.current   = tf;

    // Safety: clear the freeze-frame overlay even if no getBars fires (e.g. an
    // unsupported symbol) so the chart can never stay stuck behind the screenshot.
    const fallback = setTimeout(endFade, 2000);
    return () => clearTimeout(fallback);
  }, [coin, tf]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fullscreen API ───────────────────────────────────────────────────
  useEffect(() => {
    const onFsChange = () => {
      const isFs = !!document.fullscreenElement;
      setFullscreen(isFs);
      // Let CSS transition finish then tell klinecharts to repaint
      setTimeout(() => chartRef.current?.resize(), 60);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, []);

  const handleFullscreen = () => {
    if (!fullscreen) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (wrapRef.current as any)?.requestFullscreen?.() ?? (wrapRef.current as any)?.webkitRequestFullscreen?.();
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (document as any).exitFullscreen?.() ?? (document as any).webkitExitFullscreen?.();
    }
  };

  // ── Auto-draw Entry / SL / TP after analysis ─────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    analysisIds.current.forEach(id => chart.removeOverlay({ id }));
    analysisIds.current = [];
    if (!result) return;

    const draw = (price: number, color: string) => {
      const id = chart.createOverlay({
        name: 'horizontalStraightLine',
        groupId: 'analysis',
        lock: true,
        points: [{ value: price }],
        styles: { line: { style: 'dashed', color, size: 1 } },
      } as OverlayCreate);
      if (typeof id === 'string') analysisIds.current.push(id);
    };

    if (result.entryLow)  draw(result.entryLow,  '#34d399');
    if (result.entryHigh) draw(result.entryHigh, '#34d399');
    if (result.sl)        draw(result.sl,        '#f87171');
    if (result.tp)        draw(result.tp,        '#b8aeff');
  }, [result]);

  // ── EMA signal markers — all significant crosses in the loaded data ──────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !chartReady) return;

    chart.removeOverlay({ name: 'emaSignal' });
    if (!emaSignal || emaSignal.loading) return;

    const place = (dir: 'long' | 'short', ts: number, price: number) => {
      chart.createOverlay({
        name: 'emaSignal', lock: true,
        extendData: { dir },
        points: [{ timestamp: ts, value: price }],
      } as OverlayCreate);
    };

    for (const sig of emaSignal.signalLongs)  place('long',  sig.timestamp, sig.anchorPrice);
    for (const sig of emaSignal.signalShorts) place('short', sig.timestamp, sig.anchorPrice);
  }, [emaSignal, chartReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync price alert lines ───────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !chartReady) return;

    // Remove stale alert overlays
    alertOverlayMap.current.forEach(oid => chart.removeOverlay({ id: oid }));
    alertOverlayMap.current.clear();

    if (!chartAlerts?.length) return;

    chartAlerts.forEach(alert => {
      const id = chart.createOverlay({
        name: 'horizontalStraightLine',
        groupId: 'price_alerts',
        lock: false,
        points: [{ value: alert.target_price }],
        styles: {
          line: { style: 'dashed', color: '#f59e0b', size: 1, dashedValue: [5, 3] },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onPressedMoveEnd: ({ overlay }: { overlay: { points: Array<{ value?: number }> } }) => {
          const newPrice = overlay.points[0]?.value;
          if (newPrice !== undefined) onAlertMoveRef.current?.(alert.id, newPrice);
        },
      } as OverlayCreate);
      if (typeof id === 'string') alertOverlayMap.current.set(alert.id, id);
    });
  }, [chartAlerts, chartReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Draw / redraw S/R level lines ───────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !chartReady) return;
    srOverlayIds.current.forEach(id => chart.removeOverlay({ id }));
    srOverlayIds.current = [];
    if (!showSR || !srLevels.length) return;
    for (const level of srLevels) {
      const id = chart.createOverlay({
        name: 'srLevelLine',
        groupId: 'sr_levels',
        lock: true,
        extendData: { srType: level.type, price: level.price },
        points: [{ value: level.price }],
      } as OverlayCreate);
      if (typeof id === 'string') srOverlayIds.current.push(id);
    }
  }, [srLevels, showSR, chartReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Drawing toolbar ──────────────────────────────────────────────────
  const handleTool = (toolId: string) => {
    const chart = chartRef.current;
    if (!chart) return;
    if (activeTool === toolId) {
      chart.removeOverlay({ name: toolId });
      setActiveTool(null);
    } else {
      chart.createOverlay(toolId);
      setActiveTool(toolId);
    }
  };

  const handleClear = () => {
    chartRef.current?.removeOverlay();
    analysisIds.current = [];
    setActiveTool(null);
  };

  const handleCopy = (price: number, label: string) => {
    const text = fmtPx(price);
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedMsg(`${label} $${text} copied!`);
    if (copyToastTimer.current) clearTimeout(copyToastTimer.current);
    copyToastTimer.current = setTimeout(() => setCopiedMsg(null), 1800);
  };

  const hasLevels = result && (result.entryLow || result.sl || result.tp);

  /* ── Setup Quality: price near strong S/R + squeeze forming ── */
  const setupQuality = (() => {
    const price = lastCloseRef.current;
    if (!price || !srLevels.length) return null;
    const sq = computeSqueezeScore(coinData);
    const nearSR = srLevels.find(level => {
      const pct = Math.abs(price - level.price) / price * 100;
      return pct < 0.8 && level.touches >= 2;
    }) ?? null;
    if (!nearSR || sq.score < 50 || sq.dir === 'NEUTRAL') return null;
    const aligned =
      (nearSR.type === 'support'    && sq.dir === 'SHORT_SQ') ||
      (nearSR.type === 'resistance' && sq.dir === 'LONG_LIQ');
    if (sq.score >= 65 && aligned) return {
      label: 'Prime Setup',
      detail: nearSR.type === 'support'
        ? `Support (${nearSR.touches}T) + Short Squeeze · Score ${sq.score}/100`
        : `Resistance (${nearSR.touches}T) + Long Flush · Score ${sq.score}/100`,
      explanation: nearSR.type === 'support'
        ? 'Price is sitting on a tested support level while shorts are being squeezed out. High-probability long zone — watch for a confirmation candle before entering.'
        : 'Price is pressing against tested resistance while longs are getting flushed. High-probability short zone — watch for a rejection candle before entering.',
      color: '#fbbf24', bg: 'rgba(251,191,36,0.10)', bdr: 'rgba(251,191,36,0.28)',
    };
    return {
      label: 'Setup Forming',
      detail: `Near ${nearSR.type} (${nearSR.touches} touches) · Squeeze ${sq.score}/100`,
      explanation: `Squeeze pressure is building near a key ${nearSR.type} level, but signals aren't fully aligned yet. Watch for direction confirmation — don't jump in early.`,
      color: '#a78bfa', bg: 'rgba(167,139,250,0.10)', bdr: 'rgba(167,139,250,0.28)',
    };
  })();

  return (
    <div className="klc-wrap" ref={wrapRef}>
      {/* Toolbar */}
      <div className="klc-toolbar">
        {/* TF selector */}
        {TFS.map(t => (
          <button
            key={t}
            className={`klc-tool-btn${tf === t ? ' on' : ''}`}
            onClick={() => onTfChange?.(t)}
          >
            {t}
          </button>
        ))}
        <div className="klc-sep" />

        {TOOLS.map(({ id, label }) => (
          <button
            key={id}
            className={`klc-tool-btn${activeTool === id ? ' on' : ''}`}
            onClick={() => handleTool(id)}
          >
            {label}
          </button>
        ))}
        <div className="klc-sep" />
        <button className="klc-tool-btn klc-clear" onClick={handleClear}>Clear</button>
        <button
          className={`klc-tool-btn${showSR ? ' on' : ''}`}
          onClick={() => setShowSR(v => !v)}
          title="Toggle auto support &amp; resistance levels"
        >
          S/R
        </button>

        {hasLevels && (
          <div className="klc-legend">
            {(result!.entryLow || result!.entryHigh) && (
              <button
                className="klc-price-chip"
                style={{ color: '#34d399', background: 'rgba(52,211,153,0.08)', borderColor: 'rgba(52,211,153,0.2)' }}
                onClick={() => {
                  const mid = result!.entryLow && result!.entryHigh
                    ? (result!.entryLow + result!.entryHigh) / 2
                    : (result!.entryLow ?? result!.entryHigh ?? 0);
                  handleCopy(mid, 'Entry');
                }}
                title="Click to copy entry midpoint"
              >
                — Entry&nbsp;
                {result!.entryLow && result!.entryHigh
                  ? `$${fmtPx(result!.entryLow)}–$${fmtPx(result!.entryHigh)}`
                  : `$${fmtPx(result!.entryLow ?? result!.entryHigh ?? 0)}`}
              </button>
            )}
            {result!.sl && (
              <button
                className="klc-price-chip"
                style={{ color: '#f87171', background: 'rgba(248,113,113,0.08)', borderColor: 'rgba(248,113,113,0.2)' }}
                onClick={() => handleCopy(result!.sl!, 'SL')}
                title="Click to copy SL price"
              >
                — SL&nbsp;${fmtPx(result!.sl)}
              </button>
            )}
            {result!.tp && (
              <button
                className="klc-price-chip"
                style={{ color: '#b8aeff', background: 'rgba(184,174,255,0.08)', borderColor: 'rgba(184,174,255,0.2)' }}
                onClick={() => handleCopy(result!.tp!, 'TP')}
                title="Click to copy TP price"
              >
                — TP&nbsp;${fmtPx(result!.tp)}
              </button>
            )}
          </div>
        )}

        {chartAlerts && chartAlerts.length > 0 && (
          <div className="klc-legend" style={{ marginLeft: hasLevels ? 0 : undefined }}>
            {chartAlerts.map(alert => (
              <span
                key={alert.id}
                className="klc-price-chip"
                style={{ color: '#f59e0b', background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.2)', cursor: 'default' }}
                title={`Alert: ${alert.direction} $${fmtPx(alert.target_price)}${alert.label ? ` · ${alert.label}` : ''} — drag the dashed line to adjust`}
              >
                🔔 {alert.direction === 'above' ? '↑' : '↓'} ${fmtPx(alert.target_price)}
                {alert.label ? <>&nbsp;·&nbsp;{alert.label}</> : null}
              </span>
            ))}
          </div>
        )}

        <span style={{ marginLeft: 'auto' }} />
        {setupQuality && (
          <div
            style={{ position: 'relative', display: 'inline-flex' }}
            onMouseEnter={() => setSqHover(true)}
            onMouseLeave={() => setSqHover(false)}
          >
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
              color: setupQuality.color, background: setupQuality.bg,
              border: `0.5px solid ${setupQuality.bdr}`,
              letterSpacing: '0.04em', whiteSpace: 'nowrap', cursor: 'default',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              {setupQuality.label}
              <span style={{ opacity: 0.55, fontSize: 9, lineHeight: 1 }}>ⓘ</span>
            </span>
            {sqHover && (
              <div style={{
                position: 'absolute', bottom: 'calc(100% + 8px)', right: 0,
                width: 230, zIndex: 999, pointerEvents: 'none',
                background: '#151515',
                border: `0.5px solid ${setupQuality.bdr}`,
                borderRadius: 8, padding: '10px 12px',
                boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: setupQuality.color, marginBottom: 5, letterSpacing: '0.04em' }}>
                  {setupQuality.label}
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5, marginBottom: 8 }}>
                  {setupQuality.detail}
                </div>
                <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.82)', lineHeight: 1.65 }}>
                  {setupQuality.explanation}
                </div>
              </div>
            )}
          </div>
        )}
        <button
          className="klc-tool-btn klc-fullscreen-btn"
          onClick={handleFullscreen}
          title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {fullscreen ? '⊠' : '⛶'}
        </button>
        <span
          className={`klc-ws-dot${wsStatus === 'live' ? ' live' : wsStatus === 'error' ? ' err' : ''}`}
          title={wsStatus}
        />
      </div>

      {/* Copy toast */}
      {copiedMsg && (
        <div className="klc-copy-toast">{copiedMsg}</div>
      )}

      {/* Chart canvas */}
      <div style={{ position: 'relative' }}>
        <div ref={containerRef} className="klc-canvas" />
        {/* Screenshot crossfade — holds old chart image while new data loads, then fades out */}
        <div ref={canvasFadeRef} style={{
          position: 'absolute', inset: 0,
          backgroundSize: '100% 100%',
          backgroundRepeat: 'no-repeat',
          opacity: 0,
          pointerEvents: 'none',
        }} />
        {/* Candle-close countdown — anchored below the klinecharts current-price label */}
        {priceLabelY !== null && (
          <div style={{
            position: 'absolute',
            right: 0,
            top: priceLabelY + 11,   // 11px below price-mark centre = just under the label
            pointerEvents: 'none',
            background: 'rgba(30,30,30,0.88)',
            border: '1px solid rgba(255,255,255,0.10)',
            borderTop: 'none',
            borderRadius: '0 0 3px 3px',
            padding: '1px 6px 2px',
            fontSize: 10,
            fontFamily: 'monospace',
            color: 'rgba(255,255,255,0.70)',
            letterSpacing: '0.04em',
            lineHeight: 1.5,
            userSelect: 'none',
            minWidth: 54,
            textAlign: 'center',
          }}>
            {countdown}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Price formatter for chip labels ──────────────────────────────────────
function fmtPx(n: number): string {
  if (n >= 10000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 100)   return n.toFixed(2);
  if (n >= 1)     return n.toFixed(3);
  if (n >= 0.01)  return n.toFixed(4);
  return n.toFixed(6);
}

// ── Helper ────────────────────────────────────────────────────────────────
function setChartSymbolPeriod(chart: KChart, coin: CoinId, tf: string) {
  const bnSym    = BINANCE_SYMS[coin] as string | undefined;
  const bybitSym = BYBIT_SYMS[coin]   as string | undefined;
  chart.setSymbol({ ticker: bnSym ?? bybitSym ?? 'BTCUSDT', shortName: coin.toUpperCase() + '/USDT' });
  chart.setPeriod(TF_TO_PERIOD[tf] ?? TF_TO_PERIOD['15m']);
}
