/* #2461: Binance moved the futures market streams to /market. The old paths (fstream.binance.com/stream, /ws) connect but deliver
   ZERO events, so a liq feed or whale feed built on them is silently empty. Every futures WebSocket URL in the app must carry /market. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const FILES = ['lib/liqCollector.ts', 'components/LiqFeed.tsx', 'components/WhaleTradesFeed.tsx', 'components/MarketProvider.tsx'];
const URL_RE = /wss:\/\/fstream\.binance\.com\/[^\s'"`?]*/g;

test('N1. every fstream.binance.com socket URL in code uses the /market path', () => {
  let seen = 0;
  for (const f of FILES) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.match(URL_RE) ?? []) {
      seen++;
      assert.match(m, /^wss:\/\/fstream\.binance\.com\/market\/(stream|ws\/)/, `${f}: ${m} is the retired path and receives no events`);
    }
  }
  assert.ok(seen >= 4, `only ${seen} futures socket URLs found: the scan lost its target`);
});

test('N2. no source file under app/components/lib builds a retired fstream /stream or /ws URL', () => {
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${d}/${e.name}`] : []);
  const bad = ['app', 'components', 'lib'].flatMap(walk).filter((f) =>
    /fstream\.binance\.com\/(stream|ws)\b/.test(fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
  assert.deepEqual(bad, []);
});
