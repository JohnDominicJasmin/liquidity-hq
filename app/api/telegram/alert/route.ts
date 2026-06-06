import { NextResponse } from 'next/server';
import { classifyNews } from '@/lib/classify';
import { getSupabase } from '@/lib/supabase';
import { detectPatterns } from '@/lib/patterns';

export const dynamic = 'force-dynamic';

/* ── Grok (lightweight — no web search, pure reasoning) ── */
const GROK_KEY = process.env.GROK_API_KEY ?? '';
async function grokAnalyze(prompt: string): Promise<string> {
  try {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROK_KEY}` },
      body: JSON.stringify({ model: 'grok-4.3', messages: [{ role: 'user', content: prompt }], max_tokens: 200 }),
    });
    if (!res.ok) return '';
    const data = await res.json();
    return (data.choices?.[0]?.message?.content ?? '').trim();
  } catch { return ''; }
}

/* ── Conviction parser ── */
function parseConviction(raw: string): { text: string; badge: string } {
  const m = raw.match(/\n?CONVICTION:\s*(High|Moderate|Weak)/i);
  if (!m) return { text: raw, badge: '' };
  const level = m[1] as 'High' | 'Moderate' | 'Weak';
  const text  = raw.replace(/\n?CONVICTION:\s*(High|Moderate|Weak)/i, '').trim();
  const badges: Record<string, string> = {
    High:     '🔴 <i>High conviction</i>',
    Moderate: '🟡 <i>Moderate — wait for confirmation</i>',
    Weak:     '⚪ <i>Weak signal — observe only</i>',
  };
  return { text, badge: badges[level] };
}
function fmtGrok(raw: string): string {
  if (!raw) return '';
  const { text, badge } = parseConviction(raw);
  return `\n\n🤖 <b>LiquidityAI:</b> ${text}${badge ? `\n${badge}` : ''}`;
}

/* ── Signal queue — for confluence batching ── */
interface SignalEntry { coin: string; title: string; body: string; name: string }

/* ── Coin maps ── */
const BINANCE_PERP: Record<string, string> = {
  btc: 'BTCUSDT', eth: 'ETHUSDT', sol: 'SOLUSDT',
  xrp: 'XRPUSDT', bnb: 'BNBUSDT', near: 'NEARUSDT', sui: 'SUIUSDT',
};
const BYBIT_PERP: Record<string, string> = {
  btc: 'BTCUSDT', eth: 'ETHUSDT', sol: 'SOLUSDT',
  xrp: 'XRPUSDT', bnb: 'BNBUSDT', hype: 'HYPEUSDT', near: 'NEARUSDT', sui: 'SUIUSDT',
};
const BINANCE_SPOT: Record<string, string> = {
  btc: 'BTCUSDT', eth: 'ETHUSDT', sol: 'SOLUSDT',
  xrp: 'XRPUSDT', bnb: 'BNBUSDT', near: 'NEARUSDT', sui: 'SUIUSDT',
};
/* Coins only available on Bybit — use Bybit klines for RSI / EMA / Rapid Move / OI */
const BYBIT_KLINE_SYMS: Record<string, string> = { hype: 'HYPEUSDT' };
const LABELS: Record<string, string> = {
  btc: 'BTC', eth: 'ETH', sol: 'SOL', xrp: 'XRP',
  bnb: 'BNB', hype: 'HYPE', near: 'NEAR', sui: 'SUI',
};
const COINS = Object.keys(LABELS);

const WHALE_THRESHOLD: Record<string, number> = {
  btc: 5_000_000, eth: 2_000_000, sol: 1_000_000,
  xrp: 750_000,   bnb: 750_000,  near: 500_000, sui: 500_000, hype: 500_000,
};

/* ── In-memory state ── */
const lastSent   = new Map<string, number>();
const frSignMap  = new Map<string, number>();               // FR flip detection
const rsiLastMap = new Map<string, number>();               // RSI 50 cross detection
const emaSideMap = new Map<string, 'above' | 'below'>();   // EMA 200 cross detection

const CD: Record<string, number> = {
  fr:         4 * 3600_000,
  rsi:        4 * 3600_000,
  rsi50:      6 * 3600_000,
  ema:       12 * 3600_000,
  move5m:    30 * 60_000,
  move1h:     2 * 3600_000,
  move4h:     4 * 3600_000,
  whale:     30 * 60_000,   // overridden per session in main handler
  news:      15 * 60_000,   // overridden per session in main handler
  oi:         2 * 3600_000,
  cvd:       60 * 60_000,
  fng:       23 * 3600_000,   // Fear & Greed extreme (once per day)
  daily:     23 * 3600_000,   // Daily 7am summary
  sentiment:  4 * 3600_000,   // Sentiment Extremes — all 3 indicators aligned
};

/* ── Session helpers ── */
function isHighActivity(): boolean {
  const phtHour = (new Date().getUTCHours() + 8) % 24;
  return phtHour >= 20 || phtHour < 4;
}
function getSession(): string {
  const d   = new Date();
  const pht = ((d.getUTCHours() + 8) % 24) + d.getUTCMinutes() / 60;
  if (pht >= 21.5 || pht < 4)    return '🇺🇸 NY';
  if (pht >= 15   && pht < 21.5) return '🌍 London';
  if (pht >= 8    && pht < 15)   return '🌏 Asia';
  return '😴 Off';
}
const onCooldown = (key: string, ms: number) => { const t = lastSent.get(key); return t !== undefined && Date.now() - t < ms; };
const markSent   = (key: string) => lastSent.set(key, Date.now());

/* ── Telegram send ── */
async function tg(token: string, chatId: string, text: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch { /* fire-and-forget */ }
}

/* ════════════════════════════════════════
   FLUSH — group signals by coin, send single or confluence
   ════════════════════════════════════════ */
async function flushSignals(token: string, chatId: string, stamp: string, queue: SignalEntry[]): Promise<void> {
  if (queue.length === 0) return;

  // Group by coin
  const byCoin = new Map<string, SignalEntry[]>();
  for (const e of queue) {
    const arr = byCoin.get(e.coin) ?? [];
    arr.push(e);
    byCoin.set(e.coin, arr);
  }

  await Promise.all([...byCoin.entries()].map(async ([coin, entries]) => {
    if (entries.length === 1) {
      // Single signal — send as-is
      await tg(token, chatId, entries[0].body);
      return;
    }

    // Confluence — 2+ signals on same coin
    const label   = LABELS[coin] ?? coin.toUpperCase();
    const bullets = entries.map(e => `• ${e.title}`).join('\n');
    const grokTake = await grokAnalyze(
      `Elite crypto trader. Multiple signals fired simultaneously for ${label}:\n${bullets}\n\n` +
      `In 3-4 sentences: do these signals reinforce each other or diverge? ` +
      `What is the highest-conviction trade setup right now considering all signals together? ` +
      `Direct action bias, no hedging. ` +
      `End with exactly one of: CONVICTION: High, CONVICTION: Moderate, or CONVICTION: Weak`
    );
    await tg(token, chatId,
      `🔀 <b>${label} — ${entries.length} Signals Aligned</b>\n\n` +
      `${bullets}` +
      `${fmtGrok(grokTake)}\n\n` +
      `<i>${stamp}</i>`
    );
  }));
}

/* ════════════════════════════════════════
   SHARED: Fetch funding rates + spot prices
   ════════════════════════════════════════ */
interface BNTicker { symbol: string; lastFundingRate: string }
interface BBTicker  { symbol: string; fundingRate: string }

async function fetchAllFR(): Promise<Record<string, number | null>> {
  const result: Record<string, number | null> = {};
  COINS.forEach(c => (result[c] = null));
  const [bnR, bbR] = await Promise.allSettled([
    fetch('https://fapi.binance.com/fapi/v1/premiumIndex', { cache: 'no-store' }),
    fetch('https://api.bybit.com/v5/market/tickers?category=linear', { cache: 'no-store' }),
  ]);
  if (bnR.status === 'fulfilled' && bnR.value.ok) {
    const d = await bnR.value.json() as BNTicker[];
    for (const item of d) {
      const coin = Object.entries(BINANCE_PERP).find(([, s]) => s === item.symbol)?.[0];
      if (coin) result[coin] = parseFloat(item.lastFundingRate);
    }
  }
  if (bbR.status === 'fulfilled' && bbR.value.ok) {
    const d = await bbR.value.json() as { result?: { list?: BBTicker[] } };
    for (const item of d.result?.list ?? []) {
      const coin = Object.entries(BYBIT_PERP).find(([, s]) => s === item.symbol)?.[0];
      if (coin && result[coin] == null && item.fundingRate) result[coin] = parseFloat(item.fundingRate);
    }
  }
  return result;
}

async function fetchSpotPrices(): Promise<Record<string, number>> {
  try {
    const res  = await fetch('https://api.binance.com/api/v3/ticker/price', { cache: 'no-store' });
    if (!res.ok) return {};
    const data = await res.json() as Array<{ symbol: string; price: string }>;
    const out: Record<string, number> = {};
    for (const item of data) {
      const coin = Object.entries(BINANCE_SPOT).find(([, s]) => s === item.symbol)?.[0];
      if (coin) out[coin] = parseFloat(item.price);
    }
    return out;
  } catch { return {}; }
}

/* ── Bybit klines helper (newest-first → reversed to oldest-first) ── */
async function fetchBybitKlines(symbol: string, interval: string, limit: number): Promise<number[]> {
  try {
    const res = await fetch(
      `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`,
      { cache: 'no-store' }
    );
    if (!res.ok) return [];
    const data = await res.json() as { result?: { list?: string[][] } };
    const list = data.result?.list ?? [];
    // Bybit returns newest-first — reverse so index 0 = oldest
    return list.map(c => parseFloat(c[4])).reverse();
  } catch { return []; }
}

/* ════════════════════════════════════════
   1. FR EXTREMES
   ════════════════════════════════════════ */
async function checkFRExtremes(stamp: string, frMap: Record<string, number | null>, queue: SignalEntry[]): Promise<string[]> {
  const fired: string[] = [];
  for (const coin of COINS) {
    const fr = frMap[coin];
    if (fr == null) continue;
    const pct   = (fr * 100).toFixed(4);
    const label = LABELS[coin];
    if (fr >= 0.05 && !onCooldown(`fr_long_${coin}`, CD.fr)) {
      queue.push({
        coin, name: `${label} FR long extreme`,
        title: `FR Extreme +${pct}% — Longs Overcrowded`,
        body: `🔴 <b>${label} Funding Extreme — Longs Overcrowded</b>\n\nRate: <b>+${pct}%</b>\nSignal: Longs Overcrowded — Dump Risk\nAction: Consider fading longs or tightening stops.\n\n<i>${stamp}</i>`,
      });
      markSent(`fr_long_${coin}`); fired.push(`${label} FR long extreme`);
    }
    if (fr <= -0.03 && !onCooldown(`fr_short_${coin}`, CD.fr)) {
      queue.push({
        coin, name: `${label} FR short squeeze`,
        title: `FR Extreme ${pct}% — Shorts Crowded`,
        body: `🟢 <b>${label} Short Squeeze Setup</b>\n\nRate: <b>${pct}%</b>\nSignal: Shorts Crowded — Squeeze Setup\nAction: Watch for a violent squeeze. Long bias above key level.\n\n<i>${stamp}</i>`,
      });
      markSent(`fr_short_${coin}`); fired.push(`${label} FR short squeeze`);
    }
  }
  return fired;
}

/* ════════════════════════════════════════
   2. FR DIRECTION FLIP
   ════════════════════════════════════════ */
async function checkFRFlip(stamp: string, frMap: Record<string, number | null>, queue: SignalEntry[]): Promise<string[]> {
  const fired: string[] = [];
  for (const coin of COINS) {
    const fr = frMap[coin];
    if (fr == null) continue;
    const sign     = fr > 0.001 ? 1 : fr < -0.001 ? -1 : 0;
    const lastSign = frSignMap.get(coin);
    if (sign !== 0) {
      if (lastSign !== undefined && lastSign !== 0 && sign !== lastSign) {
        const label     = LABELS[coin];
        const pct       = (fr * 100).toFixed(4);
        const flippedTo = sign > 0 ? 'Positive' : 'Negative';
        const desc      = sign > 0
          ? 'FR flipped positive — longs now paying shorts. Early bull bias forming, momentum shifting.'
          : 'FR flipped negative — shorts now paying longs. Early squeeze setup, watch for short covering.';
        queue.push({
          coin, name: `${label} FR flip to ${flippedTo}`,
          title: `FR Flipped ${flippedTo}`,
          body: `🔄 <b>${label} FR Flipped ${flippedTo}</b>\n\nRate: <b>${sign > 0 ? '+' : ''}${pct}%</b>\n${desc}\n\n<i>${stamp}</i>`,
        });
        fired.push(`${label} FR flip to ${flippedTo}`);
      }
      frSignMap.set(coin, sign);
    }
  }
  return fired;
}

/* ════════════════════════════════════════
   3. RSI (extremes + 50 cross)
   ════════════════════════════════════════ */
function computeRSI(closes: number[], period = 14): number {
  if (closes.length < period + 2) return 50;
  const ch = closes.slice(1).map((c, i) => c - closes[i]);
  let ag = 0, al = 0;
  for (let i = 0; i < period; i++) { ag += Math.max(ch[i], 0); al += Math.max(-ch[i], 0); }
  ag /= period; al /= period;
  for (let i = period; i < ch.length; i++) {
    ag = (ag * (period - 1) + Math.max(ch[i], 0)) / period;
    al = (al * (period - 1) + Math.max(-ch[i], 0)) / period;
  }
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}

function computeEMA(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1] ?? 0;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
}

async function checkRSI(stamp: string, queue: SignalEntry[]): Promise<string[]> {
  const fired: string[] = [];
  await Promise.all(COINS.map(async coin => {
    try {
      let closes: number[];
      if (BINANCE_SPOT[coin]) {
        const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${BINANCE_SPOT[coin]}&interval=1h&limit=20`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json() as Array<unknown[]>;
        closes = data.map(c => parseFloat(c[4] as string));
      } else if (BYBIT_KLINE_SYMS[coin]) {
        closes = await fetchBybitKlines(BYBIT_KLINE_SYMS[coin], '60', 20);
        if (closes.length === 0) return;
      } else {
        return;
      }
      const rsi    = computeRSI(closes);
      const r      = rsi.toFixed(1);
      const label  = LABELS[coin];
      if (rsi > 78 && !onCooldown(`rsi_ob_${coin}`, CD.rsi)) {
        queue.push({
          coin, name: `${label} RSI overbought (${r})`,
          title: `RSI Overbought ${r} (1H)`,
          body: `⚡ <b>${label} RSI Overbought (1H)</b>\n\nRSI: <b>${r}</b>\nSignal: Exhaustion — Potential Reversal\nAction: Avoid chasing longs. Watch for rejection / reversal candle.\n\n<i>${stamp}</i>`,
        });
        markSent(`rsi_ob_${coin}`); fired.push(`${label} RSI overbought (${r})`);
      }
      if (rsi < 22 && !onCooldown(`rsi_os_${coin}`, CD.rsi)) {
        queue.push({
          coin, name: `${label} RSI oversold (${r})`,
          title: `RSI Oversold ${r} (1H)`,
          body: `⚡ <b>${label} RSI Oversold (1H)</b>\n\nRSI: <b>${r}</b>\nSignal: Oversold — Bounce Setup\nAction: Watch for bounce from key support. Long bias on confirmation.\n\n<i>${stamp}</i>`,
        });
        markSent(`rsi_os_${coin}`); fired.push(`${label} RSI oversold (${r})`);
      }
      // RSI 50 centerline cross — momentum shift
      const prevRsi = rsiLastMap.get(coin);
      rsiLastMap.set(coin, rsi);
      if (prevRsi !== undefined) {
        if (prevRsi < 50 && rsi >= 50 && !onCooldown(`rsi50_bull_${coin}`, CD.rsi50)) {
          queue.push({
            coin, name: `${label} RSI 50 cross ↑`,
            title: `RSI 50 Cross ↑ — Bullish (1H)`,
            body: `📊 <b>${label} RSI Crossed 50 — Bullish (1H)</b>\n\nRSI: <b>${r}</b> (prev ${prevRsi.toFixed(1)})\nSignal: Momentum shifted bullish — potential long setup\nAction: Confirm with break above nearest resistance.\n\n<i>${stamp}</i>`,
          });
          markSent(`rsi50_bull_${coin}`); fired.push(`${label} RSI 50 cross ↑`);
        }
        if (prevRsi > 50 && rsi < 50 && !onCooldown(`rsi50_bear_${coin}`, CD.rsi50)) {
          queue.push({
            coin, name: `${label} RSI 50 cross ↓`,
            title: `RSI 50 Cross ↓ — Bearish (1H)`,
            body: `📊 <b>${label} RSI Crossed 50 — Bearish (1H)</b>\n\nRSI: <b>${r}</b> (prev ${prevRsi.toFixed(1)})\nSignal: Momentum turned bearish — potential short setup\nAction: Confirm with breakdown below nearest support.\n\n<i>${stamp}</i>`,
          });
          markSent(`rsi50_bear_${coin}`); fired.push(`${label} RSI 50 cross ↓`);
        }
      }
    } catch { /* skip */ }
  }));
  return fired;
}

