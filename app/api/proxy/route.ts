/**
 * Server-side proxy for CORS-restricted external APIs.
 * Replaces client-side corsproxy.io calls — no CORS issues server-side.
 *
 * GET /api/proxy?type=coinglass-flow     → Coinglass BTC exchange net flow
 * GET /api/proxy?type=coinglass-liq      → Coinglass BTC liquidation levels
 * GET /api/proxy?type=trends             → Google Trends bitcoin (7-day score)
 * GET /api/proxy?type=etf                → SoSoValue BTC + ETH ETF net flows
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type');

  try {
    /* ── Coinglass: BTC exchange net flow ── */
    if (type === 'coinglass-flow') {
      const cgKey = process.env.COINGLASS_API_KEY;
      const r = await fetch(
        'https://open-api.coinglass.com/public/v2/exchange_amount_chart?symbol=BTC&time_type=h24',
        { next: { revalidate: 300 }, headers: cgKey ? { 'coinglassSecret': cgKey } : {} }
      );
      return NextResponse.json(await r.json());
    }

    /* ── Coinglass: BTC liquidation levels ── */
    if (type === 'coinglass-liq') {
      const cgKey = process.env.COINGLASS_API_KEY;
      const r = await fetch(
        'https://open-api.coinglass.com/public/v2/liquidation_chart?symbol=BTC&time_type=h4',
        { next: { revalidate: 300 }, headers: cgKey ? { 'coinglassSecret': cgKey } : {} }
      );
      return NextResponse.json(await r.json());
    }

    /* ── Google Trends: bitcoin 7-day search score (2-step) ── */
    if (type === 'trends') {
      try {
        // Step 1: get widget token
        const exploreReq = JSON.stringify({
          comparisonItem: [{ keyword: 'bitcoin', geo: '', time: 'now 7-d' }],
          category: 0,
          property: '',
        });
        const exploreUrl =
          'https://trends.google.com/trends/api/explore?hl=en-US&tz=480&req=' +
          encodeURIComponent(exploreReq);

        const exploreRes = await fetch(exploreUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(8000),
        });

        if (!exploreRes.ok) {
          // Google blocked / rate-limited — return null gracefully, no 500
          return NextResponse.json({ default: { timelineData: [] } });
        }

        const raw1 = await exploreRes.text();
        const json1 = JSON.parse(raw1.replace(/^\)\]\}'\n?/, ''));
        const widgets: Array<{ id: string; token: string; request: unknown }> =
          json1?.widgets ?? [];
        const ts = widgets.find(w => w.id === 'TIMESERIES');
        if (!ts?.token || !ts?.request) {
          return NextResponse.json({ default: { timelineData: [] } });
        }

        // Step 2: fetch timeline data
        const dataUrl =
          'https://trends.google.com/trends/api/widgetdata/multiline?hl=en-US&tz=480&req=' +
          encodeURIComponent(JSON.stringify(ts.request)) +
          '&token=' + encodeURIComponent(ts.token);

        const dataRes = await fetch(dataUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          },
          signal: AbortSignal.timeout(8000),
        });

        if (!dataRes.ok) {
          return NextResponse.json({ default: { timelineData: [] } });
        }

        const raw2 = await dataRes.text();
        const json2 = JSON.parse(raw2.replace(/^\)\]\}'\n?/, ''));
        return NextResponse.json(json2);
      } catch {
        // Google Trends blocked / timed out — return empty, never 500
        return NextResponse.json({ default: { timelineData: [] } });
      }
    }

    /* ── SoSoValue: BTC + ETH spot ETF net flows ── */
    if (type === 'etf') {
      /* sosovalue.xyz is dead — try sosovalue.com with browser headers.
         Server-side (Render) requests often bypass 403 blocks that hit headless clients. */
      const SSV_HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://sosovalue.com',
        'Referer': 'https://sosovalue.com/',
      };

      async function fetchSoSo(path: string) {
        // Try .com first, fall back to .xyz (dead but harmless to retry)
        const urls = [
          `https://sosovalue.com/api/etf/${path}?language=en`,
          `https://api.sosovalue.com/etf/${path}?language=en`,
        ];
        for (const url of urls) {
          try {
            const r = await fetch(url, {
              headers: SSV_HEADERS,
              signal: AbortSignal.timeout(8000),
              next: { revalidate: 1800 },
            } as RequestInit);
            if (r.ok) return await r.json();
          } catch { /* try next */ }
        }
        return null;
      }

      const [btc, eth] = await Promise.all([
        fetchSoSo('us-btc-spot'),
        fetchSoSo('us-eth-spot'),
      ]);

      return NextResponse.json({ btc, eth });
    }

    return NextResponse.json({ error: 'Unknown type' }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Proxy fetch failed' },
      { status: 500 }
    );
  }
}
