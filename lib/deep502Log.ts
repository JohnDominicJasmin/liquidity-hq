/* ONE STRUCTURED LINE FOR EVERY 502 THE DEEP PATH CAN ANSWER (#1651, PM + QA).
 *
 * Six signed-in 502s were seen on a Deep click and their URLs were never identified: production request logs are not
 * readable, and the existing lines were free text. A Deep click can answer 502 from exactly two routes, and each writes this
 * line at the 502, so the next occurrence names itself:
 *
 *   /api/market/klines  kind 'klines-upstream'      the candles' upstream (Binance, Bybit, ...) refused or was unreachable
 *   /api/grok           kind 'grok-empty'           the model answered with nothing
 *                       kind 'grok-unreadable'      an answer with no readable verdict after one retry
 *                       kind 'grok-strict-refused'  the strict read refused an answer the first guard let through
 *
 * THE LINE:  [deep502] {"evt":"deep502","route":…,"kind":…,"upstream":…,"upstreamStatus":…,"coin":…,"ms":…}
 * FIXED FIELD SET, NO FREE TEXT. Every value is clamped here, not trusted from the caller: `route` and `kind` are closed
 * unions, `upstream` and `coin` are cut to a safe character set and length, `upstreamStatus` is an integer or null, `ms` is
 * a non-negative integer. No user id, email, token, request body, prompt or model text can reach it because there is no
 * field to carry one. `coin` is a public market symbol or coin id. `ms` is time since the handler started. */
export type Deep502Route = '/api/market/klines' | '/api/grok';
export type Deep502Kind = 'klines-upstream' | 'grok-empty' | 'grok-unreadable' | 'grok-strict-refused';

export interface Deep502Fields {
  route: Deep502Route;
  kind: Deep502Kind;
  upstream: string;
  upstreamStatus: number | null;
  coin: string;
  ms: number;
}

const clamp = (v: unknown, max: number): string =>
  String(v ?? 'unknown').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, max) || 'unknown';

export function deep502Line(f: Deep502Fields): string {
  const status = typeof f.upstreamStatus === 'number' && Number.isFinite(f.upstreamStatus) ? Math.trunc(f.upstreamStatus) : null;
  const ms = Number.isFinite(f.ms) && f.ms > 0 ? Math.trunc(f.ms) : 0;
  return '[deep502] ' + JSON.stringify({
    evt: 'deep502',
    route: f.route,
    kind: f.kind,
    upstream: clamp(f.upstream, 16),
    upstreamStatus: status,
    coin: clamp(f.coin, 24),
    ms,
  });
}

export function logDeep502(f: Deep502Fields): void {
  console.error(deep502Line(f));
}
