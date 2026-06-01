import { NextResponse } from 'next/server';
import { classifyNews } from '@/lib/classify';

export const dynamic = 'force-dynamic';

/* ── Coin maps ── */
const BINANCE_PERP: Record<string, string> = {
  btc: 'BTCUSDT', eth: 'ETHUSDT', sol: 'SOLUSDT',
  xrp: 'XRPUSDT', bnb: 'BNBUSDT', near: 'NEARUSDT',
};
const BYBIT_PERP: Record<string, string> = {
  btc: 'BTCUSDT', eth: 'ETHUSDT', sol: 'SOLUSDT',
  xrp: 'XRPUSDT', bnb: 'BNBUSDT', hype: 'HYPEUSDT', near: 'NEARUSDT',
};
const BINANCE_SPOT: Record<string, string> = {
  btc: 'BTCUSDT', eth: 'ETHUSDT', sol: 'SOLUSDT',
  xrp: 'XRPUSDT', bnb: 'BNBUSDT', near: 'NEARUSDT',
};
const LABELS: Record<string, string> = {
  btc: 'BTC', eth: 'ETH', sol: 'SOL', xrp: 'XRP',
  bnb: 'BNB', hype: 'HYPE', near: 'NEAR',
};
const COINS = Object.keys(LABELS);

// Whale thresholds per coin (USD)
const WHALE_THRESHOLD: Record<string, number> = {
  btc: 2_000_000, eth: 1_000_000, sol: 400_000,
  xrp: 300_000,   bnb: 300_000,  near: 150_000,
};

/* ── In-memory cooldown (resets on restart) ── */
const lastSent = new Map<string, number>();
const CD = {
  fr:    4 * 3600_000,
  rsi:   4 * 3600_000,
  whale: 30 * 60_000,
  news:  15 * 60_000,
};
const onCooldown = (key: string, ms: number) => {
  const t = lastSent.get(key);
  return t !== undefined && Date.now() - t < ms;
};
const markSent = (key: string) => lastSent.set(key, Date.now());

/* ── Send Telegram ── */
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
   1. FUNDING RATE EXTREMES
   ════════════════════════════════════════ */
interface BinanceTicker { symbol: string; lastFundingRate: string }
interface BybitTicker   { symbol: string; fundingRate: string }

async function fetchAllFR(): Promise<Record<string, number | null>> {
  const result: Record<string, number | null> = {};
  COINS.forEach(c => (result[c] = null));
  const [bnRes, bbRes] = await Promise.allSettled([
    fetch('https://fapi.binance.com/fapi/v1/premiumIndex', { cache: 'no-store' }),
    fetch('https://api.bybit.com/v5/market/tickers?category=linear', { cache: 'no-store' }),
  ]);
  if (bnRes.status === 'fulfilled' && bnRes.value.ok) {
    const data = await bnRes.value.json() as BinanceTicker[];
    for (const item of data) {
      const coin = Object.entries(BINANCE_PERP).find(([, s]) => s === item.symbol)?.[0];
      if (coin) result[coin] = parseFloat(item.lastFundingRate);
    }
  }
  if (bbRes.status === 'fulfilled' && bbRes.value.ok) {
    const data = await bbRes.value.json() as { result?: { list?: BybitTicker[] } };
    for (const item of data.result?.list ?? []) {
      const coin = Object.entries(BYBIT_PERP).find(([, s]) => s === item.symbol)?.[0];
      if (coin && result[coin] == null && item.fundingRate) result[coin] = parseFloat(item.fundingRate);
    }
  }
  return result;
}

