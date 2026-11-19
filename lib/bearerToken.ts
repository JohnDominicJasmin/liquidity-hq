/* THE BEARER TOKEN OF A REQUEST, AND ONLY A BEARER TOKEN (QA 2026-11-20: the Arena Multi-timeframe card showed "No data" on the gated dev / qa / staging hosts). The HTTP site gate makes a browser send `Authorization: Basic ...` on a request that carries no
 * explicit header, and the optional-token routes took ANY Authorization value as the user's token: the gate's credential was checked as a session, rejected, and answered 401 TOKEN_EXPIRED to an anonymous visitor. Another scheme means "no token", which is
 * what an anonymous visitor is. The routes where a token is required answer 401 on no token either way, so only the optional-token routes (market/rsi, grok, proxy, cmc) use this. */
export function bearerToken(headers: Pick<Headers, 'get'>): string | undefined {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(headers.get('Authorization') ?? '');
  return m ? m[1] : undefined;
}
