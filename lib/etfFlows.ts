/* Reading SoSoValue's ETF summary-history response.
 *
 * Split out from app/api/proxy/route.ts so the two things that can silently go
 * wrong are testable without a network call or an API key:
 *
 *   1. THE UNIT. The API documents `total_net_inflow` in DOLLARS. `/briefing`
 *      renders `$${value}M` and GrokChat labels it `$…M`, so the store holds
 *      MILLIONS. Miss the divide and a -55,066,297 USD outflow renders as
 *      "-$55066297M" - a fifty-five-trillion-dollar day. That does not look
 *      like a bug on a dashboard, it looks like a number.
 *
 *   2. THE SHAPE. The docs show one record inline and document a `limit`
 *      parameter, so the payload is a list in some form. Guessing at nesting is
 *      exactly how the previous integration was written, and it never once
 *      succeeded (#175) - so this accepts the plausible shapes and THROWS on
 *      anything else rather than returning null and looking like a quiet day
 *      with no flows.
 */

/** The documented record. Only the field this app uses is named. */
interface SummaryHistoryRecord {
  total_net_inflow?: unknown;
}

/**
 * Net inflow for the most recent session, in MILLIONS of USD.
 *
 * @throws if no usable record is present. Deliberate: the caller reports health
 *   on the throw, and "no data" must not be indistinguishable from "zero flow".
 *   Zero IS a real value and is returned as 0, not treated as missing.
 */
export function etfFlowMillions(body: unknown): number {
  const rec = pickRecord(body);
  const raw = (rec as SummaryHistoryRecord | null)?.total_net_inflow;

  if (raw == null || raw === '' || !Number.isFinite(Number(raw))) {
    throw new Error('no total_net_inflow in response');
  }
  return Number(raw) / 1e6;
}

/** Newest-first per the docs, so the first record is the latest session. */
function pickRecord(body: unknown): unknown {
  if (Array.isArray(body)) return body[0] ?? null;

  if (body && typeof body === 'object') {
    const data = (body as { data?: unknown }).data;
    if (Array.isArray(data)) return data[0] ?? null;
    if (data && typeof data === 'object') return data;
    return body;
  }
  return null;
}
