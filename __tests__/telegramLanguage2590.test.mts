/* QA's PURE cells for #2590 (Telegram in the reader's saved language, tracker #1651). No database, no network. Expectations come from the PR text and the label rows in the held migration, not from running the code.
 *   L1  every kind of message that goes through tg(): in ko / zh / ru it contains the migration's label text for the phrases it carries; every HTML tag and entity is identical before and after; every number that is not part of a fixed phrase survives; English is byte-identical
 *   L2  the U+2063 marker never survives (every locale, labels or none); a headline / source / note that IS a translatable phrase (all 159 English defaults) stays untranslated; a note carrying U+2063 itself cannot break out
 *   L3  a bad label row (adds / removes / unbalances a tag, raw < > &, empty, missing, equal to the key name, a raw {placeholder}) leaves the English text, never the broken one; length ratio against English is reported
 *   L4  tgLocaleOf: the five locales map to themselves; region tags, other app locales, junk and prototype names map to English; tgDateLocale gives a date in the reader's language
 *   L5  the held migration: PROD block = DEV block, 159 keys x 5 locales (including the E'' row the shared held-migration test cannot read), en = labelDefaults, every key registered, {placeholders} identical per key in all five locales, no vendor name; with NO label rows everything is English and nothing throws
 * WHAT IT CANNOT PROVE: the route, the webhook or Telegram's own rendering (see qa/harness/telegramLanguage2590.test.mts and a real chat). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  localizeTelegram, localizeKeyboard, tgKeep, tgLabel, tgText, tgLocaleOf, tgDateLocale, typeMuteConfirmationIn, TG_LOCALES, type TgLocale,
} from '../lib/telegramI18n.ts';
import { TG_PHRASES } from '../lib/telegramPhrases.ts';
import { BOT_HELP, BOT_NOT_LINKED, BOT_PAUSED, BOT_RESUMED, BOT_RESUMED_NO_PLAN, BOT_SAVE_FAILED, BOT_READ_FAILED, botStatusText, planEndedText } from '../lib/telegramBotText.ts';
import { buildDailySummaryText } from '../lib/dailySummary.ts';
import { typeMuteKeyboard, typeMuteConfirmation } from '../lib/alertTypeMute.ts';

const KEEP = '⁣';
const root = new URL('../', import.meta.url);
const defaults = JSON.parse(readFileSync(new URL('lib/labelDefaults.en.json', root), 'utf8')) as Record<string, string>;
const tgDefaults = Object.fromEntries(Object.entries(defaults).filter(([k]) => k.startsWith('TG_')));
const sql = readFileSync(new URL('supabase/migrations/20261119z5_labels_telegram_language.sql', root), 'utf8');

/* the migration's rows, each block: key -> locale -> value. Handles '' (quote) and E'...' strings (\n). */
type Rows = Map<string, Map<string, string>>;
const ROW = /\('([A-Za-z0-9_]+)','([a-z]{2})',(E?)'((?:[^']|'')*)'\)/g;
function parse(block: string): Rows {
  const out: Rows = new Map();
  for (const m of block.matchAll(ROW)) {
    let v = m[4].replace(/''/g, "'");
    if (m[3] === 'E') v = v.replace(/\\n/g, '\n');
    if (!out.has(m[1])) out.set(m[1], new Map());
    assert.ok(!out.get(m[1])!.has(m[2]), `duplicate row ${m[1]}/${m[2]}`);
    out.get(m[1])!.set(m[2], v);
  }
  return out;
}
const pIdx = sql.indexOf('===================== PROD'), dIdx = sql.indexOf('===================== DEV');
const prod = parse(sql.slice(pIdx, dIdx)), dev = parse(sql.slice(dIdx));
/** the label table a reader of `loc` gets from lib/labelsServer.ts: English underneath, the locale on top */
function labelsOf(loc: TgLocale | 'ar'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, m] of prod) { if (m.has('en')) out[k] = m.get('en')!; if (loc !== 'en' && m.has(loc)) out[k] = m.get(loc)!; }
  return out;
}
const LOCALES: TgLocale[] = ['ko', 'zh', 'ru'];   // ar is English in Telegram since PM 2026-11-18 (2a18e5e6): its rows stay in the migration, unused
const AR = labelsOf('ar');
const L = Object.fromEntries(TG_LOCALES.map((l) => [l, labelsOf(l)])) as Record<TgLocale, Record<string, string>>;

const markup = (s: string) => (s.match(/<[^>]*>|&[a-z]+;/g) ?? []).sort();
const digitsOf = (s: string) => (s.match(/\d+/g) ?? []).sort();
/** the message with every fixed English fragment removed, so the digits that are left are the ones the translation must not touch */
function withoutPhrases(s: string): string {
  let out = s;
  for (const v of Object.values(tgDefaults).sort((a, b) => b.length - a.length)) out = out.split(v).join(' ');
  return out;
}
const subMultiset = (small: string[], big: string[]) => { const c = new Map<string, number>(); for (const b of big) c.set(b, (c.get(b) ?? 0) + 1); for (const s of small) { const n = c.get(s) ?? 0; if (!n) return false; c.set(s, n - 1); } return true; };

