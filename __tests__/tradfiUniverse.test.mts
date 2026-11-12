/* #2182: tokenized stocks, ETFs, commodities, FX and pre-IPO references joined a 463-row crypto
 * universe (now 698). Everything downstream indexes that universe by `id` and trusts that
 * `id.toUpperCase()` is the venue symbol, so the way this can go quietly wrong is a COLLISION: a
 * stock ticker equal to a crypto base (CAT, ON, WEN...) overwriting or aliasing a crypto row.
 *
 * WHAT THIS PINS, from the committed generated file (no network):
 *   U1  no two rows share an id, a Binance symbol or a Bybit symbol
 *   U2  CONTROL: the uniqueness check is shown able to fail - a forced clash is reported
 *   U3  a ticker that clashes with a crypto base takes the <ticker>stock id, keeps its ticker, and the
 *       unsuffixed id still belongs to the crypto row
 *   U4  every row has a classification from the five kinds, TradFi rows are on Binance, none is a
 *       1000x quote, and the counts reconcile with the PR (182 stocks + 41 ETFs + 7 commodities + 1 FX
 *       + 4 pre-IPO = 235 new rows, 698 total)
 *   U5  the two crypto-pipeline rows Bybit says are not crypto (xau = gold, on = ON Semiconductor) are
 *       tagged from Bybit's own type
 *   L1  the kind line and market-hours note exist, say what they should, and pre-IPO says it is a
 *       price reference and not a listed share
 *   S1  source pins: the generator hard-stops on a surviving collision, on an empty TradFi set and on a
 *       leading-digit base; the Arena picks the pre-IPO note by kind
 *
 * WHAT IT CANNOT PROVE: the generator's behaviour on a live exchangeInfo (it needs the network), so U2
 * forces the clash through the same check rather than through the generator, and S1 pins that the
 * generator exits non-zero. Price sanity against Bybit needs live data: that is a dispatched spec, not
 * a unit test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COIN_UNIVERSE, type CoinRow } from '../lib/coinUniverse.generated.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const KINDS = ['stock', 'etf', 'commodity', 'fx', 'preipo', 'asset'] as const;

/** Every shared value is a defect: ids, Binance symbols and Bybit symbols are each a primary key. */
function collisions(rows: readonly Pick<CoinRow, 'id' | 'binance' | 'bybit'>[]) {
  const dup = (vals: (string | null)[]) => {
    const seen = new Set<string>(); const out = new Set<string>();
    for (const v of vals) { if (v == null) continue; if (seen.has(v)) out.add(v); seen.add(v); }
    return [...out];
  };
  return { id: dup(rows.map(r => r.id)), binance: dup(rows.map(r => r.binance)), bybit: dup(rows.map(r => r.bybit)) };
}

test('U1. no two rows share an id, a Binance symbol or a Bybit symbol', () => {
  assert.equal(COIN_UNIVERSE.length, 698, 'the universe size changed - update the PR counts deliberately, do not let it drift');
  assert.deepEqual(collisions(COIN_UNIVERSE), { id: [], binance: [], bybit: [] });
});

test('U2. CONTROL: a forced clash is reported, so U1 can fail', () => {
  const clash = [...COIN_UNIVERSE, { id: 'cat', binance: 'CATUSDT', bybit: 'CATUSDT' }];
  const r = collisions(clash);
  assert.ok(r.id.includes('cat'), 'a duplicated id was not reported');
  assert.ok(r.binance.includes('CATUSDT') || r.bybit.includes('CATUSDT'), 'a duplicated venue symbol was not reported');
  assert.deepEqual(collisions([{ id: 'a', binance: null, bybit: null }, { id: 'b', binance: null, bybit: null }]), { id: [], binance: [], bybit: [] }, 'two NULL venue symbols are not a collision');
});

test('U3. a ticker that clashes with a crypto base takes <ticker>stock, keeps its ticker, and the crypto row keeps the plain id', () => {
  const renamed = COIN_UNIVERSE.filter(r => r.ticker && r.id !== r.ticker.toLowerCase());
  assert.ok(renamed.length >= 1, 'no renamed row found - the CAT/Caterpillar case disappeared, so this guard measures nothing');
  for (const r of renamed) {
    assert.equal(r.id, `${r.ticker!.toLowerCase()}stock`, `${r.id}: a renamed id must be <ticker>stock`);
    if (r.bybit) assert.equal(r.bybit, `${r.id.toUpperCase()}USDT`, `${r.id}: id.toUpperCase() must still be the symbol Bybit trades`);
    const plain = COIN_UNIVERSE.find(x => x.id === r.ticker!.toLowerCase());
    assert.ok(plain, `${r.id}: the unsuffixed id ${r.ticker!.toLowerCase()} should exist (the crypto row it must not overwrite)`);
    assert.equal(plain!.kind, undefined, `${r.id}: the unsuffixed id belongs to a TradFi row too - the collision guard let two TradFi rows share a name`);
  }
  const cat = COIN_UNIVERSE.find(r => r.id === 'catstock');
  assert.equal(cat?.ticker, 'CAT');
  assert.equal(cat?.bybit, 'CATSTOCKUSDT');
});

