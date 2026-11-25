'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { BINANCE_SYMS, BYBIT_SYMS, symbolDenominationFactor, venueSymbols } from '@/lib/coins';
import { liqPerTokenFactor } from '@/lib/liqUnits';
import { priceText } from '@/lib/numberFormat';
import { bucketSz } from '@/lib/liqClusters';
import { getSupabase } from '@/lib/supabase';
import { Warn } from '@/components/icons';
import { T } from '@/lib/tables';
import Tip from '@/components/Tip';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';
import { socketNeedsReconnect, dropSocket, onPageResume } from '@/lib/socketResume';
import { reconnectDelayMs, linkState, onBackOnline } from '@/lib/reconnectDelay';

/* ── Types ── */
interface LiqEvent {
  id:     number;
  symbol: string;
  coin:   string;
  side:   'LONG' | 'SHORT';
  usd:    number;
  price:  number;
  ts:     number;
  source: 'BN' | 'BB';   // Binance | Bybit
}

interface Stats  { longUsd: number; shortUsd: number; count: number; }
interface Cascade { ts: number; totalUsd: number; side: 'LONG' | 'SHORT' | 'MIXED'; coins: string[]; }
export interface Bucket  { label: string; price: number; longUsd: number; shortUsd: number; total: number; coin: string; }

/* ── Constants ── */
const FEED_SIZE          = 30;
const STATS_WIN          = 60 * 60 * 1000;        // 1h stats window
const CLUSTER_WIN        = 24 * 60 * 60 * 1000;   // 24h cluster accumulation
const MIN_SHOW           = 10_000;                 // $10K minimum to appear
const MIN_ALERT          = 500_000;                // $500K = big hit
const CASCADE_THRESHOLD  = 3_000_000;              // $3M in 30s = cascade
const CASCADE_WIN        = 30_000;                 // 30-second window
const CASCADE_HIDE_MS    = 12_000;                 // show cascade badge 12s
const STORAGE_KEY        = 'liq-events-v3';        // localStorage key (v3: prices are per-token; v2 held raw contract-unit prices and is ignored)
const STORAGE_MAX        = 2000;                   // max events to persist locally
/* How often the raw stream is handed to onEvents consumers. Not a render
   cadence - the heatmap buckets 24h into 34 columns, so ~42 minutes per
   column, and emitting faster than the grid can express changes nothing on
   screen while re-rendering the page. */
const EVENTS_EMIT_MS     = 15 * 1000;
const SB_WIN_MS          = 24 * 60 * 60 * 1000;    // load last 24h from Supabase
/* THE PROJECT API ANSWERS AT MOST 1000 ROWS PER REQUEST (QA on prod, 2026-11-22: the app asked limit=5000 and got `content-range 0-999` every time), so one `limit(5000)` read held only the newest 1000 rows of ALL coins: PEPE showed 3 of its 39 stored events and BONK 0 of 6, and the
   "last 24 hours" the page says was not what it computed. Reads are now PAGES of SB_PAGE rows (.range), newest first, a bounded number of them: the all-coins read takes up to SB_PAGES_ALL pages (the 5000 the comment meant), and the selected coin gets its OWN read (its stored base names, up to
   SB_PAGES_COIN pages, once per coin per mount) so an active coin cannot push a quiet one out of the window. At most 8 requests on mount and 3 per coin switch. */
const SB_PAGE            = 1000;
const SB_PAGES_ALL       = 5;
const SB_PAGES_COIN      = 3;
/* The in-memory history is trimmed by AGE (the 24 h window in rebuild), not by count; this is only a safety ceiling. A count trim of 5000 would drop the older events of a quiet coin whenever the busy ones filled it, which is the defect above in another place. */
const HISTORY_MAX        = 20_000;
// SB_RETAIN_MS (7 days) lived here while the browser ran the purge. Retention is server-side now -
// RETAIN_MS in app/api/liq-events/purge/route.ts is the single definition. Not kept as a comment
// for reference on purpose: two copies of a retention period is how they come to disagree.
const BYBIT_COINS        = Object.values(BYBIT_SYMS);

let idCounter = 0;