const stamp = '⏰ 14:05 UTC';
const catalogue: Array<{ kind: string; text: string; keys: string[] }> = [
  { kind: 'rsi-overbought', text: `⚡ <b>BTC RSI Overbought (1H)</b>\n\nRSI: <b>72</b>\nOverbought zone on the 1-hour chart.\n\n<i>${stamp}</i>`, keys: ['TG_RSI_OB_1H', 'TG_RSI_OB_LINE'] },
  { kind: 'rsi-oversold', text: `⚡ <b>ETH RSI Oversold (1H)</b>\n\nRSI: <b>27</b>\nOversold zone on the 1-hour chart.\n\n<i>${stamp}</i>`, keys: ['TG_RSI_OS_1H', 'TG_RSI_OS_LINE'] },
  { kind: 'rapid-pump', text: `🚀 <b>SOL Rapid Pump +3.4% (1h)</b>\n\nPrice: <b>$151.23</b>\nCandle: 3.4% up\nPattern: <b>Marubozu</b> (1h)\n\n\n<i>${stamp}</i>`, keys: ['TG_RAPID_PUMP', 'TG_L_PRICE', 'TG_L_CANDLE', 'TG_CANDLE_UP', 'TG_L_PATTERN'] },
  { kind: 'rapid-dump', text: `🔻 <b>SOL Rapid Dump -3.4% (15m)</b>\n\nPrice: <b>$140.01</b>\nCandle: 3.4% down\n\n\n<i>${stamp}</i>`, keys: ['TG_RAPID_DUMP', 'TG_CANDLE_DOWN'] },
  { kind: 'whale-buy', text: `🐋 <b>BTC Whale BUY Detected</b>\n\nSize: <b>$2.4M</b> at $68,100.5\nSignal: Large aggressive buy\n\n<i>${stamp}</i>`, keys: ['TG_WHALE_BUY_DETECTED', 'TG_L_SIZE', 'TG_L_SIGNAL', 'TG_WHALE_BUY_LINE'] },
  { kind: 'whale-sell', text: `🐋 <b>BTC Whale SELL Detected</b>\n\nSize: <b>$2.4M</b> at $68,100.5\nSignal: Large aggressive sell\n\n<i>${stamp}</i>`, keys: ['TG_WHALE_SELL_DETECTED', 'TG_WHALE_SELL_LINE'] },
  { kind: 'news-breaking', text: `🚨 <b>Breaking Alert</b>\n\n<b>${tgKeep('Exchange hacked, withdrawals halted')}</b>\nSource: ${tgKeep('Reuters')}\n\n<i>${stamp}</i>`, keys: ['TG_NEWS_BREAKING', 'TG_L_SOURCE'] },
  { kind: 'news-macro', text: `📊 <b>Macro Alert</b>\n\n<b>${tgKeep('Fed holds rates at 5.25%')}</b>\nSource: ${tgKeep('Bloomberg')}\n\n<i>${stamp}</i>`, keys: ['TG_NEWS_MACRO', 'TG_L_SOURCE'] },
  { kind: 'oi-spike', text: `📈 <b>BTC Open Interest Spike - +6.2% in 1h</b>\n\nOpen interest: 81.4K → 86.5K contracts\nOpen interest rising: new positions opening.\n\n<i>${stamp}</i>`, keys: ['TG_OI_SPIKE', 'TG_IN_1H', 'TG_L_OI', 'TG_K_CONTRACTS', 'TG_OI_RISING'] },
  { kind: 'oi-drop', text: `📈 <b>BTC Open Interest Drop - -6.2% in 1h</b>\n\nOpen interest: 86.5K → 81.1K contracts\nOpen interest falling: positions closing.\n\n<i>${stamp}</i>`, keys: ['TG_OI_DROP', 'TG_OI_FALLING'] },
  { kind: 'cvd-bear', text: `⚠️ <b>BTC Bearish CVD Divergence</b>\n\nPrice: <b>+1.2%</b> in 1h\nCVD: <b>Negative</b> - sellers dominating volume\nPrice rose while net taker volume was selling.\n\n<i>${stamp}</i>`, keys: ['TG_CVD_BEAR', 'TG_L_PRICE', 'TG_CVD_NEG', 'TG_CVD_BEAR_LINE'] },
  { kind: 'cvd-bull', text: `⚡ <b>BTC Bullish CVD Divergence</b>\n\nPrice: <b>-1.2%</b> in 1h\nCVD: <b>Positive</b> - buyers absorbing the dip\nPrice fell while net taker volume was buying.\n\n<i>${stamp}</i>`, keys: ['TG_CVD_BULL', 'TG_CVD_POS', 'TG_CVD_BULL_LINE'] },
  { kind: 'price-alert', text: `🎯 <b>BTC Price Alert Triggered</b>\n\n📈 Crossed Above <b>$68,000</b>\nReached: $68,120 (1-minute high at 13:58 UTC)\nCurrent: $68,090\nNote: ${tgKeep('take profit & rebalance')}\n\n<i>${stamp}</i>`, keys: ['TG_PRICE_ALERT', 'TG_CROSSED_ABOVE', 'TG_L_REACHED', 'TG_1M_HIGH_AT', 'TG_L_CURRENT', 'TG_L_NOTE'] },
  { kind: 'price-alert-below', text: `🎯 <b>ETH Price Alert Triggered</b>\n\n📉 Crossed Below <b>$1,900</b>\nCurrent: $1,899.5\n\n<i>${stamp}</i>`, keys: ['TG_PRICE_ALERT', 'TG_CROSSED_BELOW', 'TG_L_CURRENT'] },
  { kind: 'fear', text: `🩸 <b>Extreme Fear - Fear &amp; Greed: 12</b>\n\nClassification: <b>Extreme Fear</b>\nMarket in panic - historically a contrarian accumulation zone\n\n<i>${stamp}</i>`, keys: ['TG_FNG_FEAR', 'TG_L_CLASS', 'TG_FNG_FEAR_LINE'] },
  { kind: 'greed', text: `🔥 <b>Extreme Greed - Fear &amp; Greed: 88</b>\n\nClassification: <b>Extreme Greed</b>\nMarket euphoria - historically a distribution zone\n\n<i>${stamp}</i>`, keys: ['TG_FNG_GREED', 'TG_FNG_GREED_LINE'] },
  { kind: 'sentiment-bear', text: `🚨 <b>Sentiment Extremes - All 3 Bearish</b>\n\n😱 F&amp;G: <b>88</b> Extreme Greed\n💸 BTC funding: <b>+0.0310%</b> - longs paying shorts\n📊 L/S Ratio: <b>71.2% Long</b> / 28.8% Short\n\nSignal: All 3 sentiment gauges at extremes - <b>long-heavy positioning</b>\n\n<i>${stamp}</i>`, keys: ['TG_SENT_BEAR', 'TG_SENT_BTC_FUNDING', 'TG_SENT_LONGS_PAYING', 'TG_PCT_LONG_B', 'TG_PCT_SHORT', 'TG_SENT_ALL3', 'TG_LONG_HEAVY_LC'] },
  { kind: 'sentiment-bull', text: `🟢 <b>Sentiment Extremes - Contrarian BULLISH Setup</b>\n\n😨 F&amp;G: <b>12</b> Extreme Fear\n💸 BTC FR: <b>-0.0210%</b> - Shorts paying\n📊 L/S Ratio: <b>38.2% Long</b> / 61.8% Short\n\nSignal: All 3 sentiment gauges at fear extremes - <b>short-heavy positioning</b>\n\n<i>${stamp}</i>`, keys: ['TG_SENT_BULL', 'TG_SENT_BTC_FR', 'TG_SENT_SHORTS_PAYING', 'TG_SENT_ALL3_FEAR', 'TG_SHORT_HEAVY_LC'] },
  { kind: 'squeeze-short', text: `⚡ <b>SHORT-HEAVY POSITIONING - BTC/USDT</b>\nScore: <b>74/100</b>\n\nFunding: <b>-0.0420%</b> (shorts paying heavily)\nL/S Ratio: <b>38.0% long / 62.0% short</b>\n\n<i>${stamp}</i>`, keys: ['TG_SQ_SHORT_HEAVY', 'TG_L_SCORE', 'TG_L_FUNDING', 'TG_SQ_SHORTS_PAYING', 'TG_L_LS', 'TG_PCT_LONG_SLASH', 'TG_PCT_SHORT_B'] },
  { kind: 'squeeze-long', text: `🔥 <b>LONG-HEAVY POSITIONING - ETH/USDT</b>\nScore: <b>66/100</b>\n\nFunding: <b>+0.0420%</b> (longs paying heavily)\nL/S Ratio: <b>66.0% long / 34.0% short</b>\n\n<i>${stamp}</i>`, keys: ['TG_SQ_LONG_HEAVY', 'TG_SQ_LONGS_PAYING'] },
  { kind: 'distribution', text: `💰 <b>DISTRIBUTION DETECTED - BTC/USDT</b>\nScore: <b>71/100</b>\n\nPrice still up <b>+4.2%</b> in 24h, while these distribution signs show:\n- sample reason line\n\n<i>${stamp}</i>`, keys: ['TG_DIST_DETECTED', 'TG_DIST_STILL_UP', 'TG_DIST_SIGNS'] },
  { kind: 'ema-buy', text: `🟢 <b>BTC/USDT BUY Signal (1H)</b>\n\nEntry: <b>$68,100</b>\nSL: $67,500 · TP: $69,300 (2:1)\n<i>Standard EMA ribbon signal - not your chart's indicator selection.</i>\n\n<i>${stamp}</i>`, keys: ['TG_BUY_SIGNAL', 'TG_L_ENTRY', 'TG_EMA_NOTE'] },
  { kind: 'bos', text: `🔵 <b>BTC/USDT BOS UP (1H)</b>\n\nBreak of Structure - price closed above the prior swing high at <b>$68,000</b>\nClose: <b>$68,050</b>\nVolume: 1.8x average ⚡\n\n<i>Price-action signal - separate from the EMA buy/sell rule.</i>`, keys: ['TG_BOS_UP', 'TG_BOS_ABOVE', 'TG_L_CLOSE', 'TG_L_VOLUME', 'TG_X_AVERAGE', 'TG_STRUCT_NOTE'] },
  { kind: 'confluence-aligned', text: `🔀 <b>BTC - 3 Signals Aligned</b>\n\n• RSI Overbought (1H)\n• Open Interest Spike +6.2% (1h)\n• BTC/USDT SELL Signal (1H)\n\n<i>${stamp}</i>`, keys: ['TG_CONFLUENCE_ALIGNED', 'TG_RSI_OB_1H', 'TG_OI_SPIKE'] },
  { kind: 'confluence-mixed', text: `🔀 <b>BTC - 2 Signals (mixed directions)</b>\n\n• RSI Oversold (1H)\n• Bearish CVD Divergence\n\n<i>${stamp}</i>`, keys: ['TG_CONFLUENCE_MIXED', 'TG_RSI_OS_1H', 'TG_CVD_BEAR'] },
  { kind: 'daily-summary', text: buildDailySummaryText({ dateStr: 'Thu, 19 Nov', threshold: 60, stamp,
    movers: [{ coin: 'btc', label: 'BTC', changePct: 4.21, price: 68100.4, high: 69000, low: 65000 }, { coin: 'eth', label: 'ETH', changePct: -2.3, price: 1900, high: 2000, low: 1850 }, { coin: 'x', label: 'XRP', changePct: 0.01, price: 0.5123, high: NaN, low: NaN }] as never,
    setups: [{ coin: 'sol', label: 'SOL', dir: 'LONG_LIQ', score: 72, fundingPct: 0.0312, longPct: 66 }] as never }),
    keys: ['TG_DS_TITLE', 'TG_DS_MOVES', 'TG_DS_SETUPS', 'TG_DS_IN24_NOW', 'TG_DS_RANGE', 'TG_DS_UP', 'TG_DS_DOWN', 'TG_DS_FLAT', 'TG_DS_FUNDING', 'TG_DS_ACCOUNTS_LONG', 'TG_LONG_HEAVY_LC'] },
  { kind: 'daily-summary-empty', text: buildDailySummaryText({ dateStr: 'Thu, 19 Nov', threshold: 60, stamp, movers: [], setups: [] }), keys: ['TG_DS_NO_DATA', 'TG_DS_NONE'] },
  { kind: 'bot-help', text: BOT_HELP, keys: ['TG_BOT_HELP'] },
  { kind: 'bot-not-linked', text: BOT_NOT_LINKED, keys: ['TG_BOT_NOT_LINKED'] },
  { kind: 'bot-paused', text: BOT_PAUSED, keys: ['TG_BOT_PAUSED'] },
  { kind: 'bot-resumed', text: BOT_RESUMED, keys: ['TG_BOT_RESUMED'] },
  { kind: 'bot-resumed-noplan', text: BOT_RESUMED_NO_PLAN, keys: ['TG_BOT_RESUMED_NO_PLAN'] },
  { kind: 'bot-save-failed', text: BOT_SAVE_FAILED, keys: ['TG_BOT_SAVE_FAILED'] },
  { kind: 'bot-read-failed', text: BOT_READ_FAILED, keys: ['TG_BOT_READ_FAILED'] },
  { kind: 'status-trial-on', text: botStatusText({ plan: 'trial', alerts: 'on', quiet: null }), keys: ['TG_ST_CONNECTED', 'TG_ST_ALERTS_ON', 'TG_ST_QUIET_OFF', 'TG_ST_PLAN', 'TG_ST_PRO_TRIAL'] },
  { kind: 'status-pro-paused-quiet', text: botStatusText({ plan: 'pro', alerts: 'paused', quiet: { start: 22, end: 7, timeZone: 'Asia/Seoul' } }), keys: ['TG_ST_ALERTS', 'TG_ST_PAUSED', 'TG_ST_QUIET'] },
  { kind: 'status-snoozed', text: botStatusText({ plan: 'pro', alerts: 'snoozed', snoozeUntil: '15:30', quiet: null }), keys: ['TG_ST_SNOOZED'] },
  { kind: 'status-free', text: botStatusText({ plan: 'free', alerts: 'on', quiet: null }), keys: ['TG_ST_OFF_PLAN', 'TG_ST_FREE'] },
  { kind: 'test-alert', text: `🔔 <b>Test alert</b>\n\nThis is a test from LiquidityHQ. Your alerts arrive in this chat.\n\n<i>⏰ 14:05 UTC</i>`, keys: ['TG_TEST_TITLE', 'TG_TEST_BODY'] },
  { kind: 'plan-ended-trial', text: planEndedText('https://liquidity-hq.com/pricing', true), keys: ['TG_PLAN_ENDED_TRIAL', 'TG_PLAN_UPGRADE'] },
  { kind: 'plan-ended-pro', text: planEndedText('https://liquidity-hq.com/pricing', false), keys: ['TG_PLAN_ENDED_PRO'] },
  { kind: 'mute-failed', text: 'Could not mute. Try again.', keys: ['TG_MUTE_FAILED'] },
  { kind: 'wh-connect-q', text: `Connect this chat to <b>jo***@gmail.com</b>?\n\nOnly confirm if that is your LiquidityHQ account. If someone else sent you this link, ignore it. You can send /stop at any time to disconnect.`, keys: ['TG_WH_CONNECT_Q', 'TG_WH_CONNECT_WARN'] },
  { kind: 'wh-connected', text: '✅ Connected. Alerts for your LiquidityHQ account will arrive here. Send /stop to disconnect.\n\nThis chat was linked to another LiquidityHQ account, which no longer receives alerts here.', keys: ['TG_WH_CONNECTED', 'TG_WH_DISPLACED'] },
  { kind: 'wh-disconnected', text: 'Disconnected. This chat will not receive LiquidityHQ alerts. Open Alerts in the app and press Connect Telegram to link it again.', keys: ['TG_WH_DISCONNECTED'] },
  { kind: 'wh-moved', text: 'This chat was disconnected: your LiquidityHQ account is now linked to a different chat, so alerts will no longer arrive here.', keys: ['TG_WH_MOVED'] },
  { kind: 'wh-finish-failed', text: '⚠️ Could not finish connecting. Press Confirm again, or start again from the app.', keys: ['TG_WH_FINISH_FAILED_LONG'] },
];