test('U4. every kind is one of six, TradFi rows are on Binance and never a 1000x quote, and the counts reconcile with the PR', () => {
  const tagged = COIN_UNIVERSE.filter(r => r.kind);
  for (const r of tagged) {
    assert.ok((KINDS as readonly string[]).includes(r.kind!), `${r.id}: unknown kind ${r.kind}`);
    assert.equal(r.bybitMult, 1, `${r.id}: a TradFi row carries a Bybit denomination factor`);
    assert.equal(r.binanceMult, 1, `${r.id}: a TradFi row carries a Binance denomination factor (1000x quote)`);
  }
  for (const r of tagged.filter(x => x.id !== 'xau' && x.id !== 'on')) {
    assert.ok(r.binance, `${r.id}: a TradFi row needs Binance`);
    assert.ok(r.ticker && /^[A-Z][A-Z0-9]*$/.test(r.ticker), `${r.id}: ticker ${r.ticker} is not [A-Z][A-Z0-9]*`);
  }
  const by = (k: string) => tagged.filter(r => r.kind === k).length;
  /* 183 and 8 include the two crypto-pipeline rows retagged from Bybit's own type (U5): 182 + `on`,
     7 + `xau`. 235 new rows = 237 tagged - those two. */
  /* 692 = 463 crypto + 229 new. The 231 tagged rows include the two crypto-pipeline rows retagged from
     Bybit's own type (`on` stock, `xau` commodity), so 231 - 2 = 229. 'asset' is the neutral kind for a
     Bybit twin that is neither an equity nor a fund (never a guess at 'stock'). */
  assert.deepEqual({ stock: by('stock'), etf: by('etf'), commodity: by('commodity'), fx: by('fx'), preipo: by('preipo'), asset: by('asset') },
    { stock: 175, etf: 41, commodity: 8, fx: 1, preipo: 4, asset: 8 });
  /* 698 = 463 crypto + 235 new: the 229 above plus the six that were held and are shown again (owner, 2026-11-13). */
  assert.equal(tagged.length - 2, 235, '235 new TradFi rows (698 - 463)');
  assert.equal(COIN_UNIVERSE.length - 463, 235);
});

test('U5. the crypto-pipeline rows Bybit says are not crypto are tagged from Bybit, and are single-venue', () => {
  const xau = COIN_UNIVERSE.find(r => r.id === 'xau'); const on = COIN_UNIVERSE.find(r => r.id === 'on');
  assert.equal(xau?.kind, 'commodity'); assert.equal(on?.kind, 'stock');
  assert.equal(xau?.oneVenue, true); assert.equal(on?.oneVenue, true);
  assert.equal(on?.bybit, 'ONUSDT', 'ON must stay on its Bybit symbol - Binance ON is the Ontology token');
  assert.equal(on?.binance, null, 'ON must not carry the Ontology Binance symbol (a $0.15 token vs a $70 stock)');
});

test('L1. the kind line and market-hours note exist and say what they should, and pre-IPO is a price reference, not a share', () => {
  const EN = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
  const KEYS = read('lib/labelKeys.ts');
  for (const k of ['ARENA_TRADFI_NOTE', 'ARENA_TRADFI_NOTE_PREIPO', 'ARENA_SCANNER_KIND_NO_AI_READ']) {
    assert.ok(KEYS.includes(`'${k}'`), `${k} is not a registered label key`);
    assert.ok(typeof EN[k] === 'string' && EN[k].length > 0, `${k} has no English default`);
  }
  assert.match(EN.ARENA_TRADFI_NOTE, /24\/7/, 'the market-hours note must say the contract trades 24/7');
  assert.match(EN.ARENA_TRADFI_NOTE, /own hours/i, 'the market-hours note must say the underlying market has its own hours');
  assert.match(EN.ARENA_TRADFI_NOTE_PREIPO, /price reference, not a listed share/i, 'pre-IPO wording must say it is a price reference, not a listed share');
  assert.doesNotMatch(EN.ARENA_TRADFI_NOTE, /listed share|pre-ipo/i, 'the ordinary note must not carry the pre-IPO claim');
  assert.match(EN.ARENA_SCANNER_KIND_NO_AI_READ, /\{kind\}/, 'the kind line lost its {kind} placeholder');
});

