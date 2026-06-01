import { NextResponse } from 'next/server';

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
const LABELS: Record<string, string> = {
  btc: 'BTC', eth: 'ETH', sol: 'SOL', xrp: 'XRP',
  bnb: 'BNB', hype: 'HYPE', near: 'NEAR',
};
const COINS = Object.keys(LABELS);

/* ── In-memory cooldown (resets on server restart, fine for Render+UptimeRobot) ── */
const lastSent: Map<string, number> = new Map();
const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours

function onCooldown(key: string): boolean {
  const t = lastSent.get(key);
  return t !== undefined && Date.now() - t < COOLDOWN_MS;
}
function markSent(key: string): void {
  lastSent.set(key, Date.now());
}

/* ── Fetch live FR ── */
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
      if (coin && result[coin] == null && item.fundingRate) {
        result[coin] = parseFloat(item.fundingRate);
      }
    }
  }

  return result;
}

/* ── Send a Telegram message ── */
async function sendTG(token: string, chatId: string, text: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch { /* fire-and-forget */ }
}

/* ── Main handler ── */
export async function GET() {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not configured' }, { status: 503 });
  }

  const frMap = await fetchAllFR();
  const fired: string[] = [];
  const skipped: string[] = [];

  const now = new Date().toLocaleString('en-PH', {
    timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit',
  });

  for (const coin of COINS) {
    const fr = frMap[coin];
    if (fr == null) continue;
    const pct  = (fr * 100).toFixed(4);
    const label = LABELS[coin];

    /* ── Longs Overcrowded (dump risk) ── */
    if (fr >= 0.05) {
      const key = `fr_long_${coin}`;
      if (!onCooldown(key)) {
        await sendTG(token, chatId,
          `🔴 <b>${label} Funding Extreme — Longs Overcrowded</b>\n\n` +
          `Rate: <b>+${pct}%</b>\n` +
          `Signal: Longs Overcrowded — Dump Risk\n` +
          `Action: Consider fading longs or tightening stops on open longs.\n\n` +
          `<i>⏰ ${now} PHT · liquidity-hq.onrender.com</i>`,
        );
        markSent(key);
        fired.push(`${label} long extreme`);
      } else {
        skipped.push(`${label} long extreme (cooldown)`);
      }
    }

    /* ── Shorts Crowded (squeeze setup) ── */
    if (fr <= -0.03) {
      const key = `fr_short_${coin}`;
      if (!onCooldown(key)) {
        await sendTG(token, chatId,
          `🟢 <b>${label} Short Squeeze Setup</b>\n\n` +
          `Rate: <b>${pct}%</b>\n` +
          `Signal: Shorts Crowded — Squeeze Setup\n` +
          `Action: Watch for a violent squeeze. Long bias above key structure level.\n\n` +
          `<i>⏰ ${now} PHT · liquidity-hq.onrender.com</i>`,
        );
        markSent(key);
        fired.push(`${label} short squeeze`);
      } else {
        skipped.push(`${label} short squeeze (cooldown)`);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    checked: COINS.length,
    fired,
    skipped,
    rates: Object.fromEntries(
      Object.entries(frMap).map(([k, v]) => [k, v != null ? +(v * 100).toFixed(4) : null]),
    ),
  });
}