async function checkFR(token: string, chatId: string, now: string): Promise<string[]> {
  const frMap = await fetchAllFR();
  const fired: string[] = [];
  for (const coin of COINS) {
    const fr = frMap[coin];
    if (fr == null) continue;
    const pct   = (fr * 100).toFixed(4);
    const label = LABELS[coin];
    if (fr >= 0.05 && !onCooldown(`fr_long_${coin}`, CD.fr)) {
      await tg(token, chatId,
        `🔴 <b>${label} Funding Extreme — Longs Overcrowded</b>\n\n` +
        `Rate: <b>+${pct}%</b>\n` +
        `Signal: Longs Overcrowded — Dump Risk\n` +
        `Action: Consider fading longs or tightening stops.\n\n` +
        `<i>⏰ ${now} PHT</i>`);
      markSent(`fr_long_${coin}`);
      fired.push(`${label} FR long extreme`);
    }
    if (fr <= -0.03 && !onCooldown(`fr_short_${coin}`, CD.fr)) {
      await tg(token, chatId,
        `🟢 <b>${label} Short Squeeze Setup</b>\n\n` +
        `Rate: <b>${pct}%</b>\n` +
        `Signal: Shorts Crowded — Squeeze Setup\n` +
        `Action: Watch for a violent squeeze. Long bias above key level.\n\n` +
        `<i>⏰ ${now} PHT</i>`);
      markSent(`fr_short_${coin}`);
      fired.push(`${label} FR short squeeze`);
    }
  }
  return fired;
}

/* ════════════════════════════════════════
   2. RSI EXTREMES (1H)
   ════════════════════════════════════════ */
function computeRSI(closes: number[], period = 14): number {
  if (closes.length < period + 2) return 50;
  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    avgGain += Math.max(changes[i], 0);
    avgLoss += Math.max(-changes[i], 0);
  }
  avgGain /= period; avgLoss /= period;
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + Math.max(changes[i], 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-changes[i], 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

async function fetchRSI(coin: string): Promise<number | null> {
  const sym = BINANCE_SPOT[coin];
  if (!sym) return null;
  try {
    const res  = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1h&limit=20`,
      { cache: 'no-store' },
    );
    if (!res.ok) return null;
    const data = await res.json() as Array<unknown[]>;
    const closes = data.map(c => parseFloat(c[4] as string));
    return computeRSI(closes);
  } catch { return null; }
}

async function checkRSI(token: string, chatId: string, now: string): Promise<string[]> {
  const fired: string[] = [];
  await Promise.all(COINS.filter(c => BINANCE_SPOT[c]).map(async coin => {
    const rsi   = await fetchRSI(coin);
    if (rsi == null) return;
    const label = LABELS[coin];
    const r     = rsi.toFixed(1);

    if (rsi > 78 && !onCooldown(`rsi_ob_${coin}`, CD.rsi)) {
      await tg(token, chatId,
        `⚡ <b>${label} RSI Overbought (1H)</b>\n\n` +
        `RSI: <b>${r}</b>\n` +
        `Signal: Exhaustion — Potential Reversal\n` +
        `Action: Avoid chasing longs. Watch for rejection / reversal candle.\n\n` +
        `<i>⏰ ${now} PHT</i>`);
      markSent(`rsi_ob_${coin}`);
      fired.push(`${label} RSI overbought (${r})`);
    }
    if (rsi < 22 && !onCooldown(`rsi_os_${coin}`, CD.rsi)) {
      await tg(token, chatId,
        `⚡ <b>${label} RSI Oversold (1H)</b>\n\n` +
        `RSI: <b>${r}</b>\n` +
        `Signal: Oversold — Bounce Setup\n` +
        `Action: Watch for bounce from key support. Long bias on confirmation.\n\n` +
        `<i>⏰ ${now} PHT</i>`);
      markSent(`rsi_os_${coin}`);
      fired.push(`${label} RSI oversold (${r})`);
    }
  }));
  return fired;
}

/* ════════════════════════════════════════
   3. WHALE TRADES (Binance aggTrades)
   ════════════════════════════════════════ */
interface AggTrade { T: number; p: string; q: string; m: boolean }

async function checkWhales(token: string, chatId: string, now: string): Promise<string[]> {
  const fired: string[] = [];
  const since = Date.now() - 5 * 60_000; // last 5 min

  await Promise.all(
    Object.entries(BINANCE_PERP).map(async ([coin, sym]) => {
      const threshold = WHALE_THRESHOLD[coin];
      if (!threshold) return;
      try {
        const res = await fetch(
          `https://fapi.binance.com/fapi/v1/aggTrades?symbol=${sym}&startTime=${since}&limit=500`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const trades = await res.json() as AggTrade[];
        const label  = LABELS[coin];

        for (const t of trades) {
          const usd = parseFloat(t.p) * parseFloat(t.q);
          if (usd < threshold) continue;

          const side   = t.m ? 'SELL' : 'BUY';    // taker buys = not maker
          const key    = `whale_${coin}_${side}`;
          if (onCooldown(key, CD.whale)) continue;

          const usdFmt = usd >= 1_000_000
            ? `$${(usd / 1_000_000).toFixed(2)}M`
            : `$${(usd / 1000).toFixed(0)}K`;

          await tg(token, chatId,
            side === 'BUY'
              ? `🐋 <b>${label} Whale BUY Detected</b>\n\n` +
                `Size: <b>${usdFmt}</b> at $${parseFloat(t.p).toLocaleString()}\n` +
                `Signal: Large aggressive buy — institutional accumulation\n` +
                `Action: Watch for follow-through momentum. Short-term bullish.\n\n` +
                `<i>⏰ ${now} PHT</i>`
              : `🐋 <b>${label} Whale SELL Detected</b>\n\n` +
                `Size: <b>${usdFmt}</b> at $${parseFloat(t.p).toLocaleString()}\n` +
                `Signal: Large aggressive sell — institutional distribution\n` +
                `Action: Watch for follow-through selling. Short-term bearish.\n\n` +
                `<i>⏰ ${now} PHT</i>`);
          markSent(key);
          fired.push(`${label} whale ${side} ${usdFmt}`);
          break; // one alert per coin per check
        }
      } catch { /* skip */ }
    }),
  );
  return fired;
}