/* ════════════════════════════════════════
   3b. EMA 200 CROSS (1H)
   ════════════════════════════════════════ */
async function checkEMACross(stamp: string, queue: SignalEntry[]): Promise<string[]> {
  const fired: string[] = [];
  await Promise.all(COINS.map(async coin => {
    try {
      let closes: number[];
      if (BINANCE_SPOT[coin]) {
        const res = await fetch(
          `https://api.binance.com/api/v3/klines?symbol=${BINANCE_SPOT[coin]}&interval=1h&limit=300`,
          { cache: 'no-store' }
        );
        if (!res.ok) return;
        const data = await res.json() as Array<unknown[]>;
        closes = data.map(c => parseFloat(c[4] as string));
      } else if (BYBIT_KLINE_SYMS[coin]) {
        closes = await fetchBybitKlines(BYBIT_KLINE_SYMS[coin], '60', 300);
        if (closes.length === 0) return;
      } else {
        return;
      }
      if (closes.length < 200) return;

      const ema200   = computeEMA(closes, 200);
      const price    = closes[closes.length - 1];
      const side     = price > ema200 ? 'above' : 'below';
      const lastSide = emaSideMap.get(coin);
      emaSideMap.set(coin, side);
      if (!lastSide || lastSide === side) return;

      const label    = LABELS[coin];
      const priceFmt = price.toLocaleString();
      const emaFmt   = ema200.toLocaleString();

      if (side === 'above' && !onCooldown(`ema_bull_${coin}`, CD.ema)) {
        const grokTake = await grokAnalyze(
          `Elite crypto trader. ${label} price just crossed above its 200-period EMA on the 1H chart. ` +
          `Price: $${priceFmt}, EMA(200): $${emaFmt}. ` +
          `In 2-3 sentences: valid bullish reclaim or false breakout? What confluence confirms? Direct, no hedging. ` +
          `End with exactly one of: CONVICTION: High, CONVICTION: Moderate, or CONVICTION: Weak`);
        queue.push({
          coin, name: `${label} crossed above 200 EMA`,
          title: `200 EMA Cross ↑ (1H)`,
          body: `📈 <b>${label} Crossed Above 200 EMA (1H)</b>\n\n` +
            `Price: <b>$${priceFmt}</b> | EMA(200): $${emaFmt}\n` +
            `Signal: Bullish — price reclaimed major moving average\n` +
            `Action: Watch for EMA retest as support and higher-high confirmation.` +
            `${fmtGrok(grokTake)}\n\n<i>${stamp}</i>`,
        });
        markSent(`ema_bull_${coin}`); fired.push(`${label} crossed above 200 EMA`);
      }
      if (side === 'below' && !onCooldown(`ema_bear_${coin}`, CD.ema)) {
        const grokTake = await grokAnalyze(
          `Elite crypto trader. ${label} price just crossed below its 200-period EMA on the 1H chart. ` +
          `Price: $${priceFmt}, EMA(200): $${emaFmt}. ` +
          `In 2-3 sentences: genuine bearish breakdown or fake-out? What to watch for? Direct, no hedging. ` +
          `End with exactly one of: CONVICTION: High, CONVICTION: Moderate, or CONVICTION: Weak`);
        queue.push({
          coin, name: `${label} crossed below 200 EMA`,
          title: `200 EMA Cross ↓ (1H)`,
          body: `📉 <b>${label} Crossed Below 200 EMA (1H)</b>\n\n` +
            `Price: <b>$${priceFmt}</b> | EMA(200): $${emaFmt}\n` +
            `Signal: Bearish — price lost major moving average\n` +
            `Action: Watch for failed EMA retest as resistance and lower-low confirmation.` +
            `${fmtGrok(grokTake)}\n\n<i>${stamp}</i>`,
        });
        markSent(`ema_bear_${coin}`); fired.push(`${label} crossed below 200 EMA`);
      }
    } catch { /* skip */ }
  }));
  return fired;
}