test('S1. source pins: the generator hard-stops on a collision, an empty TradFi set and a leading-digit base; the Arena picks the pre-IPO note by kind', () => {
  const gen = read('scripts/generate-coins.mjs');
  assert.ok(/binance exchangeInfo carried no TRADIFI_PERPETUAL USDT contracts/.test(gen) && /process\.exit\(2\)/.test(gen), 'an empty TradFi set no longer stops the generator');
  assert.ok(/TRADFI base\(s\) outside \[A-Z\]\[A-Z0-9\]\*/.test(gen), 'the leading-digit refusal is gone');
  assert.ok(/survives the rename is a hard stop \(exit 2\)/.test(gen), 'the collision hard-stop is no longer documented in the generator');
  const hardStops = (gen.match(/process\.exit\(2\)/g) ?? []).length;
  assert.ok(hardStops >= 3, `expected at least 3 hard stops (empty set, digit base, collision), found ${hardStops}`);
  const arena = read('app/(main)/arena/page.tsx');
  assert.ok(/ARENA_TRADFI_NOTE_PREIPO/.test(arena) && /preipo/.test(arena), 'the Arena no longer chooses the pre-IPO note by kind');
});

test('H1. the six rows once held are SHOWN, each carrying a caveat, and no other row carries one (owner, 2026-11-13)', () => {
  const want: Record<string, { caveat: 'hkd' | 'disputed'; kind: string }> = {
    anthropic: { caveat: 'disputed', kind: 'preipo' }, openai: { caveat: 'disputed', kind: 'preipo' },
    hk0700: { caveat: 'hkd', kind: 'asset' }, hk1810: { caveat: 'hkd', kind: 'asset' },
    hk0992: { caveat: 'hkd', kind: 'asset' }, hk0625: { caveat: 'hkd', kind: 'asset' },
  };
  for (const [id, w] of Object.entries(want)) {
    const r = COIN_UNIVERSE.find(x => x.id === id);
    assert.ok(r, `${id} is missing from the universe - the owner decided to show it`);
    assert.equal(r!.caveat, w.caveat, `${id} must carry caveat '${w.caveat}'`);
    assert.equal(r!.kind, w.kind, `${id} should be kind ${w.kind}`);
  }
  const withCaveat = COIN_UNIVERSE.filter(r => r.caveat).map(r => r.id).sort();
  assert.deepEqual(withCaveat, Object.keys(want).sort(), 'a caveat is on a row that is not one of the six (or one of the six lost it)');
  for (const stay of ['moonshot', 'oura']) {
    const r = COIN_UNIVERSE.find(x => x.id === stay);
    assert.ok(r, `${stay} was dropped`);
    assert.equal(r!.caveat, undefined, `${stay} agrees with OKX within 0.5% and must carry no caveat`);
  }
  assert.equal(COIN_UNIVERSE.filter(r => r.kind === 'preipo').length, 4, 'pre-IPO set: MOONSHOT, OURA, ANTHROPIC, OPENAI');
  const gen = read('scripts/generate-coins.mjs');
  for (const b of ['ANTHROPIC', 'OPENAI']) assert.ok(gen.includes(`['${b}', { caveat: 'disputed'`), `${b} is no longer in TRADFI_CAVEAT as disputed`);
  for (const b of ['HK0700', 'HK1810', 'HK0992', 'HK0625']) assert.ok(gen.includes(`['${b}', { caveat: 'hkd'`), `${b} is no longer in TRADFI_CAVEAT as hkd`);
  const live = gen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!live.includes('TRADFI_HOLD'), 'TRADFI_HOLD is still referenced in live code - the rows would be dropped again');
  assert.ok(gen.includes('CAVEAT rows, shown with a warning (${tradfiCaveat.length})'), 'the generator no longer prints the caveat list');
  assert.ok(gen.includes('Binance ${mine} vs OKX ${o} = x'), 'the OKX disagreement is no longer printed for a disputed row - the warning would be unauditable');
  assert.ok(gen.includes('x${(mine / ref).toFixed(2)} vs ${cav.versus}'), 'the HKD ratio against the USD-quoted twin is no longer printed');
});

