/* DATA CHECK (owner order 2026-11-16): for BTC, ETH and SOL compare what the app SHOWS (price, 24h change, funding, open interest) against the exchange's public API at the same minute, and flag any
 * mismatch beyond rounding. Read-only: public GETs only, no account, no writes. The runner is in the US, so Binance and Bybit may refuse it: OKX is tried first, then Bybit, and the one that answered is printed.
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f spec=qa/e2e/data-check.spec.ts -f base_url=https://liquidity-hq-staging.onrender.com -f project=desktop
 * HOW THE ROW IS FOUND: the page is searched for the leaf element whose whole text is the coin ("BTC", "BTCUSDT", "BTC/USDT", "Bitcoin") and the smallest ancestor whose text carries a number is taken as its row. The
 * row text is printed ([DATA-ROW]) so a wrong pick is visible, and the comparison looks for ANY number in the row inside the tolerance (price 0.6 %, 24h change 0.4 pp, funding 0.005 pp, open interest 8 %): a
 * number that is simply not on that page is reported as NOT-SHOWN, never as a mismatch. Findings print as [DATA] lines. Never fails on a mismatch; it fails only if the exchange gave nothing at all. */
import { test, expect } from '@playwright/test';

const COINS = [
  { id: 'BTC', names: ['BTC', 'BTCUSDT', 'BTC/USDT', 'Bitcoin'], okx: 'BTC-USDT-SWAP', bybit: 'BTCUSDT' },
  { id: 'ETH', names: ['ETH', 'ETHUSDT', 'ETH/USDT', 'Ethereum'], okx: 'ETH-USDT-SWAP', bybit: 'ETHUSDT' },
  { id: 'SOL', names: ['SOL', 'SOLUSDT', 'SOL/USDT', 'Solana'], okx: 'SOL-USDT-SWAP', bybit: 'SOLUSDT' },
] as const;
const PAGES = ['/markets', '/funding', '/dashboard', '/scanner', '/liq'] as const;

type Ref = { src: string; price: number; chg24: number | null; funding: number | null; oiUsd: number | null; oiCoins: number | null; at: string };

async function getJson(request: import('@playwright/test').APIRequestContext, url: string): Promise<unknown | null> {
  try { const r = await request.get(url, { timeout: 15_000 }); if (!r.ok()) return null; return await r.json(); } catch { return null; }
}

async function reference(request: import('@playwright/test').APIRequestContext, c: (typeof COINS)[number]): Promise<Ref | null> {
  const at = new Date().toISOString();
  const t = await getJson(request, `https://www.okx.com/api/v5/market/ticker?instId=${c.okx}`) as { data?: Array<{ last: string; open24h: string }> } | null;
  const f = await getJson(request, `https://www.okx.com/api/v5/public/funding-rate?instId=${c.okx}`) as { data?: Array<{ fundingRate: string }> } | null;
  const o = await getJson(request, `https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${c.okx}`) as { data?: Array<{ oiCcy: string; oiUsd?: string }> } | null;
  const td = t?.data?.[0];
  if (td) {
    const last = Number(td.last); const open = Number(td.open24h);
    return { src: 'okx', price: last, chg24: open > 0 ? ((last - open) / open) * 100 : null, funding: f?.data?.[0] ? Number(f.data[0].fundingRate) * 100 : null,
      oiUsd: o?.data?.[0]?.oiUsd ? Number(o.data[0].oiUsd) : null, oiCoins: o?.data?.[0]?.oiCcy ? Number(o.data[0].oiCcy) : null, at };
  }
  const b = await getJson(request, `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${c.bybit}`) as { result?: { list?: Array<{ lastPrice: string; price24hPcnt: string; fundingRate: string; openInterest: string; openInterestValue: string }> } } | null;
  const bd = b?.result?.list?.[0];
  if (bd) return { src: 'bybit', price: Number(bd.lastPrice), chg24: Number(bd.price24hPcnt) * 100, funding: Number(bd.fundingRate) * 100, oiUsd: Number(bd.openInterestValue), oiCoins: Number(bd.openInterest), at };
  return null;
}

