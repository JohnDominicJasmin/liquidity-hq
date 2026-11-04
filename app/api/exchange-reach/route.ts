/* TEMPORARY REACHABILITY PROBE — delete once #1649's chain question is answered.
 *
 * WHY THIS EXISTS. #1649's research ends with a precondition nobody has met:
 *
 *   "OKX/Hyperliquid/Kraken/Bitget access from the Render IP is untested
 *    -> one probe from the server before relying on them."
 *
 * Our Render region is Singapore, and Bybit's terms (11.3) and Bitget's list Singapore as
 * excluded. **A probe from a laptop answers nothing** — it measures a residential IP in a different
 * country. The only reading that counts comes from the environment that will make the calls.
 *
 * WHAT IT DOES. One unauthenticated public GET per exchange, the cheapest documented endpoint each
 * one has, in parallel, with a short timeout. It reports status, latency and a short body prefix —
 * enough to tell "reachable", "geo-blocked" and "DNS/connect failure" apart, which is the whole
 * question. It writes nothing and reads nothing from our own systems.
 *
 * WHY IT IS GATED. It makes outbound calls on request, so an open version is an egress amplifier
 * pointed at four exchanges. `checkCronAuth` with `headerOnly` — the same gate the ingest routes
 * use — so a URL alone cannot trigger it and the secret never lands in a log or a Referer header.
 *
 * DELETE CRITERIA, stated so this does not become permanent: the moment the four results are
 * recorded on #1649 this route has no further use. It is not a health check and must not become
 * one — `/api/health` is where a durable signal belongs, and giving that endpoint a real
 * never-attempted state is the change this probe exists to inform.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cronAuth';

export const dynamic = 'force-dynamic';

/** Cheapest public endpoint per exchange. None require a key; none are rate-limit sensitive at one call. */
const TARGETS: ReadonlyArray<{ exchange: string; url: string; method?: 'GET' | 'POST'; body?: string }> = [
  { exchange: 'okx',         url: 'https://www.okx.com/api/v5/public/time' },
  /* Hyperliquid's info endpoint is POST-only; `{"type":"meta"}` is its documented cheapest read. */
  { exchange: 'hyperliquid', url: 'https://api.hyperliquid.xyz/info', method: 'POST', body: '{"type":"meta"}' },
  { exchange: 'kraken',      url: 'https://api.kraken.com/0/public/Time' },
  { exchange: 'bitget',      url: 'https://api.bitget.com/api/v2/public/time' },
  /* CONTROLS. Two exchanges we already reach from this environment every few minutes. If these fail
     too, the run measures the probe or the network, not the four above - the same reason a zero
     needs a positive control before it means anything. */
  { exchange: 'binance (control)', url: 'https://api.binance.com/api/v3/time' },
  { exchange: 'bybit (control)',   url: 'https://api.bybit.com/v5/market/time' },
];

async function probe(t: (typeof TARGETS)[number]) {
  const started = Date.now();
  try {
    const res = await fetch(t.url, {
      method: t.method ?? 'GET',
      ...(t.body ? { body: t.body, headers: { 'Content-Type': 'application/json' } } : {}),
      signal: AbortSignal.timeout(12_000),
      cache: 'no-store',
    });
    const text = (await res.text()).slice(0, 160);
    return {
      exchange: t.exchange,
      ok: res.ok,
      status: res.status,
      ms: Date.now() - started,
      /* The body prefix is what separates "geo-blocked" from "reachable" - a 403 with an HTML
         block page and a 403 with a JSON error read identically from the status alone. */
      body: text,
    };
  } catch (e) {
    return {
      exchange: t.exchange,
      ok: false,
      status: null,
      ms: Date.now() - started,
      /* A connect/DNS/timeout failure is a DIFFERENT answer from an HTTP refusal and must not be
         flattened into one - the first can be the region, the second is usually policy. */
      error: String(e instanceof Error ? e.message : e).slice(0, 160),
    };
  }
}

export async function GET(req: NextRequest) {
  if (!checkCronAuth(req, { headerOnly: true })) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const results = await Promise.all(TARGETS.map(probe));
  const controls = results.filter((r) => r.exchange.includes('control'));
  return NextResponse.json({
    checked_at: new Date().toISOString(),
    region_note: 'read this from the deployed service, never from a laptop - the IP is the measurement',
    /* Stated rather than left for the reader to spot: if the controls failed, nothing else here
       means anything. */
    controls_passed: controls.every((r) => r.ok),
    results,
  });
}
