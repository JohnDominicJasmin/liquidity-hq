import { NextResponse } from 'next/server';
import { classifyNews } from '@/lib/classify';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/* ── Grok (lightweight — no web search, pure reasoning) ── */
const GROK_KEY = 'xai-oCDU5hc5nANrylf2x59rY1blsSvXbefwm0rnP6BSypnO6nijulzN6znv5Bepv2POY4L6EdBULh4GYNCO';
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

/* ── Conviction parser — extracts confidence label from Grok response ── */
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
/* Convenience: format a grokLine string with conviction badge */
function fmtGrok(raw: string): string {
  if (!raw) return '';
  const { text, badge } = parseConviction(raw);
  return `\n\n🤖 <b>Grok:</b> ${text}${badge ? `\n${badge}` : ''}`;
}

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
const LABELS: Record<string, string> = {
  btc: 'BTC', eth: 'ETH', sol: 'SOL', xrp: 'XRP',
  bnb: 'BNB', hype: 'HYPE', near: 'NEAR', sui: 'SUI',
};
const COINS = Object.keys(LABELS);

const WHALE_THRESHOLD: Record<string, number> = {
  btc: 2_000_000, eth: 1_000_000, sol: 400_000,
  xrp: 300_000,   bnb: 300_000,  near: 150_000, sui: 150_000,
};

/* ── In-memory state ── */
const lastSent   = new Map<string, number>();
const frSignMap  = new Map<string, number>(); // for FR flip detection
const rsiLastMap = new Map<string, number>();               // RSI 50 cross detection
const emaSideMap = new Map<string, 'above' | 'below'>();   // EMA 200 cross detection

const CD: Record<string, number> = {
  fr:     4 * 3600_000,
  rsi:    4 * 3600_000,
  rsi50:  6 * 3600_000,   // RSI 50 cross
  ema:   12 * 3600_000,   // 200 EMA cross
  move5m: 30 * 60_000,   // rapid move 5m
  move1h:  2 * 3600_000, // rapid move 1H
  move4h:  4 * 3600_000, // rapid move 4H
  whale:  30 * 60_000,   // overridden per session in main handler
  news:   15 * 60_000,   // overridden per session in main handler
  oi:     2 * 3600_000,
  cvd:    60 * 60_000,
};