/* ════════════════════════════════════════
   4. BREAKING NEWS (Finnhub)
   ════════════════════════════════════════ */
interface FinnhubItem { id: number; headline: string; datetime: number; source: string; url: string }

const FINNHUB_KEY = 'd7f177pr01qi33g80jm0d7f177pr01qi33g80jmg';

async function checkNews(token: string, chatId: string, now: string): Promise<string[]> {
  const fired: string[] = [];
  const since = Math.floor(Date.now() / 1000) - 600; // 10 min ago

  try {
    const [cryptoRes, generalRes] = await Promise.allSettled([
      fetch(`https://finnhub.io/api/v1/news?category=crypto&token=${FINNHUB_KEY}`, { cache: 'no-store' }),
      fetch(`https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_KEY}`, { cache: 'no-store' }),
    ]);

    const items: FinnhubItem[] = [];
    if (cryptoRes.status === 'fulfilled' && cryptoRes.value.ok) {
      const d = await cryptoRes.value.json() as FinnhubItem[];
      items.push(...d.filter(n => n.datetime >= since));
    }
    if (generalRes.status === 'fulfilled' && generalRes.value.ok) {
      const d = await generalRes.value.json() as FinnhubItem[];
      // For general news, only red/breaking category (stricter)
      items.push(...d.filter(n => n.datetime >= since && classifyNews(n.headline) === 'red'));
    }

    for (const item of items) {
      const type = classifyNews(item.headline);
      if (!type || type === 'purple') continue; // skip plain crypto news (too noisy)

      const key = `news_${item.id}`;
      if (onCooldown(key, CD.news)) continue;

      const emoji  = type === 'red' ? '🚨' : '📊';
      const label  = type === 'red' ? 'Breaking Alert' : 'Macro Alert';
      const action = type === 'red'
        ? 'High-impact event. BTC can dump fast then violently recover. Watch key cluster levels.'
        : 'Macro event. Watch for crypto volatility — first move often exaggerated.';

      await tg(token, chatId,
        `${emoji} <b>${label}</b>\n\n` +
        `<b>${item.headline}</b>\n` +
        `Source: ${item.source}\n\n` +
        `${action}\n\n` +
        `<i>⏰ ${now} PHT</i>`);
      markSent(key);
      fired.push(`news: ${item.headline.slice(0, 50)}`);
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
  if (!token || !chatId) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set' }, { status: 503 });
  }

  const now = new Date().toLocaleString('en-PH', {
    timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit',
  });

  const results = await Promise.allSettled([
    checkFR(token, chatId, now),
    checkRSI(token, chatId, now),
    checkWhales(token, chatId, now),
    checkNews(token, chatId, now),
  ]);

  const fired = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

  return NextResponse.json({ ok: true, fired, checked: ['FR', 'RSI', 'Whales', 'News'] });
}
