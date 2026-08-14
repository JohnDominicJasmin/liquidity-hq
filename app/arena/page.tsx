'use client';
import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useNow } from '@/lib/useNow';
import { useSearchParams } from 'next/navigation';
import { useMarket, classifyFunding, CoinId, CoinData, COINS, computeSqueezeScore, computeFibLevels, BINANCE_SYMS, BYBIT_SYMS, computeCoinHealth } from '@/lib/marketStore';
import { GrokContext, buildCombinedPrompt, buildQuickPrompt, CombinedResult, ChartData, calcEMA, calcSMA, calcRSI, callGrokViaProxy, GrokUsageInfo } from '@/lib/grok';
import { useGrokUsage } from '@/components/GrokUsageProvider';
import { detectPatternsStr, Candle } from '@/lib/patterns';
import { getSessionName } from '@/lib/session';
import { useNews } from '@/components/NewsProvider';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';
import { useSettings } from '@/lib/settings';
import { track } from '@/lib/analytics';
import { T } from '@/lib/tables';
import { Warn } from '@/components/icons';
import KLineProChart, { ChartTf, ChartAlert } from '@/components/KLineProChart';
import { useDesignMode } from '@/components/DesignModeProvider';
import ArenaTerminal from '@/components/ArenaTerminal';
import UpgradeGateModal, { LockedFeatureCard } from '@/components/UpgradeGateModal';
import ConfluenceScore from '@/components/ConfluenceScore';
import MultiTFAlignment from '@/components/MultiTFAlignment';
import { useOI1h, oi1hSignal } from '@/lib/useOI1h';
import MarketStructure, { MSData } from '@/components/MarketStructure';
import AbsorptionDetector, { AbsorptionData } from '@/components/AbsorptionDetector';
import EMASignal from '@/components/EMASignal';
import HigherTfMoveBadge from '@/components/HigherTfMoveBadge';
import Tip from '@/components/Tip';
import LiqHeatmap from '@/components/LiqHeatmap';
import UsageMeter from '@/components/UsageMeter';
import { useEMAStrategy, strategyToGrokLine, STRATEGY_LOADING, StrategySignal, DEFAULT_FILTER_PARAMS, STRICT_FILTER_PARAMS } from '@/lib/useEMAStrategy';
import { computeDistributionScore, distributionColor, DistributionInputs } from '@/lib/distribution';
import { withAlpha } from '@/lib/color';
import PageHint from '@/components/PageHint';
import CoinMarketSnapshot from '@/components/CoinMarketSnapshot';
import CoinIcon from '@/components/CoinIcon';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';
import { GATED_TFS as LIMIT_GATED_TFS, FREE_FALLBACK_TF as LIMIT_FREE_FALLBACK_TF } from '@/lib/limits';
import { computeSectorRotation } from '@/lib/sectorRotation';
import { latestStructureSignal, describeStructureSignal, type PASignal } from '@/lib/priceAction';
import { usePerpSpot } from '@/lib/usePerpSpot';

/* ── Pattern detection - delegates to shared lib/patterns.ts ── */
function detectPatterns(candles: Candle[]): string { return detectPatternsStr(candles); }

/* ── Distribution score inputs from live store data (shared scorer in lib/distribution.ts) ── */
function distInputsFromCoin(d: CoinData): DistributionInputs {
  return {
    change24hPct:   d.change ?? null,
    cvdDivergence:  d.cvdDivergence,
    takerBuyRatio:  d.takerBuyRatio,
    oiTrend:        d.oiTrend,
    whaleLongRatio: d.bnWhaleLongRatio,
    fundingRatePct: d.fundingRate != null ? d.fundingRate * 100 : null,
    volRatio:       d.volRatio,
    priceBelowVwap: d.vwap != null && d.price ? d.price < d.vwap : null,
  };
}

/* ── Smart price formatter - preserves decimals for all coins including memes ── */
function fmtPrice(n: number): string {
  if (n >= 10000)   return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 100)     return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1)       return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
  if (n >= 0.01)    return n.toFixed(4);
  if (n >= 0.0001)  return n.toFixed(6);
  return n.toFixed(8);  // PEPE, BONK, etc.
}

/* ── Reasoning markdown renderer ─────────────────────────────────────────── */
function ReasoningText({ text }: { text: string }) {
  const { t } = useLabels();
  // Split on **bold**, [text](url), [[n]](url), or newlines
  const parts = text.split(/(\*\*[\s\S]*?\*\*|\[\[?[^\]]*\]?\]\([^)]+\)|\n)/g);
  return (
    <>
      {parts.map((seg, i) => {
        if (!seg) return null;
        if (seg === '\n') return <br key={i} />;
        if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4)
          return <strong key={i}>{seg.slice(2, -2)}</strong>;
        const link = seg.match(/^\[(\[?[^\]]*\]?)\]\(([^)]+)\)$/);
        if (link) {
          const label = link[1].replace(/^\[/, '').replace(/\]$/, '') || t('ARENA_REASONING_LINK_FALLBACK');
          return (
            <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer" className="reasoning-link">
              {label}
            </a>
          );
        }
        return <span key={i}>{seg}</span>;
      })}
    </>
  );
}

const CAT_FILTER_COINS: Record<'all' | 'majors' | 'alts' | 'defi' | 'meme', readonly CoinId[]> = {
  all:    COINS,
  majors: ['btc', 'eth', 'sol', 'xrp', 'bnb', 'ltc', 'bch', 'ada'],
  alts:   ['near', 'sui', 'avax', 'link', 'dot', 'atom', 'arb', 'op', 'apt', 'sei', 'inj', 'tia', 'trx', 'xlm', 'etc', 'fil', 'stx'],
  defi:   ['hype', 'aave', 'uni', 'ldo', 'rune', 'gmx', 'crv', 'jup', 'wld', 'render', 'tao', 'fet', 'ondo', 'pyth', 'ena', 'dydx', 'xau', 'spx'],
  meme:   ['doge', 'pepe', 'wif', 'bonk', 'gmt', 'sand', 'mana'],
};



/* ── Result cache ── */
interface CacheEntry { result: CombinedResult; priceAtAnalysis: number; mode: 'quick' | 'deep' }
const PRICE_MOVE_PCT    = 0.5;             // re-analyze when price moves >0.5%
const ARENA_RESULTS_KEY = 'arena-results-v2';
const CACHE_MAX_AGE_MS  = 4 * 60 * 60 * 1000; // 4 hours - older results are discarded

/* LEGACY SIGNAL VOCABULARY (#260).
 *
 * Results and history are persisted in the browser, so a user who ran an
 * analysis before the rename still has LONG / LEAN LONG / SHORT / LEAN SHORT
 * sitting in sessionStorage and localStorage. Every comparison in this file now
 * tests the new words, and each of those chains ends in a fallback - so an
 * un-migrated row does not error, it renders as FLAT and goes grey. A bullish
 * call the user made an hour ago silently becomes "no opinion", which is worse
 * than a crash because nothing anywhere says it happened.
 *
 * Normalising on READ rather than migrating the stored blob is deliberate: the
 * blob is rewritten on the next change anyway, and a read-side map keeps working
 * for anyone whose tab has been open across the deploy. */
const LEGACY_SIGNALS: Record<string, string> = {
  'LONG': 'BULLISH',
  'LEAN LONG': 'LEAN BULLISH',
  'SHORT': 'BEARISH',
  'LEAN SHORT': 'LEAN BEARISH',
};
function normalizeSignal<T extends string>(signal: T): T {
  return (LEGACY_SIGNALS[signal] ?? signal) as T;
}
/** Dynamic TTL: tighter during NY/pre-NY session (volatile), relaxed off-hours */
function getCacheTTL(): number {
  const utcHour = new Date().getUTCHours();
  return (utcHour >= 12 && utcHour < 20) ? 2 * 60_000 : 15 * 60_000;
}

interface HistItem {
  signal: string;
  confidence: number;
  coin: string;
  time: string;
  entry?: string;
  reasoning?: string;
  session?: string;
}

const ARENA_HIST_KEY = 'arena-session-history-v1';

// Fast timeframes are Pro-only (rule lives in lib/limits.ts so Settings and
// onboarding enforce the same list). Free users are clamped to 30m and up;
// tapping a gated timeframe opens the upgrade modal instead of switching.
const GATED_TFS: readonly ChartTf[] = LIMIT_GATED_TFS as readonly ChartTf[];
const FREE_FALLBACK_TF = LIMIT_FREE_FALLBACK_TF as ChartTf;
const TF_FEATURE_LABEL_KEYS: Record<string, LabelKey> = {
  '1m': 'ARENA_TF_LABEL_1M', '5m': 'ARENA_TF_LABEL_5M', '15m': 'ARENA_TF_LABEL_15M',
};