/* ── Session detector (PHT = UTC+8) ──
   Pre-NY:  8:00pm – 9:30pm PHT  (20:00–21:30)
   NY open: 9:30pm – 4:00am PHT  (21:30–04:00)
   High-activity window: 8pm – 4am PHT
── */
function isHighActivity(): boolean {
  const phtHour = (new Date().getUTCHours() + 8) % 24;
  return phtHour >= 20 || phtHour < 4;
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

/* ════════════════════════════════════════
   1. FR EXTREMES
   ════════════════════════════════════════ */
async function checkFRExtremes(token: string, chatId: string, now: string, frMap: Record<string, number | null>): Promise<string[]> {
  const fired: string[] = [];
  for (const coin of COINS) {
    const fr = frMap[coin];
    if (fr == null) continue;
    const pct = (fr * 100).toFixed(4);
    const label = LABELS[coin];
    if (fr >= 0.05 && !onCooldown(`fr_long_${coin}`, CD.fr)) {
      await tg(token, chatId,
        `🔴 <b>${label} Funding Extreme — Longs Overcrowded</b>\n\nRate: <b>+${pct}%</b>\nSignal: Longs Overcrowded — Dump Risk\nAction: Consider fading longs or tightening stops.\n\n<i>⏰ ${now} PHT</i>`);
      markSent(`fr_long_${coin}`); fired.push(`${label} FR long extreme`);
    }
    if (fr <= -0.03 && !onCooldown(`fr_short_${coin}`, CD.fr)) {
      await tg(token, chatId,
        `🟢 <b>${label} Short Squeeze Setup</b>\n\nRate: <b>${pct}%</b>\nSignal: Shorts Crowded — Squeeze Setup\nAction: Watch for a violent squeeze. Long bias above key level.\n\n<i>⏰ ${now} PHT</i>`);
      markSent(`fr_short_${coin}`); fired.push(`${label} FR short squeeze`);
    }
  }
  return fired;
}

/* ════════════════════════════════════════
   2. FR DIRECTION FLIP (crosses zero)
   ════════════════════════════════════════ */
async function checkFRFlip(token: string, chatId: string, now: string, frMap: Record<string, number | null>): Promise<string[]> {
  const fired: string[] = [];
  for (const coin of COINS) {
    const fr = frMap[coin];
    if (fr == null) continue;
    const sign     = fr > 0.001 ? 1 : fr < -0.001 ? -1 : 0;
    const lastSign = frSignMap.get(coin);
    if (sign !== 0) {
      if (lastSign !== undefined && lastSign !== 0 && sign !== lastSign) {
        const label    = LABELS[coin];
        const pct      = (fr * 100).toFixed(4);
        const flippedTo = sign > 0 ? 'Positive' : 'Negative';
        const desc      = sign > 0
          ? 'FR flipped positive — longs now paying shorts. Early bull bias forming, momentum shifting.'
          : 'FR flipped negative — shorts now paying longs. Early squeeze setup, watch for short covering.';
        await tg(token, chatId,
          `🔄 <b>${label} FR Flipped ${flippedTo}</b>\n\nRate: <b>${sign > 0 ? '+' : ''}${pct}%</b>\n${desc}\n\n<i>⏰ ${now} PHT</i>`);
        fired.push(`${label} FR flip to ${flippedTo}`);
      }
      frSignMap.set(coin, sign);
    }
  }
  return fired;
}

/* ════════════════════════════════════════
   3. RSI EXTREMES (1H)
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

async function checkRSI(token: string, chatId: string, now: string): Promise<string[]> {
  const fired: string[] = [];
  await Promise.all(COINS.filter(c => BINANCE_SPOT[c]).map(async coin => {
    try {
      const res  = await fetch(`https://api.binance.com/api/v3/klines?symbol=${BINANCE_SPOT[coin]}&interval=1h&limit=20`, { cache: 'no-store' });
      if (!res.ok) return;
      const data   = await res.json() as Array<unknown[]>;
      const closes = data.map(c => parseFloat(c[4] as string));
      const rsi    = computeRSI(closes);
      const r      = rsi.toFixed(1);
      const label  = LABELS[coin];
      if (rsi > 78 && !onCooldown(`rsi_ob_${coin}`, CD.rsi)) {
        await tg(token, chatId, `⚡ <b>${label} RSI Overbought (1H)</b>\n\nRSI: <b>${r}</b>\nSignal: Exhaustion — Potential Reversal\nAction: Avoid chasing longs. Watch for rejection / reversal candle.\n\n<i>⏰ ${now} PHT</i>`);
        markSent(`rsi_ob_${coin}`); fired.push(`${label} RSI overbought (${r})`);
      }
      if (rsi < 22 && !onCooldown(`rsi_os_${coin}`, CD.rsi)) {
        await tg(token, chatId, `⚡ <b>${label} RSI Oversold (1H)</b>\n\nRSI: <b>${r}</b>\nSignal: Oversold — Bounce Setup\nAction: Watch for bounce from key support. Long bias on confirmation.\n\n<i>⏰ ${now} PHT</i>`);
        markSent(`rsi_os_${coin}`); fired.push(`${label} RSI oversold (${r})`);
      }
      // RSI 50 centerline cross — momentum shift
      const prevRsi = rsiLastMap.get(coin);
      rsiLastMap.set(coin, rsi);
      if (prevRsi !== undefined) {
        if (prevRsi < 50 && rsi >= 50 && !onCooldown(`rsi50_bull_${coin}`, CD.rsi50)) {
          await tg(token, chatId,
            `📊 <b>${label} RSI Crossed 50 — Bullish (1H)</b>\n\nRSI: <b>${r}</b> (prev ${prevRsi.toFixed(1)})\nSignal: Momentum shifted bullish — potential long setup\nAction: Confirm with break above nearest resistance.\n\n<i>⏰ ${now} PHT</i>`);
          markSent(`rsi50_bull_${coin}`); fired.push(`${label} RSI 50 cross ↑`);
        }
        if (prevRsi > 50 && rsi < 50 && !onCooldown(`rsi50_bear_${coin}`, CD.rsi50)) {
          await tg(token, chatId,
            `📊 <b>${label} RSI Crossed 50 — Bearish (1H)</b>\n\nRSI: <b>${r}</b> (prev ${prevRsi.toFixed(1)})\nSignal: Momentum turned bearish — potential short setup\nAction: Confirm with breakdown below nearest support.\n\n<i>⏰ ${now} PHT</i>`);
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
async function checkEMACross(token: string, chatId: string, now: string): Promise<string[]> {
  const fired: string[] = [];
  await Promise.all(COINS.filter(c => BINANCE_SPOT[c]).map(async coin => {
    try {
      const res = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${BINANCE_SPOT[coin]}&interval=1h&limit=300`,
        { cache: 'no-store' }
      );
      if (!res.ok) return;
      const data   = await res.json() as Array<unknown[]>;
      const closes = data.map(c => parseFloat(c[4] as string));
      if (closes.length < 200) return;

      const ema200   = computeEMA(closes, 200);
      const price    = closes[closes.length - 1];
      const side     = price > ema200 ? 'above' : 'below';
      const lastSide = emaSideMap.get(coin);
      emaSideMap.set(coin, side);
      if (!lastSide || lastSide === side) return; // no cross or first run (seed only)

      const label    = LABELS[coin];
      const priceFmt = price.toLocaleString();
      const emaFmt   = ema200.toLocaleString();

      if (side === 'above' && !onCooldown(`ema_bull_${coin}`, CD.ema)) {
        const grokTake = await grokAnalyze(
          `Elite crypto trader. ${label} price just crossed above its 200-period EMA on the 1H chart. ` +
          `Price: $${priceFmt}, EMA(200): $${emaFmt}. ` +
          `In 2-3 sentences: valid bullish reclaim or false breakout? What confluence confirms? Direct, no hedging. ` +
          `End with exactly one of: CONVICTION: High, CONVICTION: Moderate, or CONVICTION: Weak`);
        await tg(token, chatId,
          `📈 <b>${label} Crossed Above 200 EMA (1H)</b>\n\n` +
          `Price: <b>$${priceFmt}</b> | EMA(200): $${emaFmt}\n` +
          `Signal: Bullish — price reclaimed major moving average\n` +
          `Action: Watch for EMA retest as support and higher-high confirmation.` +
          `${fmtGrok(grokTake)}\n\n<i>⏰ ${now} PHT</i>`);
        markSent(`ema_bull_${coin}`); fired.push(`${label} crossed above 200 EMA`);
      }
      if (side === 'below' && !onCooldown(`ema_bear_${coin}`, CD.ema)) {
        const grokTake = await grokAnalyze(
          `Elite crypto trader. ${label} price just crossed below its 200-period EMA on the 1H chart. ` +
          `Price: $${priceFmt}, EMA(200): $${emaFmt}. ` +
          `In 2-3 sentences: genuine bearish breakdown or fake-out? What to watch for? Direct, no hedging. ` +
          `End with exactly one of: CONVICTION: High, CONVICTION: Moderate, or CONVICTION: Weak`);
        await tg(token, chatId,
          `📉 <b>${label} Crossed Below 200 EMA (1H)</b>\n\n` +
          `Price: <b>$${priceFmt}</b> | EMA(200): $${emaFmt}\n` +
          `Signal: Bearish — price lost major moving average\n` +
          `Action: Watch for failed EMA retest as resistance and lower-low confirmation.` +
          `${fmtGrok(grokTake)}\n\n<i>⏰ ${now} PHT</i>`);
        markSent(`ema_bear_${coin}`); fired.push(`${label} crossed below 200 EMA`);
      }
    } catch { /* skip */ }
  }));
  return fired;
}

