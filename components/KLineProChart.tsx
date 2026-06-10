'use client';
import { useEffect, useRef, useState } from 'react';
import type { Chart as KChart, DataLoader, OverlayCreate, Period } from 'klinecharts';
import { BINANCE_SYMS, BYBIT_SYMS, CoinId } from '@/lib/marketStore';
import type { CombinedResult } from '@/lib/grok';

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

interface Props {
  coin:   CoinId;
  tf:     ChartTf;
  result?: CombinedResult | null;
}

export default function KLineProChart({ coin, tf, result }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapRef      = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<KChart | null>(null);
  const wsRef        = useRef<{ close: () => void } | null>(null);
  const analysisIds  = useRef<string[]>([]);
  const coinRef      = useRef<CoinId>(coin);
  const [activeTool,  setActiveTool]  = useState<string | null>(null);
  const [wsStatus,    setWsStatus]    = useState<'connecting' | 'live' | 'error'>('connecting');
  const [fullscreen,  setFullscreen]  = useState(false);
  const [copiedMsg,   setCopiedMsg]   = useState<string | null>(null);
  const copyToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

      // Indicators
      chart.createIndicator(
        { name: 'EMA', calcParams: [9, 200] },
        { isStack: false, pane: { id: 'candle_pane' } }
      );
      chart.createIndicator('VOL', { pane: { height: 60, minHeight: 30 } });

      // DataLoader
      const loader: DataLoader = {
        getBars: async ({ symbol, period, callback }) => {
          const c   = coinRef.current;
          const bnSym    = BINANCE_SYMS[c] as string | undefined;
          const bybitSym = BYBIT_SYMS[c]   as string | undefined;
          try {
            if (bnSym) {
              const iv = periodToBnInterval(period);
              const r  = await fetch(`https://api.binance.com/api/v3/klines?symbol=${bnSym}&interval=${iv}&limit=500`);
              const raw = await r.json() as (string | number)[][];
              callback(raw.map(k => ({
                timestamp: Number(k[0]), open: Number(k[1]), high: Number(k[2]),
                low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]),
              })), false);
            } else if (bybitSym) {
              const iv = periodToBybitInterval(period);
              const r  = await fetch(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${bybitSym}&interval=${iv}&limit=500`);
              const d  = await r.json() as { result?: { list?: string[][] } };
              const list = [...(d?.result?.list ?? [])].reverse();
              callback(list.map(k => ({
                timestamp: Number(k[0]), open: Number(k[1]), high: Number(k[2]),
                low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]),
              })), false);
            } else {
              callback([], false);
            }
          } catch { callback([], false); }
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
              callback({ timestamp: Number(k.t), open: Number(k.o), high: Number(k.h), low: Number(k.l), close: Number(k.c), volume: Number(k.v) });
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
                if (k) callback({ timestamp: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]) });
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
    })();

    return () => {
      disposed = true;
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
    analysisIds.current.forEach(id => chart.removeOverlay({ id }));
    analysisIds.current = [];
    setActiveTool(null);
    setChartSymbolPeriod(chart, coin, tf);
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

  return (
    <div className="klc-wrap" ref={wrapRef}>
      {/* Toolbar */}
      <div className="klc-toolbar">
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

        <span style={{ marginLeft: 'auto' }} />
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
      <div ref={containerRef} className="klc-canvas" />
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