test('L0. CONTROL: the migration was parsed (159 keys, 5 locales each, both blocks) and the catalogue covers every kind', () => {
  assert.equal(prod.size, 159, `PROD block has ${prod.size} keys`);
  assert.equal(dev.size, 159, `DEV block has ${dev.size} keys`);
  assert.equal(Object.keys(tgDefaults).length, 159);
  for (const [k, m] of prod) assert.deepEqual([...m.keys()].sort(), ['ar', 'en', 'ko', 'ru', 'zh'], `${k} locales`);
  assert.ok(catalogue.length >= 45, 'catalogue shrank');
  const used = new Set(catalogue.flatMap((c) => c.keys));
  const unused = Object.keys(tgDefaults).filter((k) => !used.has(k) && !['TG_MUTE_HOURS', 'TG_MUTE_TYPE_HOURS', 'TG_TYPE_OI', 'TG_TYPE_CVD', 'TG_TYPE_RAPID', 'TG_MUTED_FOR', 'TG_WH_CONFIRM', 'TG_WH_CONNECTED_SHORT', 'TG_SESSION_NY', 'TG_SESSION_LONDON', 'TG_SESSION_ASIA', 'TG_SESSION_OFF', 'TG_WH_CONNECTED_AGAIN', 'TG_WH_FINISH_FAILED', 'TG_USDT_BUY', 'TG_USDT_SELL', 'TG_SELL_SIGNAL', 'TG_BOS_DOWN', 'TG_BOS_BELOW', 'TG_CHOCH_UP', 'TG_CHOCH_DOWN', 'TG_CHOCH_ABOVE', 'TG_CHOCH_BELOW', 'TG_LIGHT', 'TG_1M_LOW_AT', 'TG_SQ_IS_SHORT', 'TG_SQ_IS_LONG', 'TG_SQ_SHORT_TITLE', 'TG_SQ_LONG_TITLE', 'TG_DS_LONG_SCORE', 'TG_DS_SHORT_SCORE', 'TG_DIST_TITLE', 'TG_RSI_OB', 'TG_RSI_OS', 'TG_WHALE_BUY', 'TG_WHALE_SELL', 'TG_SENT_BTC_FUNDING'].includes(k));
  assert.deepEqual(unused, [], 'keys never exercised by the catalogue');
});