function ArenaContent() {
  const { t } = useLabels();
  // Clock for the analysis-freshness display and the cache-age gate below.
  // Both used to call Date.now() mid-render, which meant the "just now" label
  // and the expiry check only moved when something else re-rendered the page -
  // a stale result could keep claiming to be fresh indefinitely. 30s is half
  // the smallest bucket the freshness text distinguishes.
  const nowMs = useNow(30_000);
  const { store } = useMarket();
  const { latestHeadlines, econEvents, whaleAlerts } = useNews();
  const { user, loading: authLoading, entitled } = useAuth();
  const { settings, update } = useSettings();
  const searchParams = useSearchParams();
  const designMode = useDesignMode();
  const [selectedCoin, setSelectedCoin] = useState<CoinId>(() => {
    const c = searchParams.get('coin')?.toLowerCase() ?? '';
    return (COINS as string[]).includes(c) ? c as CoinId : 'btc';
  });
  const [readTf, setReadTf] = useState<ChartTf>(() => {
    const tf = searchParams.get('tf') ?? '';
    const valid: ChartTf[] = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'];
    return valid.includes(tf as ChartTf) ? tf as ChartTf : '15m';
  });
  // Which Pro feature the user just tried to open (null = modal closed)
  const [upgradeGate, setUpgradeGate] = useState<string | null>(null);
  const arenaInitRef  = useRef(false);
  const oi1hDataRef   = useRef<{ pct: number | null; signal: string }>({ pct: null, signal: '-' });
  const msDataRef     = useRef<MSData | null>(null);
  // State, not a ref: the Confluence Score re-renders on it. Sourced from the
  // chart rather than recomputed here so the score votes on the same break the
  // chart marks, on whichever timeframe is being viewed.
  const [chartStructure, setChartStructure] = useState<PASignal | null>(null);
  const absDataRef    = useRef<AbsorptionData | null>(null);
  const emaSignalRef  = useRef<StrategySignal>(STRATEGY_LOADING);
  const oi1h          = useOI1h(selectedCoin);
  // Default OFF: a 3-year majors/1h backtest showed raw signals (this filter off) beat
  // the stricter persistence-based filter on every metric - see STRICT_FILTER_PARAMS
  // in lib/strategyCore.ts for the numbers. Server-synced (settings.anti_chop_enabled,
  // not local-only state) so Telegram/push EMA signal alerts can fire under the exact
  // same filter this chart is drawing with - see checkEMASignal in
  // app/api/telegram/alert/route.ts.
  const antiChopEnabled = settings.anti_chop_enabled;
  const filterParams = antiChopEnabled ? STRICT_FILTER_PARAMS : DEFAULT_FILTER_PARAMS;
  const emaSignal     = useEMAStrategy(
    selectedCoin,
    readTf,
    store.coins[selectedCoin]?.fundingRate ?? null,
    oi1h.pct,
    filterParams,
  );
  const [readLoading, setReadLoading] = useState(false);
  const [readStep, setReadStep]       = useState('');
  const [readError, setReadError]     = useState('');
  const [readMode,  setReadMode]      = useState<'quick' | 'deep'>('deep');
  const [resultsCache, setResultsCache] = useState<Partial<Record<CoinId, CacheEntry>>>({});
  // Per-coin "the AI Read card is hidden" - a UI-only hide, not a data delete.
  // Set either by the user dismissing the card OR by starting a read (the old
  // card closes for the duration), and cleared when that read finishes,
  // whatever the outcome.
  //
  // This comment used to say "cleared the next time this coin gets a fresh
  // read", which described the intent correctly and the code incorrectly: the
  // clear ran when the read STARTED, so a dismiss during the load survived into
  // the result and suppressed it. The user spent a Grok call and saw nothing
  // (#278). Clearing on finish is what makes the sentence true.
  const [dismissedResults, setDismissedResults] = useState<Set<CoinId>>(new Set());
  const [history, setHistory]         = useState<HistItem[]>([]);
  const [detailIdx, setDetailIdx]     = useState<number | null>(null);
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [ctxOpen, setCtxOpen]         = useState(false);
  const { usage: grokUsage, setUsage: setGrokUsage } = useGrokUsage();
  // Track last Quick signal per coin so Deep can compare and show an override notice
  const [quickSignals, setQuickSignals] = useState<Partial<Record<CoinId, string>>>({});
  const [scannerOpen, setScannerOpen]   = useState(false);
  const [scannerSearch, setScannerSearch] = useState('');
  const scannerSearchRef = useRef<HTMLInputElement>(null);
  const [coinCat, setCoinCat]           = useState<'all' | 'majors' | 'alts' | 'defi' | 'meme'>('all');
  const [copiedKey, setCopiedKey]           = useState<string | null>(null);
  const [jpyUsd, setJpyUsd]                 = useState<number | null>(null);
  /* Perps vs spot (#340) - the same reading the dashboard card shows, from the
     shared hook so the card and the AI cannot disagree about it. */
  const perpSpot = usePerpSpot(selectedCoin);
  /* Mirrored into a ref because the prompt payload is built inside a callback
     that reads refs rather than closing over state - same pattern as
     emaSignalRef and absDataRef beside it. Closing over `perpSpot` directly
     would freeze it at whatever it was when the callback was created. */
  const perpSpotRef = useRef(perpSpot);
  useEffect(() => { perpSpotRef.current = perpSpot; }, [perpSpot]);
  const scannerRef      = useRef<HTMLDivElement>(null);
  const hoverOpenTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* Whether the scanner was opened by hover rather than by a click. Only a
     hover-opened panel closes again on mouse-out - closing a click-opened one
     the moment the pointer drifts off would make it unusable. */
  const openedByHover   = useRef(false);

  /* ── Price alert mini-form ── */
  const [alertFormOpen, setAlertFormOpen] = useState(false);
  const [alertPrice,    setAlertPrice]    = useState('');
  const [alertDir,      setAlertDir]      = useState<'above' | 'below'>('above');
  const [alertLabel,    setAlertLabel]    = useState('');
  const [alertSaving,   setAlertSaving]   = useState(false);
  const [alertSuccess,  setAlertSuccess]  = useState(false);
  const [chartAlerts,   setChartAlerts]   = useState<ChartAlert[]>([]);

  function openAlertForm() {
    const price = store.coins[selectedCoin]?.price;
    setAlertPrice(price ? String(price) : '');
    setAlertDir('above');
    setAlertLabel('');
    setAlertSuccess(false);
    setAlertFormOpen(true);
  }

  async function saveArenaAlert() {
    if (!alertPrice || isNaN(parseFloat(alertPrice)) || !user) return;
    setAlertSaving(true);
    try {
      const token = (await getSupabase()!.auth.getSession()).data.session?.access_token;
      const res = await fetch('/api/price-alerts', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ coin: selectedCoin, target_price: parseFloat(alertPrice), direction: alertDir, label: alertLabel }),
      });
      window.dispatchEvent(new CustomEvent('onboarding:done', { detail: 'priceAlert' }));
      if (res.ok) {
        const { alert } = await res.json() as { alert: { id: string } };
        setChartAlerts(prev => [...prev, { id: alert.id, target_price: parseFloat(alertPrice), direction: alertDir, label: alertLabel }]);
      }
      setAlertSuccess(true);
      setAlertLabel('');
      setTimeout(() => { setAlertFormOpen(false); setAlertSuccess(false); }, 1500);
    } finally {
      setAlertSaving(false);
    }
  }

  /* ── Scroll to the usage meter when linked via #usage-meter (nav's "view
     usage" link). Next's client-side Link navigation updates the URL hash
     but doesn't trigger the browser's native anchor-scroll, and clicking it
     while already on /arena doesn't remount this page at all - so `hashchange`
     is the one signal that reliably fires for both the same-page and
     cross-page cases. ── */
  useEffect(() => {
    const scrollToUsage = () => {
      if (window.location.hash === '#usage-meter') {
        document.getElementById('usage-meter')?.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
    };
    scrollToUsage();
    window.addEventListener('hashchange', scrollToUsage);
    return () => window.removeEventListener('hashchange', scrollToUsage);
  }, []);

  /* ── Sync coin + tf to URL so the page is shareable ── */
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('coin', selectedCoin);
    url.searchParams.set('tf', readTf);
    window.history.replaceState(null, '', url.toString());
  }, [selectedCoin, readTf]);

  /* ── Fetch alerts for selected coin (chart overlay lines) ── */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function load() {
      const token = (await getSupabase()!.auth.getSession()).data.session?.access_token;
      if (!token || cancelled) return;
      const res = await fetch('/api/price-alerts', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok || cancelled) return;
      const { alerts } = await res.json() as { alerts: Array<{ id: string; coin: string; target_price: number; direction: 'above' | 'below'; label?: string }> };
      if (!cancelled) setChartAlerts(alerts.filter(a => a.coin === selectedCoin));
    }
    load();
    return () => { cancelled = true; };
  }, [selectedCoin, user]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Update alert price when user drags a line ── */
  async function handleAlertMove(id: string, newPrice: number) {
    setChartAlerts(prev => prev.map(a => a.id === id ? { ...a, target_price: newPrice } : a));
    const token = (await getSupabase()!.auth.getSession()).data.session?.access_token;
    if (!token) return;
    fetch(`/api/price-alerts?id=${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ target_price: newPrice }),
    }).catch(() => {});
  }

  /* Hover over the trigger auto-opens the scanner after 800ms.
   *
   * That behaviour is deliberate and is kept. What was missing is everything
   * WCAG 2.1 SC 1.4.13 (Content on Hover or Focus, AA) requires of content
   * triggered by pointer hover. Measured before this change: Escape did nothing
   * and moving the pointer away left the panel open indefinitely, so a user who
   * merely passed over the bar on the way somewhere else was left with a panel
   * covering the page and no way to dismiss it without clicking. QA filed it as
   * issue #31 after we established it predates PR #29.
   *
   * The three requirements, and where each is now met:
   *   Dismissable - Escape closes it, without moving the pointer. See the
   *                 keydown effect below.
   *   Hoverable   - the mouseleave lives on the wrapper that contains BOTH the
   *                 bar and the flyout, so moving the pointer from one into the
   *                 other never fires it. The panel survives being hovered.
   *   Persistent  - it stays until the pointer leaves the whole widget, Escape,
   *                 or a click outside. Nothing times it out from under you.
   *
   * A click-opened panel is deliberately NOT closed by mouse-out; only a
   * hover-opened one is, which is what openedByHover tracks. */
  const handleScannerHoverEnter = () => {
    if (scannerOpen) return;
    hoverOpenTimer.current = setTimeout(() => {
      openedByHover.current = true;
      setScannerOpen(true);
    }, 800);
  };
  const handleScannerHoverLeave = () => {
    if (hoverOpenTimer.current) { clearTimeout(hoverOpenTimer.current); hoverOpenTimer.current = null; }
    if (openedByHover.current) {
      openedByHover.current = false;
      setScannerOpen(false);
    }
  };

  // SC 1.4.13 "Dismissable": Escape must close it without moving the pointer.
  useEffect(() => {
    if (!scannerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        openedByHover.current = false;
        setScannerOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [scannerOpen]);

  // Close scanner when clicking anywhere outside the scanner widget
  useEffect(() => {
    if (!scannerOpen) return;
    const handler = (e: MouseEvent) => {
      if (scannerRef.current && !scannerRef.current.contains(e.target as Node)) {
        setScannerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [scannerOpen]);

  /* Fetch USD/JPY via server proxy, refresh every 5 min */
  useEffect(() => {
    const load = () =>
      fetch('/api/forex/jpy')
        .then(r => r.json())
        .then((d: { jpy?: number }) => { if (d?.jpy) setJpyUsd(d.jpy); })
        .catch(() => {});
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => clearInterval(t);
  }, []);

  // Derived - current coin's cached result (persists across coin switches)
  const cacheEntry = resultsCache[selectedCoin] ?? null;
  const result     = cacheEntry?.result ?? null;
  const notifCooldown = useRef<Set<string>>(new Set());

  /* ── Seed coin + TF from settings once settings are loaded ── */
  useEffect(() => {
    if (!arenaInitRef.current) {
      arenaInitRef.current = true;
      // URL params take priority - only apply settings defaults when no URL params present
      const urlParams = new URLSearchParams(window.location.search);
      if (!urlParams.has('coin') && COINS.includes(settings.default_coin as CoinId)) {
        setSelectedCoin(settings.default_coin as CoinId);
      }
      if (!urlParams.has('tf') && ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'].includes(settings.default_tf)) {
        setReadTf(settings.default_tf as ChartTf);
      }
    }
  }, [settings.default_coin, settings.default_tf]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Pro gate: fast timeframes ──
     Intercepts every timeframe switch (chart toolbar buttons come through
     here via onTfChange). Free users tapping 1m/5m/15m get the upgrade modal
     instead of a switch. */
  const handleTfChange = (tf: ChartTf) => {
    if (!entitled && GATED_TFS.includes(tf)) {
      setUpgradeGate(t(TF_FEATURE_LABEL_KEYS[tf] ?? 'ARENA_TF_LABEL_FALLBACK'));
      return;
    }
    setReadTf(tf);
  };

  /* Clamp: a free user can still land on a gated timeframe without clicking -
     URL ?tf= param, a saved default from Settings, or a session that was Pro
     when the timeframe was chosen. Once the role is known, bump them to the
     free fallback rather than serving gated signals. */
  useEffect(() => {
    if (authLoading || entitled) return;
    if (GATED_TFS.includes(readTf)) setReadTf(FREE_FALLBACK_TF);
  }, [authLoading, entitled, readTf]);

  /* ── Sync OI 1h hook data → ref (used by Grok context builder) ── */
  useEffect(() => {
    if (oi1h.loading || oi1h.pct == null) return;
    const { txt } = oi1hSignal(oi1h.pct, store.coins[selectedCoin]?.oiTrend);
    oi1hDataRef.current = { pct: oi1h.pct, signal: txt };
  }, [oi1h.pct, oi1h.loading, selectedCoin, store.coins]);

  /* ── Sync EMA strategy → ref (used by Grok context builder) ── */
  useEffect(() => {
    if (!emaSignal.loading) emaSignalRef.current = emaSignal;
  }, [emaSignal]);

  /* ── Market Structure data callback - keeps ref in sync without re-renders ── */
  const handleMsData = useCallback((d: MSData | null) => {
    msDataRef.current = d;
  }, []);

  /* ── Absorption Detector data callback ── */
  const handleAbsData = useCallback((d: AbsorptionData | null) => {
    absDataRef.current = d;
  }, []);


  /* ── Persist history in sessionStorage (survives nav away + back) ── */
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(ARENA_HIST_KEY);
      // Rows stored before the #260 rename carry LONG/SHORT and would render as
      // FLAT-and-grey, turning a directional call the user made into "no view".
      if (saved) setHistory((JSON.parse(saved) as HistItem[]).map(h => ({ ...h, signal: normalizeSignal(h.signal) })));
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(ARENA_HIST_KEY, JSON.stringify(history)); } catch { /* ignore */ }
  }, [history]);

  /* ── Persist results cache in localStorage - purge entries older than 4h on load ── */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ARENA_RESULTS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<Record<CoinId, CacheEntry>>;
        const now = Date.now();
        const fresh: Partial<Record<CoinId, CacheEntry>> = {};
        Object.entries(parsed).forEach(([k, v]) => {
          // Same #260 migration as the history above, and it matters more here:
          // this is the main result card, so a pre-rename cached result would
          // show the wrong verdict word and the wrong colour on the page's most
          // prominent element.
          if (v && now - v.result.analyzedAt < CACHE_MAX_AGE_MS) {
            fresh[k as CoinId] = { ...v, result: { ...v.result, signal: normalizeSignal(v.result.signal) } };
          }
        });
        setResultsCache(fresh);
      }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(ARENA_RESULTS_KEY, JSON.stringify(resultsCache)); } catch { /* ignore */ }
  }, [resultsCache]);

  /* ── Cross-exchange funding data ── */
  type FundingRow = { coin: string; binance: number|null; bybit: number|null };
  const [fundingData, setFundingData] = useState<Record<string, FundingRow>>({});
  useEffect(() => {
    const load = async () => {
      try {
        const res  = await fetch('/api/funding');
        const json = await res.json();
        if (json.data) {
          const map: Record<string, FundingRow> = {};
          (json.data as FundingRow[]).forEach(r => { map[r.coin] = r; });
          setFundingData(map);
        }
      } catch { /* silent */ }
    };
    load();
    let iv = setInterval(load, 60_000);
    const onVisibility = () => {
      if (document.hidden) {
        clearInterval(iv);
      } else {
        load();
        iv = setInterval(load, 60_000);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);

  /* ── Push notifications ──
     notifEnabled starts false (SSR-safe - Notification isn't available on the
     server, so reading it in a useState initializer would mismatch during
     hydration). This effect syncs it to the browser's actual, already-decided
     permission right after mount, so a returning user whose permission is
     already 'granted' sees the bell lit immediately instead of "off" and
     clickable again - which is what made it feel like it was asking twice. */
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'granted') setNotifEnabled(true);
  }, []);

  const enableNotifications = async () => {
    if (!('Notification' in window)) { alert(t('ARENA_ALERT_NOTIFS_UNSUPPORTED')); return; }
    if (Notification.permission === 'granted') { setNotifEnabled(true); return; }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') setNotifEnabled(true);
    else alert(t('ARENA_ALERT_NOTIFS_DENIED'));
  };

  const fireNotif = useCallback(async (title: string, body: string) => {
    if (!notifEnabled) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification(title, { body, icon: '/icons/icon-192.png' });
    } catch {
      try { new Notification(title, { body }); } catch { /* */ }
    }
  }, [notifEnabled]);

  useEffect(() => {
    if (!notifEnabled) return;
    const coin = store.coins[selectedCoin];
    const sym  = selectedCoin.toUpperCase();
    const b30  = Math.floor(Date.now() / (30 * 60 * 1000));  // 30-min bucket
    const b1h  = Math.floor(Date.now() / (60 * 60 * 1000));  // 1-hour bucket
    const b2h  = Math.floor(Date.now() / (2  * 60 * 60 * 1000));
    const b4h  = Math.floor(Date.now() / (4  * 60 * 60 * 1000));

    const fire = (key: string, title: string, body: string) => {
      if (notifCooldown.current.has(key)) return;
      notifCooldown.current.add(key);
      fireNotif(title, body);
    };

    /* 1 - Extreme funding rate (30 min cooldown) */
    if (coin?.fundingRate != null) {
      const fr = coin.fundingRate * 100;
      if (Math.abs(fr) >= settings.fr_threshold)
        fire(`fund-${selectedCoin}-${b30}`,
          t('ARENA_NOTIF_FUNDING_TITLE', { coin: sym }),
          t('ARENA_NOTIF_FUNDING_BODY', {
            pct: `${fr >= 0 ? '+' : ''}${fr.toFixed(4)}`,
            suffix: fr > 0 ? t('ARENA_NOTIF_FUNDING_SUFFIX_LONG_RISK') : t('ARENA_NOTIF_FUNDING_SUFFIX_SHORT_SQUEEZE'),
          }));
    }

    /* 2 - Fear & Greed extreme (4 hour cooldown) */
    if (store.fng != null && (store.fng <= settings.fng_fear || store.fng >= settings.fng_greed))
      fire(`fng-${store.fng <= settings.fng_fear ? 'fear' : 'greed'}-${b4h}`,
        store.fng <= settings.fng_fear ? t('ARENA_NOTIF_FNG_TITLE_FEAR') : t('ARENA_NOTIF_FNG_TITLE_GREED'),
        t('ARENA_NOTIF_FNG_BODY', {
          fng: store.fng, label: store.fngLabel,
          suffix: store.fng <= settings.fng_fear ? t('ARENA_NOTIF_FNG_SUFFIX_BOTTOM') : t('ARENA_NOTIF_FNG_SUFFIX_OVEREXTENDED'),
        }));

    /* 3 - CVD Divergence (1 hour cooldown) */
    if (coin?.cvdDivergence)
      fire(`cvd-${selectedCoin}-${coin.cvdDivergence}-${b1h}`,
        coin.cvdDivergence === 'bullish'
          ? t('ARENA_NOTIF_CVD_TITLE_BULL', { coin: sym })
          : t('ARENA_NOTIF_CVD_TITLE_BEAR', { coin: sym }),
        coin.cvdDivergence === 'bullish'
          ? t('ARENA_NOTIF_CVD_BODY_BULL')
          : t('ARENA_NOTIF_CVD_BODY_BEAR'));

    /* 4 - RSI 1h extreme (2 hour cooldown) */
    if (coin?.rsi1h != null) {
      if (coin.rsi1h >= settings.rsi_ob)
        fire(`rsi-ob-${selectedCoin}-${b2h}`,
          t('ARENA_NOTIF_RSI_OB_TITLE', { coin: sym }),
          t('ARENA_NOTIF_RSI_OB_BODY', { rsi: coin.rsi1h.toFixed(0) }));
      else if (coin.rsi1h <= settings.rsi_os)
        fire(`rsi-os-${selectedCoin}-${b2h}`,
          t('ARENA_NOTIF_RSI_OS_TITLE', { coin: sym }),
          t('ARENA_NOTIF_RSI_OS_BODY', { rsi: coin.rsi1h.toFixed(0) }));
    }

    /* 5 - Chart pattern detected (30 min cooldown) */
    if (coin?.chartPattern) {
      const isBull = /bull|higher high|engulf.*bull|hammer(?! man)|double bot/i.test(coin.chartPattern);
      const isBear = /bear|lower high|engulf.*bear|shooting|hanging|double top/i.test(coin.chartPattern);
      if (isBull)
        fire(`pat-bull-${selectedCoin}-${b30}`,
          t('ARENA_NOTIF_PATTERN_BULL_TITLE', { coin: sym }),
          t('ARENA_NOTIF_PATTERN_BULL_BODY', { pattern: coin.chartPattern.split(';')[0].trim() }));
      else if (isBear)
        fire(`pat-bear-${selectedCoin}-${b30}`,
          t('ARENA_NOTIF_PATTERN_BEAR_TITLE', { coin: sym }),
          t('ARENA_NOTIF_PATTERN_BEAR_BODY', { pattern: coin.chartPattern.split(';')[0].trim() }));
    }

    /* 6 - OI trend signal (1 hour cooldown) */
    if (coin?.oiTrend === 'strong_up')
      fire(`oi-sup-${selectedCoin}-${b1h}`,
        t('ARENA_NOTIF_OI_UP_TITLE', { coin: sym }),
        t('ARENA_NOTIF_OI_UP_BODY'));
    else if (coin?.oiTrend === 'strong_down')
      fire(`oi-sdn-${selectedCoin}-${b1h}`,
        t('ARENA_NOTIF_OI_DOWN_TITLE', { coin: sym }),
        t('ARENA_NOTIF_OI_DOWN_BODY'));

    /* 7 - Sentiment Extremes: F&G + FR + L/S all aligned (#20) */
    if (store.fng != null && coin?.fundingRate != null && coin?.longRatio != null) {
      const fng      = store.fng;
      const fr       = coin.fundingRate * 100;
      const longRat  = coin.longRatio * 100;  // e.g. 62.1
      const shortRat = 100 - longRat;
      // Bearish: all 3 screaming "longs overcrowded"
      if (fng >= 75 && fr >= 0.04 && longRat >= 60)
        fire(`sent-bear-${b4h}`,
          t('ARENA_NOTIF_SENTIMENT_BEAR_TITLE'),
          t('ARENA_NOTIF_SENTIMENT_BEAR_BODY', { fng, fr: fr.toFixed(3), longPct: longRat.toFixed(0) }));
      // Contrarian bullish: all 3 screaming "shorts overcrowded"
      if (fng <= 25 && fr <= -0.02 && longRat <= 40)
        fire(`sent-bull-${b4h}`,
          t('ARENA_NOTIF_SENTIMENT_BULL_TITLE'),
          t('ARENA_NOTIF_SENTIMENT_BULL_BODY', { fng, fr: fr.toFixed(3), shortPct: shortRat.toFixed(0) }));
    }

  }, [store, selectedCoin, notifEnabled, fireNotif, settings]);

  const gatherContext = (): GrokContext => {
    const coin = store.coins[selectedCoin];
    const session = getSessionName(new Date());

    /* 15m technicals */
    const rsi14 = coin?.rsi14 != null
      ? coin.rsi14.toFixed(1) + (coin.rsi14 >= 70 ? ' (Overbought)' : coin.rsi14 <= 30 ? ' (Oversold)' : ' (Neutral)')
      : '-';
    const ma20 = coin?.ma20 != null ? '$' + coin.ma20.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-';
    const priceVsMA = coin?.price && coin?.ma20
      ? coin.price > coin.ma20
        ? 'ABOVE MA20 (+' + ((coin.price / coin.ma20 - 1) * 100).toFixed(2) + '% - bullish)'
        : 'BELOW MA20 (' + ((coin.price / coin.ma20 - 1) * 100).toFixed(2) + '% - bearish)'
      : '-';
    const volRatio = coin?.volRatio != null
      ? coin.volRatio.toFixed(2) + 'x' + (coin.volRatio >= 1.5 ? ' (spike)' : coin.volRatio <= 0.6 ? ' (dry)' : ' (normal)')
      : '-';
    const longShortRatio = coin?.longRatio != null && coin?.shortRatio != null
      ? 'Long ' + (coin.longRatio * 100).toFixed(1) + '% / Short ' + (coin.shortRatio * 100).toFixed(1) + '%'
        + (coin.longRatio > 0.6 ? ' (overleveraged longs)' : coin.shortRatio > 0.6 ? ' (overleveraged shorts)' : ' (balanced)')
      : '-';

    /* Multi-TF RSI */
    const fmt = (v: number | null | undefined) => v != null
      ? v.toFixed(0) + (v >= 70 ? ' (Overbought)' : v <= 30 ? ' (Oversold)' : ' (Neutral)')
      : '-';
    const rsi1h = fmt(coin?.rsi1h);
    const rsi4h = fmt(coin?.rsi4h);

    /* CVD */
    const cvd = coin?.cvd != null
      ? (coin.cvd >= 0 ? '+' : '') + (coin.cvd / 1000).toFixed(1) + 'K'
        + (coin.cvd > 0 ? ' (net buying)' : ' (net selling)')
      : '-';
    const cvdDivergence = coin?.cvdDivergence
      ? coin.cvdDivergence === 'bullish'
        ? 'BULLISH DIVERGENCE DETECTED - price falling but net buying rising (smart money accumulating)'
        : 'BEARISH DIVERGENCE DETECTED - price rising but net selling rising (distribution)'
      : 'None';

    /* Basis */
    const basis = coin?.perpPrice != null && coin?.price
      ? (() => {
          const b = ((coin.perpPrice - coin.price) / coin.price) * 100;
          return b.toFixed(4) + '%' + (b > 0.05 ? ' (perp premium - bullish)' : b < -0.05 ? ' (perp discount - bearish)' : ' (neutral)');
        })()
      : '-';

    /* Fibonacci nearest */
    const fibNearest = coin?.high && coin?.low && coin.high > coin.low && coin?.price
      ? (() => {
          const fibs = computeFibLevels(coin.high, coin.low, coin.price);
          if (!fibs.length) return '-';
          const nearest = fibs.reduce((acc, f) => Math.abs(coin.price - f.price) < Math.abs(coin.price - acc.price) ? f : acc);
          return nearest.label + ' @ $' + nearest.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' (' + nearest.dist + ')';
        })()
      : '-';

    /* Order book walls */
    const orderWalls = coin?.orderBidWalls && coin?.orderAskWalls
      ? 'Bid walls: ' + coin.orderBidWalls.map(w => '$' + w.price.toLocaleString(undefined, { maximumFractionDigits: 0 })).join(', ')
        + ' | Ask walls: ' + coin.orderAskWalls.map(w => '$' + w.price.toLocaleString(undefined, { maximumFractionDigits: 0 })).join(', ')
      : '-';

    /* Squeeze score */
    const sq = computeSqueezeScore(coin);
    const squeezeScore = sq.score + '/100 - ' + sq.label;

    /* Options */
    const pcRatio = store.btcPcRatio != null
      ? store.btcPcRatio.toFixed(2) + (store.btcPcRatio > 1.2 ? ' (bearish - more puts)' : store.btcPcRatio < 0.7 ? ' (bullish - more calls)' : ' (neutral)')
      : '-';
    const maxPain = store.btcMaxPain != null ? '$' + store.btcMaxPain.toLocaleString() : '-';

    /* Exchange net flow */
    const exchangeNetFlow = store.btcExchangeNetFlow != null
      ? (store.btcExchangeNetFlow >= 0 ? '+' : '') + '$' + Math.abs(store.btcExchangeNetFlow).toFixed(1) + 'M'
        + (store.btcExchangeNetFlow > 50 ? ' (inflow - sell pressure)' : store.btcExchangeNetFlow < -50 ? ' (outflow - accumulation)' : ' (neutral)')
      : 'AI will search';

    /* Stablecoin flow */
    const stablecoinFlow = store.stablecoinSupply != null
      ? '$' + store.stablecoinSupply.toFixed(1) + 'B'
        + (store.stablecoinPrev != null
          ? (store.stablecoinSupply > store.stablecoinPrev ? ' ↑ minting (bullish)' : ' ↓ burning (bearish)')
          : '')
      : '-';

    /* Liquidation levels */
    const liqLevels = store.btcLiqLevels && store.btcLiqLevels.length > 0
      ? store.btcLiqLevels.slice(0, 4).map(l => '$' + l.price.toLocaleString() + ' ' + l.side).join(' | ')
      : 'AI will search';

    /* BTC dom trend */
    const btcDomTrend = store.btcDomHistory && store.btcDomHistory.length >= 3
      ? (() => {
          const h = store.btcDomHistory;
          const trend = h[h.length - 1] - h[0];
          return (store.btcDom?.toFixed(2) ?? '') + '%'
            + (trend > 0.3 ? ' ↑ rising (alt weakness)' : trend < -0.3 ? ' ↓ falling (alt season)' : ' → flat');
        })()
      : (store.btcDom != null ? store.btcDom.toFixed(2) + '%' : '-');

    /* Sector rotation - BTC vs the alt complex */
    const sectorRotation = computeSectorRotation(store, selectedCoin).line;

    /* Volume Profile POC */
    const pocLine = coin?.poc != null
      ? '$' + coin.poc.toLocaleString(undefined, { maximumFractionDigits: 2 })
        + (coin.vah != null ? ' | VAH $' + coin.vah.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '')
        + (coin.val != null ? ' | VAL $' + coin.val.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '')
        + (coin.price && coin.poc ? (coin.price > coin.poc ? ' - price ABOVE POC (bullish)' : ' - price BELOW POC (bearish)') : '')
      : '-';

    /* Taker Buy/Sell ratio */
    const takerBuy = coin?.takerBuyRatio;
    const takerRatio = takerBuy != null
      ? `Buy ${Math.round(takerBuy * 100)}% / Sell ${Math.round((1 - takerBuy) * 100)}%`
        + (takerBuy >= 0.65 ? ' - aggressive buyers hitting asks (BULLISH)'
        :  takerBuy >= 0.55 ? ' - mild buy pressure'
        :  takerBuy <= 0.35 ? ' - aggressive sellers hitting bids (BEARISH)'
        :  takerBuy <= 0.45 ? ' - mild sell pressure'
        :                     ' - balanced flow')
      : '-';

    /* Coinbase Premium */
    const cbPremium = store.cbPremium != null && store.cbPremiumPct != null
      ? (store.cbPremium >= 0 ? '+' : '') + '$' + Math.abs(store.cbPremium).toFixed(1)
        + ' (' + (store.cbPremiumPct >= 0 ? '+' : '') + store.cbPremiumPct.toFixed(3) + '%)'
        + (store.cbPremiumPct > 0.05  ? ' - US institutional buying (BULLISH)'
        :  store.cbPremiumPct < -0.05 ? ' - US institutional selling (BEARISH)'
        :                               ' - neutral')
      : '-';

    /* VWAP */
    const vwap = coin?.vwap != null
      ? '$' + coin.vwap.toLocaleString(undefined, { maximumFractionDigits: 2 })
        + (coin.price
          ? (coin.price > coin.vwap
              ? ' - price ABOVE VWAP (bullish, paying up)'
              : ' - price BELOW VWAP (bearish, distributing)')
          : '')
      : '-';

    /* OI Trend vs Price */
    const OI_TREND_LABELS: Record<string, string> = {
      strong_up:   'Open Interest ↑ + Price ↑ - real bullish trend (new money entering longs)',
      strong_down: 'Open Interest ↑ + Price ↓ - real bearish trend (new money entering shorts)',
      weak_up:     'Open Interest ↓ + Price ↑ - short covering rally (no conviction, likely fake)',
      weak_down:   'Open Interest ↓ + Price ↓ - long exits (capitulation, not fresh shorts)',
    };
    const oiTrend = coin?.oiTrend ? OI_TREND_LABELS[coin.oiTrend] : '-';

    /* GEX (Gamma Exposure) */
    const btcGex = (() => {
      const net = store.btcNetGex;
      const flip = store.btcGexFlip;
      if (net == null) return 'Calculating…';
      const absN = Math.abs(net);
      const netStr = (net >= 0 ? '+' : '−') + '$' + (absN >= 1e9 ? (absN / 1e9).toFixed(2) + 'B' : (absN / 1e6).toFixed(0) + 'M');
      const regime = net >= 0
        ? 'Dealers LONG gamma - market pins/mean-reverts near large strikes'
        : 'Dealers SHORT gamma - moves accelerate, expect trending/explosive vol';
      const flipStr = flip ? ` | Flip level: $${flip.toLocaleString()} (break = regime shift)` : '';
      const topStrike = store.btcGexLevels.length > 0
        ? store.btcGexLevels.reduce((a, b) => Math.abs(a.gex) > Math.abs(b.gex) ? a : b)
        : null;
      const pinStr = topStrike ? ` | Pin strike: $${topStrike.strike.toLocaleString()}` : '';
      return `${netStr} - ${regime}${flipStr}${pinStr}`;
    })();

    /* Macro */
    const oilPrice  = store.oilPrice  != null ? '$' + store.oilPrice.toFixed(2)  + '/bbl' : '-';
    const bonds10y  = store.bonds10y  != null ? store.bonds10y.toFixed(3)  + '%'   : '-';
    const dxyLine   = store.dxy       != null ? store.dxy.toFixed(2) + (store.dxyChg != null ? ' (' + (store.dxyChg >= 0 ? '+' : '') + store.dxyChg.toFixed(2) + '%)' : '') + (store.dxyChg != null && store.dxyChg > 0.2 ? ' → BTC headwind' : store.dxyChg != null && store.dxyChg < -0.2 ? ' → BTC tailwind' : '') : '-';
    const spxLine   = store.spx       != null ? store.spx.toLocaleString(undefined, { maximumFractionDigits: 0 }) + (store.spxChg != null ? ' (' + (store.spxChg >= 0 ? '+' : '') + store.spxChg.toFixed(2) + '%)' : '') + (store.spxChg != null && store.spxChg > 0.3 ? ' → risk-on' : store.spxChg != null && store.spxChg < -0.5 ? ' → risk-off' : '') : '-';
    const goldLine  = store.gold      != null ? '$' + store.gold.toLocaleString(undefined, { maximumFractionDigits: 0 }) + (store.goldChg != null ? ' (' + (store.goldChg >= 0 ? '+' : '') + store.goldChg.toFixed(2) + '%)' : '') : '-';

    /* Upcoming events + recently released */
    const now = Date.now();
    const recentlyReleased = econEvents
      .filter(e => { const lh = (e.dt.getTime() - now) / 3600000; return lh >= -72 && lh < 0; })
      .sort((a, b) => b.dt.getTime() - a.dt.getTime())
      .slice(0, 6)
      .map(e => {
        const hoursAgo = Math.round((now - e.dt.getTime()) / 3600000);
        const timeLabel = hoursAgo < 2 ? `${Math.round((now - e.dt.getTime()) / 60000)}m ago` : `${hoursAgo}h ago`;
        const actualStr = e.actual ? ` → ACTUAL: ${e.actual}` : ' → result pending/not yet in feed';
        const estStr = e.estimate ? ` | Est: ${e.estimate}` : '';
        const prevStr = e.previous ? ` | Prev: ${e.previous}` : '';
        return `✅ RELEASED (${timeLabel}): ${e.name}${actualStr}${estStr}${prevStr}`;
      })
      .join('\n');
    const upcomingList = econEvents
      .filter(e => { const lh = (e.dt.getTime() - now) / 3600000; return lh > 0 && lh < 48; }).slice(0, 6)
      .map(e => `UPCOMING: ${e.name} (${e.dateStr}, impact: ${e.impact})${e.estimate ? ' | Est: ' + e.estimate : ''}`)
      .join('\n') || 'None in next 48h';
    const upcoming = [recentlyReleased, upcomingList].filter(Boolean).join('\n');

    /* Liquidation cascade size (#30) */
    const ca = store.cascadeAlert;
    const cascadeLine = ca && (Date.now() - ca.ts < 4 * 60 * 60 * 1000)
      ? `${ca.side} cascade on ${ca.coin} - $${(ca.totalUsd / 1e6).toFixed(1)}M liquidated (${Math.floor((Date.now() - ca.ts) / 60000)}m ago)`
      : 'None in last 4h';

    /* Whale net flow - last 1h for selected coin (#29) */
    const nowSec = Math.floor(Date.now() / 1000);
    const coinSym = selectedCoin.toUpperCase();
    const recentWhales = whaleAlerts.filter(w => w.symbol === coinSym && nowSec - w.ts < 3600);
    const whaleFlow = (() => {
      if (!['btc', 'eth'].includes(selectedCoin)) return 'Whale monitoring: BTC/ETH only';
      if (recentWhales.length === 0) return 'No whale trades (>$500K) detected in last 1h';
      let buyUsd = 0, sellUsd = 0, buyCount = 0, sellCount = 0;
      recentWhales.forEach(w => {
        if (w.side === 'BUY')  { buyUsd  += w.usdValue; buyCount++;  }
        else                   { sellUsd += w.usdValue; sellCount++; }
      });
      const net = buyUsd - sellUsd;
      const f = (v: number) => v >= 1e6 ? `$${(v/1e6).toFixed(1)}M` : `$${(v/1e3).toFixed(0)}K`;
      return `Net ${net >= 0 ? 'BUY' : 'SELL'} ${f(Math.abs(net))} - ${buyCount} buys (${f(buyUsd)}) vs ${sellCount} sells (${f(sellUsd)}) · ${recentWhales.length} whale trades >$500K in last 1h`;
    })();

    /* Cross-exchange funding */
    const cf = fundingData[selectedCoin];
    const crossExchangeFunding = cf
      ? (() => {
          const fmt = (v: number | null) => v !== null ? (v >= 0 ? '+' : '') + (v * 100).toFixed(4) + '%' : '-';
          const vals = [cf.binance, cf.bybit].filter((v): v is number => v !== null);
          const avg  = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
          const divergent = avg !== null && [cf.binance, cf.bybit]
            .some(v => v !== null && Math.abs(v - avg) * 100 >= 0.02);
          const sentiment = avg === null ? '' : avg * 100 >= 0.05 ? ' - extreme long crowding (flush risk)'
            : avg * 100 >= 0.01 ? ' - longs paying, mild crowding'
            : avg * 100 <= -0.05 ? ' - extreme short crowding (squeeze risk)'
            : avg * 100 <= -0.01 ? ' - shorts paying, mild crowding'
            : ' - neutral';
          return `Binance ${fmt(cf.binance)} | Bybit ${fmt(cf.bybit)} | Avg ${fmt(avg)}${sentiment}${divergent ? ' · DIVERGENCE: exchanges differ - flow imbalance' : ''}`;
        })()
      : '-';

    return {
      coin: selectedCoin.toUpperCase() + '/USDT',
      price: coin?.price ? '$' + coin.price.toLocaleString() : '-',
      change24h: coin?.change != null ? (coin.change >= 0 ? '+' : '') + coin.change.toFixed(2) + '%' : '-',
      fundingRate: coin?.fundingRate != null ? classifyFunding(coin.fundingRate).label : '-',
      openInterest: coin?.oi != null ? '$' + (coin.oi / 1e9).toFixed(2) + 'B' : '-',
      fearGreed: store.fng != null ? store.fng + ' (' + store.fngLabel + ')' : '-',
      btcDominance: btcDomTrend,
      session, clusters: '-',
      news: latestHeadlines.length > 0 ? latestHeadlines.slice(0, 15).join('\n') : 'No recent alerts',
      rsi14, ma20, priceVsMA, volRatio, longShortRatio,
      oilPrice, bonds10y, upcomingEvents: upcoming,
      rsi1h, rsi4h, rsiDaily: fmt(coin?.rsiDaily), cvd, cvdDivergence, basis, fibNearest, orderWalls, squeezeScore,
      pcRatio, maxPain, btcGex,
      exchangeNetFlow, stablecoinFlow, liqLevels, btcDomTrend, sectorRotation,
      // Placeholder: needs candles, which this synchronous builder has no
      // access to. Overridden at the call site once they are fetched, the same
      // way rsiDaily is - see the gatherContext() spread below.
      structureBreak: '-',
      pocLine, dxyLine, spxLine, goldLine,
      cbPremium, vwap, oiTrend, takerRatio, crossExchangeFunding,
      cascadeLine, whaleFlow,
      distribution: (() => {
        if (!coin?.price) return '-';
        const res = computeDistributionScore(distInputsFromCoin(coin));
        if (!res) return 'Not applicable - no 24h run-up (profit-taking needs prior strength)';
        return `${res.score}/100 - ${res.label}${res.reasons.length ? ' · ' + res.reasons.join(', ') : ''}`;
      })(),
      setupScan: (() => {
        const sq = computeSqueezeScore(coin);
        const oiChip  = coin?.oiTrend   ? { strong_up: 'Open Int ↑↑', weak_up: 'Open Int ↑', weak_down: 'Open Int ↓', strong_down: 'Open Int ↓↓' }[coin.oiTrend] ?? 'Open Int -' : 'Open Int -';
        const cvdChip = coin?.cvdDivergence === 'bullish' ? 'CVD ↑' : coin?.cvdDivergence === 'bearish' ? 'CVD ↓' : 'CVD -';
        const tkr     = coin?.takerBuyRatio != null ? 'Tkr ' + (coin.takerBuyRatio * 100).toFixed(0) + '%' : 'Tkr -';
        const rsi     = coin?.rsi14 != null ? 'RSI ' + Math.round(coin.rsi14) : 'RSI -';
        return `Score ${sq.score}/100 · ${sq.label} · ${oiChip}, ${cvdChip}, ${tkr}, ${rsi}`;
      })(),
      oi1hChange: (() => {
        const { pct, signal } = oi1hDataRef.current;
        if (pct == null) return '-';
        return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '% · ' + signal;
      })(),
      marketStructure: (() => {
        const ms = msDataRef.current;
        if (!ms) return '-';
        let s = ms.bias;
        if (ms.lastEvent) {
          const le = ms.lastEvent;
          s += ` · Last: ${le.type} ${le.dir} @ $${fmtPrice(le.price)} (${le.candlesAgo === 0 ? 'current' : le.candlesAgo + 'c ago'})`;
          if (le.type === 'CHoCH') s += ' - STRUCTURE FLIP';
        }
        if (ms.lastSwingHigh != null) s += ` · SH $${fmtPrice(ms.lastSwingHigh)}`;
        if (ms.lastSwingLow  != null) s += ` · SL $${fmtPrice(ms.lastSwingLow)}`;
        return s;
      })(),
      absorptionScore: (() => {
        const ab = absDataRef.current;
        if (!ab || ab.label === 'None') return 'None';
        let s = `${ab.label} ${ab.type === 'accumulation' ? 'ACCUMULATION' : ab.type === 'distribution' ? 'DISTRIBUTION' : ''} (${ab.score}/100)`;
        if (ab.duration > 0) {
          const m = ab.durationMin;
          s += ` · ${ab.duration} candles (~${m < 60 ? m + 'm' : Math.floor(m/60) + 'h' + (m % 60 ? ' ' + m % 60 + 'm' : '')})`;
        }
        if (ab.nearLevel) s += ` · ${ab.nearLevel}`;
        if (ab.mtfConfirmed) s += ' · 1H CONFIRMED';
        return s;
      })(),
      yenWatch: jpyUsd == null ? '-'
        : jpyUsd >= 160
          ? `${jpyUsd.toFixed(2)} - DANGER ZONE: BOJ intervention risk high, carry trade unwind can trigger BTC liquidations`
          : jpyUsd >= 158
            ? `${jpyUsd.toFixed(2)} - WARNING: Approaching 160 danger zone, watch for BOJ signals`
            : `${jpyUsd.toFixed(2)} - Safe: below 158, carry trade stable, low JPY liquidation risk`,
      /* The card's own sentence, verbatim. Rewording it for the prompt would
         give the model a second vocabulary for one fact, and a user reading the
         dashboard and the AI answer would see two claims instead of one. */
      perpSpot: perpSpotRef.current?.explanation ?? 'Perps vs spot could not be measured for this coin.',
      emaStrategy: strategyToGrokLine(emaSignalRef.current, readTf),
      emaATR: emaSignalRef.current.atrLast != null
        ? `ATR(14) = $${emaSignalRef.current.atrLast.toFixed(2)} · 35% buf = $${(emaSignalRef.current.atrLast * 0.35).toFixed(2)} min clearance above/below EMA50`
        : '-',
      ema50Slope: (() => {
        const s = emaSignalRef.current.ema50Slope;
        if (s == null) return '-';
        const pct = (s * 100).toFixed(3);
        const label = s > 0.001 ? 'RISING - bullish slope confirmed' : s < -0.001 ? 'FALLING - bearish slope confirmed' : 'FLAT - ranging market, slope filter fails';
        return `${pct}% over 5 bars - ${label}`;
      })(),
      waveTrend: (() => {
        const c = emaSignalRef.current.conditions.find(x => x.label === 'WaveTrend Confirming');
        if (!c) return '-';
        return `${c.pass === true ? 'CONFIRMING' : c.pass === false ? 'NOT CONFIRMING' : 'N/A'} - ${c.detail}`;
      })(),
    };
  };

  const readMarket = useCallback(async (mode: 'quick' | 'deep' = 'deep', force = false) => {
    const binanceSym = BINANCE_SYMS[selectedCoin] as string | undefined;
    const bybitSym   = BYBIT_SYMS[selectedCoin]   as string | undefined;
    if (!binanceSym && !bybitSym) {
      setReadError(t('ARENA_ERROR_NO_DATA_SOURCE', { coin: selectedCoin.toUpperCase() }));
      return;
    }

    /* UN-HIDE FIRST, BEFORE THE CACHE CHECK (#278).
     *
     * Dismiss means "hide this one now", not "stop showing me results", so ANY
     * new analysis brings the card back - including one served from cache.
     *
     * The position is the entire fix. This clear used to live below the cache
     * check and below the early return, which broke it twice over:
     *
     *   - a CACHE HIT returned before ever reaching it, so asking for a fresh
     *     read on a dismissed coin appeared to do nothing at all;
     *   - a dismiss landing AFTER this point was never undone, so a result the
     *     user was waiting for arrived and rendered nothing. They spent a Grok
     *     call and saw no output.
     *
     * The early return above it is correct and stays - serving a fresh cached
     * result without a Grok call is the right behaviour. The bug was reading
     * "serve cache silently" as "change nothing", when exactly one thing had to
     * change. */
    setDismissedResults(prev => {
      if (!prev.has(selectedCoin)) return prev;
      const next = new Set(prev);
      next.delete(selectedCoin);
      return next;
    });

    // ── Cache check - skip API call if result is fresh and price hasn't moved >0.5% ──
    // Quick accepts any cached result (Quick or Deep).
    // Deep only accepts a cached Deep result - clicking Deep always re-fetches if last was Quick.
    if (!force) {
      const currentPrice = store.coins[selectedCoin]?.price ?? 0;
      const entry = resultsCache[selectedCoin];
      if (entry && entry.mode === mode) {
        const ageSecs  = (Date.now() - entry.result.analyzedAt) / 1000;
        const pricePct = currentPrice > 0
          ? Math.abs(currentPrice - entry.priceAtAnalysis) / currentPrice * 100
          : 0;
        if (ageSecs < getCacheTTL() / 1000 && pricePct < PRICE_MOVE_PCT && entry.result.tf === readTf) {
          return; // serve cache silently - no banner, no state change
        }
      }
    }

    setReadMode(mode);
    setReadLoading(true); setReadError('');

    try {
      // Step 1 - fetch candles (Binance preferred; fall back to Bybit for HYPE etc.)
      setReadStep('Reading chart…');
      let raw: (string|number)[][];
      if (binanceSym) {
        const r = await fetch(`/api/market/klines?source=binance&symbol=${binanceSym}&interval=${readTf}&limit=300`);
        if (!r.ok) throw new Error(t('ARENA_ERROR_BINANCE_API'));
        raw = await r.json();
      } else {
        // Bybit klines: interval uses numbers (1, 5, 15, 30, 60, 240) or 'D'; response is newest-first
        const bybitInterval = readTf === '1m' ? '1' : readTf === '5m' ? '5' : readTf === '30m' ? '30' : readTf === '15m' ? '15' : readTf === '1h' ? '60' : readTf === '2h' ? '120' : readTf === '4h' ? '240' : 'D';
        const r = await fetch(`/api/market/klines?source=bybit&symbol=${bybitSym}&interval=${bybitInterval}&limit=300`);
        if (!r.ok) throw new Error(t('ARENA_ERROR_BYBIT_API'));
        const data = await r.json();
        raw = [...(data?.result?.list ?? [])].reverse(); // oldest-first to match Binance
      }
      // k[0]=time k[1]=open k[2]=high k[3]=low k[4]=close k[5]=vol - same index for both
      const candles = raw.map(k => ({ t: Number(k[0]), o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]), v: Number(k[5]) }));
      const closes  = candles.map(c => c.c);
      const vis     = candles.slice(-80);
      const ema9    = calcEMA(closes, 9).at(-1) ?? null;
      const sma200  = calcSMA(closes, 200).at(-1) ?? null;
      const rsi     = calcRSI(closes, 14).at(-1) ?? null;
      const lastC    = vis[vis.length - 1].c;
      const pDec     = lastC >= 10000 ? 0 : lastC >= 100 ? 2 : lastC >= 1 ? 3 : 4;
      // Include volume so AI can detect drying-up volume (exhaustion signal)
      const recent20 = vis.slice(-15).map(c => `O:${c.o.toFixed(pDec)} H:${c.h.toFixed(pDec)} L:${c.l.toFixed(pDec)} C:${c.c.toFixed(pDec)} V:${c.v >= 1e6 ? (c.v/1e6).toFixed(2)+'M' : c.v >= 1e3 ? (c.v/1e3).toFixed(1)+'K' : c.v.toFixed(0)}`).join(' | ');
      const detectedPatterns = detectPatterns(vis);
      // Structure read from the same candles already in hand - no extra fetch.
      // Deliberately independent of the EMA ribbon: the prompt is told to
      // surface a disagreement between the two rather than quietly pick one.
      const structureBreak = describeStructureSignal(latestStructureSignal(
        candles.map(c => ({ timestamp: c.t, open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v })),
      ));
      const chartData: ChartData = {
        tf: readTf, ema9, sma200, rsi, recent20,
        hi: Math.max(...vis.map(c => c.h)),
        lo: Math.min(...vis.map(c => c.l)),
        lastClose: vis[vis.length - 1].c,
        detectedPatterns: detectedPatterns || undefined,
      };

      // Step 1.5 - fetch daily RSI (parallel, silent fail)
      let rsiDailyStr = '-';
      try {
        if (binanceSym) {
          const dr = await fetch(`/api/market/klines?source=binance&symbol=${binanceSym}&interval=1d&limit=20`);
          const dd = await dr.json() as (string|number)[][];
          const dc = dd.map(k => Number(k[4]));
          const dv = calcRSI(dc, 14).at(-1);
          if (dv != null) rsiDailyStr = dv.toFixed(1) + (dv >= 70 ? ' (Overbought)' : dv <= 30 ? ' (Oversold)' : ' (Neutral)');
        } else if (bybitSym) {
          const dr = await fetch(`/api/market/klines?source=bybit&symbol=${bybitSym}&interval=D&limit=20`);
          const dd = await dr.json() as { result?: { list?: string[][] } };
          const dc = [...(dd?.result?.list ?? [])].reverse().map(k => parseFloat(k[4]));
          const dv = calcRSI(dc, 14).at(-1);
          if (dv != null) rsiDailyStr = dv.toFixed(1) + (dv >= 70 ? ' (Overbought)' : dv <= 30 ? ' (Oversold)' : ' (Neutral)');
        }
      } catch { /* silent */ }

      // Step 2 - gather 34 market signals
      setReadStep('Reading market…');
      const ctx = { ...gatherContext(), rsiDaily: rsiDailyStr, structureBreak };

      // Step 3 - ask Grok via server proxy (key hidden, rate-limited)
      setReadStep(mode === 'quick' ? 'Quick analysis…' : 'Searching live…');
      const prompt = mode === 'quick'
        ? buildQuickPrompt(ctx, chartData)
        : buildCombinedPrompt(ctx, chartData);
      const { result: res, usage } = await callGrokViaProxy(prompt, readTf, ctx.session, mode);
      if (usage) setGrokUsage(usage);
      track.arenaAnalysis(mode, selectedCoin);

      // ── Liquidity Raid → Telegram alert (1h cooldown per coin + setup type) ──
      if (res.raidSetup) {
        try {
          const raidKey  = `raid-tg-${selectedCoin}-${res.raidSetup}`;
          const lastSent = Number(localStorage.getItem(raidKey) ?? 0);
          if (Date.now() - lastSent > 60 * 60 * 1000) {
            localStorage.setItem(raidKey, String(Date.now()));
            const sym  = selectedCoin.toUpperCase();
            const lines: string[] = [
              '<b>LIQUIDITY RAID DETECTED</b>',
              `<b>${res.raidSetup} - ${sym}/USDT</b>`,
              '',
            ];
            if (res.raidTarget)  lines.push(`Target: ${res.raidTarget}`);
            if (res.raidTrigger) lines.push(`Trigger: ${res.raidTrigger}`);
            lines.push(`Signal: ${res.signal} · ${res.confidence}% confidence`);
            lines.push(`Session: ${ctx.session}`);
            lines.push('');
            lines.push('<i>LiquidityHQ Arena</i>');
            fetch('/api/telegram/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: lines.join('\n') }),
            }).catch(() => { /* silent - alert failure must not block UI */ });
          }
        } catch { /* localStorage unavailable - skip silently */ }
      }

      // Cache result per coin (with price snapshot for stale-check)
      const priceNow = store.coins[selectedCoin]?.price ?? 0;
      setResultsCache(prev => ({ ...prev, [selectedCoin]: { result: res, priceAtAnalysis: priceNow, mode } }));
      // Track Quick signals separately so Deep can show an override notice when they disagree
      if (mode === 'quick') setQuickSignals(prev => ({ ...prev, [selectedCoin]: res.signal }));
      setDetailIdx(null);
      setHistory(h => [{
        signal: res.signal, confidence: res.confidence,
        coin: ctx.coin, time: new Date().toLocaleTimeString(),
        reasoning: res.reasoning, session: ctx.session,
      }, ...h].slice(0, 10));
      if (user && process.env.NEXT_PUBLIC_SUPABASE_URL) {
        getSupabase()!.from(T.signals).insert({
          coin: ctx.coin, signal: res.signal, confidence: res.confidence,
          reasoning: res.reasoning, session: ctx.session,
        }).then(() => {});
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t('ARENA_ERROR_UNKNOWN');
      setReadError(msg);
      // If rate limit error, update usage display so the chip reflects the limit
      const usageFromErr = (e as { usage?: GrokUsageInfo }).usage;
      if (usageFromErr) setGrokUsage(usageFromErr);
    } finally {
      setReadLoading(false); setReadStep('');

      /* REVEAL, on every exit path (#278).
       *
       * `finally`, not the success branch, and that is deliberate. On success
       * there is a new result to show. On FAILURE there is not - and leaving the
       * coin dismissed would hide the previous card too, so a failed read would
       * silently cost the user the result they already had, on top of the one
       * that did not arrive. Restoring it puts them back where they started with
       * an error banner explaining why, which is the honest outcome.
       *
       * `selectedCoin` is the closure value from when the read began, so a user
       * who switches coins mid-read un-dismisses the coin they actually ran -
       * not whichever one they are looking at now. */
      setDismissedResults(prev => {
        if (!prev.has(selectedCoin)) return prev;
        const next = new Set(prev);
        next.delete(selectedCoin);
        return next;
      });
    }
  }, [selectedCoin, readTf, store, latestHeadlines, econEvents, fundingData, resultsCache]);

  /* ── Squeeze scanner data - sorted by 24h volume descending (BTC → ETH → ...) ── */
  const btcChange = store.coins['btc']?.change ?? null;
  const scannerRows = COINS
    .filter(c => coinCat === 'all' || (CAT_FILTER_COINS[coinCat] as readonly CoinId[]).includes(c))
    .map(c => {
      const coin   = store.coins[c];
      const change = coin?.change ?? null;
      const vsBtc  = change != null && btcChange != null && c !== 'btc' ? change - btcChange : null;
      const rsi    = coin?.rsi14 ?? null;
      const fr     = coin?.fundingRate ?? null;
      const badges: Array<{ key: LabelKey; tone: 'good' | 'bad' }> = [];
      if (rsi != null && rsi >= 70)      badges.push({ key: 'ARENA_SCANNER_BADGE_OVERBOUGHT', tone: 'bad' });
      if (rsi != null && rsi <= 30)      badges.push({ key: 'ARENA_SCANNER_BADGE_OVERSOLD', tone: 'good' });
      if (fr  != null && fr  < -0.0001) badges.push({ key: 'ARENA_SCANNER_BADGE_NEG_FUNDING', tone: 'bad' });
      if (vsBtc != null && vsBtc >= 2)  badges.push({ key: 'ARENA_SCANNER_BADGE_BEATS_BTC', tone: 'good' });
      if (vsBtc != null && vsBtc <= -2) badges.push({ key: 'ARENA_SCANNER_BADGE_LAGS_BTC', tone: 'bad' });
      return {
        c, badges, vsBtc,
        sq:     computeSqueezeScore(coin),
        price:  coin?.price  ?? null,
        change,
        vol24:  coin?.vol24  ?? 0,
      };
    }).sort((a, b) => (b.vol24 ?? 0) - (a.vol24 ?? 0));
  const sqzCount   = scannerRows.filter(x => x.sq.dir === 'SHORT_SQ'  && x.sq.score >= 30).length;
  const flushCount = scannerRows.filter(x => x.sq.dir === 'LONG_LIQ'  && x.sq.score >= 30).length;
  const visibleScannerRows = scannerSearch
    ? scannerRows.filter(r => r.c.toLowerCase().includes(scannerSearch.toLowerCase()))
    : scannerRows;

  /* The chart, built ONCE. The terminal layout puts it between the timeframe
     toolbar and the evidence grid; the legacy layout leaves it where it was.
     Same element either way - carrying the read result, the EMA overlay, the
     draggable alerts, the gamma levels and the structure callback. Rendering a
     second, plainer chart inside the new layout is what put two charts on the
     page. */
  const arenaChart = <KLineProChart coin={selectedCoin} tf={readTf} onTfChange={handleTfChange} result={result} emaSignal={emaSignal} chartAlerts={chartAlerts} onAlertMove={handleAlertMove} gexLevels={selectedCoin === 'btc' ? { flip: store.btcGexFlip, maxPain: store.btcMaxPain } : null} onStructure={setChartStructure} />;

  /* The EXISTING Arena, kept whole. Nothing here is deleted by the redesign -
     the owner's instruction is that UI moves or gets reworded, never removed.
     It becomes a value so the terminal branch below can render it underneath
     the new layout while each panel is relocated into its designed slot
     (README:89 gives Arena in-page tabs: Read, Order flow, Liquidity,
     Correlation, History). */
  const legacyArena = (
    <div>

      {/* ── PAGE HEADER ── */}
      <div style={{ padding: '1rem 0 0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 'var(--fs-section)', fontWeight: 700, color: 'var(--txt)', letterSpacing: '-0.3px' }}>{t('ARENA_PAGE_TITLE')}</div>
          <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: 'var(--accent-bg)', color: 'var(--accent)', border: '0.5px solid var(--accent-bdr)', letterSpacing: '.05em' }}>{t('ARENA_LIVE_BADGE')}</span>
        </div>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('ARENA_PAGE_SUBTITLE')}</div>
      </div>

      <PageHint
        pageKey="arena"
        title={t('ARENA_HINT_TITLE')}
        body={t('ARENA_HINT_BODY')}
      />

      {/* ── COIN CATEGORY TABS ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        {(['all', 'majors', 'alts', 'defi', 'meme'] as const).map(c => (
          <button
            key={c}
            className={`gsc-tf-btn${coinCat === c ? ' on' : ''}`}
            style={{ padding: '3px 9px', fontSize: 'var(--fs-caption)', textTransform: 'capitalize' }}
            onClick={() => setCoinCat(c)}
          >
            {c === 'all' ? t('ARENA_CAT_ALL') : c === 'majors' ? t('ARENA_CAT_MAJORS') : c === 'alts' ? t('ARENA_CAT_ALTS') : c === 'defi' ? t('ARENA_CAT_DEFI') : t('ARENA_CAT_MEME')}
          </button>
        ))}
      </div>

      {/* ── SQUEEZE SCANNER - hover flyout (Bybit-style watchlist) ── */}
      <div
        ref={scannerRef}
        style={{ position: 'relative', marginBottom: 12 }}
        onMouseEnter={handleScannerHoverEnter}
        onMouseLeave={handleScannerHoverLeave}
      >
        {/* ── Compact trigger bar ──
            The bar itself is a plain <div>, not a <button>. It used to be a
            button, which made the notification bell further down a control
            nested inside a control - axe's nested-interactive rule, and the
            reason the bell was already a div[role=button] rather than a
            <button>. That earlier change only dodged the invalid-HTML half of
            the problem; the accessibility tree still saw a control inside a
            control, so screen readers announce one thing and expose two.

            This div carries the onClick so clicking anywhere on the bar still
            toggles, but deliberately has NO role and NO tabIndex: axe only
            treats focusable or role-bearing ancestors as interactive, so a bare
            div is not one. Keyboard access comes from the real <button> inside,
            whose Enter/Space fires a click that bubbles up to this handler -
            which is why that button needs no onClick of its own. */}
        <div
          onClick={() => {
            /* A deliberate click takes ownership of the panel: clear the
               hover flag so drifting the pointer away no longer closes it,
               and cancel any pending hover-open so it cannot reopen behind
               a click that just closed it. */
            openedByHover.current = false;
            if (hoverOpenTimer.current) { clearTimeout(hoverOpenTimer.current); hoverOpenTimer.current = null; }
            setScannerOpen(v => { if (v) setScannerSearch(''); return !v; });
            if (!scannerOpen) setTimeout(() => scannerSearchRef.current?.focus(), 60);
          }}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 12px', borderRadius: 8,
            background: scannerOpen ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.03)',
            border: `0.5px solid ${scannerOpen ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.07)'}`,
            cursor: 'pointer', textAlign: 'left', transition: 'background 0.15s, border-color 0.15s',
          }}
        >
          {/* The actual control: carries the accessible name and aria-expanded,
              and fills the bar so the click target is unchanged. */}
          <button
            aria-expanded={scannerOpen}
            style={{
              flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8,
              background: 'none', border: 'none', padding: 0, margin: 0,
              color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer',
            }}
          >
          {/* Dot indicator */}
          <span style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: sqzCount > 0 ? '#34d399' : flushCount > 0 ? '#f87171' : '#333',
            boxShadow: sqzCount > 0 ? '0 0 6px #34d39966' : flushCount > 0 ? '0 0 6px #f8717166' : 'none',
          }} />
          {/* Selected coin chip - left side */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--accent-2)',
            background: 'rgba(var(--accent-rgb), 0.1)', padding: '2px 9px 2px 5px',
            borderRadius: 20, border: '0.5px solid rgba(var(--accent-rgb), 0.2)',
            flexShrink: 0,
          }}>
            <CoinIcon coin={selectedCoin} size={16} color="#5aa3ff" bg="rgba(var(--accent-rgb), 0.15)" />
            {selectedCoin.toUpperCase()}
          </span>
          {/* Spacer */}
          <span style={{ flex: 1 }} />
          {/* Active signal chips */}
          {sqzCount > 0 && (
            <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--green-2)', background: 'rgba(52,211,153,0.1)', padding: '1px 7px', borderRadius: 20, border: '0.5px solid rgba(52,211,153,0.2)' }}>
              ↑ {sqzCount}
            </span>
          )}
          {flushCount > 0 && (
            <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--red)', background: 'rgba(248,113,113,0.1)', padding: '1px 7px', borderRadius: 20, border: '0.5px solid rgba(248,113,113,0.2)' }}>
              ↓ {flushCount}
            </span>
          )}
          {sqzCount === 0 && flushCount === 0 && (
            <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)' }}>All neutral</span>
          )}
          {/* Coin Health grade badge */}
          {(() => {
            const h = computeCoinHealth(store.coins[selectedCoin]);
            return (
              <span title={h.label} style={{
                fontSize: 'var(--fs-caption)', fontWeight: 800, lineHeight: 1,
                padding: '2px 6px', borderRadius: 6, flexShrink: 0,
                color: h.color, background: withAlpha(h.color, '22'),
                border: `0.5px solid ${withAlpha(h.color, '55')}`, letterSpacing: '.04em',
              }}>
                {h.grade}
              </span>
            );
          })()}
          </button>

          {/* Notification bell - now a SIBLING of the trigger button, not a
              child of it. Kept as div[role=button] rather than reverted to a
              real <button> only because the surrounding markup has not changed
              otherwise; either is valid here now that it is not nested.
              stopPropagation matters more than before: this sits inside the
              bar's onClick, so without it enabling notifications would also
              toggle the scanner panel. */}
          <div
            role="button"
            tabIndex={0}
            onClick={e => { e.stopPropagation(); enableNotifications(); }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); enableNotifications(); } }}
            title={notifEnabled ? t('ARENA_ALERTS_ON_TITLE') : t('ARENA_ALERTS_ENABLE_TITLE')}
            style={{
              /* 28x20 before - WCAG 2.2 SC 2.5.8 wants 24 in both axes, and a
                 notification toggle is a standalone control so the inline
                 exception does not apply. Grown via minHeight and centring so
                 the bell glyph and the pill border look unchanged. */
              minWidth: 24, minHeight: 24,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              padding: '3px 7px', borderRadius: 7, border: '0.5px solid',
              background: notifEnabled ? '#152b1e' : 'transparent',
              borderColor: notifEnabled ? '#266038' : 'rgba(255,255,255,0.08)',
              color: notifEnabled ? 'var(--green-soft)' : 'var(--txt-dim)',
              fontSize: 'var(--fs-caption)', cursor: 'pointer', flexShrink: 0, lineHeight: 1,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              {!notifEnabled && <line x1="2" y1="2" x2="22" y2="22" />}
            </svg>
          </div>
          {/* Decorative: aria-expanded on the trigger button already conveys
              this state, so announcing an arrow glyph on top of it is noise. */}
          <span aria-hidden="true" style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)', flexShrink: 0 }}>{scannerOpen ? '▲' : '▼'}</span>
        </div>

        {/* ── Flyout panel (appears on hover / click) ── */}
        {scannerOpen && (
          <div
            className="scanner-flyout"
            style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50,
            }}
          >
          <div style={{
            background: 'var(--bg2)', border: '0.5px solid var(--bdr)',
            borderRadius: 10, overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          }}>
            {/* Search bar */}
            <div style={{ borderBottom: '0.5px solid var(--bdr)', padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, opacity: 0.3 }}>
                <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.3"/>
                <line x1="8" y1="8" x2="11" y2="11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              <input
                ref={scannerSearchRef}
                type="text"
                placeholder={t('ARENA_SCANNER_SEARCH_PLACEHOLDER')}
                value={scannerSearch}
                onChange={e => setScannerSearch(e.target.value)}
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', padding: '7px 0', fontSize: 'var(--fs-caption)', color: 'var(--txt)' }}
              />
              {scannerSearch && (
                <button onClick={() => setScannerSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--txt3)', fontSize: '0.8125rem', lineHeight: 1 }} aria-label={t('ARENA_SCANNER_CLEAR_SEARCH_ARIA')}>×</button>
              )}
            </div>

            {/* Column header */}
            <div className="scanner-flyout-grid" style={{
              display: 'grid', gridTemplateColumns: '1fr 78px 44px 44px 72px 32px',
              padding: '6px 12px',
              borderBottom: '0.5px solid var(--bdr)',
              background: 'var(--bg1)',
            }}>
              {([
                { id: 'name', key: 'ARENA_SCANNER_COL_NAME', align: 'left' },
                { id: 'price', key: 'ARENA_SCANNER_COL_PRICE', align: 'right' },
                { id: '24h', key: 'ARENA_SCANNER_COL_24H', align: 'right' },
                { id: 'vsbtc', key: 'ARENA_SCANNER_COL_VS_BTC', align: 'right' },
                { id: 'status', key: 'ARENA_SCANNER_COL_STATUS', align: 'right' },
                { id: 'score', key: 'ARENA_SCANNER_COL_SCORE', align: 'right' },
              ] as const).map(col => (
                <span key={col.id} className={col.id === 'vsbtc' ? 'scanner-flyout-vsbtc' : undefined} style={{ fontSize: 'var(--fs-micro)', fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--txt3)', textAlign: col.align }}>{t(col.key)}</span>
              ))}
            </div>

            {/* Coin rows */}
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {visibleScannerRows.length === 0 ? (
              <div style={{ padding: '12px', fontSize: 'var(--fs-caption)', color: 'var(--txt3)', textAlign: 'center' }}>{t('ARENA_SCANNER_NO_MATCH', { search: scannerSearch })}</div>
            ) : visibleScannerRows.map(({ c, sq: rowSq, price, change, vsBtc, badges }) => {
              const isSelected  = c === selectedCoin;
              const isActive    = rowSq.dir !== 'NEUTRAL' && rowSq.score >= 30;
              const icon        = rowSq.dir === 'SHORT_SQ' ? '↑' : rowSq.dir === 'LONG_LIQ' ? '↓' : '';
              const statusLabel = rowSq.dir === 'SHORT_SQ' ? t('ARENA_SCANNER_STATUS_SQUEEZE') : rowSq.dir === 'LONG_LIQ' ? t('ARENA_SCANNER_STATUS_FLUSH') : t('ARENA_SCANNER_STATUS_NEUTRAL');
              const vsBtcColor  = vsBtc == null ? 'var(--txt3)' : vsBtc >= 2 ? 'var(--green-2)' : vsBtc <= -2 ? 'var(--red)' : 'var(--txt3)';
              return (
                <button
                  key={c}
                  className="scanner-flyout-grid"
                  onClick={() => {
                    setSelectedCoin(c); setScannerOpen(false); setScannerSearch(''); window.dispatchEvent(new CustomEvent('onboarding:done', { detail: 'coins' }));
                  }}
                  style={{
                    width: '100%', display: 'grid',
                    gridTemplateColumns: '1fr 78px 44px 44px 72px 32px',
                    alignItems: 'center', padding: '7px 12px',
                    background: isSelected ? 'rgba(var(--accent-rgb), 0.08)' : 'transparent',
                    border: 'none',
                    borderBottom: '0.5px solid var(--bdr)',
                    cursor: 'pointer', textAlign: 'left', transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg3)'; }}
                  onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                >
                  {/* Coin icon + name + tech badges */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CoinIcon
                      coin={c}
                      size={22}
                      color={isActive ? rowSq.color : undefined}
                      bg={isActive ? withAlpha(rowSq.color, '1a') : undefined}
                    />
                    <div>
                      <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: isSelected ? 'var(--accent-2)' : isActive ? 'var(--txt)' : 'var(--txt3)', lineHeight: 1.2 }}>
                        {c.toUpperCase()}
                      </div>
                      {badges.length > 0 ? (
                        <div style={{ display: 'flex', gap: 3, marginTop: 2, flexWrap: 'wrap' }}>
                          {badges.map(b => {
                            const col = b.tone === 'good' ? 'var(--green-2)' : 'var(--red)';
                            return (
                              <span key={b.key} style={{
                                fontSize: 'var(--fs-caption)', fontWeight: 700, letterSpacing: '.04em',
                                padding: '1px 4px', borderRadius: 3,
                                color: col, background: withAlpha(col, '18'), border: `0.5px solid ${withAlpha(col, '33')}`,
                              }}>{t(b.key)}</span>
                            );
                          })}
                        </div>
                      ) : (
                        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', lineHeight: 1 }}>{t('ARENA_SCANNER_USDT_PERP')}</div>
                      )}
                    </div>
                  </div>
                  {/* Price */}
                  <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, color: isActive ? 'var(--txt)' : 'var(--txt3)', fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
                    {price ? '$' + fmtPrice(price) : '-'}
                  </span>
                  {/* 24h % */}
                  <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', textAlign: 'right', color: change == null ? 'var(--txt3)' : change >= 0 ? 'var(--green-2)' : 'var(--red)' }}>
                    {change != null ? (change >= 0 ? '+' : '') + change.toFixed(1) + '%' : '-'}
                  </span>
                  {/* vs BTC */}
                  <span className="scanner-flyout-vsbtc" style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', textAlign: 'right', color: vsBtcColor }}>
                    {vsBtc != null ? (vsBtc >= 0 ? '+' : '') + vsBtc.toFixed(1) + '%' : c === 'btc' ? '-' : '-'}
                  </span>
                  {/* Status */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                    {isActive ? (
                      <span style={{
                        fontSize: 'var(--fs-caption)', fontWeight: 700, letterSpacing: '.04em', padding: '1px 6px',
                        borderRadius: 4, background: withAlpha(rowSq.color, '18'),
                        border: `0.5px solid ${withAlpha(rowSq.color, '44')}`,
                        color: rowSq.color,
                      }}>
                        {icon} {statusLabel}
                      </span>
                    ) : (
                      <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('ARENA_SCANNER_NEUTRAL_DOT')}</span>
                    )}
                  </div>
                  {/* Score */}
                  <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: isActive ? rowSq.color : 'var(--txt3)', fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
                    {rowSq.score}
                  </span>
                </button>
              );
            })}
            </div>

            {/* Footer */}
            <div style={{ padding: '5px 12px', background: 'var(--bg1)', borderTop: '0.5px solid var(--bdr)' }}>
              <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('ARENA_SCANNER_FOOTER_EXPLAINER')}</span>
            </div>
          </div>
          </div>
        )}
      </div>

      {/* ── AI READ · answer-first hero ── */}
      <div className="arena-below-chart">
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {/* Quick button - requires sign-in */}
        <button
          className={`arena-fire-btn arena-quick-btn${!user ? ' arena-deep-locked' : ''}`}
          disabled={readLoading || !!(user && grokUsage && grokUsage.quick_used >= grokUsage.quick_limit)}
          onClick={() => {
            if (!user) { window.location.href = '/login'; return; }
            const entry = resultsCache[selectedCoin];
            const force = !!(entry && entry.mode === 'quick' && entry.result.tf === readTf && Date.now() - entry.result.analyzedAt > 30_000);
            readMarket('quick', force);
            window.dispatchEvent(new CustomEvent('onboarding:done', { detail: 'grok' }));
          }}
          style={{ width: 'auto', marginBottom: 0 }}
          title={!user ? t('ARENA_QUICK_SIGNIN_TITLE') : t('ARENA_QUICK_LOCAL_ONLY_TITLE')}
        >
          {readLoading && readMode === 'quick' ? readStep || t('ARENA_WORKING') : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {!user && (
                <svg width="10" height="10" viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
                  <rect x="4" y="9" width="12" height="9" rx="2" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M7 9V6a3 3 0 0 1 6 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              )}
              {t('ARENA_QUICK_RESEARCH_BUTTON')}
            </span>
          )}
        </button>

        {/* Deep button - requires sign-in */}
        <button
          className={`arena-fire-btn${!user ? ' arena-deep-locked' : ''}`}
          disabled={readLoading || !!(user && grokUsage && grokUsage.deep_used >= grokUsage.deep_limit)}
          onClick={() => {
            if (!user) { window.location.href = '/login'; return; }
            const entry = resultsCache[selectedCoin];
            const force = !!(entry && entry.mode === 'deep' && entry.result.tf === readTf && Date.now() - entry.result.analyzedAt > 30_000);
            readMarket('deep', force);
            window.dispatchEvent(new CustomEvent('onboarding:done', { detail: 'grok' }));
          }}
          style={{ width: 'auto', marginBottom: 0 }}
          title={!user ? t('ARENA_DEEP_SIGNIN_TITLE') : t('ARENA_DEEP_WEB_SEARCH_TITLE')}
        >
          {readLoading && readMode === 'deep' ? readStep || t('ARENA_WORKING') : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {!user && (
                <svg width="10" height="10" viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
                  <rect x="4" y="9" width="12" height="9" rx="2" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M7 9V6a3 3 0 0 1 6 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              )}
              {t('ARENA_DEEP_RESEARCH_BUTTON')}
            </span>
          )}
        </button>

        {user && (
          <button
            className="arena-ask-grok-btn"
            style={{ width: 'auto', marginBottom: 0, background: alertFormOpen ? 'rgba(var(--accent-rgb), 0.15)' : undefined }}
            onClick={() => alertFormOpen ? setAlertFormOpen(false) : openAlertForm()}
            title={t('ARENA_SET_ALERT_TITLE')}
          >
            {t('ARENA_SET_ALERT_BUTTON')}
          </button>
        )}

        <button
          className="arena-ask-grok-btn"
          style={{ width: 'auto', marginBottom: 0 }}
          onClick={() => window.dispatchEvent(new CustomEvent('grok-chat', {
            detail: {
              coin: selectedCoin,
              prompt: result
                ? t('ARENA_CHAT_PROMPT_WITH_RESULT', {
                    coin: selectedCoin.toUpperCase(), signal: result.signal, confidence: result.confidence,
                    entryZone: '-',  // #260: no levels; ARENA_CHAT_PROMPT_WITH_RESULT still names one - needs a DB row edit
                    reasoning: result.reasoning,
                  })
                : t('ARENA_CHAT_PROMPT_NO_RESULT', { coin: selectedCoin.toUpperCase() }),
            },
          }))}
        >
          {t('ARENA_ASK_LIQUIDITYAI_BUTTON')}
        </button>
      </div>

      {/* Live daily-usage meter - remaining Quick/Deep + reset countdown. Visible
          scarcity (freemium plan move #3) instead of a silently-disabled button.
          id + scroll-margin-top: the nav's "view usage" link points at
          #usage-meter so it scrolls straight here instead of dumping the user
          at the top of the whole Arena page - scroll-margin-top clears the
          sticky ticker+nav bar so the meter doesn't land hidden under them. */}
      <div id="usage-meter" style={{ scrollMarginTop: 90 }}>
        <UsageMeter />
      </div>

      {/* ── Price alert inline form - buy/sell-panel styling ── */}
      {alertFormOpen && user && (
        <div style={{
          margin: '8px 0', padding: 16, borderRadius: 14,
          border: '0.5px solid var(--bdr)', background: 'var(--bg2)',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          {alertSuccess ? (
            <div style={{ fontSize: 'var(--fs-label)', fontWeight: 600, textAlign: 'center', padding: '4px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
              <span style={{ color: 'var(--accent-2)' }}>{t('ARENA_ALERT_SET_SUCCESS', { coin: selectedCoin.toUpperCase() })}</span>
              <Link href="/alerts" style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', textDecoration: 'underline' }}>{t('ARENA_VIEW_ALL_ALERTS_LINK')}</Link>
            </div>
          ) : (
            <>
              {/* Above / Below tab switcher */}
              <div style={{ display: 'flex', borderRadius: 10, overflow: 'hidden', background: 'var(--bg1)', padding: 3, gap: 3 }}>
                {(['above', 'below'] as const).map(d => (
                  <button
                    key={d}
                    onClick={() => setAlertDir(d)}
                    style={{
                      flex: 1, padding: '7px 12px', fontSize: 'var(--fs-caption)', fontWeight: 700, letterSpacing: '.02em',
                      border: 'none', borderRadius: 8, cursor: 'pointer', transition: 'background .15s, color .15s',
                      background: alertDir === d ? (d === 'above' ? 'var(--green-bg)' : 'var(--red-bg)') : 'transparent',
                      color: alertDir === d ? (d === 'above' ? 'var(--green)' : 'var(--red)') : 'var(--txt3)',
                    }}
                  >
                    {d === 'above' ? t('ARENA_ALERT_DIR_ABOVE') : t('ARENA_ALERT_DIR_BELOW')}
                  </button>
                ))}
              </div>

              {/* Target price - input box with coin suffix chip */}
              <div>
                <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 6 }}>
                  {t('ARENA_ALERT_TARGET_PRICE_LABEL')}
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: 'var(--bg1)', border: '0.5px solid var(--bdr)', borderRadius: 10,
                  padding: '4px 6px 4px 12px',
                }}>
                  <span style={{ fontSize: 'var(--fs-label)', color: 'var(--txt3)', flexShrink: 0 }}>$</span>
                  <input
                    type="number"
                    value={alertPrice}
                    onChange={e => setAlertPrice(e.target.value)}
                    placeholder={t('ARENA_ALERT_PRICE_PLACEHOLDER')}
                    style={{ flex: 1, minWidth: 0, padding: '7px 0', fontSize: 'var(--fs-body)', fontFamily: 'var(--font-mono), monospace', border: 'none', background: 'transparent', color: 'var(--txt)', outline: 'none' }}
                  />
                  <span style={{
                    flexShrink: 0, fontSize: 'var(--fs-caption)', fontWeight: 700, letterSpacing: '.03em',
                    color: 'var(--accent-2)', background: 'var(--accent-bg)', border: '0.5px solid var(--accent-bdr)',
                    borderRadius: 7, padding: '4px 9px',
                  }}>
                    {selectedCoin.toUpperCase()}
                  </span>
                </div>
              </div>

              {/* Optional label */}
              <div>
                <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 6 }}>
                  {t('ARENA_ALERT_LABEL_FIELD')} <span style={{ textTransform: 'none', fontWeight: 400, color: 'var(--txt3)' }}>{t('ARENA_ALERT_LABEL_OPTIONAL_HINT')}</span>
                </div>
                <input
                  type="text"
                  value={alertLabel}
                  onChange={e => setAlertLabel(e.target.value)}
                  placeholder={t('ARENA_ALERT_LABEL_PLACEHOLDER')}
                  style={{ width: '100%', padding: '9px 12px', fontSize: 'var(--fs-label)', borderRadius: 10, border: '0.5px solid var(--bdr)', background: 'var(--bg1)', color: 'var(--txt)', outline: 'none' }}
                />
              </div>

              {/* CTA */}
              <button
                onClick={saveArenaAlert}
                disabled={alertSaving || !alertPrice}
                style={{
                  width: '100%', fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--on-accent)',
                  background: 'var(--accent-solid)', border: 'none', borderRadius: 10, padding: '12px 18px',
                  cursor: alertSaving || !alertPrice ? 'default' : 'pointer',
                  opacity: alertSaving || !alertPrice ? 0.5 : 1, transition: 'opacity .15s',
                }}
              >
                {alertSaving ? t('ARENA_ALERT_SAVING') : t('ARENA_ALERT_SET_CTA', { coin: selectedCoin.toUpperCase() })}
              </button>
              <button
                onClick={() => setAlertFormOpen(false)}
                style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}
              >
                {t('ARENA_ALERT_CANCEL_BUTTON')}
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Auth / upgrade notice ── */}
      {!user && !authLoading && (
        <div className="usage-auth-notice">
          {t('ARENA_AUTH_NOTICE')}{' '}
          <Link href="/login" className="usage-auth-link">{t('ARENA_AUTH_SIGN_IN_LINK')}</Link>
        </div>
      )}
      {/* Free-tier usage now shown live by the UsageMeter under the buttons
          (remaining Quick/Deep + reset + Upgrade), so the old static "7 Quick +
          5 Deep / day" notice was a redundant second Upgrade prompt - removed. */}

      {readLoading && (
        <div className="arena-loading">
          <div className="arena-loading-dots">···</div>
          <div className="arena-loading-text">{readStep}</div>
        </div>
      )}

      {readError && <div className="arena-err">{readError}</div>}

      {/* `!readLoading`: the card closes the moment Quick or Deep is clicked and
          the loading indicator above takes its place (#278). Leaving the old
          verdict on screen while its replacement computes shows a call that is
          about to change, under an "Updated just now" label that is already
          wrong - and it is why a user reaches for the dismiss button mid-read in
          the first place.
          This is deliberately the LOADING flag and not `dismissedResults`.
          Hiding via the dismiss set would conflate "the user hid this" with "a
          read is running", and the two have opposite endings: one persists, the
          other must not. */}
      {result && !readLoading && !dismissedResults.has(selectedCoin) && nowMs - result.analyzedAt < CACHE_MAX_AGE_MS && (() => {
        const sigCol = result.signal === 'BULLISH' ? 'var(--green-2)' : result.signal === 'LEAN BULLISH' ? 'var(--green-soft)' : result.signal === 'BEARISH' ? 'var(--red)' : result.signal === 'LEAN BEARISH' ? 'var(--red-soft)' : 'var(--txt3)';
        const verdictWord = result.signal === 'BULLISH' ? t('ARENA_VERDICT_LONG') : result.signal === 'LEAN BULLISH' ? t('ARENA_VERDICT_LEAN_LONG') : result.signal === 'BEARISH' ? t('ARENA_VERDICT_SHORT') : result.signal === 'LEAN BEARISH' ? t('ARENA_VERDICT_LEAN_SHORT') : t('ARENA_VERDICT_WAIT');
        const sigGrad = result.signal.includes('BULLISH') ? 'linear-gradient(160deg,#5ff0b0,#34d399)'
          : result.signal.includes('BEARISH') ? 'linear-gradient(160deg,#ff9d9d,#f87171)'
          : 'linear-gradient(160deg,#d8dee9,#9ca3af)';
        const whyLine = (result.reasoning || '').split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
        const coinD = store.coins[selectedCoin];
        const frPct = coinD?.fundingRate != null ? coinD.fundingRate * 100 : null;
        const GC = 'var(--green-2)', RC = 'var(--red)', NC = 'var(--txt3)';
        // Multi-TF: RSI bias across 15m/1h/4h (same math as the MultiTFAlignment card)
        const tfBias = (r: number | null | undefined) => r == null ? 0 : r > 57 ? 1 : r < 43 ? -1 : 0;
        const tfArr = [coinD?.rsi14, coinD?.rsi1h, coinD?.rsi4h].map(tfBias);
        const tfBull = tfArr.filter(x => x > 0).length, tfBear = tfArr.filter(x => x < 0).length;
        // Ribbon chip reads relative to the verdict (agrees/opposes/neutral), not as its
        // own absolute up/down claim - "Trend down" next to a LONG verdict read like the
        // page was contradicting itself, when really it's one input the AI weighed against
        // the others and still called LONG anyway.
        const verdictDir = result.signal.includes('BULLISH') ? 'long' : result.signal.includes('BEARISH') ? 'short' : null;
        const ribbonRel = !verdictDir || !emaSignal.signalDir ? 'neutral'
          : emaSignal.signalDir === verdictDir ? 'agrees' : 'opposes';
        const factors = [
          { k: 'Ribbon',    v: ribbonRel === 'agrees' ? 'agrees' : ribbonRel === 'opposes' ? 'opposes' : 'neutral', c: ribbonRel === 'agrees' ? GC : ribbonRel === 'opposes' ? RC : NC, a: ribbonRel === 'agrees' ? '↑' : ribbonRel === 'opposes' ? '↓' : '•' },
          { k: 'Squeeze',   v: sqzCount > 0 ? 'building' : flushCount > 0 ? 'flush risk' : 'quiet', c: sqzCount > 0 ? GC : flushCount > 0 ? RC : NC, a: sqzCount > 0 ? '↑' : flushCount > 0 ? '↓' : '•' },
          { k: 'Funding',   v: frPct == null ? 'n/a' : frPct >= 0.03 ? 'long-heavy' : frPct <= -0.02 ? 'short-heavy' : 'neutral', c: frPct == null ? NC : frPct >= 0.03 ? RC : frPct <= -0.02 ? GC : NC, a: '•' },
          { k: 'Multi-TF',  v: tfBull >= 2 ? `${tfBull}/3 up` : tfBear >= 2 ? `${tfBear}/3 down` : (tfBull > 0 && tfBear > 0) ? 'conflicting' : 'mixed', c: tfBull >= 2 ? GC : tfBear >= 2 ? RC : NC, a: tfBull >= 2 ? '↑' : tfBear >= 2 ? '↓' : '•' },
          { k: 'Whale CVD', v: coinD?.cvdDivergence === 'bullish' ? 'bullish' : coinD?.cvdDivergence === 'bearish' ? 'bearish' : 'flat', c: coinD?.cvdDivergence === 'bullish' ? GC : coinD?.cvdDivergence === 'bearish' ? RC : NC, a: coinD?.cvdDivergence === 'bullish' ? '↑' : coinD?.cvdDivergence === 'bearish' ? '↓' : '•' },
        ];
        const prevQuickSignal = quickSignals[selectedCoin];
        const showOverride = !!(
          cacheEntry?.mode === 'deep' &&
          prevQuickSignal &&
          prevQuickSignal !== result.signal
        );
        const secsDiff = Math.floor((nowMs - result.analyzedAt) / 1000);
        const freshness = secsDiff < 60 ? t('ARENA_FRESHNESS_JUST_NOW') : secsDiff < 3600 ? t('ARENA_FRESHNESS_MINUTES_AGO', { n: Math.floor(secsDiff/60) }) : t('ARENA_FRESHNESS_HOURS_AGO', { n: Math.floor(secsDiff/3600) });
        // Live invalidation/target-hit check - the entry/stop/target grid used to be a
        // static snapshot from whenever the analysis ran: price could blow straight
        // through the stop or reach the target and the card would look identical,
        // still showing the old trade as if it were live. store.coins[selectedCoin].price
        // ticks in real time, so this recomputes on every render, not just on a fresh
        // AI call - "stopped"/"target" wins on the FIRST render where it's already true,
        // not only the render where the cross happens.
        // Checked in this priority order (stop first) so a candle that gaps past both
        // levels in one move is reported as invalidated, not as a win.
        const currentPrice = store.coins[selectedCoin]?.price ?? null;
        const isLongDir  = result.signal === 'BULLISH' || result.signal === 'LEAN BULLISH';
        const isShortDir = result.signal === 'BEARISH' || result.signal === 'LEAN BEARISH';
        return (
          <div className={`arena-signal-card sig-${result.signal.toLowerCase().replace(' ', '-')}`}>
            <button
              type="button"
              className="av-dismiss"
              aria-label={t('ARENA_DISMISS_RESULT_ARIA')}
              title={t('ARENA_DISMISS_RESULT_ARIA')}
              onClick={() => setDismissedResults(prev => new Set(prev).add(selectedCoin))}
            >
              ✕
            </button>
            {/* Answer-first header: big verdict word + confidence */}
            <div className="av-head">
              <div className="av-head-eyebrow">
                {t('ARENA_AI_READ_EYEBROW', { coin: selectedCoin.toUpperCase(), tf: result.tf })}
                <span className="av-updated">{t('ARENA_UPDATED_FRESHNESS', { freshness })}</span>
              </div>
              <div className="av-head-row">
                <div className="av-verdict">
                  <span className="av-verdict-word" style={{ backgroundImage: sigGrad }}>{verdictWord}</span>
                  <small>{result.signal === 'FLAT' && result.bias && result.bias !== 'NEUTRAL'
                    ? (result.bias === 'BEARISH' ? t('ARENA_LEANING_BEARISH') : t('ARENA_LEANING_BULLISH'))
                    : t('ARENA_DIRECTIONAL_READ')}</small>
                </div>
                <div className="av-conf">
                  <div className="av-conf-num">{result.confidence}<span>%</span></div>
                  <div className="av-conf-lbl">{t('ARENA_CONFIDENCE_LABEL')}</div>
                  <div className="av-conf-bar"><div style={{ width: result.confidence + '%', background: sigCol }} /></div>
                </div>
              </div>
            </div>

            {/* Deep override notice */}
            {showOverride && (
              <div className="arena-override-notice">
                {t('ARENA_OVERRIDE_NOTICE_PRE')}{' '}
                <strong>{prevQuickSignal}</strong> {t('ARENA_OVERRIDE_NOTICE_TO')} <strong>{result.signal}</strong>{t('ARENA_OVERRIDE_NOTICE_POST')}
              </div>
            )}

            {whyLine && <p className="av-why">{whyLine}</p>}

            {/* Factor chips - live signals behind the read */}
            <div className="av-factors">
              {factors.map(f => (
                <span key={f.k} className="av-fchip"><span style={{ color: f.c }}>{f.a}</span> {f.k} <b>{f.v}</b></span>
              ))}
            </div>



            {/* Wait-for - single inline row matching the mockup's .waitfor style */}
            {result.waitFor && (
              <div className="av-waitfor">
                <span>⏳</span>
                <div>
                  <b>{result.signal === 'LEAN BEARISH' ? t('ARENA_CONFIRMS_TO_SHORT') : result.signal === 'LEAN BULLISH' ? t('ARENA_CONFIRMS_TO_LONG') : t('ARENA_WAIT_FOR')}</b>{' '}
                  {result.waitFor}
                  {result.signal === 'FLAT' && result.bias && result.bias !== 'NEUTRAL' && (
                    <span style={{
                      marginLeft: 6, fontSize: 'var(--fs-micro)', fontWeight: 800, letterSpacing: '.06em',
                      textTransform: 'uppercase',
                      color: result.bias === 'BEARISH' ? 'var(--red)' : 'var(--green-2)',
                    }}>
                      · {result.bias === 'BEARISH' ? t('ARENA_LEANING_BEARISH_ARROW') : t('ARENA_LEANING_BULLISH_ARROW')}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* ── Liquidity Raid Setup ── */}
            {result.raidSetup && (
              <div className="arena-raid-block" style={{
                marginTop: 8,
                borderRadius: 10,
                border: `0.5px solid ${result.raidSetup === 'SHORT SQUEEZE' ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)'}`,
                background: result.raidSetup === 'SHORT SQUEEZE' ? 'rgba(52,211,153,0.06)' : 'rgba(248,113,113,0.06)',
                overflow: 'hidden',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px 6px', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
                  <span style={{
                    fontSize: 'var(--fs-caption)', fontWeight: 800, letterSpacing: '.05em',
                    color: result.raidSetup === 'SHORT SQUEEZE' ? 'var(--green-2)' : 'var(--red)',
                  }}>
                    {t('ARENA_RAID_HEADER', { setup: result.raidSetup })}
                  </span>
                </div>
                <div style={{ padding: '7px 12px 8px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {result.raidTarget && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                      <span style={{ fontSize: 'var(--fs-micro)', fontWeight: 600, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.05em', minWidth: 52, flexShrink: 0 }}>{t('ARENA_RAID_TARGET_LABEL')}</span>
                      <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--txt)', fontVariantNumeric: 'tabular-nums' }}>{result.raidTarget}</span>
                    </div>
                  )}
                  {result.raidTrigger && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                      <span style={{ fontSize: 'var(--fs-micro)', fontWeight: 600, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.05em', minWidth: 52, flexShrink: 0 }}>{t('ARENA_RAID_TRIGGER_LABEL')}</span>
                      <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', lineHeight: 1.5 }}>{result.raidTrigger}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Catalysts - top 3 bullets only */}
            {result.catalysts && result.catalysts.length > 0 && (
              <div style={{ marginTop: 8, borderTop: '0.5px solid rgba(255,255,255,0.05)', paddingTop: 8 }}>
                <ul style={{ margin: 0, padding: '0 0 0 14px', listStyle: 'disc' }}>
                  {result.catalysts.slice(0, 3).map((c, i) => (
                    <li key={i} style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', lineHeight: 1.5 }}>{c}</li>
                  ))}
                </ul>
              </div>
            )}

          </div>
        );
      })()}
      </div>

      {/* ── Workspace: chart (left) + evidence rail (right) ── */}
      <div className="arena-ws">
        <div className="arena-ws-chart">
      {/* ── CHART - KLineChart with auto Entry/SL/TP overlays ── */}
      {designMode === 'terminal' ? null : arenaChart}
      {/* Directly under the chart, on the owner's request (#370). The read
          refers to what the chart shows - "price below EMAs", "closing below
          the swing low", "lower wick at Fib support" - so anything between
          them makes the reader hold the chart in their head while scrolling.

          This pushes the EMA Ribbon card down one slot. The comment there
          says it "sits directly under the chart"; that was true and is no
          longer, and the owner asked for this order explicitly. */}
      {/* AI long-form reasoning / chart read / patterns - only when a read has run */}
      {result && (
        <>
          {result.chartAnalysis && (
            <div className="arena-reasoning" style={{ margin: '10px 0' }}>
              <div className="arena-reasoning-title">{t('ARENA_REASONING_CHART_TITLE')}</div>
              <div className="arena-reasoning-text"><ReasoningText text={result.chartAnalysis} /></div>
            </div>
          )}
          {result.patterns && result.patterns.length > 0 && (
            <div style={{ margin: '10px 0' }}>
              <div className="arena-reasoning-title" style={{ marginBottom: 8 }}>{t('ARENA_REASONING_PATTERNS_TITLE')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {result.patterns.map((p, i) => {
                  const isBull = /bull|higher high|engulf.*bull|hammer|morning/i.test(p);
                  const isBear = /bear|lower high|engulf.*bear|shooting|evening|head.*shoulder|double top/i.test(p);
                  const col = isBull ? 'var(--green-2)' : isBear ? 'var(--red)' : '#1a7aff';
                  const bg  = isBull ? 'rgba(52,211,153,0.08)' : isBear ? 'rgba(248,113,113,0.08)' : 'rgba(var(--accent-rgb), 0.08)';
                  const bdr = isBull ? 'rgba(52,211,153,0.25)' : isBear ? 'rgba(248,113,113,0.25)' : 'rgba(var(--accent-rgb), 0.25)';
                  return (
                    <span key={i} style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, padding: '3px 10px', borderRadius: 6, background: bg, color: col, border: `0.5px solid ${bdr}` }}>{p}</span>
                  );
                })}
              </div>
            </div>
          )}
          <div className="arena-reasoning">
            <div className="arena-reasoning-title">{t('ARENA_REASONING_TITLE')}</div>
            <div className="arena-reasoning-text"><ReasoningText text={result.reasoning} /></div>
          </div>
        </>
      )}

      {/* Anti-chop filter toggle */}
      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          onClick={() => update({ anti_chop_enabled: !antiChopEnabled })}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.09)',
            borderRadius: 999,
            padding: '6px 13px 6px 6px',
            cursor: 'pointer',
            fontSize: 'var(--fs-caption)',
            color: 'var(--txt)',
            transition: 'border-color 0.15s, background 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.2)'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.09)'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.03)'; }}
        >
          <span style={{
            width: 32,
            height: 18,
            borderRadius: 9,
            background: antiChopEnabled ? '#34d399' : 'rgba(255,255,255,0.14)',
            boxShadow: antiChopEnabled
              ? '0 0 0 1px rgba(52,211,153,0.35), 0 0 8px rgba(52,211,153,0.45)'
              : 'inset 0 1px 3px rgba(0,0,0,0.45)',
            position: 'relative',
            flexShrink: 0,
            transition: 'background 0.25s ease, box-shadow 0.25s ease',
          }}>
            <span style={{
              position: 'absolute',
              top: 2,
              left: antiChopEnabled ? 16 : 2,
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: '#fff',
              boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
              transition: 'left 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }} />
          </span>
          <span style={{ opacity: 0.8, letterSpacing: '0.01em' }}>{t('ARENA_ANTICHOP_LABEL')}</span>
        </button>
        {/* Tip sits OUTSIDE the button, not wrapped around its label.
            Tip's trigger became a real focusable control when it was made
            keyboard operable, so nesting it inside this button produced a
            control inside a control - axe nested-interactive. It is the only
            constraint that component carries: Tip must never be rendered inside
            a <button>, <a>, or anything with an interactive role.
            The label stays inside the button so clicking it still toggles. */}
        <Tip
          width={260}
          iconColor="rgba(255,255,255,0.6)"
          text={t('ARENA_ANTICHOP_TIP')}
        />
        {/* opacity 0.35 computed to #55565b = 2.75:1. This hint explains what
            the anti-chop toggle beside it actually does, so it has to be
            readable; --txt-dim carries the same de-emphasis at 5.80:1. */}
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)' }}>
          {antiChopEnabled
            ? t('ARENA_ANTICHOP_ON_HINT')
            : t('ARENA_ANTICHOP_OFF_HINT')}
        </span>
      </div>
      {/* EMA Ribbon Strategy card - sits directly under the chart so it reads as
          the explanation of the chart's own Buy/Sell markers, not a stray card
          four sections down. */}
      <EMASignal signal={emaSignal} tf={readTf} coin={selectedCoin} />
      {/* Data collectors - run hooks for Grok context, render nothing.
          AbsorptionDetector is Pro-only: for free users it is not mounted at
          all, so its data never reaches the AI context either. */}
      <div style={{ display: 'none' }}>
        <MarketStructure coin={selectedCoin} onData={handleMsData} />
        {entitled && <AbsorptionDetector coin={selectedCoin} onData={handleAbsData} />}
      </div>
        </div>
        <aside className="arena-ws-rail">
      {/* ── Market snapshot - VWAP / Open Interest / Funding for the selected coin ── */}
      <div className="av-rail-panel">
        <div className="av-rail-panel-h">{t('ARENA_MARKET_SNAPSHOT_HEADER')}</div>
        <CoinMarketSnapshot coin={selectedCoin} />
      </div>
      {/* Confluence Score - EMA Ribbon + Order Flow + Multi-TF RSI combined, plus a
          separate macro/event risk overlay (econ calendar + JPY carry-trade risk).
          Pro-only: free users get an in-place locked card so the layout holds. */}
      {/* Locked ONLY once we know the user is not entitled (#376).
          entitled starts false while auth resolves, so gating on it alone
          renders the paywall to a paying account for as long as that takes -
          which reads as a broken subscription and costs a support message or a
          chargeback, not a pixel.
          Same guard as MultiTFAlignment:120, written for #310 and not carried
          here at the time. */}
      {authLoading || entitled ? (
        <ConfluenceScore coin={selectedCoin} emaSignal={emaSignal} jpyUsd={jpyUsd} structure={chartStructure} />
      ) : (
        <LockedFeatureCard
          title={t('ARENA_CONFLUENCE_GATE_TITLE')}
          description={t('ARENA_CONFLUENCE_GATE_DESC')}
          onUnlock={() => setUpgradeGate(t('ARENA_CONFLUENCE_GATE_FEATURE_LABEL'))}
        />
      )}
        </aside>
      </div>

      {/* ── Evidence + advanced (full width, below the workspace) ── */}
      <div className="arena-below-chart">
      {/* BTC Liquidation Heatmap - shows only when BTC selected and data available */}
      {selectedCoin === 'btc' && store.btcLiqLevels.length > 0 && (
        <LiqHeatmap
          levels={store.btcLiqLevels}
          currentPrice={store.coins['btc']?.price ?? 0}
        />
      )}
      {/* GEX / Options Market Pressure table removed here 2026-07-25
          (signal-overload pass): biggest single block on the page (~456px),
          BTC-only, and max-pain/net-gamma is background context rather than a
          trade decision - it still feeds the AI read above, which is where it
          now surfaces. Full table remains on the Liquidation Map page for
          anyone who wants the raw numbers. */}
      {/* ── Pullback warning - reuses the Distribution score for the selected coin.
          "This pump is getting weaker" made explicit as text, not just a header chip. ── */}
      {(() => {
        const d = store.coins[selectedCoin];
        const res = d?.price ? computeDistributionScore(distInputsFromCoin(d)) : null;
        if (!res || res.score < 45) return null;
        const col = distributionColor(res.score);
        return (
          <div style={{
            marginBottom: 10, padding: '10px 12px', borderRadius: 10,
            background: withAlpha(col, '0f'), border: `0.5px solid ${withAlpha(col, '44')}`,
            display: 'flex', alignItems: 'flex-start', gap: 8,
          }}>
            <span style={{ color: col, lineHeight: 0, flexShrink: 0, marginTop: 1 }}><Warn size={14} /></span>
            <div>
              <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: col, marginBottom: 2 }}>
                {res.score >= 70 ? t('ARENA_DIST_WARN_PULLBACK') : t('ARENA_DIST_WARN_EARLY_WEAKNESS')}
                <span style={{ fontWeight: 400, color: 'var(--txt3)', marginLeft: 6 }}>({res.score}/100)</span>
              </div>
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', lineHeight: 1.4 }}>
                {res.reasons.join(' · ')}
              </div>
            </div>
          </div>
        );
      })()}
      {/* ── Full breakdown - always visible (was collapsible, user asked for it
          up front rather than an extra click to drill in). Granular technical
          cards (multi-timeframe alignment, higher-timeframe context, stop
          zone) plus the AI's long-form reasoning/patterns. ── */}
      <MultiTFAlignment coin={selectedCoin} />
      {/* StopLossZone ("Order Flow Setup" card) stays removed - its stop + R:R
          duplicated the AI read card's own STOP and R:R cells. Component kept in
          the codebase, just not mounted here. */}
      {/* Informational only (not a filter - see component header for why): flags when
          the 4h has already moved a lot, so a same-direction lower-TF signal doesn't
          look more trustworthy than it is. Only shows on 1m/5m/15m/30m. */}
      <HigherTfMoveBadge coin={selectedCoin} tf={readTf} signalDir={emaSignal.signalDir} />
      {/* ── SESSION HISTORY ── */}
      {history.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--txt-dim)' }}>{t('ARENA_SESSION_HISTORY_HEADER')}</div>
            <button
              onClick={() => { setHistory([]); setDetailIdx(null); try { sessionStorage.removeItem(ARENA_HIST_KEY); } catch {} }}
              style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
            >{t('ARENA_SESSION_HISTORY_CLEAR_BUTTON')}</button>
          </div>

          {history.map((h, i) => (
            <div key={i}>
              <div
                className={`arena-hist-item${detailIdx === i ? ' arena-hist-open' : ''}`}
                onClick={() => setDetailIdx(detailIdx === i ? null : i)}
                style={{ cursor: 'pointer' }}
              >
                <div className="arena-hist-left">
                  <span className={`arena-hist-badge tag ${h.signal === 'BULLISH' || h.signal === 'LEAN BULLISH' ? 'tg' : h.signal === 'BEARISH' || h.signal === 'LEAN BEARISH' ? 'tr' : 'tp'}`}>
                    {h.signal === 'BULLISH' ? t('ARENA_HIST_BADGE_LONG') : h.signal === 'LEAN BULLISH' ? t('ARENA_HIST_BADGE_LEAN_LONG') : h.signal === 'BEARISH' ? t('ARENA_HIST_BADGE_SHORT') : h.signal === 'LEAN BEARISH' ? t('ARENA_HIST_BADGE_LEAN_SHORT') : t('ARENA_HIST_BADGE_FLAT')}
                  </span>
                  <div>
                    <div className="arena-hist-pair">{h.coin}</div>
                    <div className="arena-hist-time">{h.time}{h.session ? ` · ${h.session}` : ''}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="arena-hist-conf">{h.confidence}%</div>
                  <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)' }}>{detailIdx === i ? '▲' : '▼'}</span>
                </div>
              </div>

              {detailIdx === i && (
                <div className={`arena-hist-detail sig-${h.signal.toLowerCase().replace(' ', '-')}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span className={`arena-sig-badge badge-${h.signal.toLowerCase().replace(' ', '-')}`} style={{ fontSize: 'var(--fs-caption)' }}>
                      {h.signal === 'BULLISH' ? t('ARENA_HIST_BADGE_LONG') : h.signal === 'LEAN BULLISH' ? t('ARENA_HIST_BADGE_LEAN_LONG') : h.signal === 'BEARISH' ? t('ARENA_HIST_BADGE_SHORT') : h.signal === 'LEAN BEARISH' ? t('ARENA_HIST_BADGE_LEAN_SHORT') : t('ARENA_HIST_BADGE_FLAT')}
                    </span>
                    <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--accent-2)' }}>{t('ARENA_HIST_CONFIDENCE_PCT', { pct: h.confidence })}</div>
                  </div>
                  {h.entry && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                      <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>{t('ARENA_HIST_ENTRY_ZONE_LABEL')}</span>
                      <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--txt)', fontFamily: 'monospace' }}>{h.entry}</span>
                    </div>
                  )}
                  <div className="arena-conf-bar" style={{ marginBottom: 10 }}>
                    <div className="arena-conf-fill" style={{
                      width: h.confidence + '%',
                      background: h.signal === 'BULLISH' ? '#7de0a4' : h.signal === 'LEAN BULLISH' ? '#86efac' : h.signal === 'BEARISH' ? '#ff9a92' : h.signal === 'LEAN BEARISH' ? '#fca5a5' : '#606060',
                    }} />
                  </div>
                  {h.reasoning && (
                    <div className="arena-reasoning">
                      <div className="arena-reasoning-title">{t('ARENA_REASONING_TITLE')}</div>
                      <div className="arena-reasoning-text"><ReasoningText text={h.reasoning} /></div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      </div> {/* end arena-below-chart */}

      {/* Pro upgrade modal - opened by the timeframe gate and locked cards */}
      <UpgradeGateModal
        open={upgradeGate !== null}
        onClose={() => setUpgradeGate(null)}
        feature={upgradeGate ?? undefined}
      />
    </div>
  );

  /* One screen, two designs, while the redesign lands frame by frame (#413).
     Same branch DisclaimerTerminal uses: the terminal Arena is its own
     component rather than conditionals threaded through 1,000 lines of JSX.
     The two layouts share their DATA and almost nothing else - the frame puts
     the verdict in a band, drops the coin sidebar, and moves clusters,
     reasoning and history into a 304px rail. Deleting this branch is the last
     step of the migration.

     Everything below is read from the state this page already computes. The
     shape comes from frame 1a; the values are ours, per the owner's rule:
     "we cannot display all data in design but we can fill it with other data
     or numbers". Where we genuinely have nothing - no read run yet, no
     liquidation clusters in range - the component renders an em dash rather
     than a placeholder figure. */
  if (designMode === 'terminal') {
    const verdictDir = result?.signal?.includes('BULLISH') ? 'bull' as const
                     : result?.signal?.includes('BEARISH') ? 'bear' as const
                     : 'neutral' as const;
    return (
      <ArenaTerminal
        coin={selectedCoin}
        tf={readTf}
        onTfChange={setReadTf}
        verdict={result ? { label: result.signal, dir: verdictDir, confidence: result.confidence } : null}
        /* Entry zone is the EMA9-EMA20 value zone the strategy already defines,
           and sl/tp are its own stop and target - not numbers invented to fill
           the band. Null until the strategy has loaded, which the band shows
           as an em dash. */
        entry={{
          zoneLow:  emaSignal.ema20_4h ?? null,
          zoneHigh: emaSignal.ema9_4h  ?? null,
          stop:     emaSignal.sl       ?? null,
          target:   emaSignal.tp       ?? null,
          target2:  null,
        }}
        reasoning={result?.reasoning ?? null}
        history={history.map(h => ({
          time: h.time, verdict: h.signal, conf: h.confidence, outcome: null,
        }))}
        /* The rail's clusters, from the data the page already loads for the
           heatmap. The prototype shows eight mock levels; we show the ones we
           actually have, largest first, in the frame's row design - extending
           the pattern to our data rather than padding it to eight.
           BTC-only today, which is where btcLiqLevels exists; other coins get
           "No clusters in range" rather than a fabricated ladder. */
        clusters={
          selectedCoin === 'btc'
            ? [...store.btcLiqLevels]
                .sort((a, b) => b.amount - a.amount)
                .slice(0, 8)
                .map(l => ({ price: l.price, usd: l.amount }))
            : []
        }
        onRerun={() => { void readMarket('deep', true); }}
        onSetAlert={openAlertForm}
        rerunning={readLoading}
        chart={arenaChart}
      >
        {legacyArena}
      </ArenaTerminal>
    );
  }


  return legacyArena;
}

export default function Arena() {
  return (
    <Suspense>
      <ArenaContent />
    </Suspense>
  );
}
