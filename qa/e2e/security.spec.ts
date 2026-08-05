import { test, expect, request as pwRequest } from '@playwright/test';

// Unauthenticated OWASP API probes. All 33 of these passed in the 2026-08-04
// audit, so every one is a STRICT assertion - this suite exists to make sure a
// future refactor cannot quietly remove a gate.
//
// Runs once (desktop project only); these are HTTP-level, not viewport-level.
test.describe('api security', () => {
  test.beforeEach(({ }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'HTTP-level, viewport irrelevant');
  });

  const OPS = [
    '/api/ops/overview', '/api/ops/users', '/api/ops/team', '/api/ops/config',
    '/api/ops/accuracy', '/api/ops/ai-cost', '/api/ops/api-health', '/api/ops/crons', '/api/ops/me',
  ];
  const CRON = [
    '/api/signals/track', '/api/macro-alert', '/api/alert-outcomes/resolve',
    '/api/trial-reminder', '/api/ops/spike-alert', '/api/telegram/alert', '/api/telegram/setup-webhook',
  ];

  for (const path of OPS) {
    test(`BFLA: ${path} rejects an unauthenticated request`, async ({ request }) => {
      const r = await request.get(path, { failOnStatusCode: false });
      expect([401, 403], `${path} must not serve admin data anonymously`).toContain(r.status());
    });
  }

  for (const path of CRON) {
    test(`cron: ${path} fails closed without the secret`, async ({ request }) => {
      // lib/cronAuth.ts denies when CRON_SECRET is unset - deliberately
      // fail-closed, unlike the fail-open version this replaced.
      const r = await request.get(path, { failOnStatusCode: false });
      expect([401, 403]).toContain(r.status());
    });
  }

  test('forged tokens are all rejected, including an alg:none owner claim', async ({ request }) => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    // The classic JWT bypass: unsigned token asserting an admin role.
    const algNone = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: '1', role: 'owner', email: 'a@b.c' })}.`;

    const tokens: Record<string, string> = {
      garbage: 'not-a-jwt',
      empty: '',
      literalNull: 'null',
      wrongSignature: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.bad',
      algNoneForgedOwner: algNone,
    };

    for (const [name, token] of Object.entries(tokens)) {
      const r = await request.get('/api/ops/users', {
        headers: { Authorization: `Bearer ${token}` },
        failOnStatusCode: false,
      });
      expect([401, 403], `token "${name}" was not rejected`).toContain(r.status());
    }
  });

  test('/api/admin/* is a honeypot returning 404', async ({ request }) => {
    for (const path of ['/api/admin', '/api/admin/users']) {
      const r = await request.get(path, { failOnStatusCode: false });
      expect(r.status(), `${path} should look like it never existed`).toBe(404);
    }
  });

  test('path traversal cannot reach ops routes', async ({ request }) => {
    // NOTE: use percent-encoded %2e%2e. A literal '..' is normalised away by
    // fetch/undici BEFORE the request leaves, so it never tests traversal at
    // all - that mistake produced a false "failure" during the audit.
    for (const path of ['/api/admin/%2e%2e/ops/users', '/api/ops/%2e%2e/admin', '/api/OPS/users']) {
      const r = await request.get(path, { failOnStatusCode: false });
      expect([401, 403, 404], `${path} leaked`).toContain(r.status());
    }
  });

  test('security headers are present on the document', async () => {
    // A fresh context: fixture `request` shares cookie state, and we want the
    // raw document response here.
    const ctx = await pwRequest.newContext();
    const r = await ctx.get(`http://localhost:${process.env.E2E_PORT ?? 3100}/`);
    const h = r.headers();

    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['strict-transport-security']).toContain('max-age=');
    expect(h['referrer-policy']).toBeTruthy();
    expect(h['permissions-policy']).toBeTruthy();

    const csp = h['content-security-policy'] ?? '';
    expect(csp, 'CSP must block framing and object embedding').toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");

    // Server fingerprinting.
    expect(h['x-powered-by'], 'x-powered-by should not be advertised').toBeUndefined();
    await ctx.dispose();
  });

  test('API does not echo an arbitrary Origin back', async ({ request }) => {
    const r = await request.get('/api/config', {
      headers: { Origin: 'https://evil.example' },
      failOnStatusCode: false,
    });
    const acao = r.headers()['access-control-allow-origin'];
    expect(acao === undefined || acao === 'null', `CORS echoed: ${acao}`).toBeTruthy();
  });

  test('injection payloads do not 500 or leak database errors', async ({ request }) => {
    const payloads = ["' OR '1'='1", "'; DROP TABLE lhq_user_subscriptions; --", "' UNION SELECT NULL--"];
    for (const p of payloads) {
      const r = await request.get(`/api/labels?locale=${encodeURIComponent(p)}`, { failOnStatusCode: false });
      expect(r.status(), `payload ${p} caused a server error`).not.toBe(500);
      const body = await r.text();
      expect(body).not.toMatch(/syntax error|postgres|pg_|relation .* does not exist/i);
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // BOLA / IDOR (OWASP API #1) used to be a test.fixme here - the single
  // biggest gap in this suite, and the one thing every other spec left
  // unanswered, because everything else tests the signed-out surface where
  // the answer is always 401.
  //
  // It now lives in qa/e2e/bola.spec.ts, which authenticates as two seeded
  // accounts and proves B cannot read or mutate A's rows. It is a separate
  // file because it is the only spec that signs in, and the only one whose
  // failure means "user data is exposed".
  //
  // It skips - loudly, never passes - when the fixtures are absent. See
  // qa/e2e/_auth.ts for what it needs.
  // ─────────────────────────────────────────────────────────────────────
});