for (const c of catalogue) {
  test(`L1 ${c.kind}: translated in ko/zh/ru (label text present, tags/entities identical, free numbers kept, no marker); English byte-identical`, () => {
    const keptOut = c.text.replaceAll(KEEP, '');
    for (const loc of LOCALES) {
      const out = localizeTelegram(c.text, loc, L[loc]);
      assert.ok(!out.includes(KEEP), `${loc}: a U+2063 marker survived`);
      assert.notEqual(out, keptOut, `${loc}: nothing was translated`);
      for (const k of c.keys) {
        const want = L[loc][k];
        assert.ok(want && want !== L.en[k], `${loc}: the migration has no distinct ${k} text`);
        assert.ok(out.includes(want), `${loc}: output lacks ${k} = ${JSON.stringify(want)}\n${out}`);
      }
      assert.deepEqual(markup(out), markup(keptOut), `${loc}: tag / entity multiset changed`);
      assert.ok(subMultiset(digitsOf(withoutPhrases(keptOut)), digitsOf(out)), `${loc}: a number outside the fixed phrases changed\n${out}`);
    }
    // English: with the real en table, with a ko table, with no table: unchanged apart from the markers
    assert.equal(localizeTelegram(c.text, 'en', L.en), keptOut);
    assert.equal(localizeTelegram(c.text, 'en', L.ko), keptOut, 'en reader given a ko table');
    assert.equal(localizeTelegram(c.text, 'en', null), keptOut);
    assert.equal(localizeTelegram(c.text, 'ko', null), keptOut, 'ko reader with NO label table must read English');
    assert.equal(localizeTelegram(c.text, 'ko', {}), keptOut, 'ko reader with an empty table must read English');
  });
}

