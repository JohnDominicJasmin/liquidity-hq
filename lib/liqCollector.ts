/* THE LIQUIDATION COLLECTOR, RUN BY THE SERVER (#1632 item 4, PM's queue).
 *
 * Liquidation collection moves server-side. Until this file the rows in `lhq_liq_events` were written by visitors' browsers (components/LiqFeed.tsx), so coverage depended on somebody having the page open.
 * This runs the same two subscriptions in the server process and writes with the service role; the browser no longer writes, and the table's browser write grant is removed as part of the
 * move (supabase/migrations/20261116g).
 *
 * WHY A PROCESS AND NOT A CRON ROUTE. Liquidations arrive over WebSocket and neither exchange has a history endpoint, so a scheduled request has nothing to fetch, and a route that
 * opens the socket for a short window would draw the bursts it missed as quiet periods that never happened. The production service is a Render Starter web service (always on, one
 * instance, Singapore), so a long-lived socket in its Node process is the honest fit. Started from instrumentation.ts.
 *
 * OFF UNLESS `LIQ_COLLECTOR=1`. The free-plan services (dev, qa, staging) sleep when idle, so a collector there would write a few minutes in a day and look healthy. The env var is set
 * on the production service only, by whoever deploys, BEFORE the release that removes the browser insert; without it nothing writes and the heatmap starves.
 *
 * KNOWN GAPS, STATED. A deploy or restart drops both sockets for the seconds it takes to reconnect; that window is missed, not backfilled (there is no history to backfill from).
 * Each socket reconnects on its own with a capped backoff. A quiet feed is normal, so there is no message-silence watchdog: only a close or an error reconnects. */
import { BINANCE_SYMS, BYBIT_SYMS } from './coins.ts';
import { getSupabaseAdmin } from './supabase-admin.ts';
import { T } from './tables.ts';
import { reportHealth } from './apiHealth.ts';

/** Same floor the browser used (LiqFeed MIN_SHOW): smaller liquidations are noise for the clusters and are not stored. */
export const LIQ_MIN_USD = 10_000;
const FLUSH_MS = 5_000;
const MAX_BATCH = 500;
const MAX_QUEUE = 5_000;
const BACKOFF_CAP_MS = 30_000;
/* WATCHDOG. A TCP stall (half-open socket) fires neither close nor error, so without this the collector stops with nothing to say so. Bybit answers our 20 s ping, so a minute of NO message at all
   (pongs count) means the socket is dead; Binance only sends data when something liquidates, so its limit is long. Past LIQ_SILENCE_FAIL_MS with no liquidation from either venue the health row goes FAILED. */
export const BYBIT_STALE_MS = 60_000;
export const BINANCE_STALE_MS = 10 * 60_000;
export const LIQ_SILENCE_FAIL_MS = 20 * 60_000;
const WATCHDOG_MS = 15_000;
/** True when a socket that last heard something at `lastMsgAt` has been silent longer than `limitMs`. */
export function isStale(nowMs: number, lastMsgAt: number, limitMs: number): boolean { return nowMs - lastMsgAt > limitMs; }

export interface LiqRow { coin: string; side: 'LONG' | 'SHORT'; usd: number; price: number; source: 'BN' | 'BB'; ts: number }

/** `BTCUSDT` -> `BTC`, `1000PEPEUSDT` -> `PEPE`: the same derivation as the browser's coinFromSym, kept here as the one server definition. */
export function coinFromSymbol(sym: string): string {
  return sym.replace(/^\d+/, '').replace(/USDT$|BUSD$|USDC$/, '');
}

/** The exchange's own event time when it sent a sane one, else the receipt time. The EXCHANGE time is what makes a restart overlap (two processes briefly both subscribed) produce the same key for the same liquidation, which the unique index then drops. */
function eventTs(raw: unknown, receivedAt: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && Math.abs(n - receivedAt) < 60 * 60 * 1000 ? Math.round(n) : receivedAt;
}

function toRow(sym: string, side: 'LONG' | 'SHORT', usd: number, price: number, source: 'BN' | 'BB', ts: number): LiqRow | null {
  if (!sym || !Number.isFinite(usd) || !Number.isFinite(price) || price <= 0 || usd < LIQ_MIN_USD) return null;
  const coin = coinFromSymbol(sym);
  if (!coin) return null;
  return { coin, side, usd, price, source, ts };
}

/** One Binance `@forceOrder` combined-stream message -> a row, or null (not a filled liquidation, malformed, or under the floor).
 *  SELL on the order means a LONG position was liquidated. */
