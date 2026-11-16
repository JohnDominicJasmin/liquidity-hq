/* #2467: four fixes from QA's signed-out prod explore (run 43904397684). Each defect was a console error on a PUBLIC page.
 *   I1-I3  coin icons: CoinIcon asks the server for /coin-icons/<id>.png ONLY for an id in COIN_ICON_IDS, and that set IS the directory (both ways)
 *   K1-K3  SPXUSDT is futures-only; asked of Binance SPOT it is a 400 on every call. binanceKlineSource() picks the source and every caller that builds a klines
 *          URL from the futures symbol map uses it (7 call sites measured); the two that must stay `source=binance` are named
 *   A1     /alerts: no request to /api/price-alerts while auth is loading or signed out (a 401 per visit); a signed-in failure keeps the error path
 *   T1     /api/telegram/bot-info: a failure is cached 10 s (was 60 s: one cold-start failure answered 503 for a minute), success still 5 min
 * Structure pins (K2, A1, T1) are source anchors: the callers are JSX/hooks with no DOM harness here; the rendered proof is the signed-out browser run. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { COIN_ICON_IDS } from '../lib/coinIconSet.ts';
import { BINANCE_SYMS, BINANCE_SPOT_EXCLUDED, binanceKlineSource } from '../lib/coins.ts';
import { appPath } from './_appPath.mts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const once = (src: string, needle: string, label: string) => assert.equal(src.split(needle).length - 1, 1, `${label}: anchor occurs ${src.split(needle).length - 1} time(s), expected exactly 1`);

test('I1. COIN_ICON_IDS is exactly the .png files in public/coin-icons: no id without a file (a 404 per coin), no file without an id (an icon never shown)', () => {
  const files = readdirSync(new URL('../public/coin-icons/', import.meta.url)).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)).sort();
  assert.ok(files.length >= 40, `only ${files.length} icon files found: the listing lost its target`);
  const ids = [...COIN_ICON_IDS].sort();
  assert.deepEqual(ids.filter((i) => !files.includes(i)), [], 'ids with NO file: each one is a 404');
  assert.deepEqual(files.filter((f) => !ids.includes(f)), [], 'files with no id: the icon is never requested');
});
test('I2. the coins QA saw 404 (lit xag vrt ksm djt bbx trust 4 eido eqt sahara aster zec spcx evaa) are not in the set, so they draw the fallback with no request', () => {
  for (const id of ['lit', 'xag', 'vrt', 'ksm', 'djt', 'bbx', 'trust', '4', 'eido', 'eqt', 'sahara', 'aster', 'zec', 'spcx', 'evaa']) assert.equal(COIN_ICON_IDS.has(id), false, `${id} is in the set but has no file`);
  for (const id of ['btc', 'eth', 'sol']) assert.equal(COIN_ICON_IDS.has(id), true, `${id} lost its icon`);
});
test('I3. CoinIcon requests a file only for a listed id and draws the neutral shape otherwise (never a letter)', () => {
  const src = code(read('components/CoinIcon.tsx'));
  once(src, 'const hasIcon = COIN_ICON_IDS.has(coin);', 'the request is gated on the set');
  once(src, 'if (failed || !hasIcon) {', 'an unlisted coin takes the fallback branch');
  assert.ok(src.indexOf('if (failed || !hasIcon) {') < src.indexOf('src={src}') || !src.includes('src={src}'), 'the image is rendered before the unlisted coin returns the fallback');
});

test('K1. binanceKlineSource: spot-listed coins read binance, futures-only coins (SPX, every BINANCE_SPOT_EXCLUDED) read binance-futures', () => {
  assert.equal(binanceKlineSource('spx'), 'binance-futures');
  assert.equal(binanceKlineSource('btc'), 'binance');
  assert.ok(BINANCE_SPOT_EXCLUDED.includes('spx'), 'the control moved: SPX is no longer futures-only, so this cell no longer measures the defect');
  for (const id of BINANCE_SPOT_EXCLUDED) assert.equal(binanceKlineSource(id), 'binance-futures', `${id} is futures-only and would 400 on spot`);
  for (const id of Object.keys(BINANCE_SYMS).filter((i) => !BINANCE_SPOT_EXCLUDED.includes(i))) assert.equal(binanceKlineSource(id), 'binance', `${id} is spot-listed`);
});
test('K2. every klines URL built from the futures symbol map takes its source from binanceKlineSource; only the two named callers keep a literal source=binance', () => {
  const walk = (d: string): string[] => readdirSync(new URL(`../${d}/`, import.meta.url), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${d}/${e.name}`] : []);
  const files = ['app', 'components', 'lib'].flatMap(walk);
  const literal = files.filter((f) => /\/api\/market\/klines\?source=binance&/.test(code(read(f)))).sort();
  assert.deepEqual(literal, ['components/KLineProChart.tsx', 'components/VolatilityRegime.tsx'],
    'a caller builds a klines URL with a hard-coded spot source: a futures-only coin is a 400 there. KLineProChart (spot first, then futures) and VolatilityRegime (a fixed symbol) are the only intended ones');
  const viaHelper = files.filter((f) => /\/api\/market\/klines\?source=\$\{binanceKlineSource\(/.test(code(read(f)))).sort();
  assert.ok(viaHelper.length >= 5, `only ${viaHelper.length} files use the helper in a klines URL: ${viaHelper.join(', ')}`);
  for (const f of ['components/AbsorptionDetector.tsx', 'components/GrokChat.tsx', 'components/MarketStructure.tsx', 'lib/sparklineData.ts']) assert.ok(viaHelper.includes(f), `${f} lost the helper`);
  const arena = code(read(appPath('app/arena/page.tsx')));
  assert.ok((arena.match(/source=\$\{binanceKlineSource\(selectedCoin\)\}/g) ?? []).length >= 2, 'the Arena page lost the helper on one of its two reads');
  assert.match(code(read('components/CorrelationTerminal.tsx')), /const binSource = binanceKlineSource\(id\);/, 'the correlation page lost the helper (the 400 QA saw)');
});

test('A1. /alerts asks for price alerts only for a signed-in user: nothing while auth loads, an empty list (no error) when signed out', () => {
  const src = code(read(appPath('app/alerts/page.tsx')));
  const a = src.indexOf('const loadPriceAlerts = useCallback(async () => {');
  assert.ok(a > 0, 'loadPriceAlerts not found');
  const body = src.slice(a, src.indexOf("fetch('/api/price-alerts'", a));
  assert.ok(body.includes('if (authLoading) return;'), 'a request can leave while auth is still loading');
  assert.ok(/if \(!signedIn\) \{ setPriceAlerts\(\[\]\);[^}]*return; \}/.test(body), 'a signed-out visitor still reaches the fetch (a 401 per visit)');
  assert.ok(src.indexOf("fetch('/api/price-alerts'", a) > a + body.indexOf('if (!signedIn)'), 'the fetch runs before the signed-out guard');
});

test('T1. /api/telegram/bot-info: a failure is cached 10 s, a success 5 min, and the failure branch uses the failure TTL', () => {
  const src = code(read('app/api/telegram/bot-info/route.ts'));
  once(src, 'const OK_TTL_MS = 5 * 60_000;', 'success TTL');
  once(src, 'const FAIL_TTL_MS = 10_000;', 'failure TTL');
  once(src, 'ttl: FAIL_TTL_MS, info', 'the failure is cached with the failure TTL');
  once(src, 'ttl: OK_TTL_MS, info', 'the success is cached with the success TTL');
});