test('L1c. where a fragment may match (PR text): start-only labels never match mid-line, end-only "% up" never mid-line, whole-line "Alerts: on" never inside a longer line', () => {
  for (const loc of LOCALES) {
    for (const t of ['rose. Price: 5', 'BTC Current: 3 Note: z', 'a Open interest: 4', 'x Source: y', 'Price Source: y']) {
      const out = localizeTelegram(t, loc, L[loc]);
      assert.ok(!out.includes(L[loc].TG_L_PRICE) && !out.includes(L[loc].TG_L_CURRENT) && !out.includes(L[loc].TG_L_NOTE) && !out.includes(L[loc].TG_L_OI) && !out.includes(L[loc].TG_L_SOURCE), `${loc}: a start-only label matched mid-line in ${JSON.stringify(t)} -> ${JSON.stringify(out)}`);
    }
    assert.ok(!localizeTelegram('Candle: 3% up today', loc, L[loc]).includes(L[loc].TG_CANDLE_UP), `${loc}: % up matched mid-line`);
    assert.ok(!localizeTelegram('Alerts: on now', loc, L[loc]).includes(L[loc].TG_ST_ALERTS_ON), `${loc}: "Alerts: on" matched inside a longer line`);
    assert.ok(localizeTelegram('Alerts: on', loc, L[loc]).includes(L[loc].TG_ST_ALERTS_ON), `${loc}: whole-line match control`);
    assert.ok(localizeTelegram('x\nPrice: 5', loc, L[loc]).includes(L[loc].TG_L_PRICE), `${loc}: start-of-line control`);
  }
});
test('L1b. the mute buttons and the mute reply: ko/zh/ru text, callback data untouched, English untouched', () => {
  for (const loc of LOCALES) {
    const one = typeMuteKeyboard(['oi_spike'])!, many = typeMuteKeyboard(['oi_spike', 'cvd', 'rapid_move'])!;
    const o1 = localizeKeyboard(one, loc, L[loc])!, o3 = localizeKeyboard(many, loc, L[loc])!;
    assert.deepEqual(o1.inline_keyboard.flat().map((b) => b.callback_data), one.inline_keyboard.flat().map((b) => b.callback_data));
    assert.deepEqual(o3.inline_keyboard.flat().map((b) => b.callback_data), many.inline_keyboard.flat().map((b) => b.callback_data));
    const want1 = [1, 4].map((h) => L[loc].TG_MUTE_HOURS.replace('{h}', String(h)));
    assert.deepEqual(o1.inline_keyboard.flat().map((b) => b.text), want1, `${loc} single-type buttons`);
    assert.ok(o3.inline_keyboard.flat().every((b) => !/[{}]/.test(b.text) && !/^Mute /.test(b.text)), `${loc}: a long-form button is still English or has a raw placeholder`);
    assert.ok(o3.inline_keyboard[0][0].text.includes(L[loc].TG_TYPE_OI) && o3.inline_keyboard[1][0].text.includes(L[loc].TG_TYPE_CVD) && o3.inline_keyboard[2][0].text.includes(L[loc].TG_TYPE_RAPID), `${loc} type names`);
    for (const [rk, key] of [['oi_spike', 'TG_TYPE_OI'], ['cvd', 'TG_TYPE_CVD'], ['rapid_move', 'TG_TYPE_RAPID']] as const) {
      const r = typeMuteConfirmationIn(rk, 4, L[loc]);
      assert.equal(r, L[loc].TG_MUTED_FOR.replace('{type}', L[loc][key]).replace('{h}', '4'), `${loc} ${rk} reply`);
      assert.ok(!/[{}]/.test(r));
    }
  }
  const one = typeMuteKeyboard(['cvd'])!;
  assert.equal(localizeKeyboard(one, 'en', L.ko), one, 'en keyboard is the same object');
  assert.equal(localizeKeyboard(one, 'ko', null), one, 'ko without labels is the same object');
  for (const rk of ['oi_spike', 'cvd', 'rapid_move'] as const) assert.equal(typeMuteConfirmationIn(rk, 1, null), typeMuteConfirmation(rk, 1), `English reply for ${rk} equals the pre-PR text`);
  const foreign = { inline_keyboard: [[{ text: 'Confirm', callback_data: 'link:abc' }]] };
  assert.deepEqual(localizeKeyboard(foreign, 'ko', L.ko), foreign, 'a non-mute button is left alone');
});