export function parseBinanceForceOrder(raw: string, ts: number): LiqRow | null {
  try {
    const msg = JSON.parse(raw);
    const o = msg?.data?.o ?? msg?.o;
    if (!o) return null;
    /* PARTIALLY_FILLED counts: `z` is the accumulated FILLED quantity, which was really liquidated. NEW/EXPIRED/CANCELED with nothing filled fall out below on z. */
    if (o.X && o.X !== 'FILLED' && o.X !== 'PARTIALLY_FILLED') return null;
    const priceAp = parseFloat(o.ap ?? '0');
    const priceP = parseFloat(o.p ?? '0');
    const price = priceAp > 0 ? priceAp : priceP;
    const qty = parseFloat(o.X === 'PARTIALLY_FILLED' ? (o.z ?? '0') : (o.z ?? o.q ?? '0'));
    if (!(price > 0) || !(qty > 0)) return null;
    return toRow(String(o.s ?? ''), o.S === 'SELL' ? 'LONG' : 'SHORT', price * qty, price, 'BN', eventTs(o.T ?? msg?.data?.E, ts));
  } catch { return null; }
}

/** One Bybit v5 `allLiquidation.<symbol>` message -> rows. `Buy` means a LONG position was liquidated. Acks and other topics give []. */
export function parseBybitLiquidation(raw: string, ts: number): LiqRow[] {
  try {
    const msg = JSON.parse(raw);
    if (msg?.op === 'subscribe') return [];
    if (typeof msg?.topic !== 'string' || !msg.topic.startsWith('allLiquidation.') || !msg.data) return [];
    const items: Array<Record<string, string>> = Array.isArray(msg.data) ? msg.data : [msg.data];
    const out: LiqRow[] = [];
    for (const d of items) {
      const price = parseFloat(d.p ?? '0');
      const qty = parseFloat(d.v ?? '0');
      if (!(price > 0) || !(qty > 0)) continue;
      const row = toRow(String(d.s ?? ''), d.S === 'Buy' ? 'LONG' : 'SHORT', price * qty, price, 'BB', eventTs(d.T ?? msg.ts, ts));
      if (row) out.push(row);
    }
    return out;
  } catch { return []; }
}

interface Venue { lastMsgAt: number; staleMs: number; retire: (reason: string) => void }
interface Collector { started: boolean; stopped: boolean; queue: LiqRow[]; flushing: boolean; lastRowAt: number; venues: Venue[]; sockets: Array<{ close(): void } | null> }
const g = globalThis as typeof globalThis & { __lhqLiqCollector?: Collector };

async function flush(c: Collector): Promise<void> {
  if (c.flushing || c.queue.length === 0) return;
  c.flushing = true;
  const batch = c.queue.splice(0, MAX_BATCH);
  try {
    const admin = getSupabaseAdmin();
    /* UPSERT-IGNORE on the natural key, so a second process (a restart overlap) cannot double a row. It needs the unique index of 20261116i; until that exists Postgres answers
       42P10 (no matching constraint) and this falls back to a plain insert, so the order of deploy and migration does not matter. */
    let { error } = await admin.from(T.liq_events).upsert(batch, { onConflict: 'source,coin,ts,side,usd', ignoreDuplicates: true });
    if (error && (error.code === '42P10' || /no unique or exclusion constraint/i.test(error.message))) {
      ({ error } = await admin.from(T.liq_events).insert(batch));
    }
    if (error) throw new Error(error.message);
    reportHealth('liq:collect', 'other', true, `${batch.length} rows written`, batch.length);
  } catch (e) {
    /* Put the batch back, newest kept if the queue is over its cap: a database that is down for a while loses the OLDEST rows, not the newest. */
    c.queue.unshift(...batch);
    if (c.queue.length > MAX_QUEUE) c.queue.splice(0, c.queue.length - MAX_QUEUE);
    reportHealth('liq:collect', 'other', false, String(e instanceof Error ? e.message : e).slice(0, 200));
  } finally {
    c.flushing = false;
  }
}

