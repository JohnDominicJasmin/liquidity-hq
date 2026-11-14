/* QA's fake world for the Telegram alert cron (not shipped: lives under qa/). It runs the REAL route handler in-process (jiti transpiles the TypeScript, `@/` aliased) with `fetch` replaced by a fake
 * network, so nothing leaves the machine: a fake Supabase REST (seeded tables, simple PostgREST filters, writes recorded), a fake Telegram Bot API (records every sendMessage and answers per mode),
 * and fake exchange endpoints (tickers, klines). Secrets here are throwaway literals. */
import { createJiti } from 'jiti';
import path from 'node:path';

const root = path.resolve('.');
const PRO = { role: 'pro', trial_ends_at: null, current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString() };

export function makeWorld(over = {}) {
  const w = {
    tables: {
      lhq_user_subscriptions: [{ user_id: 'u-pro', ...PRO }, { user_id: 'u-free', role: 'free', trial_ends_at: null, current_period_end: null }],
      lhq_user_settings: [{ user_id: 'u-pro', telegram_chat_id: '1001', timezone: 'UTC' }, { user_id: 'u-free', telegram_chat_id: '2002', timezone: 'UTC' }],
      lhq_price_alerts: [], lhq_muted_alerts: [], lhq_alert_fires: [], lhq_app_config: [], lhq_alert_cooldowns: [],
      ...(over.tables ?? {}),
    },
    telegram: { mode: 'ok', sent: [], attempts: [] },     // mode: ok | 403 (bot blocked) | 400 (chat not found) | throw
    prices: { BTCUSDT: 69_000, ETHUSDT: 1_900, SOLUSDT: 75 },
    writes: [], log: [], anchor: Date.now(),
  };
  for (const k of Object.keys(over)) if (k !== 'tables') w[k] = over[k];
  return w;
}

const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

function filterRows(rows, params) {
  let out = rows;
  for (const [k, v] of params.entries()) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    const m = /^(eq|neq|is|not|in|gte|lte|gt|lt)\.(.*)$/.exec(v); if (!m) continue;
    const [, op, val] = m;
    out = out.filter(r => {
      const x = r[k];
      if (op === 'eq') return String(x) === val;
      if (op === 'neq') return String(x) !== val;
      if (op === 'is') return val === 'null' ? x == null : val === 'true' ? x === true : x === false;
      if (op === 'not') return val === 'is.null' ? x != null : true;
      if (op === 'in') return val.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')).includes(String(x));
      if (op === 'gte') return String(x) >= val; if (op === 'lte') return String(x) <= val;
      if (op === 'gt') return String(x) > val; if (op === 'lt') return String(x) < val;
      return true;
    });
  }
  return out;
}

export function installFakeFetch(w) {
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url ?? input); const method = (init?.method ?? 'GET').toUpperCase(); const u = new URL(url);
    w.log.push(`${method} ${u.host}${u.pathname}`);
    if (u.host === 'stub.supabase.test') {
      const table = u.pathname.replace('/rest/v1/', '');
      if (u.pathname.startsWith('/rest/v1/rpc/')) { w.rpcs = w.rpcs ?? []; w.rpcs.push({ name: u.pathname.replace('/rest/v1/rpc/', ''), args: init?.body ? JSON.parse(init.body) : null }); return json(0); }
      const rows = w.tables[table] ?? [];
      if (method === 'GET' || method === 'HEAD') return json(filterRows(rows, u.searchParams));
      const body = init?.body ? JSON.parse(init.body) : null;
      w.writes.push({ method, table, query: u.search, body });
      if (method === 'POST') { const add = Array.isArray(body) ? body : [body]; for (const r of add) rows.push(r); w.tables[table] = rows; return new Response(null, { status: 201 }); }
      if (method === 'PATCH') { for (const r of filterRows(rows, u.searchParams)) Object.assign(r, body); return new Response(null, { status: 204 }); }
      return new Response(null, { status: 204 });
    }
    if (u.host === 'api.telegram.org') {
      const b = init?.body ? JSON.parse(init.body) : {};
      w.telegram.attempts.push({ chat_id: String(b.chat_id), text: b.text });
      if (w.telegram.mode === 'throw') throw new Error('network down');
      if (w.telegram.mode === '403') return json({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }, 403);
      if (w.telegram.mode === '400') return json({ ok: false, error_code: 400, description: 'Bad Request: chat not found' }, 400);
      w.telegram.sent.push({ chat_id: String(b.chat_id), text: b.text });
      return json({ ok: true, result: { message_id: w.telegram.sent.length } });
    }
    if (/bybit|binance/.test(u.host) && /ticker/.test(u.pathname)) {
      const syms = Object.keys(w.prices);
      if (/bybit/.test(u.host)) return json({ retCode: 0, result: { category: 'linear', list: syms.map(s => ({ symbol: s, lastPrice: String(w.prices[s]), price24hPcnt: '0.01', volume24h: '1000', turnover24h: '1000000' })) } });
      return json(syms.map(s => ({ symbol: s, lastPrice: String(w.prices[s]), priceChangePercent: '1.0', volume: '1000', quoteVolume: '1000000' })));
    }
    if (/bybit/.test(u.host) && u.pathname === '/v5/market/kline' && w.noKlines) return json({ retCode: 0, result: { list: [] } });   // a market with no candles: only price alerts can fire
    if (/bybit/.test(u.host) && u.pathname === '/v5/market/kline') {
      const sym = u.searchParams.get('symbol'); const iv = u.searchParams.get('interval'); const limit = Math.min(Number(u.searchParams.get('limit') ?? 200), 1000);
      const ms = ({ D: 86_400_000, W: 604_800_000, M: 2_592_000_000 })[iv] ?? Number(iv) * 60_000;
      const closes = (w.series && (w.series[`${sym}:${iv}`] ?? w.series[`${sym}:*`])) || null;       // oldest -> newest
      const start = Math.floor((w.anchor ?? Date.now()) / ms) * ms;   // w.anchor pins the candle clock: "the same market a minute later" stays the same candles
      const list = []; for (let i = 0; i < limit; i++) {
        const fromEnd = i; const c = closes ? (closes[closes.length - 1 - fromEnd] ?? closes[0]) : (w.prices[sym] ?? 100);
        const prev = closes ? (closes[closes.length - 2 - fromEnd] ?? c) : c;
        list.push([String(start - i * ms), String(prev), String(Math.max(c, prev) + 0.0), String(Math.min(c, prev) - 0.0), String(c), '1000', '100000']);
      }
      return json({ retCode: 0, result: { category: u.searchParams.get('category') ?? 'linear', symbol: sym, list } });
    }
    return json([]);   // everything else: an empty, healthy-looking world
  };
}

export async function loadRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://stub.supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-key';
  process.env.TELEGRAM_BOT_TOKEN = '123:harness-fake-token';
  process.env.CRON_SECRET = 'harness-fake-secret';
  process.env.NEXT_PUBLIC_APP_ENV = 'prod';        // table names lhq_*, the same names the fake world serves
  const jiti = createJiti(import.meta.url, { alias: { '@': root }, interopDefault: true, moduleCache: false });
  const mod = await jiti.import(path.join(root, 'app/api/telegram/alert/route.ts'));
  const { NextRequest } = await import('next/server.js');
  return {
    run: async (secret = 'harness-fake-secret') => {
      const res = await mod.GET(new NextRequest('http://localhost/api/telegram/alert', { headers: secret ? { 'x-cron-secret': secret } : {} }));
      return { status: res.status, body: await res.json().catch(() => null) };
    },
  };
}