test('L2a. markers: removed on every path, in every locale, with and without labels; unbalanced and nested markers too', () => {
  const msgs = [`a ${KEEP}b${KEEP} c`, `${KEEP}${KEEP}`, `x${KEEP}`, `${KEEP}x`, `${KEEP}a${KEEP}${KEEP}b${KEEP}`, KEEP, `Price: ${tgKeep('Price: 5')}`];
  for (const m of msgs) for (const loc of TG_LOCALES) for (const lab of [L[loc], null, {}, L.ko]) assert.ok(!localizeTelegram(m, loc, lab).includes(KEEP), `marker left: ${JSON.stringify(m)} ${loc}`);
});
test('L2b. a headline / source / note that IS any of the 159 English phrases stays English in every locale (and inside the real news layout)', () => {
  const bad: string[] = [];
  for (const [key, en] of Object.entries(tgDefaults)) {
    const safe = en.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); // what escapeHtml does before tgKeep
    for (const loc of LOCALES) {
      const msg = `🚨 <b>Breaking Alert</b>\n\n<b>${tgKeep(safe)}</b>\nSource: ${tgKeep(safe)}\n\nNote: ${tgKeep(safe)}\n<i>${stamp}</i>`;
      const out = localizeTelegram(msg, loc, L[loc]);
      if (out.split(safe).length - 1 !== 3) bad.push(`${loc} ${key}: ${JSON.stringify(safe)} appears ${out.split(safe).length - 1}x, want 3`);
      if (!out.includes(L[loc].TG_NEWS_BREAKING) || !out.includes(L[loc].TG_L_SOURCE) || !out.includes(L[loc].TG_L_NOTE)) bad.push(`${loc} ${key}: the surrounding fixed text was not translated`);
    }
  }
  assert.deepEqual(bad, []);
});
test('L2c. injection: a note containing U+2063, the translatable phrases and HTML cannot break out of its protection or reach a chat', () => {
  const hostile = [
    `x${KEEP} Price Alert Triggered ${KEEP}y`,
    `${KEEP}${KEEP}${KEEP} Breaking Alert`,
    `Breaking Alert${KEEP}`,
    `${KEEP}Source: ${KEEP}`,
    `{list} {h} {type} Mute {h} h`,
    `&lt;b&gt;Price: &amp; Open interest: `,
    `\n\nPrice: 5\nAlerts: on\n`,
  ];
  for (const h of hostile) for (const loc of LOCALES) {
    const wrapped = tgKeep(h.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    const msg = `🎯 <b>BTC Price Alert Triggered</b>\n\nCurrent: $5\nNote: ${wrapped}\nReached: $6\n\n<i>${stamp}</i>`;
    const out = localizeTelegram(msg, loc, L[loc]);
    assert.ok(!out.includes(KEEP), `marker leaked for ${JSON.stringify(h)} ${loc}`);
    const noteLine = out.split('\n').slice(4).join('\n'); // everything after the first Note line start
    const inner = h.replaceAll(KEEP, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    assert.ok(out.includes(inner), `${loc}: the note was altered: ${JSON.stringify(h)} -> ${JSON.stringify(noteLine)}`);
    assert.ok(out.includes(L[loc].TG_PRICE_ALERT) && out.includes(L[loc].TG_L_REACHED), `${loc}: the text AFTER the note was not translated (the note swallowed the rest): ${out}`);
  }
  assert.equal(tgKeep(`a${KEEP}b`), `${KEEP}ab${KEEP}`, 'tgKeep strips an embedded marker');
});

test('L3a. a bad label row leaves the English text for that fragment: adds / removes / unbalances a tag, raw < > &, an added entity', () => {
  const cases: Array<[string, string, string]> = [
    ['adds a tag', 'TG_L_PRICE', '<b>가격</b>: '],
    ['unbalanced open tag', 'TG_ST_CONNECTED', '<b>연결됨'],
    ['removes the tag', 'TG_ST_CONNECTED', '연결됨'],
    ['raw less-than', 'TG_L_NOTE', '메모 < 참고: '],
    ['raw greater-than', 'TG_L_NOTE', '메모 > 참고: '],
    ['raw ampersand', 'TG_FNG_FEAR', '극단적 공포 - Fear & Greed:'],
    ['added entity', 'TG_L_NOTE', '메모 &lt;x&gt; '],
    ['an href injection', 'TG_L_NOTE', '<a href="https://evil.example">메모</a>: '],
    ['wrong tag kind', 'TG_ST_CONNECTED', '<i>연결됨</i>'],
  ];
  const probe: Record<string, string> = {
    TG_L_PRICE: 'Price: <b>$5</b>', TG_ST_CONNECTED: '<b>Connected</b>\nPlan: Pro', TG_L_NOTE: 'Note: x', TG_FNG_FEAR: '🩸 <b>Extreme Fear - Fear &amp; Greed: 12</b>',
  };
  for (const [name, key, value] of cases) {
    const out = localizeTelegram(probe[key], 'ko', { ...L.ko, [key]: value });
    assert.ok(out.includes(tgDefaults[key]), `${name}: the English fragment was not kept: ${out}`);
    assert.ok(!out.includes(value), `${name}: the bad row reached the message: ${out}`);
    assert.deepEqual(markup(out).filter((t) => /href|<a|<i>/.test(t) && !probe[key].includes(t)), [], `${name}: a foreign tag appeared`);
  }
});
test('L3b. a missing, empty, blank or English-equal row is English', () => {
  const probe = 'Note: x\nPrice: 5';
  const miss = { ...L.ko }; delete miss.TG_L_NOTE;
  assert.equal(localizeTelegram(probe, 'ko', miss), `Note: x\n${L.ko.TG_L_PRICE}5`, 'missing row');
  for (const v of ['', '   ', '\n']) assert.equal(localizeTelegram(probe, 'ko', { ...L.ko, TG_L_NOTE: v }), `Note: x\n${L.ko.TG_L_PRICE}5`, `blank row ${JSON.stringify(v)}`);
  assert.equal(localizeTelegram(probe, 'ko', { ...L.ko, TG_L_NOTE: 'Note: ' }), `Note: x\n${L.ko.TG_L_PRICE}5`, 'English-equal row');
});
test('L3b2. a row equal to its KEY NAME must not reach a chat (the lead brief: "equal to a key name -> English")', { todo: 'F1 (Low): tgLabel does not guard a key-name row or a foreign {placeholder}; remove this option when fixed' }, () => {
  const keyName = localizeTelegram('Note: x\nPrice: 5', 'ko', { ...L.ko, TG_L_NOTE: 'TG_L_NOTE' });
  assert.ok(!keyName.includes('TG_L_NOTE'), `a row equal to its key name reached the message: ${JSON.stringify(keyName)}`);
});
test('L3b3. a row holding a raw {placeholder} the English does not have must not reach a chat', { todo: 'F1 (Low): tgLabel does not guard a key-name row or a foreign {placeholder}; remove this option when fixed' }, () => {
  const ph = localizeTelegram('Note: x', 'ko', { ...L.ko, TG_L_NOTE: '메모 {name}: ' });
  assert.ok(!/\{\w+\}/.test(ph), `a raw {placeholder} reached the message: ${JSON.stringify(ph)}`);
});
test('L3b4. a button / reply row with a wrong {placeholder} must not print it raw', { todo: 'F1 (Low): tgLabel does not guard a key-name row or a foreign {placeholder}; remove this option when fixed' }, () => {
  const phKey = tgText('TG_MUTE_HOURS', { ...L.ko, TG_MUTE_HOURS: '{hours}시간 음소거' }, { h: 1 });
  assert.ok(!/\{\w+\}/.test(phKey), `a button label with a wrong {placeholder} reached the chat: ${JSON.stringify(phKey)}`);
});
test('L3c. tgLabel / tgText: English default for a missing, unsafe or blank row; placeholders filled; an unknown key is the key', () => {
  assert.equal(tgLabel('TG_L_NOTE', null), 'Note: ');
  assert.equal(tgLabel('TG_L_NOTE', L.ko), L.ko.TG_L_NOTE);
  assert.equal(tgText('TG_MUTE_HOURS', L.ko, { h: 4 }), L.ko.TG_MUTE_HOURS.replace('{h}', '4'));
  assert.equal(tgText('TG_MUTE_HOURS', null, { h: 4 }), 'Mute 4 h');
});
test('L3d. length: worst ratio of a translated message to its English, and every catalogue message stays under 4096 characters (report only)', () => {
  const rows: string[] = []; let worst = { r: 0, id: '' }, longest = { n: 0, id: '' };
  for (const c of catalogue) for (const loc of LOCALES) {
    const en = c.text.replaceAll(KEEP, ''), out = localizeTelegram(c.text, loc, L[loc]);
    const r = out.length / en.length; if (r > worst.r) worst = { r, id: `${c.kind}/${loc} ${en.length}->${out.length}` };
    if (out.length > longest.n) longest = { n: out.length, id: `${c.kind}/${loc}` };
    assert.ok(out.length <= 4096, `${c.kind}/${loc} is ${out.length} chars`);
  }
  rows.push(`worst length ratio ${worst.r.toFixed(2)} (${worst.id}); longest ${longest.n} (${longest.id})`);
  console.log(`# L3d ${rows.join(' | ')}`);
  // the daily summary is the only unbounded message (squeeze setups are not capped): 4096 breaks at about this many setups
  const mk = (n: number) => buildDailySummaryText({ dateStr: 'Thu, 19 Nov', threshold: 60, stamp, movers: [], setups: Array.from({ length: n }, (_, i) => ({ coin: 'c' + i, label: 'COIN' + i, dir: 'LONG_LIQ', score: 72, fundingPct: 0.0312, longPct: 66 })) as never });
  const cap = (loc: TgLocale) => { let n = 1; while (localizeTelegram(mk(n), loc, L[loc]).length <= 4096) n++; return n; };
  console.log(`# L3d daily-summary setups that exceed 4096 chars: ${TG_LOCALES.map((l) => `${l} ${cap(l)}`).join(', ')}`);
  assert.ok(cap('en') > 1);
});

test('L4. tgLocaleOf: five locales map to themselves; everything else is English; the date locale is per language', () => {
  for (const l of TG_LOCALES) assert.equal(tgLocaleOf(l), l);
  for (const x of ['ko-KR', 'zh-TW', 'zh-CN', 'pt-BR', 'vi', 'tr', 'es', 'id', 'KO', 'Ko', ' ko', 'ko ', '', null, undefined, 'xx', 'ar', 'AR', 'ar-SA', 'toString', '__proto__', 'constructor', 'en-GB', 'ar-SA', '한국어', 'ru-RU']) assert.equal(tgLocaleOf(x as never), 'en', `tgLocaleOf(${JSON.stringify(x)})`);
  const d = new Date(Date.UTC(2026, 10, 19, 12));
  const f = (l: TgLocale) => d.toLocaleString(tgDateLocale(l), { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  assert.match(f('en'), /^Thu,? 19 Nov$/);
  assert.match(f('ko'), /11월 19일 \(목\)/);
  assert.match(f('zh'), /11月19日/);
  assert.match(f('ru'), /19/); assert.match(f('ru'), /[а-я]/i);
  assert.ok(!(TG_LOCALES as readonly string[]).includes('ar'), 'ar must not be a Telegram locale');
});

test('L5a. migration 20261119z5: PROD = DEV, en = labelDefaults, registered keys, same {placeholders} in all 5 locales, no vendor name, no empty/identical-to-key rows', () => {
  const keysSrc = readFileSync(new URL('lib/labelKeys.ts', root), 'utf8');
  const bad: string[] = [];
  for (const [k, m] of prod) {
    const d = dev.get(k);
    if (!d) { bad.push(`${k}: not in DEV`); continue; }
    for (const loc of ['en', 'ko', 'zh', 'ru', 'ar']) {
      const v = m.get(loc)!;
      if (d.get(loc) !== v) bad.push(`${k}/${loc}: PROD != DEV`);
      if (!v.trim()) bad.push(`${k}/${loc}: empty`);
      if (v === k) bad.push(`${k}/${loc}: equals the key`);
      if (/\b(claude|anthropic|openai|gpt|grok|gemini|xai|chatgpt)\b/i.test(v)) bad.push(`${k}/${loc}: vendor name`);
      if (/[⁣​-‏‪-‮]/.test(v)) bad.push(`${k}/${loc}: invisible/bidi control character in the label text`);
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
      if (ph(v) !== ph(m.get('en')!)) bad.push(`${k}/${loc}: placeholders ${ph(v)} vs en ${ph(m.get('en')!)}`);
      if (loc !== 'en' && markup(v).join('') !== markup(m.get('en')!).join('')) bad.push(`${k}/${loc}: tags/entities differ from English (the runtime would silently fall back to English for this fragment)`);
    }
    if (m.get('en') !== defaults[k]) bad.push(`${k}: en != labelDefaults.en.json`);
    if (!keysSrc.includes(`'${k}'`)) bad.push(`${k}: not registered in labelKeys.ts`);
  }
  for (const k of dev.keys()) if (!prod.has(k)) bad.push(`${k}: not in PROD`);
  assert.deepEqual(bad, []);
  const phrasesKeys = TG_PHRASES.map(([k]) => k).sort();
  assert.deepEqual(phrasesKeys, Object.keys(tgDefaults).sort(), 'telegramPhrases.ts and the 159 label defaults list different keys');
  assert.ok(sql.startsWith('-- NOT YET APPLIED TO ANY DATABASE'), 'the held header is the first line');
});
test('L5b. held: with NO label rows (migration not applied) every message of every kind is English and nothing throws', () => {
  for (const c of catalogue) for (const loc of LOCALES) {
    for (const lab of [null, undefined, {}, { TG_UNRELATED: 'x' }]) assert.equal(localizeTelegram(c.text, loc, lab as never), c.text.replaceAll(KEEP, ''), `${c.kind}/${loc}`);
  }
  for (const loc of LOCALES) {
    const kb = typeMuteKeyboard(['oi_spike'])!;
    assert.deepEqual(localizeKeyboard(kb, loc, {})!.inline_keyboard.flat().map((b) => b.text), ['Mute 1 h', 'Mute 4 h'], 'keyboard with an empty table');
    assert.equal(typeMuteConfirmationIn('oi_spike', 1, {}), 'Open interest alerts muted for 1 h.');
  }
});
test('L5c. word budgets do not apply to bot text; list English labels over 25 words (report only)', () => {
  const over = Object.entries(tgDefaults).filter(([, v]) => v.trim().split(/\s+/).length > 25).map(([k, v]) => `${k} (${v.trim().split(/\s+/).length})`);
  console.log(`# L5c english labels over 25 words: ${over.join(', ') || 'none'}`);
  assert.ok(true);
});

test('A1. ARABIC IS ENGLISH (PM 2026-11-18, head 2a18e5e6): language ar gives English everywhere, byte-identical to the English path, no U+2063, no Arabic text; ko / zh / ru still translate; the ar migration rows stay but the sender never uses them', () => {
  assert.equal(tgLocaleOf('ar'), 'en'); assert.deepEqual([...TG_LOCALES], ['en', 'ko', 'zh', 'ru']);
  const ARABIC = /[؀-ۿݐ-ݿ]/;
  for (const c of catalogue) {
    const reader = tgLocaleOf('ar');
    const viaAr = localizeTelegram(c.text, reader, L[reader]), viaEn = localizeTelegram(c.text, 'en', L.en), keptOut = c.text.replaceAll(KEEP, '');
    assert.equal(viaAr, viaEn, `${c.kind}: an ar reader differs from the English path`); assert.equal(viaAr, keptOut, `${c.kind}: an ar reader is not byte-identical to the English text`);
    assert.ok(!viaAr.includes(KEEP) && !ARABIC.test(viaAr), `${c.kind}: marker or Arabic text reached an ar reader`);
    // CONTROL: the same message does translate for the other three
    for (const loc of LOCALES) assert.notEqual(localizeTelegram(c.text, tgLocaleOf(loc), L[tgLocaleOf(loc)]), keptOut, `${c.kind}/${loc}: stopped translating`);
  }
  const kb = typeMuteKeyboard(['oi_spike'])!;
  assert.deepEqual(localizeKeyboard(kb, tgLocaleOf('ar'), L[tgLocaleOf('ar')])!.inline_keyboard.flat().map((b) => b.text), ['Mute 1 h', 'Mute 4 h']);
  assert.equal(typeMuteConfirmationIn('cvd', 4, null), typeMuteConfirmation('cvd', 4), 'the ar mute reply is the English one');
  assert.equal(tgText('TG_MUTE_HOURS', null, { h: 1 }), 'Mute 1 h');
  assert.deepEqual(['ko', 'zh', 'ru'].map((l) => tgLocaleOf(l)), ['ko', 'zh', 'ru'], 'the ko / zh / ru codes still translate');
  // the ar rows are still in the migration (ready for when Arabic returns), complete and not English
  for (const [k, m] of prod) { assert.ok(m.has('ar') && m.get('ar')!.trim(), `${k}: ar row missing`); }
  assert.ok([...prod.values()].filter((m) => ARABIC.test(m.get('ar')!)).length > 100, 'the ar rows lost their Arabic text');
  assert.ok(Object.keys(AR).length >= 159);
});