function connect(c: Collector, idx: number, name: string, staleMs: number, open: () => WebSocket, onOpen: (ws: WebSocket) => void, onMessage: (data: string) => void): void {
  let attempts = 0;
  let gen = 0; /* each socket owns a generation; a retired socket's late events are ignored, so a dead one can never reconnect twice */
  const venue: Venue = { lastMsgAt: Date.now(), staleMs, retire: () => {} };
  c.venues[idx] = venue;
  const schedule = () => { if (!c.stopped) setTimeout(go, Math.min(BACKOFF_CAP_MS, 2_000 * ++attempts)); };
  const go = () => {
    if (c.stopped) return;
    const mine = ++gen;
    venue.lastMsgAt = Date.now();
    let ws: WebSocket;
    try { ws = open(); } catch (e) {
      reportHealth(`liq:${name}`, 'other', false, String(e instanceof Error ? e.message : e).slice(0, 200));
      schedule();
      return;
    }
    c.sockets[idx] = ws;
    let lastError = '';
    /* Reported as FAILED with what the socket said, so a venue that refuses this server (Binance has before) shows up in lhq_api_health as that venue being down; the feed then says its history is one-venue (LiqFeed). */
    const retire = (reason: string) => {
      if (gen !== mine) return;
      gen++;
      try { ws.close(); } catch { /* already closed */ }
      reportHealth(`liq:${name}`, 'other', false, `${reason}, reconnecting`);
      schedule();
    };
    venue.retire = retire;
    ws.addEventListener('open', () => { if (gen !== mine) return; attempts = 0; venue.lastMsgAt = Date.now(); reportHealth(`liq:${name}`, 'other', true, 'connected'); onOpen(ws); });
    ws.addEventListener('message', (ev: MessageEvent) => { if (gen !== mine) return; venue.lastMsgAt = Date.now(); if (typeof ev.data === 'string') onMessage(ev.data); });
    ws.addEventListener('error', (ev: Event) => { lastError = String((ev as ErrorEvent).message ?? '').slice(0, 120); /* the close that follows does the reconnect */ });
    ws.addEventListener('close', (ev: CloseEvent) => retire(`socket closed (code ${ev.code}${lastError ? ', ' + lastError : ''})`));
  };
  go();
}

/** Starts both subscriptions and the flush timer, once per process. A no-op unless LIQ_COLLECTOR=1. */
export function startLiqCollector(): void {
  if (process.env.LIQ_COLLECTOR !== '1') return;
  if (g.__lhqLiqCollector?.started) return;
  if (typeof WebSocket === 'undefined') { reportHealth('liq:collect', 'other', false, 'no global WebSocket in this Node runtime'); return; }
  const c: Collector = { started: true, queue: [], flushing: false, stopped: false, lastRowAt: Date.now(), venues: [], sockets: [null, null] };
  g.__lhqLiqCollector = c;
  const push = (r: LiqRow | null) => { if (r) { c.lastRowAt = Date.now(); c.queue.push(r); if (c.queue.length > MAX_QUEUE) c.queue.shift(); } };

  const bnStreams = Object.values(BINANCE_SYMS).map(s => `${s.toLowerCase()}@forceOrder`).join('/');
  connect(c, 0, 'binance', BINANCE_STALE_MS,
    () => new WebSocket(`wss://fstream.binance.com/stream?streams=${bnStreams}`),
    () => { /* the combined stream subscribes by URL */ },
    data => push(parseBinanceForceOrder(data, Date.now())));

  const topics = Object.values(BYBIT_SYMS).map(s => `allLiquidation.${s}`);
  let bybitHost = 0;
  connect(c, 1, 'bybit', BYBIT_STALE_MS,
    () => new WebSocket(bybitHost++ % 2 === 0 ? 'wss://stream.bybit.com/v5/public/linear' : 'wss://stream.bytick.com/v5/public/linear'),
    ws => {
      for (let i = 0; i < topics.length; i += 25) ws.send(JSON.stringify({ op: 'subscribe', args: topics.slice(i, i + 25) }));
      /* Bybit asks for a heartbeat about every 20 s on a public socket; the browser version relied on the tab's own socket handling, a server process does not get that for free. */
      const ping = setInterval(() => { try { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 'ping' })); else clearInterval(ping); } catch { clearInterval(ping); } }, 20_000);
      ws.addEventListener('close', () => clearInterval(ping));
    },
    data => { for (const r of parseBybitLiquidation(data, Date.now())) push(r); });

  const timer = setInterval(() => { void flush(c); }, FLUSH_MS);
  timer.unref?.();
  let lastSilenceReport = 0;
  const dog = setInterval(() => {
    const now = Date.now();
    for (const v of c.venues) if (v && isStale(now, v.lastMsgAt, v.staleMs)) v.retire(`no message for ${Math.round((now - v.lastMsgAt) / 1000)} s`);
    /* A silent stop must be VISIBLE: with no liquidation from either venue for LIQ_SILENCE_FAIL_MS the collect row goes FAILED (re-reported every 5 min), and the next row clears it. */
    if (isStale(now, c.lastRowAt, LIQ_SILENCE_FAIL_MS) && now - lastSilenceReport > 5 * 60_000) {
      lastSilenceReport = now;
      reportHealth('liq:collect', 'other', false, `no liquidations received for ${Math.round((now - c.lastRowAt) / 60_000)} min`);
    }
  }, WATCHDOG_MS);
  dog.unref?.();
  /* Next's own start handler (next start) also listens for SIGTERM and exits with 143 after its cleanup, so this does not block the exit; it makes a best effort to write the last <5 s of rows and stops the sockets reconnecting. */
  process.once('SIGTERM', () => { c.stopped = true; for (const s of c.sockets) { try { s?.close(); } catch { /* */ } } void flush(c); });
}