/* ════════════════════════════════════════
   3c. RAPID PRICE MOVE (5m / 1H / 4H)
   ════════════════════════════════════════ */
async function checkRapidMove(token: string, chatId: string, now: string): Promise<string[]> {
  const fired: string[] = [];
  const FRAMES = [
    { interval: '5m',  threshold: 4,  cd: 'move5m', tfLabel: '5m' },
    { interval: '1h',  threshold: 5,  cd: 'move1h', tfLabel: '1H' },
    { interval: '4h',  threshold: 10, cd: 'move4h', tfLabel: '4H' },
  ] as const;

  await Promise.all(
    COINS.filter(c => BINANCE_SPOT[c]).flatMap(coin =>
      FRAMES.map(async ({ interval, threshold, cd, tfLabel }) => {
        try {
          const res = await fetch(
            `https://api.binance.com/api/v3/klines?symbol=${BINANCE_SPOT[coin]}&interval=${interval}&limit=3`,
            { cache: 'no-store' }
          );
          if (!res.ok) return;
          const data = await res.json() as Array<unknown[]>;
          if (data.length < 2) return;

          // data[0] = 2 candles ago (completed), data[1] = last completed candle, data[2] = current open
          const prevClose = parseFloat(data[0][4] as string);
          const currClose = parseFloat(data[1][4] as string);
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

          await tg(token, chatId,
            `${emoji} <b>${label} Rapid ${pct > 0 ? 'Pump' : 'Dump'} ${sign}${pct.toFixed(1)}% (${tfLabel})</b>\n\n` +
            `Price: <b>$${currClose.toLocaleString()}</b>\n` +
            `Signal: ${Math.abs(pct).toFixed(1)}% candle — ${pct > 0 ? 'momentum surge' : 'flash dump'}\n` +
            `Action: Check volume + OI. Next candle direction is key.` +
            `${fmtGrok(grokTake)}\n\n<i>⏰ ${now} PHT</i>`);
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

async function checkWhales(token: string, chatId: string, now: string): Promise<string[]> {
  const fired: string[] = [];
  const since = Date.now() - 5 * 60_000;
  await Promise.all(Object.entries(BINANCE_PERP).map(async ([coin, sym]) => {
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
        const usdFmt = usd >= 1_000_000 ? `$${(usd / 1_000_000).toFixed(2)}M` : `$${(usd / 1000).toFixed(0)}K`;
        const grokTake = await grokAnalyze(
          `Elite crypto trader. A whale just ${side === 'BUY' ? 'bought' : 'sold'} ${usdFmt} of ${label} at $${parseFloat(t.p).toLocaleString()}. ` +
          `In 2-3 sentences: short-term (1-4h) market impact? Worth acting on now or wait for confirmation? Direct, no hedging. ` +
          `End with exactly one of: CONVICTION: High, CONVICTION: Moderate, or CONVICTION: Weak`);
        const grokLine = fmtGrok(grokTake);
        await tg(token, chatId,
          side === 'BUY'
            ? `🐋 <b>${label} Whale BUY Detected</b>\n\nSize: <b>${usdFmt}</b> at $${parseFloat(t.p).toLocaleString()}\nSignal: Large aggressive buy — institutional accumulation${grokLine}\n\n<i>⏰ ${now} PHT</i>`
            : `🐋 <b>${label} Whale SELL Detected</b>\n\nSize: <b>${usdFmt}</b> at $${parseFloat(t.p).toLocaleString()}\nSignal: Large aggressive sell — institutional distribution${grokLine}\n\n<i>⏰ ${now} PHT</i>`);
        markSent(key); fired.push(`${label} whale ${side} ${usdFmt}`); break;
      }
    } catch { /* skip */ }
  }));
  return fired;
}

/* ════════════════════════════════════════
   5. BREAKING NEWS
   ════════════════════════════════════════ */
interface FinnhubItem { id: number; headline: string; datetime: number; source: string }
const FINNHUB_KEY = 'd7f177pr01qi33g80jm0d7f177pr01qi33g80jmg';

async function checkNews(token: string, chatId: string, now: string): Promise<string[]> {
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
      const emoji = type === 'red' ? '🚨' : '📊';
      const label = type === 'red' ? 'Breaking Alert' : 'Macro Alert';
      const grokTake = await grokAnalyze(
        `Elite crypto trader. Breaking news: "${item.headline}". In 2-3 sentences: short-term (1-4h) crypto market impact? What should a trader watch for right now? Direct, no hedging. ` +
        `End with exactly one of: CONVICTION: High, CONVICTION: Moderate, or CONVICTION: Weak`);
      const grokLine = fmtGrok(grokTake);
      await tg(token, chatId, `${emoji} <b>${label}</b>\n\n<b>${item.headline}</b>\nSource: ${item.source}${grokLine}\n\n<i>⏰ ${now} PHT</i>`);
      markSent(key); fired.push(`news: ${item.headline.slice(0, 50)}`);
    }
  } catch { /* skip */ }
  return fired;
}

/* ════════════════════════════════════════
   6. OI SPIKE (+15% in 1h)
   ════════════════════════════════════════ */
interface OIHistItem { sumOpenInterest: string; timestamp: number }

async function checkOISpike(token: string, chatId: string, now: string, prices: Record<string, number>): Promise<string[]> {
  const fired: string[] = [];
  await Promise.all(Object.entries(BINANCE_PERP).map(async ([coin, sym]) => {
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

        await tg(token, chatId,
          `📈 <b>${label} OI ${pct > 0 ? 'Spike' : 'Drop'} — +${pct.toFixed(1)}% in 1h</b>\n\n` +
          `OI changed from ${(oldest / 1000).toFixed(1)}K to ${(newest / 1000).toFixed(1)}K contracts\n` +
          `Signal: ${pct > 0 ? 'New money entering — big move likely building' : 'Positions closing — potential trend reversal'}` +
          `${grokLine}\n\n<i>⏰ ${now} PHT</i>`);
        markSent(key); fired.push(`${label} OI ${dir} ${pct.toFixed(1)}%`);
      }
    } catch { /* skip */ }
  }));
  return fired;
}