/* ════════════════════════════════════════
   3c. RAPID PRICE MOVE (5m / 1H / 4H)
   ════════════════════════════════════════ */
async function checkRapidMove(stamp: string, queue: SignalEntry[]): Promise<string[]> {
  const fired: string[] = [];
  const FRAMES = [
    { interval: '5m',  bybitInterval: '5',   threshold: 4,  cd: 'move5m', tfLabel: '5m' },
    { interval: '1h',  bybitInterval: '60',  threshold: 5,  cd: 'move1h', tfLabel: '1H' },
    { interval: '4h',  bybitInterval: '240', threshold: 10, cd: 'move4h', tfLabel: '4H' },
  ] as const;

  await Promise.all(
    COINS.flatMap(coin =>
      FRAMES.map(async ({ interval, bybitInterval, threshold, cd, tfLabel }) => {
        try {
          let prevClose: number, currClose: number;
          let patternStr = '';
          if (BINANCE_SPOT[coin]) {
            const res = await fetch(
              `https://api.binance.com/api/v3/klines?symbol=${BINANCE_SPOT[coin]}&interval=${interval}&limit=25`,
              { cache: 'no-store' }
            );
            if (!res.ok) return;
            const data = await res.json() as Array<unknown[]>;
            if (data.length < 2) return;
            prevClose = parseFloat(data[data.length - 2][4] as string);
            currClose = parseFloat(data[data.length - 1][4] as string);
            // Detect patterns from OHLC
            const ohlc = data.map(k => ({ o: parseFloat(k[1] as string), h: parseFloat(k[2] as string), l: parseFloat(k[3] as string), c: parseFloat(k[4] as string) }));
            const pats = detectPatterns(ohlc);
            if (pats.length > 0) patternStr = pats[0]; // show first pattern
          } else if (BYBIT_KLINE_SYMS[coin]) {
            const closes = await fetchBybitKlines(BYBIT_KLINE_SYMS[coin], bybitInterval, 25);
            if (closes.length < 2) return;
            prevClose = closes[closes.length - 2];
            currClose = closes[closes.length - 1];
          } else {
            return;
          }
          if (prevClose === 0) return;
          const pct = (currClose - prevClose) / prevClose * 100;
          if (Math.abs(pct) < threshold) return;

          const label = LABELS[coin];
          const dir   = pct > 0 ? 'up' : 'down';
          const key   = `move_${dir}_${interval}_${coin}`;
          if (onCooldown(key, CD[cd])) return;

          const sign     = pct > 0 ? '+' : '';
          const emoji    = pct > 0 ? '🚀' : '🔻';
          const grokTake = await grokAnalyze(
            `Elite crypto trader. ${label} just moved ${sign}${pct.toFixed(1)}% in one ${tfLabel} candle. ` +
            `Current price: $${currClose.toLocaleString()}. ` +
            `In 2-3 sentences: genuine breakout/breakdown or spike reversal? What to watch next candle? Direct, no hedging. ` +
            `End with exactly one of: CONVICTION: High, CONVICTION: Moderate, or CONVICTION: Weak`);

          queue.push({
            coin, name: `${label} rapid ${dir} ${sign}${pct.toFixed(1)}% (${tfLabel})`,
            title: `Rapid ${pct > 0 ? 'Pump' : 'Dump'} ${sign}${pct.toFixed(1)}% (${tfLabel})`,
            body: `${emoji} <b>${label} Rapid ${pct > 0 ? 'Pump' : 'Dump'} ${sign}${pct.toFixed(1)}% (${tfLabel})</b>\n\n` +
              `Price: <b>$${currClose.toLocaleString()}</b>\n` +
              `Signal: ${Math.abs(pct).toFixed(1)}% candle — ${pct > 0 ? 'momentum surge' : 'flash dump'}\n` +
              (patternStr ? `Pattern: <b>${patternStr}</b>\n` : '') +
              `Action: Check volume + OI. Next candle direction is key.` +
              `${fmtGrok(grokTake)}\n\n<i>${stamp}</i>`,
          });
          markSent(key); fired.push(`${label} rapid ${dir} ${sign}${pct.toFixed(1)}% (${tfLabel})`);
        } catch { /* skip */ }
      })
    )
  );
  return fired;
}