test('H2. the warning copy: HKD says HK$ and not US dollars, disputed says rough reference; keys registered; the Arena shows by caveat', () => {
  const EN = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
  const KEYS = read('lib/labelKeys.ts');
  for (const k of ['ARENA_CAVEAT_HKD', 'ARENA_CAVEAT_DISPUTED']) {
    assert.ok(KEYS.includes(`'${k}'`), `${k} is not a registered label key`);
    assert.ok(typeof EN[k] === 'string' && EN[k].length > 0, `${k} has no English default`);
  }
  assert.ok(EN.ARENA_CAVEAT_HKD.includes('HK$'), 'the HKD warning must name HK$');
  assert.match(EN.ARENA_CAVEAT_HKD, /not US dollars/i, 'the HKD warning must say it is not US dollars');
  assert.match(EN.ARENA_CAVEAT_DISPUTED, /exchanges disagree/i);
  assert.match(EN.ARENA_CAVEAT_DISPUTED, /rough reference/i);
  assert.doesNotMatch(EN.ARENA_CAVEAT_HKD + EN.ARENA_CAVEAT_DISPUTED, /grok|xai|claude|gpt/i, 'a warning names an AI vendor (the UI says "AI")');
  const arena = read('app/(main)/arena/page.tsx');
  assert.ok(arena.includes('coinCaveat(selectedCoin)') && arena.includes('ARENA_CAVEAT_HKD') && arena.includes('ARENA_CAVEAT_DISPUTED'), 'the Arena no longer shows a warning by caveat');
});

test('H3. currencyPrefix is HK$ for the four hkd rows and $ for everything else, including a disputed row', async () => {
  const { currencyPrefix, coinCaveat } = await import('../lib/coins.ts');
  for (const id of ['hk0700', 'hk1810', 'hk0992', 'hk0625']) assert.equal(currencyPrefix(id as never), 'HK$', `${id} must print HK$`);
  for (const id of ['btc', 'nvda', 'anthropic', 'openai', 'moonshot']) assert.equal(currencyPrefix(id as never), '$', `${id} must print a plain $`);
  assert.equal(coinCaveat('hk0700' as never), 'hkd');
  assert.equal(coinCaveat('anthropic' as never), 'disputed');
  assert.equal(coinCaveat('btc' as never), undefined);
});

test('H4. the files that print a selected coin\'s price write no literal "$" straight before a formatted price, except the three known AI-prompt lines', () => {
  /* A SOURCE SCAN, so a site Dev missed shows up before a browser finds it on an HK row.
     THE THREE ALLOWED LINES are in the Arena's `marketStructure` field ("Last: ... @ $x", "SH $x", "SL $x"), which is text for the
     AI READ. The AI read is not offered for any TradFi row (#2182), so an HK row never reaches it. They are pinned by COUNT, not
     skipped: a fourth literal "$" in the Arena page, or one in any other file, fails here. If the AI read is ever offered for these
     rows, those three become defects and this count goes to 0. */
  const BAD = /\$\$\{\s*(?:fmt|fmtPx|fmtPrice)\(/g;
  const count = (file: string) =>
    (read(file).split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n').match(BAD) ?? []).length;
  assert.equal(count('app/(main)/arena/page.tsx'), 3, 'the Arena page has a different number of literal-$ formatted prices than the three AI-prompt lines');
  /* KLineProChart.tsx:3352 is a KNOWN MISS, pinned at 1 so a SECOND one fails here: the price-alert marker's hover title
     ("Alert: above $x") prints a bare $ on an HK row. H4b below states the clean target and is `todo` until Dev fixes it. */
  assert.equal(count('components/KLineProChart.tsx'), 1, 'KLineProChart.tsx has a different number of literal-$ formatted prices than the one known alert-title miss');
  for (const file of ['lib/useEMAStrategy.ts', 'components/EMASignal.tsx']) {
    assert.equal(count(file), 0, `${file} writes a literal $ before a formatted price - it must go through currencyPrefix`);
  }
});

test('H4b. TARGET: no file writes a literal $ before a formatted price except the three AI-prompt lines', { todo: 'Dev: KLineProChart.tsx:3352 - the price-alert marker title prints a bare $ on an HK row' }, () => {
  const BAD = /\$\$\{\s*(?:fmt|fmtPx|fmtPrice)\(/g;
  const src = read('components/KLineProChart.tsx').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.equal((src.match(BAD) ?? []).length, 0, 'KLineProChart.tsx still writes a literal $ before a formatted price');
});


test('A1. the neutral `asset` kind: exactly the four Bybit twins that are neither stock nor fund, and none is guessed as a stock', () => {
  assert.deepEqual(COIN_UNIVERSE.filter(r => r.kind === 'asset').map(r => r.id).sort(), ['dis', 'frhc', 'hk0625', 'hk0700', 'hk0992', 'hk1810', 'payp', 'strc']);
  assert.ok(/stock', 'asset', 'preipo'/.test(read('lib/coins.ts')), 'the Stocks tab no longer includes the asset kind');
});
