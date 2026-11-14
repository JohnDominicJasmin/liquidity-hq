/* The quick-read prompts for the bake-off (#1631): N varied contexts built by the PRODUCT'S OWN prompt builder, so every engine gets exactly the text a
 * real quick read sends. Market numbers only, generated from a seeded generator: no user data, nothing from production. A real-data variant (inputs pulled by
 * PM from production's market snapshot) can replace this by supplying the same function; the runner does not care where the prompts come from. */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('../../../qa/alias-hooks.mjs', import.meta.url);
const { buildArenaPrompt } = await import('../../../lib/grok.ts');

/** A tiny seeded generator (mulberry32): the same N inputs on every run, so a re-run is comparable. */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const COINS = [['BTC', 74000], ['ETH', 3100], ['SOL', 160], ['XRP', 0.62], ['DOGE', 0.14], ['AVAX', 28], ['LINK', 15], ['ADA', 0.42], ['BNB', 590], ['SUI', 2.1]];
const fx = (n, d = 2) => n.toFixed(d);

export function makePrompts(n) {
  const rand = rng(20261113);
  const out = [];
  for (let i = 0; i < n; i++) {
    const [coin, base] = COINS[i % COINS.length];
    const px = base * (0.92 + rand() * 0.16);
    const chg = (rand() - 0.5) * 12;
    const rsi = 25 + rand() * 50;
    const ls = 35 + rand() * 30;
    const taker = 35 + rand() * 30;
    const above = rand() > 0.5;
    const ctx = {
      coin, price: `$${fx(px, px < 1 ? 4 : 2)}`, change24h: `${chg >= 0 ? '+' : ''}${fx(chg)}%`, ma20: `$${fx(px * (above ? 0.98 : 1.02), px < 1 ? 4 : 2)}`,
      priceVsMA: `${above ? 'ABOVE' : 'BELOW'} MA20 (${above ? '+' : '-'}${fx(1 + rand() * 3)}% - ${above ? 'bullish' : 'bearish'})`,
      volRatio: `${fx(0.6 + rand() * 1.6)}x (${rand() > 0.5 ? 'normal' : 'elevated'})`,
      rsi14: `${fx(rsi, 1)} (${rsi > 70 ? 'Overbought' : rsi < 30 ? 'Oversold' : 'Neutral'})`, rsi1h: `${fx(rsi + (rand() - 0.5) * 10, 0)} (Neutral)`,
      rsi4h: `${fx(rsi + (rand() - 0.5) * 8, 0)} (Neutral)`, rsiDaily: `${fx(rsi + (rand() - 0.5) * 12, 0)} (Neutral)`,
      longShortRatio: `Long ${fx(ls, 1)}% / Short ${fx(100 - ls, 1)}% (${ls > 55 ? 'crowded long' : ls < 45 ? 'crowded short' : 'balanced'})`,
      vwap: `$${fx(px * 0.995, px < 1 ? 4 : 2)} - price ${above ? 'ABOVE' : 'BELOW'} VWAP`,
      takerRatio: `Buy ${fx(taker, 0)}% / Sell ${fx(100 - taker, 0)}% - ${taker > 55 ? 'buyers aggressive' : taker < 45 ? 'sellers aggressive' : 'balanced flow'}`,
      pocLine: `$${fx(px * 0.99, px < 1 ? 4 : 2)} | VAH $${fx(px * 1.02, px < 1 ? 4 : 2)} | VAL $${fx(px * 0.97, px < 1 ? 4 : 2)}`,
      orderWalls: `BID WALL ${fx(px * 0.98, px < 1 ? 4 : 2)} | ASK WALL ${fx(px * 1.03, px < 1 ? 4 : 2)}`,
      liqLevels: `LONG CLUSTER ${fx(px * 0.96, px < 1 ? 4 : 2)} | SHORT CLUSTER ${fx(px * 1.05, px < 1 ? 4 : 2)}`,
      news: 'News feed unavailable (not loaded) - do not assume there is no news', upcomingEvents: 'No events in window', oilPrice: '$70',
    };
    out.push(buildArenaPrompt(ctx, {}, 'quick', []));
  }
  return out;
}