/* ════════════════════════════════════════
   4. WHALE TRADES
   ════════════════════════════════════════ */
interface AggTrade { T: number; p: string; q: string; m: boolean }

async function checkWhales(stamp: string, queue: SignalEntry[]): Promise<string[]> {
  const fired: string[] = [];
  const since = Date.now() - 5 * 60_000;
  await Promise.all([
    // ── Binance perp coins ──
    ...Object.entries(BINANCE_PERP).map(async ([coin, sym]) => {
      const threshold = WHALE_THRESHOLD[coin];
      if (!threshold) return;
      try {
        const res    = await fetch(`https://fapi.binance.com/fapi/v1/aggTrades?symbol=${sym}&startTime=${since}&limit=500`, { cache: 'no-store' });
        if (!res.ok) return;
        const trades = await res.json() as AggTrade[];
        const label  = LABELS[coin];
        for (const t of trades) {
          const usd = parseFloat(t.p) * parseFloat(t.q);
          if (usd < threshold) continue;
          const side = t.m ? 'SELL' : 'BUY';
          const key  = `whale_${coin}_${side}`;
          if (onCooldown(key, CD.whale)) continue;
          const usdFmt   = usd >= 1_000_000 ? `$${(usd / 1_000_000).toFixed(2)}M` : `$${(usd / 1000).toFixed(0)}K`;
          const priceStr = parseFloat(t.p).toLocaleString();
          const grokTake = await grokAnalyze(
            `Elite crypto trader. A whale just ${side === 'BUY' ? 'bought' : 'sold'} ${usdFmt} of ${label} at $${priceStr}. ` +
            `In 2-3 sentences: short-term (1-4h) market impact? Worth acting on now or wait for confirmation? Direct, no hedging. ` +
            `End with exactly one of: CONVICTION: High, CONVICTION: Moderate, or CONVICTION: Weak`);
          queue.push({
            coin, name: `${label} whale ${side} ${usdFmt}`,
            title: `Whale ${side} ${usdFmt}`,
            body: side === 'BUY'
              ? `🐋 <b>${label} Whale BUY Detected</b>\n\nSize: <b>${usdFmt}</b> at $${priceStr}\nSignal: Large aggressive buy — institutional accumulation${fmtGrok(grokTake)}\n\n<i>${stamp}</i>`
              : `🐋 <b>${label} Whale SELL Detected</b>\n\nSize: <b>${usdFmt}</b> at $${priceStr}\nSignal: Large aggressive sell — institutional distribution${fmtGrok(grokTake)}\n\n<i>${stamp}</i>`,
          });
          markSent(key); fired.push(`${label} whale ${side} ${usdFmt}`); break;
        }
      } catch { /* skip */ }
    }),
    // ── Bybit-only coins (HYPE) ──
    ...Object.entries(BYBIT_KLINE_SYMS).map(async ([coin, sym]) => {
      const threshold = WHALE_THRESHOLD[coin];
      if (!threshold) return;
      try {
        const res = await fetch(
          `https://api.bybit.com/v5/market/recent-trade?category=linear&symbol=${sym}&limit=1000`,
          { cache: 'no-store' }
        );
        if (!res.ok) return;
        const data = await res.json() as { result?: { list?: Array<{ T: number; p: string; v: string; S: string }> } };
        const trades = (data.result?.list ?? []).filter(t => t.T >= since);
        const label  = LABELS[coin];
        for (const t of trades) {
          const usd = parseFloat(t.p) * parseFloat(t.v);
          if (usd < threshold) continue;
          const side = t.S === 'Buy' ? 'BUY' : 'SELL';
          const key  = `whale_${coin}_${side}`;
          if (onCooldown(key, CD.whale)) continue;
          const usdFmt   = usd >= 1_000_000 ? `$${(usd / 1_000_000).toFixed(2)}M` : `$${(usd / 1000).toFixed(0)}K`;
          const priceStr = parseFloat(t.p).toLocaleString();
          const grokTake = await grokAnalyze(
            `Elite crypto trader. A whale just ${side === 'BUY' ? 'bought' : 'sold'} ${usdFmt} of ${label} at $${priceStr}. ` +
            `In 2-3 sentences: short-term (1-4h) market impact? Worth acting on now or wait for confirmation? Direct, no hedging. ` +
            `End with exactly one of: CONVICTION: High, CONVICTION: Moderate, or CONVICTION: Weak`);
          queue.push({
            coin, name: `${label} whale ${side} ${usdFmt}`,
            title: `Whale ${side} ${usdFmt}`,
            body: side === 'BUY'
              ? `🐋 <b>${label} Whale BUY Detected</b>\n\nSize: <b>${usdFmt}</b> at $${priceStr}\nSignal: Large aggressive buy — institutional accumulation${fmtGrok(grokTake)}\n\n<i>${stamp}</i>`
              : `🐋 <b>${label} Whale SELL Detected</b>\n\nSize: <b>${usdFmt}</b> at $${priceStr}\nSignal: Large aggressive sell — institutional distribution${fmtGrok(grokTake)}\n\n<i>${stamp}</i>`,
          });
          markSent(key); fired.push(`${label} whale ${side} ${usdFmt}`); break;
        }
      } catch { /* skip */ }
    }),
  ]);
  return fired;
}