/* ── Helpers ── */
function fmtUSD(v: number): string {
  if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(2) + 'M';
  if (v >= 1_000)     return '$' + (v / 1_000).toFixed(1) + 'K';
  return '$' + v.toFixed(0);
}
function fmtTime(ts: number): string {
  const d = new Date(ts);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0')).join(':');
}
function coinFromSym(sym: string): string {
  return sym.replace(/^\d+/, '').replace(/USDT$|BUSD$|USDC$/, '');
}
/** The names a coin is stored under in lhq_liq_events: the coin id and the base of each venue's symbol (1000PEPEUSDT -> PEPE), upper case. */
function storedCoinNames(coinUpper: string): string[] {
  const v = venueSymbols(coinUpper.toLowerCase());
  return [...new Set([coinUpper, v.bybit ? coinFromSym(v.bybit) : '', v.binance ? coinFromSym(v.binance) : ''].filter(Boolean))];
}
type StoredRow = { coin: string; side: string; usd: number; price: number; source: string; ts: number };
/** Newest-first pages of the stored events of the last 24 h (all coins when `coins` is null), returned oldest first. A page shorter than SB_PAGE ends the read. */
async function readStored(sb: NonNullable<ReturnType<typeof getSupabase>>, since: number, coins: string[] | null, maxPages: number, onPartial?: () => void): Promise<StoredRow[]> {
  const rows: StoredRow[] = [];
  for (let page = 0; page < maxPages; page++) {
    let q = sb.from(T.liq_events).select('coin, side, usd, price, source, ts').gte('ts', since).order('ts', { ascending: false });
    if (coins) q = q.in('coin', coins);
    const { data, error } = await q.range(page * SB_PAGE, page * SB_PAGE + SB_PAGE - 1);
    if (error || !data) { onPartial?.(); break; }
    rows.push(...(data as StoredRow[]));
    if (data.length < SB_PAGE) break;
    if (page === maxPages - 1) onPartial?.();   // the last page allowed came back full: older rows were not read
  }
  return rows.reverse();
}
/** Whether a stored read (rows oldest first) holds the whole 1h stats window: it ran to its end, or what it did read reaches back past it. */
function coversStatsWindow(rows: StoredRow[], partial: boolean): boolean {
  return !partial || (rows.length > 0 && rows[0].ts <= Date.now() - STATS_WIN);
}

// bucketSz moved to lib/liqClusters.ts (#1075) - #1075's chart-side band
// merge needs this same rounding tier as its "same zone" threshold, and
// lib/ cannot import from components/, so the shared copy lives in lib and
// this file imports it back rather than keeping two definitions in sync.
function snapBucket(price: number): number {
  const sz = bucketSz(price);
  return Math.round(price / sz) * sz;
}
function fmtBucket(price: number): string {
  if (price < 0.1) return priceText(price);   // sub-dime prices (per-token 1000x coins): decimals by size, the bucket tier is a fraction of a cent
  const sz  = bucketSz(price);
  const dec = sz >= 1 ? 0 : sz >= 0.1 ? 1 : 2;
  return '$' + price.toLocaleString(undefined, { maximumFractionDigits: dec });
}
function fmtEventPrice(price: number): string {
  if (price < 0.1) return priceText(price);
  return '$' + price.toLocaleString('en-US', { maximumFractionDigits: price < 10 ? 3 : 2 });
}

/** `headless` runs the feed and renders nothing (#811).
 *
 *  Arena needs what this component COLLECTS - the 24h cluster accumulation off
 *  the Binance and Bybit sockets, handed up through onClusters - and not what
 *  it DRAWS: the chart already draws those same eight clusters as lines, so the
 *  card was 844px repeating them. Unmounting it would take the chart's data
 *  with it, which is why this is a render flag and not a conditional mount.
 *
 *  Deliberately NOT `display: none`: that keeps the whole subtree in the DOM
 *  and in the accessibility tree, so a screen reader still walks a live-region
 *  feed the owner asked to remove. Returning null is the honest version.
 *
 *  The live event ticker goes with it. The owner was offered "keep the ticker,
 *  drop the duplicated bars" and chose to hide the card - recorded here so it
 *  does not come back as an oversight. */
