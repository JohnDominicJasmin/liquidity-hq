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

/** One US trading day's net flow, in MILLIONS of USD. `date` is SoSoValue's own trading date (yyyy-MM-dd). */
export interface EtfFlowDay { date: string; flowM: number }

/**
 * The last `n` trading days that carry a flow, newest first (#1631 A). The Deep read had no dated ETF data at all, so a +$526.7M day was
 * either missed or presented without its date.
 *
 * The documented summary-history record has `date` (yyyy-MM-dd) and `total_net_inflow` (USD), newest first, non-trading days excluded.
 * A row with no usable flow is SKIPPED, not read as zero: the current session's row can exist before its flow is settled, and the day
 * before it is then the latest real number. Zero is a real value and is kept.
 *
 * @throws if no row has a usable date and flow - same reason as etfFlowMillions: "no data" must not look like "nothing happened".
 */
export function etfFlowDays(body: unknown, n: number): EtfFlowDay[] {
  const rows = pickRecords(body);
  const days: EtfFlowDay[] = [];
  for (const row of rows) {
    const rec = (row ?? {}) as { date?: unknown; total_net_inflow?: unknown };
    const raw = rec.total_net_inflow;
    if (typeof rec.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(rec.date)) continue;
    if (raw == null || raw === '' || !Number.isFinite(Number(raw))) continue;
    days.push({ date: rec.date, flowM: Number(raw) / 1e6 });
    if (days.length >= n) break;
  }
  if (days.length === 0) throw new Error('no dated total_net_inflow in response');
  return days;
}

/** Every record, in the order sent (newest first per the docs), from the same plausible shapes pickRecord accepts. */
function pickRecords(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    const data = (body as { data?: unknown }).data;
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') return [data];
    return [body];
  }
  return [];
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