/* ════════════════════════════════════════
   5. BREAKING NEWS (global — stays direct, no coin grouping)
   ════════════════════════════════════════ */
interface FinnhubItem { id: number; headline: string; datetime: number; source: string }
const FINNHUB_KEY = process.env.FINNHUB_KEY ?? '';

async function checkNews(token: string, chatId: string, stamp: string): Promise<string[]> {
  const fired: string[] = [];
  const since = Math.floor(Date.now() / 1000) - 600;
  try {
    const [cryptoR, generalR] = await Promise.allSettled([
      fetch(`https://finnhub.io/api/v1/news?category=crypto&token=${FINNHUB_KEY}`, { cache: 'no-store' }),
      fetch(`https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_KEY}`, { cache: 'no-store' }),
    ]);
    const items: FinnhubItem[] = [];
    if (cryptoR.status === 'fulfilled' && cryptoR.value.ok) {
      const d = await cryptoR.value.json() as FinnhubItem[];
      items.push(...d.filter(n => n.datetime >= since));
    }
    if (generalR.status === 'fulfilled' && generalR.value.ok) {
      const d = await generalR.value.json() as FinnhubItem[];
      items.push(...d.filter(n => n.datetime >= since && classifyNews(n.headline) === 'red'));
    }
    for (const item of items) {
      const type = classifyNews(item.headline);
      if (!type || type === 'purple') continue;
      const key = `news_${item.id}`;
      if (onCooldown(key, CD.news)) continue;
      const emoji    = type === 'red' ? '🚨' : '📊';
      const label    = type === 'red' ? 'Breaking Alert' : 'Macro Alert';
      const grokTake = await grokAnalyze(
        `Elite crypto trader. Breaking news: "${item.headline}". In 2-3 sentences: short-term (1-4h) crypto market impact? What should a trader watch for right now? Direct, no hedging. ` +
        `End with exactly one of: CONVICTION: High, CONVICTION: Moderate, or CONVICTION: Weak`);
      const grokLine = fmtGrok(grokTake);
      await tg(token, chatId, `${emoji} <b>${label}</b>\n\n<b>${item.headline}</b>\nSource: ${item.source}${grokLine}\n\n<i>${stamp}</i>`);
      markSent(key); fired.push(`news: ${item.headline.slice(0, 50)}`);
    }
  } catch { /* skip */ }
  return fired;
}

/* ════════════════════════════════════════
   6. OI SPIKE (+15% in 1h)
   ════════════════════════════════════════ */
interface OIHistItem { sumOpenInterest: string; timestamp: number }

