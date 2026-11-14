/* SECOND PRICE SOURCE for the few instruments the primary feeds can leave empty (#1263).
 *
 * Hyperliquid, price and 24h change only - nothing else is read. ONLY the coins in `HL_PRICE_BACKUP` (lib/coins.ts) are reachable: each one was checked
 * against Binance's own quote as the SAME asset at the SAME unit before it was listed (one sample per row, recorded there), so a caller cannot ask for an
 * arbitrary name and this route cannot hand back a different instrument's price.
 *
 * WHY A ROUTE AND NOT A BROWSER CALL: the exchange guard (lib/exchangeGuard.ts) already knows Hyperliquid - one place holds its cooldown and concurrency -
 * and the answer is shared: one cached read serves every visitor for 30 s instead of one call per tab.
 *
 * NO CACHE-CONTROL HEADER ON PURPOSE: the shared cache below already serves every visitor, and this route is not one of the polled-header routes the stale-while-revalidate
 * pin (closedCandleAndPolledCache B2/B3) walks, so it sets no shared-cache header without being listed there.
 *
 * `cached()` stores successes only, and a failure is held 30 s (failTtlMs) so a refused upstream is not called again on every visitor's request. The page
 * treats a non-OK answer as "no backup" and keeps whatever its cell already says.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/apiCache';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { apiError } from '@/lib/apiError';
import { reportHealth } from '@/lib/apiHealth';
import { HL_PRICE_BACKUP } from '@/lib/coins';
import { HL_INFO_URL } from '@/lib/hyperliquid';
import { exchangeFetch } from '@/lib/exchangeGuard';

const TTL_MS = 30_000;

type Quote = { price: number; change: number | null; vol24: number | null };

/** One Hyperliquid perp dex ('' = the core venue). Throws on anything that is not a well-formed answer, so `cached()` never stores a refusal. */
async function readDex(dex: string): Promise<Map<string, Quote>> {
  const r = await exchangeFetch(HL_INFO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'metaAndAssetCtxs', ...(dex ? { dex } : {}) }),
    cache: 'no-store',
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`hyperliquid price-backup ${r.status}: ${text.slice(0, 120)}`);
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new Error(`hyperliquid price-backup returned non-JSON on a 200: ${text.slice(0, 120)}`); }
  if (!Array.isArray(body) || body.length !== 2) throw new Error('hyperliquid price-backup: unexpected shape');
  const [meta, ctxs] = body as [{ universe?: Array<{ name?: string }> }, Array<Record<string, string>>];
  if (!Array.isArray(meta?.universe) || !Array.isArray(ctxs)) throw new Error('hyperliquid price-backup: unexpected shape');
  const out = new Map<string, Quote>();
  meta.universe.forEach((u, i) => {
    const c = ctxs[i];
    if (!u?.name || !c) return;
    const price = parseFloat(c.midPx ?? c.markPx ?? '');
    if (!Number.isFinite(price) || price <= 0) return;
    const prev = parseFloat(c.prevDayPx ?? '');
    const vol = parseFloat(c.dayNtlVlm ?? '');
    out.set(u.name, {
      price,
      change: Number.isFinite(prev) && prev > 0 ? (price / prev - 1) * 100 : null,
      vol24: Number.isFinite(vol) ? vol : null,
    });
  });
  return out;
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!rateLimit(`price-backup:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }
  const asked = (req.nextUrl.searchParams.get('coins') ?? '')
    .split(',').map(s => s.trim().toLowerCase()).filter(id => Object.prototype.hasOwnProperty.call(HL_PRICE_BACKUP, id));
  if (!asked.length) return NextResponse.json({});

  try {
    const all = await cached('price-backup:v1', TTL_MS, async () => {
      const [core, xyz] = await Promise.all([readDex(''), readDex('xyz')]);
      return new Map<string, Quote>([...core, ...xyz]);
    }, { failTtlMs: TTL_MS });
    const body: Record<string, Quote> = {};
    for (const id of asked) {
      const q = all.get(HL_PRICE_BACKUP[id]);
      if (q) body[id] = q;
    }
    reportHealth('hyperliquid:price-backup', 'market', true, `${Object.keys(body).length}/${asked.length}`);
    return NextResponse.json(body);
  } catch (e) {
    reportHealth('hyperliquid:price-backup', 'market', false, e instanceof Error ? e.message.slice(0, 120) : 'failed');
    return apiError('price-backup', e, 502, 'Price backup unavailable.');
  }
}
