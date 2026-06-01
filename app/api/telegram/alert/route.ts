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
      body: JSON.stringify({ model: 'grok-4.3', messages: [{ role: 'user', content: prompt }], max_tokens: 180 }),
    });
    if (!res.ok) return '';
    const data = await res.json();
    return (data.choices?.[0]?.message?.content ?? '').trim();
  } catch { return ''; }
}

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

const WHALE_THRESHOLD: Record<string, number> = {
  btc: 2_000_000, eth: 1_000_000, sol: 400_000,
  xrp: 300_000,   bnb: 300_000,  near: 150_000,
};

/* ── In-memory state ── */
const lastSent  = new Map<string, number>();
const frSignMap = new Map<string, number>(); // for FR flip detection

const CD = {
  fr:    4 * 3600_000,
  rsi:   4 * 3600_000,
  whale: 30 * 60_000,
  news:  15 * 60_000,
  oi:    2 * 3600_000,
  cvd:   60 * 60_000,
};
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

async function checkRSI(token: string, chatId: string, now: string): Promise<string[]> {
  const fired: string[] = [];
  await Promise.all(COINS.filter(c => BINANCE_SPOT[c]).map(async coin => {
    try {
      const res  = await fetch(`https://api.binance.com/api/v3/klines?symbol=${BINANCE_SPOT[coin]}&interval=1h&limit=20`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json() as Array<unknown[]>;
      const rsi  = computeRSI(data.map(c => parseFloat(c[4] as string)));
      const r    = rsi.toFixed(1);
      const label = LABELS[coin];
      if (rsi > 78 && !onCooldown(`rsi_ob_${coin}`, CD.rsi)) {
        await tg(token, chatId, `⚡ <b>${label} RSI Overbought (1H)</b>\n\nRSI: <b>${r}</b>\nSignal: Exhaustion — Potential Reversal\nAction: Avoid chasing longs. Watch for rejection / reversal candle.\n\n<i>⏰ ${now} PHT</i>`);
        markSent(`rsi_ob_${coin}`); fired.push(`${label} RSI overbought (${r})`);
      }
      if (rsi < 22 && !onCooldown(`rsi_os_${coin}`, CD.rsi)) {
        await tg(token, chatId, `⚡ <b>${label} RSI Oversold (1H)</b>\n\nRSI: <b>${r}</b>\nSignal: Oversold — Bounce Setup\nAction: Watch for bounce from key support. Long bias on confirmation.\n\n<i>⏰ ${now} PHT</i>`);
        markSent(`rsi_os_${coin}`); fired.push(`${label} RSI oversold (${r})`);
      }
    } catch { /* skip */ }
  }));
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
          `In 2-3 sentences: short-term (1-4h) market impact? Worth acting on now or wait for confirmation? Direct, no hedging.`);
        const grokLine = grokTake ? `\n\n🤖 <b>Grok:</b> ${grokTake}` : '';
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
        `Elite crypto trader. Breaking news: "${item.headline}". In 2-3 sentences: short-term (1-4h) crypto market impact? What should a trader watch for right now? Direct, no hedging.`);
      const grokLine = grokTake ? `\n\n🤖 <b>Grok:</b> ${grokTake}` : '';
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
          ` In 2-3 sentences: Is this new longs, new shorts, or liquidation-driven? What's the likely next move? Direct, no hedging.`);
        const grokLine = grokTake ? `\n\n🤖 <b>Grok:</b> ${grokTake}` : '';

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
        ` In 2-3 sentences: Is this a valid entry/exit level right now? What to watch for to confirm? Direct, no hedging.`);
      const grokLine   = grokTake ? `\n\n🤖 <b>Grok:</b> ${grokTake}` : '';

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

  const now = new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' });

  // Fetch shared data once
  const [frMap, prices] = await Promise.all([fetchAllFR(), fetchSpotPrices()]);

  const results = await Promise.allSettled([
    checkFRExtremes(token, chatId, now, frMap),
    checkFRFlip(token, chatId, now, frMap),
    checkRSI(token, chatId, now),
    checkWhales(token, chatId, now),
    checkNews(token, chatId, now),
    checkOISpike(token, chatId, now, prices),
    checkCVD(token, chatId, now),
    checkPriceAlerts(token, chatId, now, prices),
  ]);

  const fired = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

  return NextResponse.json({
    ok: true, fired,
    checked: ['FR extremes', 'FR flip', 'RSI', 'Whales', 'News', 'OI spike', 'CVD', 'Price alerts'],
  });
}