async function checkOISpike(stamp: string, prices: Record<string, number>, queue: SignalEntry[]): Promise<string[]> {
  const fired: string[] = [];
  await Promise.all([
    // ── Binance perp coins ──
    ...Object.entries(BINANCE_PERP).map(async ([coin, sym]) => {
    try {
      const res = await fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${sym}&period=5m&limit=13`, { cache: 'no-store' });
      if (!res.ok) return;
      const data  = await res.json() as OIHistItem[];
      if (data.length < 12) return;
      const oldest = parseFloat(data[0].sumOpenInterest);
      const newest = parseFloat(data[data.length - 1].sumOpenInterest);
      if (oldest === 0) return;
      const pct   = (newest - oldest) / oldest * 100;
      const label = LABELS[coin];
      const price = prices[coin];

      if (Math.abs(pct) >= 15) {
        const dir = pct > 0 ? 'spike' : 'drop';
        const key = `oi_${dir}_${coin}`;
        if (onCooldown(key, CD.oi)) return;

        const grokTake = await grokAnalyze(
          `Elite crypto trader. ${label} Open Interest just ${pct > 0 ? 'spiked +' : 'dropped '}${pct.toFixed(1)}% in 1 hour.` +
          (price ? ` Current price: $${price.toLocaleString()}.` : '') +
          ` In 2-3 sentences: Is this new longs, new shorts, or liquidation-driven? What's the likely next move? Direct, no hedging. ` +
          `End with exactly one of: CONVICTION: High, CONVICTION: Moderate, or CONVICTION: Weak`);
        const grokLine = fmtGrok(grokTake);

        queue.push({
          coin, name: `${label} OI ${dir} ${pct.toFixed(1)}%`,
          title: `OI ${pct > 0 ? 'Spike' : 'Drop'} ${pct > 0 ? '+' : ''}${pct.toFixed(1)}% (1h)`,
          body: `📈 <b>${label} OI ${pct > 0 ? 'Spike' : 'Drop'} — ${pct > 0 ? '+' : ''}${pct.toFixed(1)}% in 1h</b>\n\n` +
            `OI changed from ${(oldest / 1000).toFixed(1)}K to ${(newest / 1000).toFixed(1)}K contracts\n` +
            `Signal: ${pct > 0 ? 'New money entering — big move likely building' : 'Positions closing — potential trend reversal'}` +
            `${grokLine}\n\n<i>${stamp}</i>`,
        });
        markSent(key); fired.push(`${label} OI ${dir} ${pct.toFixed(1)}%`);
      }
    } catch { /* skip */ }
    }),
    // ── Bybit-only coins (HYPE) ──
    ...Object.entries(BYBIT_KLINE_SYMS).map(async ([coin, sym]) => {
      try {
        const res = await fetch(
          `https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${sym}&intervalTime=5min&limit=13`,
          { cache: 'no-store' }
        );
        if (!res.ok) return;
        const data = await res.json() as { result?: { list?: Array<{ openInterest: string }> } };
        const list = data.result?.list ?? [];
        if (list.length < 12) return;
        // Bybit returns newest-first
        const newest = parseFloat(list[0].openInterest);
        const oldest = parseFloat(list[list.length - 1].openInterest);
        if (oldest === 0) return;
        const pct   = (newest - oldest) / oldest * 100;
        const label = LABELS[coin];
        const price = prices[coin];
        if (Math.abs(pct) >= 15) {
          const dir = pct > 0 ? 'spike' : 'drop';
          const key = `oi_${dir}_${coin}`;
          if (onCooldown(key, CD.oi)) return;
          const grokTake = await grokAnalyze(
            `Elite crypto trader. ${label} Open Interest just ${pct > 0 ? 'spiked +' : 'dropped '}${pct.toFixed(1)}% in 1 hour.` +
            (price ? ` Current price: $${price.toLocaleString()}.` : '') +
            ` In 2-3 sentences: Is this new longs, new shorts, or liquidation-driven? What's the likely next move? Direct, no hedging. ` +
            `End with exactly one of: CONVICTION: High, CONVICTION: Moderate, or CONVICTION: Weak`);
          queue.push({
            coin, name: `${label} OI ${dir} ${pct.toFixed(1)}%`,
            title: `OI ${pct > 0 ? 'Spike' : 'Drop'} ${pct > 0 ? '+' : ''}${pct.toFixed(1)}% (1h)`,
            body: `📈 <b>${label} OI ${pct > 0 ? 'Spike' : 'Drop'} — ${pct > 0 ? '+' : ''}${pct.toFixed(1)}% in 1h</b>\n\n` +
              `OI: ${(oldest / 1000).toFixed(1)}K → ${(newest / 1000).toFixed(1)}K contracts\n` +
              `Signal: ${pct > 0 ? 'New money entering — big move likely building' : 'Positions closing — potential trend reversal'}` +
              `${fmtGrok(grokTake)}\n\n<i>${stamp}</i>`,
          });
          markSent(key); fired.push(`${label} OI ${dir} ${pct.toFixed(1)}%`);
        }
      } catch { /* skip */ }
    }),
  ]);
  return fired;
}

/* ════════════════════════════════════════
   7. CVD DIVERGENCE
   ════════════════════════════════════════ */
interface TakerVolItem { buyVol: string; sellVol: string; timestamp: number }

async function checkCVD(stamp: string, queue: SignalEntry[]): Promise<string[]> {
  const fired: string[] = [];
  await Promise.all(Object.entries(BINANCE_PERP).map(async ([coin, sym]) => {
    try {
      const [kRes, tvRes] = await Promise.allSettled([
        fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1h&limit=2`, { cache: 'no-store' }),
        fetch(`https://fapi.binance.com/futures/data/takerBuySellVol?symbol=${sym}&period=5m&limit=12`, { cache: 'no-store' }),
      ]);
      if (kRes.status !== 'fulfilled' || !kRes.value.ok) return;
      if (tvRes.status !== 'fulfilled' || !tvRes.value.ok) return;

      const klines  = await kRes.value.json() as Array<unknown[]>;
      const tvData  = await tvRes.value.json() as TakerVolItem[];
      if (klines.length < 2 || tvData.length < 6) return;

      const prevClose      = parseFloat(klines[0][4] as string);
      const currClose      = parseFloat(klines[1][4] as string);
      const priceChangePct = (currClose - prevClose) / prevClose * 100;

      let totalBuy = 0, totalSell = 0;
      for (const item of tvData) { totalBuy += parseFloat(item.buyVol); totalSell += parseFloat(item.sellVol); }
      const netCVD = totalBuy - totalSell;
      const label  = LABELS[coin];
      const THRESH = 1.5;

      if (priceChangePct > THRESH && netCVD < 0 && !onCooldown(`cvd_bear_${coin}`, CD.cvd)) {
        queue.push({
          coin, name: `${label} bearish CVD divergence`,
          title: `Bearish CVD Divergence`,
          body: `⚠️ <b>${label} Bearish CVD Divergence</b>\n\nPrice: <b>+${priceChangePct.toFixed(1)}%</b> in 1h\nCVD: <b>Negative</b> — sellers dominating volume\nSignal: Price pump not supported by buying — likely a fake move\nAction: Avoid chasing longs. Watch for reversal.\n\n<i>${stamp}</i>`,
        });
        markSent(`cvd_bear_${coin}`); fired.push(`${label} bearish CVD divergence`);
      }
      if (priceChangePct < -THRESH && netCVD > 0 && !onCooldown(`cvd_bull_${coin}`, CD.cvd)) {
        queue.push({
          coin, name: `${label} bullish CVD divergence`,
          title: `Bullish CVD Divergence`,
          body: `⚡ <b>${label} Bullish CVD Divergence</b>\n\nPrice: <b>${priceChangePct.toFixed(1)}%</b> in 1h\nCVD: <b>Positive</b> — buyers absorbing the dip\nSignal: Price drop not matched by sell volume — accumulation signal\nAction: Watch for bounce from key support.\n\n<i>${stamp}</i>`,
        });
        markSent(`cvd_bull_${coin}`); fired.push(`${label} bullish CVD divergence`);
      }
    } catch { /* skip */ }
  }));
  return fired;
}

/* ════════════════════════════════════════
   8. PRICE ALERTS (user-set, Supabase)
   ════════════════════════════════════════ */
interface PriceAlert { id: number; coin: string; target_price: number; direction: string; label: string }