/** All numbers in a string, with K/M/B suffixes expanded, commas removed. */
function numbers(s: string): number[] {
  const out: number[] = [];
  for (const m of s.matchAll(/([+-]?\d[\d,]*\.?\d*)\s*([KMBT])?/gi)) {
    const n = Number(m[1].replace(/,/g, '')); if (!Number.isFinite(n)) continue;
    const mult = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[(m[2] ?? '').toUpperCase() as 'K' | 'M' | 'B' | 'T'] ?? 1; out.push(n * mult);
  }
  return out;
}

test.describe('data check: what the app shows vs the exchange, same minute', () => {
  for (const c of COINS) {
    test(`data ${c.id}`, async ({ browser, request }) => {
      test.setTimeout(420_000);
      const ref = await reference(request, c);
      expect(ref, `neither OKX nor Bybit answered from this runner for ${c.id}: nothing to compare against`).not.toBeNull();
      console.log(`[DATA-REF] ${c.id} ${ref!.src} at ${ref!.at}: price ${ref!.price} chg24 ${ref!.chg24?.toFixed(2)}% funding ${ref!.funding?.toFixed(4)}% OI $${ref!.oiUsd ? Math.round(ref!.oiUsd) : 'n/a'} (${ref!.oiCoins ? Math.round(ref!.oiCoins) : 'n/a'} coins)`);
      for (const width of [1280, 390]) {
        const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
        await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
        const page = await ctx.newPage();
        try {
          for (const path of PAGES) {
            try { await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 45_000 }); } catch (e) { console.log(`[DATA] ${c.id} ${width} ${path}: LOAD-FAILED ${String(e).slice(0, 100)}`); continue; }
            await page.waitForTimeout(9_000);
            const row = await page.evaluate((names) => {
              const all = Array.from(document.querySelectorAll('body *')).filter((e) => e.children.length === 0 && names.includes((e.textContent || '').trim()));
              for (const leaf of all) {
                let el: Element | null = leaf;
                for (let i = 0; i < 7 && el; i++) { const t = (el as HTMLElement).innerText || ''; if (/\d/.test(t.replace(leaf.textContent || '', '')) && t.length < 400 && t.length > (leaf.textContent || '').length + 3) return t.replace(/\s+/g, ' ').trim(); el = el.parentElement; }
              }
              return '';
            }, [...c.names]);
            if (!row) { console.log(`[DATA] ${c.id} ${width} ${path}: NO-ROW (the coin is not shown on this page as a row)`); continue; }
            console.log(`[DATA-ROW] ${c.id} ${width} ${path}: ${row.slice(0, 220)}`);
            const nums = numbers(row);
            const near = (target: number | null, tol: (t: number) => number) => (target === null ? null : nums.find((n) => Math.abs(n - target) <= tol(target)) ?? undefined);
            const price = near(ref!.price, (t) => t * 0.006);
            const chg = near(ref!.chg24, () => 0.4);
            const fund = near(ref!.funding, () => 0.005);
            const oi = ref!.oiUsd ? nums.find((n) => Math.abs(n - ref!.oiUsd!) <= ref!.oiUsd! * 0.08) : undefined;
            const rep = (label: string, v: number | null | undefined, want: string) => (v === null ? '' : v === undefined ? `${label}=NOT-MATCHED(ref ${want})` : `${label}=ok`);
            console.log(`[DATA] ${c.id} ${width} ${path}: ${[rep('price', price, String(ref!.price)), rep('24h', chg, ref!.chg24?.toFixed(2) + '%'), rep('funding', fund, ref!.funding?.toFixed(4) + '%'), rep('OI', oi ?? (ref!.oiUsd ? undefined : null), '$' + Math.round(ref!.oiUsd ?? 0))].filter(Boolean).join(' ')}`);
          }
        } finally { await ctx.close(); }
      }
    });
  }
});