/* ════════════════════════════════════════
   7. CVD DIVERGENCE (taker buy/sell vol vs price)
   ════════════════════════════════════════ */
interface TakerVolItem { buyVol: string; sellVol: string; timestamp: number }

async function checkCVD(token: string, chatId: string, now: string): Promise<string[]> {
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

      const prevClose     = parseFloat(klines[0][4] as string);
      const currClose     = parseFloat(klines[1][4] as string);
      const priceChangePct = (currClose - prevClose) / prevClose * 100;

      let totalBuy = 0, totalSell = 0;
      for (const item of tvData) { totalBuy += parseFloat(item.buyVol); totalSell += parseFloat(item.sellVol); }
      const netCVD = totalBuy - totalSell;
      const label  = LABELS[coin];
      const THRESH = 1.5;

      if (priceChangePct > THRESH && netCVD < 0 && !onCooldown(`cvd_bear_${coin}`, CD.cvd)) {
        await tg(token, chatId,
          `⚠️ <b>${label} Bearish CVD Divergence</b>\n\nPrice: <b>+${priceChangePct.toFixed(1)}%</b> in 1h\nCVD: <b>Negative</b> — sellers dominating volume\nSignal: Price pump not supported by buying — likely a fake move\nAction: Avoid chasing longs. Watch for reversal.\n\n<i>⏰ ${now} PHT</i>`);
        markSent(`cvd_bear_${coin}`); fired.push(`${label} bearish CVD divergence`);
      }
      if (priceChangePct < -THRESH && netCVD > 0 && !onCooldown(`cvd_bull_${coin}`, CD.cvd)) {
        await tg(token, chatId,
          `⚡ <b>${label} Bullish CVD Divergence</b>\n\nPrice: <b>${priceChangePct.toFixed(1)}%</b> in 1h\nCVD: <b>Positive</b> — buyers absorbing the dip\nSignal: Price drop not matched by sell volume — accumulation signal\nAction: Watch for bounce from key support.\n\n<i>⏰ ${now} PHT</i>`);
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

async function checkPriceAlerts(token: string, chatId: string, now: string, prices: Record<string, number>): Promise<string[]> {
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

      const label      = LABELS[alert.coin] ?? alert.coin.toUpperCase();
      const dirLabel   = alert.direction === 'above' ? '📈 Crossed Above' : '📉 Crossed Below';
      const grokTake   = await grokAnalyze(
        `Elite crypto trader. ${label} just hit $${alert.target_price.toLocaleString()} (now $${price.toLocaleString()}).` +
        (alert.label ? ` Saved alert: "${alert.label}".` : '') +
        ` In 2-3 sentences: Is this a valid entry/exit level right now? What to watch for to confirm? Direct, no hedging. ` +
        `End with exactly one of: CONVICTION: High, CONVICTION: Moderate, or CONVICTION: Weak`);
      const grokLine   = fmtGrok(grokTake);

      await tg(token, chatId,
        `🎯 <b>${label} Price Alert Triggered</b>\n\n` +
        `${dirLabel} <b>$${alert.target_price.toLocaleString()}</b>\n` +
        `Current: $${price.toLocaleString()}` +
        (alert.label ? `\nNote: ${alert.label}` : '') +
        `${grokLine}\n\n<i>⏰ ${now} PHT</i>`);

      await db.from('price_alerts').update({ active: false, triggered_at: new Date().toISOString() }).eq('id', alert.id);
      fired.push(`${label} price alert at $${alert.target_price.toLocaleString()}`);
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

  const now = new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' });

  // Fetch shared data once
  const [frMap, prices] = await Promise.all([fetchAllFR(), fetchSpotPrices()]);

  const results = await Promise.allSettled([
    checkFRExtremes(token, chatId, now, frMap),
    checkFRFlip(token, chatId, now, frMap),
    checkRSI(token, chatId, now),
    checkEMACross(token, chatId, now),
    checkRapidMove(token, chatId, now),
    checkWhales(token, chatId, now),
    checkNews(token, chatId, now),
    checkOISpike(token, chatId, now, prices),
    checkCVD(token, chatId, now),
    checkPriceAlerts(token, chatId, now, prices),
  ]);

  const fired = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

  return NextResponse.json({
    ok: true, fired,
    checked: ['FR extremes', 'FR flip', 'RSI', 'RSI 50 cross', 'EMA 200 cross', 'Rapid move', 'Whales', 'News', 'OI spike', 'CVD', 'Price alerts'],
    session: nyActive ? 'NY/Pre-NY (high activity)' : 'Asia/London',
    cooldowns: { whale: `${CD.whale / 60_000}min`, news: `${CD.news / 60_000}min` },
  });
}