async function checkPriceAlerts(stamp: string, prices: Record<string, number>, queue: SignalEntry[]): Promise<string[]> {
  const db = getSupabase();
  if (!db) return [];
  const fired: string[] = [];
  try {
    const { data: alerts } = await db.from('price_alerts').select('*').eq('active', true);
    if (!alerts?.length) return [];
    for (const alert of alerts as PriceAlert[]) {
      const price = prices[alert.coin];
      if (price == null) continue;
      const triggered =
        (alert.direction === 'above' && price >= alert.target_price) ||
        (alert.direction === 'below' && price <= alert.target_price);
      if (!triggered) continue;

      const label    = LABELS[alert.coin] ?? alert.coin.toUpperCase();
      const dirLabel = alert.direction === 'above' ? '📈 Crossed Above' : '📉 Crossed Below';
      const grokTake = await grokAnalyze(
        `Elite crypto trader. ${label} just hit $${alert.target_price.toLocaleString()} (now $${price.toLocaleString()}).` +
        (alert.label ? ` Saved alert: "${alert.label}".` : '') +
        ` In 2-3 sentences: Is this a valid entry/exit level right now? What to watch for to confirm? Direct, no hedging. ` +
        `End with exactly one of: CONVICTION: High, CONVICTION: Moderate, or CONVICTION: Weak`);
      const grokLine = fmtGrok(grokTake);

      queue.push({
        coin: alert.coin, name: `${label} price alert at $${alert.target_price.toLocaleString()}`,
        title: `Price Alert ${dirLabel.replace(/📈 |📉 /, '')} $${alert.target_price.toLocaleString()}`,
        body: `🎯 <b>${label} Price Alert Triggered</b>\n\n` +
          `${dirLabel} <b>$${alert.target_price.toLocaleString()}</b>\n` +
          `Current: $${price.toLocaleString()}` +
          (alert.label ? `\nNote: ${alert.label}` : '') +
          `${grokLine}\n\n<i>${stamp}</i>`,
      });

      // Deactivate immediately — don't wait for flush
      await db.from('price_alerts').update({ active: false, triggered_at: new Date().toISOString() }).eq('id', alert.id);
      fired.push(`${label} price alert at $${alert.target_price.toLocaleString()}`);
    }
  } catch { /* skip */ }
  return fired;
}

/* ════════════════════════════════════════
   9. FEAR & GREED EXTREME
   ════════════════════════════════════════ */
interface FNGData { value: string; value_classification: string }