export default function LiqFeed({ onClusters, coinFilter, headless = false, onHistoryVenues, onHistoryPartial }: { onClusters?: (clusters: Bucket[]) => void; coinFilter: string; headless?: boolean; onHistoryVenues?: (only: 'BN' | 'BB' | null) => void; onHistoryPartial?: (partial: boolean) => void }) {
  const { t } = useLabels();
  const [feed,     setFeed]     = useState<LiqEvent[]>([]);
  const [stats,    setStats]    = useState<Stats>({ longUsd: 0, shortUsd: 0, count: 0 });
  const [cascade,  setCascade]  = useState<Cascade | null>(null);
  const [clusters, setClusters] = useState<Bucket[]>([]);
  const [bnStatus, setBnStatus] = useState<'connecting'|'live'|'error'>('connecting');
  const [bbStatus, setBbStatus] = useState<'connecting'|'live'|'error'>('connecting');
  /* A feed that has not connected after 8 s says so instead of staying on skeletons for ever (a socket blocked by a network, a venue refusing us). It keeps retrying underneath; the line goes away when a socket goes live. */
  const [connectWaited, setConnectWaited] = useState(false);
  const noneLive = bnStatus !== 'live' && bbStatus !== 'live';
  useEffect(() => {
    if (!noneLive) { setConnectWaited(false); return; }
    const id = setTimeout(() => setConnectWaited(true), 8_000);
    return () => clearTimeout(id);
  }, [noneLive]);
  /* Which venue is the ONLY one in the stored 24 h history, if one is. A venue the server cannot reach would otherwise leave history that looks complete and is not (the cluster read is stored rows). */
  const [histOnly, setHistOnly] = useState<'BN' | 'BB' | null>(null);
  const [msgCount, setMsgCount] = useState(0);
  const coinFilterRef = useRef(coinFilter);

  const bnWsRef         = useRef<WebSocket | null>(null);
  const bbWsRef         = useRef<WebSocket | null>(null);
  /* When each socket last delivered anything: on resume a socket quiet for 30 s or not OPEN is replaced (lib/socketResume.ts). */
  const bnLastMsgRef    = useRef<number | null>(null);
  const bbLastMsgRef    = useRef<number | null>(null);
  /* Reconnect state (lib/reconnectDelay.ts): failures since the last open, the pending retry, and whether the feed was unmounted. */
  const bnAttemptRef    = useRef(0);
  const bbAttemptRef    = useRef(0);
  const bnTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bbTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef      = useRef(false);
  const historyRef      = useRef<LiqEvent[]>([]);
  const lastEmitRef     = useRef(0);
  const msgRef          = useRef(0);
  const cascadeTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer       = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Rebuild derived state from history ── */
  const rebuild = useCallback((history: LiqEvent[]) => {
    const now = Date.now();
    const cf  = coinFilterRef.current;

    // 1h stats - filtered to selected coin
    const win = history.filter(e => now - e.ts < STATS_WIN && (cf === 'ALL' || e.coin === cf));
    setStats({
      longUsd:  win.filter(e => e.side === 'LONG').reduce((s, e)  => s + e.usd, 0),
      shortUsd: win.filter(e => e.side === 'SHORT').reduce((s, e) => s + e.usd, 0),
      count: win.length,
    });

    // Cascade: $3M+ in 30s
    const cascWin   = history.filter(e => now - e.ts < CASCADE_WIN);
    const cascTotal = cascWin.reduce((s, e) => s + e.usd, 0);
    if (cascTotal >= CASCADE_THRESHOLD) {
      const lUsd  = cascWin.filter(e => e.side === 'LONG').reduce((s, e)  => s + e.usd, 0);
      const sUsd  = cascWin.filter(e => e.side === 'SHORT').reduce((s, e) => s + e.usd, 0);
      const side: Cascade['side'] = lUsd > sUsd * 1.5 ? 'LONG' : sUsd > lUsd * 1.5 ? 'SHORT' : 'MIXED';
      const coins = [...new Set(cascWin.map(e => e.coin))].slice(0, 4);
      setCascade({ ts: now, totalUsd: cascTotal, side, coins });
      if (cascadeTimer.current) clearTimeout(cascadeTimer.current);
      cascadeTimer.current = setTimeout(() => setCascade(null), CASCADE_HIDE_MS);
    }

    // Price clusters keyed per-coin so callers can filter by selected coin
    const cWin = history.filter(e => now - e.ts < CLUSTER_WIN);
    const map  = new Map<string, { longUsd: number; shortUsd: number; coin: string; price: number }>();
    cWin.forEach(e => {
      const bp  = snapBucket(e.price);
      const key = `${e.coin}::${bp}`;
      const cur = map.get(key) ?? { longUsd: 0, shortUsd: 0, coin: e.coin, price: bp };
      if (e.side === 'LONG') cur.longUsd += e.usd; else cur.shortUsd += e.usd;
      map.set(key, cur);
    });
    const buckets: Bucket[] = Array.from(map.values())
      .map(({ longUsd, shortUsd, coin, price }) => ({
        label: fmtBucket(price), price, longUsd, shortUsd, total: longUsd + shortUsd, coin,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 100);
    setClusters(buckets);
    onClusters?.(buckets);
  }, [onClusters]);

  /* ── Stored events (a page read or a coin read) merged into the history ── */
  const coinVenuesRef = useRef(false);   // a coin read has set the "one venue only" note; the all-coins read then leaves it alone
  const mergeStored = useCallback((data: StoredRow[], perCoin: boolean) => {
    if (data.length === 0) return;
    if (perCoin || !coinVenuesRef.current) {
      const venues = new Set(data.map(r => r.source));
      const only = venues.size === 1 ? (venues.has('BN') ? 'BN' : venues.has('BB') ? 'BB' : null) : null;
      if (perCoin) coinVenuesRef.current = true;
      setHistOnly(only);
      onHistoryVenues?.(only);   // the /liq ladder and the Arena chart read the same table and say the same thing
    }
    const seen = new Set(historyRef.current.map(e => `${e.ts}_${e.coin}_${e.price}_${e.side}_${e.source}`));
    /* STORED ROWS KEEP THE VENUE'S RAW PRICE: converted to per-token before they are compared with live events or merged (lib/liqUnits.ts). */
    const newEvts = data
      .map(r => ({ ...r, price: r.price * liqPerTokenFactor(r.coin, r.source) }))
      .filter(r => !seen.has(`${r.ts}_${r.coin}_${r.price}_${r.side}_${r.source}`))
      .map(r => ({
        id: ++idCounter,
        symbol: r.coin + 'USDT',
        coin: r.coin,
        side: r.side as 'LONG' | 'SHORT',
        usd: r.usd,
        price: r.price,
        ts: r.ts,
        source: r.source as 'BN' | 'BB',
      }));
    if (newEvts.length === 0) return;
    const merged = [...historyRef.current, ...newEvts].sort((a, b) => a.ts - b.ts).slice(-HISTORY_MAX);
    historyRef.current = merged;
    rebuild(merged);
    // Do NOT update setFeed here - old events should not appear in the live feed
  }, [rebuild, onHistoryVenues]);

  /* WHETHER THE 24 h HISTORY IS INCOMPLETE (#1651): a read that failed or hit its page limit leaves older events out, and the clusters
     built from it must say so. Per coin read, with the all-coins read ('ALL') standing for a coin that has not had its own. */
  const [partialBy, setPartialBy] = useState<Record<string, boolean>>({});
  const historyPartial = partialBy[coinFilter] ?? partialBy.ALL ?? false;
  useEffect(() => { onHistoryPartial?.(historyPartial); }, [historyPartial, onHistoryPartial]);

  /* THE 1h FIGURES ARE SHOWN ONLY ONCE THE STORED HOUR IS IN (#1651): a panel opened seconds ago used to read $0 and 0 events beside
     "waiting", which is a claim nothing had been read to support. Per read, keyed like `partialBy`: undefined while it runs. */
  const [hourBy, setHourBy] = useState<Record<string, boolean>>({});
  const hourReads: (boolean | undefined)[] = coinFilter === 'ALL' ? [hourBy.ALL] : [hourBy[coinFilter], hourBy.ALL];
  const hourKnown = hourReads.includes(true);
  const hourPending = !hourKnown && hourReads.includes(undefined);

  /* The selected coin's own stored events, once per coin (a coin switch on the Arena or /liq reads the new coin's). */
  const loadedCoinsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const cf = coinFilter;
    if (cf === 'ALL' || loadedCoinsRef.current.has(cf)) return;
    const sb = getSupabase();
    if (!sb) return;
    loadedCoinsRef.current.add(cf);
    let partial = false;
    readStored(sb, Date.now() - SB_WIN_MS, storedCoinNames(cf), SB_PAGES_COIN, () => { partial = true; })
      .then(rows => { setPartialBy(m => ({ ...m, [cf]: partial })); mergeStored(rows, true); setHourBy(m => ({ ...m, [cf]: coversStatsWindow(rows, partial) })); })
      .catch(() => { loadedCoinsRef.current.delete(cf); setHourBy(m => ({ ...m, [cf]: false })); });
  }, [coinFilter, mergeStored]);

  /* ── Sync coinFilter prop → ref and re-derive stats/clusters ── */
  useEffect(() => {
    coinFilterRef.current = coinFilter;
    rebuild(historyRef.current);
  }, [coinFilter, rebuild]);

  /* ── Persist history to localStorage (debounced 5s) ── */
  const saveToStorage = useCallback(() => {
    if (saveTimer.current) return;
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      try {
        const now = Date.now();
        const recent = historyRef.current
          .filter(e => now - e.ts < CLUSTER_WIN)
          .slice(-STORAGE_MAX);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
      } catch { /* storage full - ignore */ }
    }, 5000);
  }, []);

  /* ── Common event processor for both exchanges ── */
  const onLiq = useCallback((
    sym: string, side: 'LONG' | 'SHORT', usd: number, price: number, source: 'BN' | 'BB'
  ) => {
    if (usd < MIN_SHOW || !isFinite(usd)) return;
    msgRef.current++;
    if (msgRef.current % 5 === 0) setMsgCount(msgRef.current);

    const ev: LiqEvent = {
      id: ++idCounter, symbol: sym, coin: coinFromSym(sym),
      side, usd, price: price * symbolDenominationFactor(sym) /* per-token: 1000PEPEUSDT quotes per 1000 tokens (lib/liqUnits.ts) */, ts: Date.now(), source,
    };
    historyRef.current = [...historyRef.current, ev].slice(-HISTORY_MAX);
    rebuild(historyRef.current);
    setFeed(prev => [ev, ...prev].slice(0, FEED_SIZE));
    saveToStorage();
  }, [rebuild, saveToStorage]);

  /* ── Binance forceOrder WebSocket (individual symbol streams - all-market @arr is deprecated) ── */
  // Reconnect goes through a ref for the same reason as MarketProvider's
  // startWS: a function cannot reference its own binding from inside its own
  // initialiser, and the stale-closure risk is real - connectBN is a useCallback
  // over [onLiq], so a socket that drops after onLiq changes would otherwise
  // reconnect wired to the previous onLiq and write liquidations through a
  // stale rebuild/saveToStorage pair.
  const connectBNRef = useRef<() => void>(() => {});
  const BN_SYMBOLS = Object.values(BINANCE_SYMS).map(s => s.toLowerCase());
  const connectBN = useCallback(() => {
    if (stoppedRef.current) return;
    if (bnTimerRef.current) { clearTimeout(bnTimerRef.current); bnTimerRef.current = null; }
    // Detached, so the old socket's onclose cannot queue a second reconnect beside this one.
    dropSocket(bnWsRef.current);
    // Combined stream: each symbol has its own forceOrder feed
    const streams = BN_SYMBOLS.map(s => `${s}@forceOrder`).join('/');
    const ws = new WebSocket(`wss://fstream.binance.com/market/stream?streams=${streams}`);
    bnWsRef.current = ws;
    ws.onopen  = () => { bnLastMsgRef.current = Date.now(); bnAttemptRef.current = 0; setBnStatus('live'); };
    ws.onerror = () => setBnStatus('error');
    ws.onclose = () => {
      if (stoppedRef.current || bnWsRef.current !== ws) return;
      setBnStatus('error');
      // 5 s as before while online and visible; offline or hidden backs off to 30 s (QA, 2026-11-18: ~1,554 sockets in 90 min offline).
      bnAttemptRef.current += 1;
      bnTimerRef.current = setTimeout(() => { bnTimerRef.current = null; connectBNRef.current(); },
        reconnectDelayMs(bnAttemptRef.current, { ...linkState(), normalMs: 5000 }));
    };
    ws.onmessage = (ev) => {
      bnLastMsgRef.current = Date.now();
      try {
        const msg = JSON.parse(ev.data as string);
        // Combined stream wraps: {stream:"btcusdt@forceOrder", data:{e,E,o}}
        const o = msg?.data?.o ?? msg?.o;
        if (!o) return;
        if (o.X && o.X !== 'FILLED') return;
        const priceAp = parseFloat(o.ap ?? '0');
        const priceP  = parseFloat(o.p  ?? '0');
        const price   = priceAp > 0 ? priceAp : priceP;
        const qty     = parseFloat(o.z  ?? o.q ?? '0');
        if (price <= 0 || qty <= 0) return;
        onLiq(o.s ?? '', o.S === 'SELL' ? 'LONG' : 'SHORT', price * qty, price, 'BN');
      } catch { /* */ }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onLiq]);

  // Kept current in an effect, not assigned during render (a render-time ref
  // write is its own violation). Declared above the effect that first calls
  // connectBN(), so React runs it first and the ref is never the initial no-op
  // by the time a reconnect can fire.
  useEffect(() => { connectBNRef.current = connectBN; }, [connectBN]);

  /* ── Bybit liquidation WebSocket (try primary, fall back to bytick.com mirror) ── */
  const bbRetriesRef2 = useRef(0);
  const connectBBRef = useRef<() => void>(() => {});
  const connectBB = useCallback(() => {
    if (stoppedRef.current) return;
    if (bbTimerRef.current) { clearTimeout(bbTimerRef.current); bbTimerRef.current = null; }
    dropSocket(bbWsRef.current);
    // bytick.com is Bybit's alternative domain - less likely to be blocked by extensions
    const host = bbRetriesRef2.current % 2 === 0
      ? 'wss://stream.bybit.com/v5/public/linear'
      : 'wss://stream.bytick.com/v5/public/linear';
    const ws = new WebSocket(host);
    bbWsRef.current = ws;
    ws.onopen = () => {
      bbLastMsgRef.current = Date.now();
      bbAttemptRef.current = 0;
      setBbStatus('live');
      // v5 topic: allLiquidation.{symbol} - max 25 topics per subscribe message
      const topics = BYBIT_COINS.map(s => `allLiquidation.${s}`);
      for (let i = 0; i < topics.length; i += 25) {
        ws.send(JSON.stringify({ op: 'subscribe', args: topics.slice(i, i + 25) }));
      }
    };
    ws.onerror = () => setBbStatus('error');
    ws.onclose = () => {
      if (stoppedRef.current || bbWsRef.current !== ws) return;
      setBbStatus('error');
      bbRetriesRef2.current++;   // host alternation; independent of the backoff count, which resets on open
      bbAttemptRef.current += 1;
      bbTimerRef.current = setTimeout(() => { bbTimerRef.current = null; connectBBRef.current(); },
        reconnectDelayMs(bbAttemptRef.current, { ...linkState(), normalMs: 5000 }));
    };
    ws.onmessage = (ev) => {
      bbLastMsgRef.current = Date.now();
      try {
        const msg = JSON.parse(ev.data as string);
        if (msg.op === 'subscribe') return;   // ignore subscription ack
        if (!msg.topic?.startsWith('allLiquidation.') || !msg.data) return;
        const items = Array.isArray(msg.data) ? msg.data : [msg.data];
        items.forEach((d: Record<string, string>) => {
          // allLiquidation fields: s=symbol, S=side (Buy=long liq), v=size, p=bankruptcy price
          const price = parseFloat(d.p ?? '0');
          const qty   = parseFloat(d.v ?? '0');
          if (price <= 0 || qty <= 0) return;
          // S:"Buy" = long position was liquidated; S:"Sell" = short position liquidated
          onLiq(d.s ?? '', d.S === 'Buy' ? 'LONG' : 'SHORT', price * qty, price, 'BB');
        });
      } catch { /* */ }
    };
  }, [onLiq]);

  // Same as connectBN's above, and declared before the effect that first calls
  // connectBB() so the ref is populated before any reconnect can run.
  useEffect(() => { connectBBRef.current = connectBB; }, [connectBB]);

  /* RESUME (owner, 2026-11-18): back from an idle or frozen tab, a socket that is not OPEN or has been quiet for 30 s is replaced now
     rather than whenever its own timer gets to run. dropSocket detaches the old handlers so its onclose cannot queue a second one. */
  /* The same check when the network comes back (`online`): reconnect now with the backoff reset, not after a 30 s offline wait. */
  useEffect(() => {
    const kick = () => {
      if (stoppedRef.current) return;
      const now = Date.now();
      if (socketNeedsReconnect(bnWsRef.current?.readyState, bnLastMsgRef.current, now)) { dropSocket(bnWsRef.current); bnWsRef.current = null; bnAttemptRef.current = 0; connectBNRef.current(); }
      if (socketNeedsReconnect(bbWsRef.current?.readyState, bbLastMsgRef.current, now)) { dropSocket(bbWsRef.current); bbWsRef.current = null; bbAttemptRef.current = 0; connectBBRef.current(); }
    };
    const offResume = onPageResume(kick);
    const offOnline = onBackOnline(kick);
    return () => { offResume(); offOnline(); };
  }, []);

  useEffect(() => {
    stoppedRef.current = false;   // a remount (React strict mode runs mount, cleanup, mount) starts the feeds again
    // ── Seed from localStorage (fast, synchronous) ───────────────────────
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: LiqEvent[] = JSON.parse(stored);
        const now = Date.now();
        const valid = parsed
          .filter(e => now - e.ts < CLUSTER_WIN)
          .map(e => ({ ...e, id: ++idCounter }));
        if (valid.length > 0) {
          historyRef.current = valid;
          rebuild(valid);
          setFeed(valid.slice().reverse().slice(0, FEED_SIZE));
        }
      }
    } catch { /* corrupted storage - ignore */ }

    // ── Connect to exchanges ─────────────────────────────────────────────
    connectBN();
    connectBB();
    const iv = setInterval(() => rebuild(historyRef.current), 30_000);

    // ── Load 24h history from Supabase (async, fills clusters on arrival) ─
    const sb = getSupabase();
    if (sb) {
      const since = Date.now() - SB_WIN_MS;
      let partial = false;
      readStored(sb, since, null, SB_PAGES_ALL, () => { partial = true; })
        .then(rows => { setPartialBy(m => ({ ...m, ALL: partial })); mergeStored(rows, false); setHourBy(m => ({ ...m, ALL: coversStatsWindow(rows, partial) })); })
        .catch(() => { setPartialBy(m => ({ ...m, ALL: true })); setHourBy(m => ({ ...m, ALL: false })); /* the live feed and the coin read still run */ });

      /* The browser no longer saves liquidations (#1632 item 4): the server process collects them (lib/liqCollector.ts). The tab still READS the last 24 h above and shows its own live events. */
    }

    return () => {
      clearInterval(iv);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      /* Stop the reconnect loops with the component. A plain close() here ran each socket's onclose, which scheduled a reconnect
         for a feed that no longer existed - and that socket then stayed open for the life of the tab. */
      stoppedRef.current = true;
      if (bnTimerRef.current) { clearTimeout(bnTimerRef.current); bnTimerRef.current = null; }
      if (bbTimerRef.current) { clearTimeout(bbTimerRef.current); bbTimerRef.current = null; }
      dropSocket(bnWsRef.current); bnWsRef.current = null;
      dropSocket(bbWsRef.current); bbWsRef.current = null;
      if (cascadeTimer.current) clearTimeout(cascadeTimer.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Derived display values ── */
  const displayed = coinFilter === 'ALL' ? feed : feed.filter(e => e.coin === coinFilter);
  const totalUsd  = stats.longUsd + stats.shortUsd;
  // What a 1h figure says while it cannot be told: an ellipsis while the stored hour is being read, the words if it could not be.
  const hourGap   = hourPending ? '…' : t('ARENA_SCANNER_UNAVAILABLE_NARROW');
  const longDom   = stats.longUsd  > stats.shortUsd * 1.2;
  const shortDom  = stats.shortUsd > stats.longUsd  * 1.2;
  const anyLive   = bnStatus === 'live' || bbStatus === 'live';

  /* AFTER every hook, and that placement is the whole correctness argument.
     Returning early above them would break the rules-of-hooks order and, worse,
     skip the effects that open the sockets, seed from localStorage and emit
     onClusters - the exact work headless mode exists to keep running. The
     cleanup at the bottom of the mount effect has to stay reachable too. */
  if (headless) return null;

  return (
    <div className="liqfeed-wrap">

      {/* ── Header ── */}
      <div className="liqfeed-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-card-title)', fontWeight: 700, color: 'var(--txt)' }}>
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M11 1.5 3.5 11.5H9L8 18.5 16 8H10.5L11 1.5Z" fill="currentColor" /></svg>
            <Tip text={t('LIQ_FEED_TOOLTIP')}>{t('LIQ_FEED_TITLE')}</Tip>
          </span>
          <span className={`liqfeed-dot liqfeed-dot-${bnStatus}`} title={t('LIQ_FEED_BINANCE_STATUS_TITLE', { status: bnStatus })} />
          <span className={`liqfeed-dot liqfeed-dot-${bbStatus}`} title={t('LIQ_FEED_BYBIT_STATUS_TITLE', { status: bbStatus })} />
        </div>
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>
          {t('LIQ_FEED_SOURCES_LINE', { status: msgCount > 0 ? t('LIQ_FEED_EVENTS_COUNT', { count: msgCount }) : t('LIQ_FEED_WAITING') })}
          {histOnly && <> · {t('LIQ_FEED_HISTORY_ONE_VENUE', { venue: histOnly === 'BN' ? 'Binance' : 'Bybit' })}</>}
          {historyPartial && <> · {t('LIQ_HISTORY_PARTIAL')}</>}
        </span>
      </div>

      {/* ── Cascade alert ── */}
      {cascade && (
        <div className={`liq-cascade liq-cascade-${cascade.side.toLowerCase()}`}>
          <span className="liq-cascade-icon" style={{ display: 'inline-flex', lineHeight: 0 }}>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M11 1.5 3.5 11.5H9L8 18.5 16 8H10.5L11 1.5Z" fill="currentColor" /></svg>
          </span>
          <div className="liq-cascade-body">
            <span className="liq-cascade-label">
              {cascade.side === 'LONG' ? t('LIQ_FEED_CASCADE_LONG') : cascade.side === 'SHORT' ? t('LIQ_FEED_CASCADE_SHORT') : t('LIQ_FEED_CASCADE_MIXED')}
            </span>
            <span className="liq-cascade-amt">
              {' '}{t('LIQ_FEED_CASCADE_WIPED', { amount: fmtUSD(cascade.totalUsd) })}
            </span>
            {cascade.coins.length > 0 && (
              <span className="liq-cascade-coins"> · {cascade.coins.join(', ')}</span>
            )}
          </div>
        </div>
      )}

      {/* ── Stats ── */}
      <div className="liqfeed-stats">
        <div className="liqfeed-stat">
          <span className="liqfeed-stat-lbl">{t('LIQ_FEED_STAT_LONGS')}</span>
          <span className="liqfeed-stat-val" style={{ color: 'var(--red)' }}>{hourKnown ? fmtUSD(stats.longUsd) : hourGap}</span>
        </div>
        <div className="liqfeed-stat-sep" />
        <div className="liqfeed-stat" style={{ textAlign: 'center' }}>
          <span className="liqfeed-stat-lbl">{t('LIQ_FEED_STAT_EVENTS')}</span>
          <span className="liqfeed-stat-val" style={{ color: 'var(--accent)' }}>{hourKnown ? stats.count : hourGap}</span>
        </div>
        <div className="liqfeed-stat-sep" />
        <div className="liqfeed-stat" style={{ textAlign: 'right' }}>
          <span className="liqfeed-stat-lbl">{t('LIQ_FEED_STAT_SHORTS')}</span>
          <span className="liqfeed-stat-val" style={{ color: 'var(--green-2)' }}>{hourKnown ? fmtUSD(stats.shortUsd) : hourGap}</span>
        </div>
      </div>

      {/* ── Bias bar ── */}
      {hourKnown && totalUsd > 0 && (
        <>
          <div className="liqfeed-bias-wrap">
            <div className="liqfeed-bias-bar liqfeed-bias-long"  style={{ width: `${(stats.longUsd  / totalUsd) * 100}%` }} />
            <div className="liqfeed-bias-bar liqfeed-bias-short" style={{ width: `${(stats.shortUsd / totalUsd) * 100}%` }} />
          </div>
          <div className="liqfeed-bias-label">
            {longDom  && <span style={{ color: 'var(--red)', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Warn /> {t('LIQ_FEED_BIAS_LONG_DOM')}</span>}
            {shortDom && <span style={{ color: 'var(--green-2)' }}>{t('LIQ_FEED_BIAS_SHORT_DOM')}</span>}
            {!longDom && !shortDom && <span style={{ color: 'var(--txt3)' }}>{t('LIQ_FEED_BIAS_BALANCED')}</span>}
          </div>
        </>
      )}

      {/* ── Price clusters ── */}
      {clusters.length > 0 && (() => {
        const filtered = coinFilter === 'ALL'
          ? clusters
          : clusters.filter(c => c.coin === coinFilter);
        if (filtered.length === 0) return null;
        const displayMax = Math.max(...filtered.map(c => c.total));
        return (
          <div className="liq-clusters">
            <div className="liq-clusters-title">
              {t('LIQ_FEED_CLUSTERS_TITLE')}
              <span style={{ color: 'var(--txt-dim)', fontWeight: 400, marginLeft: 6 }}>{t('LIQ_FEED_CLUSTERS_SUBTITLE')}</span>
            </div>
            {filtered.map(c => (
              <div key={`${c.coin}::${c.price}`} className="liq-cluster-row">
                <div>
                  {coinFilter === 'ALL' && (
                    <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: '#888', letterSpacing: '.06em', display: 'block', marginBottom: 1 }}>{c.coin}</span>
                  )}
                  <span className="liq-cluster-price">{c.label}</span>
                </div>
                <div className="liq-cluster-bars">
                  <div
                    className="liq-cluster-bar liq-cluster-bar-long"
                    style={{ width: `${(c.longUsd / displayMax) * 100}%` }}
                  />
                  <div
                    className="liq-cluster-bar liq-cluster-bar-short"
                    style={{ width: `${(c.shortUsd / displayMax) * 100}%` }}
                  />
                </div>
                <span className="liq-cluster-amt">{fmtUSD(c.total)}</span>
                <span
                  className="liq-cluster-dom"
                  style={{ color: c.longUsd > c.shortUsd ? 'var(--red)' : 'var(--green-2)' }}
                >
                  {c.longUsd > c.shortUsd ? t('LIQ_FEED_DOM_LONG_ABBR') : t('LIQ_FEED_DOM_SHORT_ABBR')}
                </span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ── Feed ── */}
      {displayed.length === 0 && (
        <div style={{ padding: '10px 14px' }} role="status" aria-live="polite">
          <span className="sr-only">
            {anyLive ? t('LIQ_FEED_SR_WATCHING', { coin: coinFilter === 'ALL' ? t('LIQ_FEED_ALL_MARKETS') : coinFilter }) : t('LIQ_FEED_SR_CONNECTING')}
          </span>
          {anyLive ? (
            /* A connected feed with nothing yet is a quiet market, not a loading one; same height as the skeleton so nothing below moves. */
            <div style={{ minHeight: 106, color: 'var(--txt3)', fontSize: 'var(--fs-caption)' }}>{t('LIQ_FEED_SR_WATCHING', { coin: coinFilter === 'ALL' ? t('LIQ_FEED_ALL_MARKETS') : coinFilter })}</div>
          ) : connectWaited ? (
            /* NOT CONNECTED YET, AND THE SOCKET KEEPS RETRYING BY ITSELF: the space is held and says nothing, instead of a "could not connect" sentence (failure-text audit A17). Rows appear the moment the feed delivers. */
            <div data-testid="liq-feed-connect-failed" style={{ minHeight: 106 }} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[0, 1, 2].map(i => (
                <SkeletonBar key={i} height={30} radius={8} style={{ opacity: 1 - i * 0.18 }} />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="liqfeed-list">
        {displayed.map(ev => {
          const isLong = ev.side === 'LONG';
          const isBig  = ev.usd >= MIN_ALERT;
          const accent = isLong ? 'var(--red)' : 'var(--green-2)';
          return (
            <div
              key={ev.id}
              className={`liqfeed-row${isBig ? ' liqfeed-row-big' : ''}`}
              style={{ borderLeftColor: accent }}
            >
              <span className="liqfeed-row-coin" style={{ color: accent }}>{ev.coin}</span>
              <span className={`liqfeed-row-side liqfeed-row-side-${isLong ? 'long' : 'short'}`}>
                {isLong ? t('LIQ_FEED_ROW_LONG') : t('LIQ_FEED_ROW_SHORT')}
              </span>
              <span className="liqfeed-row-usd" style={{ color: isBig ? accent : 'var(--txt-dim)' }}>
                {fmtUSD(ev.usd)}
              </span>
              <span className="liqfeed-row-price">{fmtEventPrice(ev.price)}</span>
              <span className="liqfeed-row-time">
                <span className={`liq-src liq-src-${ev.source.toLowerCase()}`}>{ev.source}</span>
                {fmtTime(ev.ts)}
              </span>
            </div>
          );
        })}
      </div>

    </div>
  );
}