async function checkFearGreed(token: string, chatId: string, stamp: string): Promise<string[]> {
  const fired: string[] = [];
  try {
    const res  = await fetch('https://api.alternative.me/fng/', { cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json() as { data: FNGData[] };
    const val  = parseInt(json.data?.[0]?.value ?? '50');
    const cls  = json.data?.[0]?.value_classification ?? '';
    if (isNaN(val)) return [];

    if (val <= 15 && !onCooldown('fng_fear', CD.fng)) {
      await tg(token, chatId,
        `🩸 <b>Extreme Fear — Fear &amp; Greed: ${val}</b>\n\n` +
        `Classification: <b>${cls}</b>\n` +
        `Signal: Market in panic — historically a contrarian accumulation zone\n` +
        `Action: Watch for capitulation candle + volume spike as entry signal.\n\n` +
        `<i>${stamp}</i>`);
      markSent('fng_fear'); fired.push(`Fear & Greed extreme fear (${val})`);
    }
    if (val >= 85 && !onCooldown('fng_greed', CD.fng)) {
      await tg(token, chatId,
        `🔥 <b>Extreme Greed — Fear &amp; Greed: ${val}</b>\n\n` +
        `Classification: <b>${cls}</b>\n` +
        `Signal: Market euphoria — historically a distribution zone\n` +
        `Action: Consider tightening stops and reducing position size.\n\n` +
        `<i>${stamp}</i>`);
      markSent('fng_greed'); fired.push(`Fear & Greed extreme greed (${val})`);
    }
  } catch { /* skip */ }
  return fired;
}

/* ════════════════════════════════════════
   10. DAILY 7AM PHT SUMMARY
   ════════════════════════════════════════ */
async function checkDailySummary(
  token: string, chatId: string, stamp: string,
  frMap: Record<string, number | null>
): Promise<string[]> {
  const d       = new Date();
  const phtHour = (d.getUTCHours() + 8) % 24;
  const phtMin  = d.getUTCMinutes();
  if (phtHour !== 7 || phtMin > 10) return [];
  if (onCooldown('daily_summary', CD.daily)) return [];

  const dateStr = d.toLocaleString('en-PH', {
    timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric',
  });

  // Fear & Greed
  let fngLine    = '';
  let fngForGrok = '';
  try {
    const fngRes = await fetch('https://api.alternative.me/fng/', { cache: 'no-store' });
    if (fngRes.ok) {
      const fngJson = await fngRes.json() as { data: FNGData[] };
      const val = fngJson.data?.[0]?.value;
      const cls = fngJson.data?.[0]?.value_classification;
      if (val) { fngLine = `\n😨 F&amp;G: <b>${val}</b> (${cls})`; fngForGrok = `Fear & Greed: ${val} (${cls}). `; }
    }
  } catch { /* skip */ }

  // Funding rates — two rows of 4
  const frParts = COINS.map(coin => {
    const fr = frMap[coin];
    if (fr == null) return null;
    const sign = fr >= 0 ? '+' : '';
    return `${LABELS[coin]} ${sign}${(fr * 100).toFixed(4)}%`;
  }).filter(Boolean) as string[];
  const frBlock    = [frParts.slice(0, 4).join(' · '), frParts.slice(4).join(' · ')].filter(Boolean).join('\n');
  const frForGrok  = frParts.join(', ');

  // Active price alerts
  let alertsBlock = '';
  try {
    const db = getSupabase();
    if (db) {
      const { data } = await db.from('price_alerts').select('*').eq('active', true);
      if (data?.length) {
        const lines = (data as PriceAlert[]).map(a => {
          const lbl = LABELS[a.coin] ?? a.coin.toUpperCase();
          const dir = a.direction === 'above' ? '↑' : '↓';
          return `• ${lbl} ${dir} $${parseFloat(String(a.target_price)).toLocaleString()}${a.label ? ` (${a.label})` : ''}`;
        }).join('\n');
        alertsBlock = `\n\n🎯 <b>Active Price Alerts:</b>\n${lines}`;
      }
    }
  } catch { /* skip */ }

  // Grok daily outlook (no conviction label — this is an overview, not a signal)
  const grokRaw  = await grokAnalyze(
    `Elite crypto trader. Morning briefing for ${dateStr}. ` +
    fngForGrok +
    `Funding rates: ${frForGrok}. ` +
    `In 2-3 sentences: overall market bias today and which 1-2 coins look most interesting to watch? ` +
    `Direct and actionable. No conviction label needed.`
  );
  const grokLine = grokRaw ? `\n\n🤖 <b>LiquidityAI:</b> ${grokRaw}` : '';

  await tg(token, chatId,
    `☀️ <b>Morning Briefing — ${dateStr}</b>` +
    `${fngLine}\n\n` +
    `📊 <b>Funding Rates:</b>\n${frBlock}` +
    `${grokLine}` +
    `${alertsBlock}\n\n` +
    `<i>${stamp}</i>`
  );

  markSent('daily_summary');
  return ['Daily 7am summary'];
}

/* ════════════════════════════════════════
   11. SENTIMENT EXTREMES (#20)
   Fires when F&G + BTC funding rate + BTC L/S ratio all hit extremes together
   ════════════════════════════════════════ */
interface LSItem { longShortRatio: string; longAccount: string; shortAccount: string }

async function checkSentimentExtremes(
  token: string, chatId: string, stamp: string,
  frMap: Record<string, number | null>
): Promise<string[]> {
  const fired: string[] = [];
  try {
    const btcFR = frMap['btc'];
    if (btcFR == null) return [];

    // Fetch F&G and BTC L/S ratio in parallel
    const [fngR, lsR] = await Promise.allSettled([
      fetch('https://api.alternative.me/fng/', { cache: 'no-store' }),
      fetch('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1', { cache: 'no-store' }),
    ]);

    if (fngR.status !== 'fulfilled' || !fngR.value.ok) return [];
    if (lsR.status  !== 'fulfilled' || !lsR.value.ok)  return [];

    const fngJson = await fngR.value.json() as { data: FNGData[] };
    const fng     = parseInt(fngJson.data?.[0]?.value ?? '50');
    const fngCls  = fngJson.data?.[0]?.value_classification ?? '';
    if (isNaN(fng)) return [];

    const lsData  = await lsR.value.json() as LSItem[];
    if (!lsData?.length) return [];
    const longPct  = parseFloat(lsData[0].longAccount) * 100;   // e.g. 60.87
    const shortPct = 100 - longPct;
    const frPct    = btcFR * 100;

    // ── BEARISH EXTREME: F&G greedy + FR long-heavy + L/S long-heavy ──
    // All 3 screaming "longs are overcrowded" → dump risk is elevated
    if (fng >= 75 && frPct >= 0.04 && longPct >= 60 && !onCooldown('sentiment_bear', CD.sentiment)) {
      const grokTake = await grokAnalyze(
        `Elite crypto trader. All 3 sentiment indicators are simultaneously at BEARISH extremes: ` +
        `Fear & Greed ${fng} (${fngCls}), BTC Funding Rate +${frPct.toFixed(4)}% (longs overcrowded), ` +
        `BTC L/S Ratio ${longPct.toFixed(1)}% long (overleveraged longs). ` +
        `In 3-4 sentences: How severe is this risk? Should a trader reduce longs or set tight stops? ` +
        `Direct, no hedging. End with: CONVICTION: High, CONVICTION: Moderate, or CONVICTION: Weak`
      );
      await tg(token, chatId,
        `🚨 <b>Sentiment Extremes — ALL 3 BEARISH</b>\n\n` +
        `😱 F&amp;G: <b>${fng}</b> (${fngCls})\n` +
        `💸 BTC FR: <b>+${frPct.toFixed(4)}%</b> — Longs overcrowded\n` +
        `📊 L/S Ratio: <b>${longPct.toFixed(1)}% Long</b> / ${shortPct.toFixed(1)}% Short\n\n` +
        `Signal: All 3 sentiment gauges at extremes — <b>long flush risk elevated</b>\n` +
        `Action: Tighten stops on longs. Do NOT add longs into this setup.` +
        `${fmtGrok(grokTake)}\n\n` +
        `<i>${stamp}</i>`
      );
      markSent('sentiment_bear');
      fired.push(`Sentiment extremes — bearish (F&G ${fng}, FR +${frPct.toFixed(4)}%, Long ${longPct.toFixed(0)}%)`);
    }

    // ── BULLISH EXTREME (contrarian): F&G fearful + FR short-heavy + L/S short-heavy ──
    // All 3 screaming "shorts are overcrowded" → squeeze / reversal risk
    if (fng <= 25 && frPct <= -0.02 && longPct <= 40 && !onCooldown('sentiment_bull', CD.sentiment)) {
      const grokTake = await grokAnalyze(
        `Elite crypto trader. All 3 sentiment indicators are simultaneously at CONTRARIAN BULLISH extremes: ` +
        `Fear & Greed ${fng} (${fngCls}) — extreme fear, BTC Funding Rate ${frPct.toFixed(4)}% (shorts paying), ` +
        `BTC L/S Ratio ${longPct.toFixed(1)}% long / ${shortPct.toFixed(1)}% short (overleveraged shorts). ` +
        `In 3-4 sentences: Is this genuine capitulation or a dead-cat bounce zone? ` +
        `What confirms this as a valid reversal entry? Direct, no hedging. End with: CONVICTION: High, CONVICTION: Moderate, or CONVICTION: Weak`
      );
      await tg(token, chatId,
        `🟢 <b>Sentiment Extremes — Contrarian BULLISH Setup</b>\n\n` +
        `😨 F&amp;G: <b>${fng}</b> (${fngCls})\n` +
        `💸 BTC FR: <b>${frPct.toFixed(4)}%</b> — Shorts paying\n` +
        `📊 L/S Ratio: <b>${longPct.toFixed(1)}% Long</b> / ${shortPct.toFixed(1)}% Short\n\n` +
        `Signal: All 3 sentiment gauges at fear extremes — <b>potential contrarian reversal zone</b>\n` +
        `Action: Watch for capitulation candle + volume spike before entering long.` +
        `${fmtGrok(grokTake)}\n\n` +
        `<i>${stamp}</i>`
      );
      markSent('sentiment_bull');
      fired.push(`Sentiment extremes — contrarian bullish (F&G ${fng}, FR ${frPct.toFixed(4)}%, Long ${longPct.toFixed(0)}%)`);
    }
  } catch { /* skip */ }
  return fired;
}

/* ════════════════════════════════════════
   MAIN HANDLER
   ════════════════════════════════════════ */
export async function GET() {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId)
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set' }, { status: 503 });

  // Session-based cooldowns — tighter during pre-NY + NY (8pm–4am PHT)
  const nyActive = isHighActivity();
  CD.whale = nyActive ? 5 * 60_000  : 30 * 60_000;
  CD.news  = nyActive ? 5 * 60_000  : 15 * 60_000;

  const now   = new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' });
  const stamp = `⏰ ${now} PHT · ${getSession()}`;

  // Fetch shared data once
  const [frMap, prices] = await Promise.all([fetchAllFR(), fetchSpotPrices()]);

  // Per-request signal queue — all coin checks push here, flushed after
  const signalQueue: SignalEntry[] = [];

  const results = await Promise.allSettled([
    checkFRExtremes(stamp, frMap, signalQueue),
    checkFRFlip(stamp, frMap, signalQueue),
    checkRSI(stamp, signalQueue),
    checkEMACross(stamp, signalQueue),
    checkRapidMove(stamp, signalQueue),
    checkWhales(stamp, signalQueue),
    checkNews(token, chatId, stamp),                       // global — sends directly
    checkFearGreed(token, chatId, stamp),                  // global — sends directly
    checkDailySummary(token, chatId, stamp, frMap),        // global — sends directly
    checkOISpike(stamp, prices, signalQueue),
    checkCVD(stamp, signalQueue),
    checkPriceAlerts(stamp, prices, signalQueue),
    checkSentimentExtremes(token, chatId, stamp, frMap),   // global — sends directly
  ]);

  // Flush: single signals → send as-is, 2+ same coin → confluence alert
  await flushSignals(token, chatId, stamp, signalQueue);

  const fired = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

  return NextResponse.json({
    ok: true, fired,
    checked: ['FR extremes', 'FR flip', 'RSI', 'RSI 50 cross', 'EMA 200 cross', 'Rapid move', 'Whales', 'News', 'Fear & Greed', 'Daily summary', 'OI spike', 'CVD', 'Price alerts', 'Sentiment extremes'],
    session: nyActive ? 'NY/Pre-NY (high activity)' : 'Asia/London',
    cooldowns: { whale: `${CD.whale / 60_000}min`, news: `${CD.news / 60_000}min` },
  });
}
