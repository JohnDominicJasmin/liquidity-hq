import { test, expect, request as pwRequest } from '@playwright/test';
import { getGuarded } from './_shared';
import { AUTH_READY, AUTH_SKIP_REASON, FIXTURES, SUPABASE_URL, SUPABASE_ANON, signIn } from './_auth';

/**
 * BOLA / IDOR - OWASP API Security #1.
 *
 * The question every other spec in this suite leaves unanswered: can a
 * legitimately signed-in user reach another user's rows by asking for them by
 * id? Everything else here tests the signed-out surface, where the answer is
 * always 401 and nothing is learned about this.
 *
 * Why it needs its own file: it is the only spec that authenticates, and the
 * only one that can fail in a way that means "user data is exposed".
 *
 * WHY THE ASSERTIONS LOOK PARANOID
 *
 * A status code is not evidence here. `PATCH .../someone-elses-id` returning
 * 200 is ambiguous - Supabase reports success for an UPDATE that matched zero
 * rows, which is exactly what a correct ownership filter produces. So every
 * write attempt is followed by a read AS THE OWNER to prove the row did not
 * change. Without that second read this file would pass against a genuinely
 * broken app.
 *
 * Equally, an empty result is only meaningful if the row exists. Test 1 proves
 * A can read its own fixtures first; if that fails everything after it would
 * "pass" vacuously, so it fails the run loudly instead.
 */

test.describe('BOLA / IDOR - cross-account access', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);

  // HTTP-level. Running both viewport projects would just double the requests.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'HTTP-level, viewport irrelevant');
  });

  let tokenA = '';
  let tokenB = '';

  test.beforeAll(async () => {
    tokenA = await signIn(FIXTURES.aEmail, FIXTURES.aPassword);
    tokenB = await signIn(FIXTURES.bEmail, FIXTURES.bPassword);
    expect(tokenA, 'A and B must be different sessions').not.toBe(tokenB);
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /**
   * Statuses treated as "access was refused".
   *
   * 500 is in here deliberately, and it is a defect rather than an accident:
   * measured 2026-08-06, B's write attempts return
   * `500 {"error":"Something went wrong. Please try again."}` - including for a
   * UUID that does not exist at all, which proves the 500 is about B (no
   * entitlement row) and not about reaching A's data. A's own writes return
   * 200, so the endpoints work.
   *
   * It fails CLOSED, so it is not a security hole and this suite must not fail
   * the build over it. But a denial surfacing as 500 makes real server errors
   * indistinguishable from refused access in the logs and in GlitchTip, so
   * every test below annotates when it sees one. Security is asserted by
   * re-reading the row as its owner, never by the status code.
   */
  const REFUSED = [200, 400, 401, 403, 404, 500];

  const noteIf500 = (status: number, what: string) => {
    if (status !== 500) return;
    test.info().annotations.push({
      type: 'known-issue',
      description:
        `${what} refused with HTTP 500 rather than 403. Fails closed - data is ` +
        `safe - but denial is indistinguishable from a server fault in logs.`,
    });
  };

  /** Direct PostgREST, bypassing the app - measures RLS itself. */
  const rest = async (t: string, table: string, query: string) => {
    const ctx = await pwRequest.newContext();
    const r = await ctx.get(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${t}` },
      failOnStatusCode: false,
    });
    const body = await r.json().catch(() => null);
    await ctx.dispose();
    return { status: r.status(), body };
  };

  // ── 1. Fixtures are real ────────────────────────────────────────────────
  // Everything below is meaningless if A's rows do not exist. This runs first
  // and fails the file rather than letting later tests pass vacuously.
  test('A can read its own seeded rows (guards against a vacuous pass)', async ({ request }) => {
    const hyp = await getGuarded(request, '/api/hypotheses', { headers: auth(tokenA), failOnStatusCode: false });
    expect(hyp.status(), 'A should be able to list its hypotheses').toBe(200);
    const hypBody = await hyp.json();
    const hypRows = Array.isArray(hypBody) ? hypBody : (hypBody.hypotheses ?? hypBody.data ?? []);
    expect(
      JSON.stringify(hypRows),
      `A's seeded hypothesis ${FIXTURES.hypothesisId} must be visible to A, or this file proves nothing`,
    ).toContain(FIXTURES.hypothesisId);

    const alerts = await getGuarded(request, '/api/price-alerts', { headers: auth(tokenA), failOnStatusCode: false });
    expect(alerts.status()).toBe(200);
    expect(JSON.stringify(await alerts.json())).toContain(FIXTURES.priceAlertId);
  });

  // ── 2. B cannot LIST A's data ───────────────────────────────────────────
  test('B listing its own collections never returns A rows', async ({ request }) => {
    // Only UUID-shaped fixtures are safe as substring needles. A's price-alert
    // id is the integer "1", so `not.toContain("1")` would match almost any
    // JSON body - including B's own legitimate response. That produced a false
    // failure the first time this ran. Integer-keyed rows are covered by the
    // per-row ownership tests and the RLS test instead.
    const needles: Array<[string, string]> = [
      ["A's user id", FIXTURES.aId],
      ["A's hypothesis", FIXTURES.hypothesisId],
      ["A's trade", FIXTURES.tradeId],
    ].filter(([, v]) => v.length >= 8) as Array<[string, string]>;

    for (const path of ['/api/hypotheses', '/api/price-alerts', '/api/settings']) {
      const r = await getGuarded(request, path, { headers: auth(tokenB), failOnStatusCode: false });
      expect([200, 404], `${path} should answer B`).toContain(r.status());
      const text = await r.text();
      for (const [what, needle] of needles) {
        expect(text, `${path} leaked ${what} to B`).not.toContain(needle);
      }
    }
  });

  // ── 3. B cannot MUTATE A's rows by id ───────────────────────────────────
  // The important half. Each attempt is verified by re-reading as A.
  test("B cannot modify A's hypothesis by id", async ({ request }) => {
    const before = await rest(tokenA, 'lhq_dev_hypotheses', `id=eq.${FIXTURES.hypothesisId}&select=*`);
    expect(before.status, "A must be able to read its own hypothesis").toBe(200);
    expect(before.body?.length, 'fixture missing - cannot test').toBe(1);

    const r = await request.patch(`/api/hypotheses/${FIXTURES.hypothesisId}`, {
      headers: { ...auth(tokenB), 'Content-Type': 'application/json' },
      data: { title: 'OWNED BY B', status: 'invalidated' },
      failOnStatusCode: false,
    });
    // 200 here is NOT a failure by itself: an UPDATE matching zero rows succeeds.
    expect(REFUSED).toContain(r.status());
    noteIf500(r.status(), "PATCH /api/hypotheses/{id} as a non-owner");

    const after = await rest(tokenA, 'lhq_dev_hypotheses', `id=eq.${FIXTURES.hypothesisId}&select=*`);
    expect(
      JSON.stringify(after.body),
      `B MUTATED A's hypothesis. HTTP was ${r.status()} - which is why this test re-reads as the owner.`,
    ).not.toContain('OWNED BY B');
    expect(after.body?.length, "A's hypothesis must still exist").toBe(1);
  });

  test("B cannot delete A's hypothesis by id", async ({ request }) => {
    const r = await request.delete(`/api/hypotheses/${FIXTURES.hypothesisId}`, {
      headers: auth(tokenB), failOnStatusCode: false,
    });
    expect(REFUSED).toContain(r.status());
    noteIf500(r.status(), "DELETE /api/hypotheses/{id} as a non-owner");

    const after = await rest(tokenA, 'lhq_dev_hypotheses', `id=eq.${FIXTURES.hypothesisId}&select=id`);
    expect(
      after.body?.length,
      `B DELETED A's hypothesis. HTTP was ${r.status()}.`,
    ).toBe(1);
  });

  /* WHY THIS RUNS AS A, NOT B.
   *
   * `price-alerts` checks entitlement at route.ts:89 and ownership at :111. B is
   * the FREE fixture, so it is refused by the Pro gate twenty lines before the
   * ownership check is reached - the test passed and stopped testing ownership
   * the moment B's role was pinned to free on 2026-08-08.
   *
   * A is PRO, so it clears the gate and the refusal it gets is the one this test
   * is actually about. The B direction is kept below as its own test, because a
   * free account being refused IS worth asserting - it just is not BOLA. */
  test("A cannot modify or deactivate B's price alert by id", async ({ request }) => {
    const patch = await request.patch(`/api/price-alerts?id=${FIXTURES.bPriceAlertId}`, {
      headers: { ...auth(tokenA), 'Content-Type': 'application/json' },
      data: { label: 'OWNED BY A', target_price: 1 },
      failOnStatusCode: false,
    });
    expect(REFUSED).toContain(patch.status());
    noteIf500(patch.status(), "PATCH /api/price-alerts as a non-owner (A on B's row)");

    const del = await request.delete(`/api/price-alerts?id=${FIXTURES.bPriceAlertId}`, {
      headers: auth(tokenA), failOnStatusCode: false,
    });
    expect(REFUSED).toContain(del.status());
    noteIf500(del.status(), "DELETE /api/price-alerts as a non-owner (A on B's row)");

    const after = await rest(tokenB, 'lhq_dev_price_alerts', `id=eq.${FIXTURES.bPriceAlertId}&select=*`);
    expect(after.body?.length, "B's price alert must still exist").toBe(1);
    const row = after.body?.[0] ?? {};
    expect(JSON.stringify(row), "A renamed B's price alert").not.toContain('OWNED BY A');
    // DELETE here is a soft delete (active:false). If B could reach it, the
    // alert would silently stop firing for A - a data-loss bug that returns 200.
    expect(row.active, "A deactivated B's price alert - it would silently stop firing").not.toBe(false);
  });

  /* The B direction, kept and renamed to what it actually proves.
   *
   * B is free, so `price-alerts` refuses it at the entitlement check before
   * ownership is ever considered. That is worth asserting - a free account must
   * not reach a Pro route - but it is an ENTITLEMENT test, and calling it BOLA
   * is how a cross-account assertion silently stopped covering cross-account
   * access when B's role was pinned. */
  test("a FREE account is refused by the Pro gate, not by ownership", async ({ request }) => {
    const r = await request.patch(`/api/price-alerts?id=${FIXTURES.priceAlertId}`, {
      headers: { ...auth(tokenB), 'Content-Type': 'application/json' },
      data: { label: 'OWNED BY B', target_price: 1 },
      failOnStatusCode: false,
    });
    expect(r.status(), 'a free account reached a Pro-gated route').toBe(403);
    expect(await r.text(), 'refused, but not for entitlement').toContain('PRO_REQUIRED');

    const after = await rest(tokenA, 'lhq_dev_price_alerts', `id=eq.${FIXTURES.priceAlertId}&select=*`);
    expect(JSON.stringify(after.body?.[0] ?? {}), "B renamed A's alert despite the 403").not.toContain('OWNED BY B');
  });

  test("B cannot overwrite A's settings", async ({ request }) => {
    const r = await request.patch('/api/settings', {
      headers: { ...auth(tokenB), 'Content-Type': 'application/json' },
      data: { user_id: FIXTURES.aId, account_size: 999999, risk_per_trade: 99 },
      failOnStatusCode: false,
    });
    expect(REFUSED).toContain(r.status());
    noteIf500(r.status(), "PATCH /api/settings with a foreign user_id in the body");

    // Mass-assignment check: passing user_id in the body must not let B write
    // to A's row. If the handler trusted that field this would silently succeed.
    const after = await rest(tokenA, 'lhq_dev_user_settings', `user_id=eq.${FIXTURES.aId}&select=*`);
    const s = after.body?.[0] ?? {};
    expect(
      s.account_size,
      "B overwrote A's settings via a user_id in the request body (mass assignment)",
    ).not.toBe(999999);
  });

  // ── 4. RLS floor, measured directly ─────────────────────────────────────
  // The API routes query with the user's token, so RLS is the second layer.
  // Checking it separately means a future route that switches to the
  // service-role client does not silently lose all protection.
  test('RLS refuses B direct PostgREST access to A rows', async () => {
    const tables: Array<[string, string]> = [
      ['lhq_dev_hypotheses', FIXTURES.hypothesisId],
      ['lhq_dev_price_alerts', FIXTURES.priceAlertId],
      ['lhq_dev_trades', FIXTURES.tradeId],
    ];
    for (const [table, id] of tables) {
      const asA = await rest(tokenA, table, `id=eq.${id}&select=id`);
      expect(asA.body?.length, `fixture ${table}/${id} missing - test would be vacuous`).toBe(1);

      const asB = await rest(tokenB, table, `id=eq.${id}&select=*`);
      expect([200, 401, 403]).toContain(asB.status);
      expect(
        Array.isArray(asB.body) ? asB.body.length : 0,
        `RLS let B read A's row in ${table}`,
      ).toBe(0);
    }

    const settingsAsB = await rest(tokenB, 'lhq_dev_user_settings', `user_id=eq.${FIXTURES.aId}&select=*`);
    expect(
      Array.isArray(settingsAsB.body) ? settingsAsB.body.length : 0,
      "RLS let B read A's settings",
    ).toBe(0);
  });

  // ── 5. Controls ─────────────────────────────────────────────────────────
  // Proves the endpoints are actually reachable and gated, so a network
  // failure cannot masquerade as "access correctly denied" above.
  test('the same requests without a token are rejected', async ({ request }) => {
    for (const path of ['/api/hypotheses', '/api/price-alerts', '/api/settings']) {
      const r = await getGuarded(request, path, { failOnStatusCode: false });
      const body = await r.text();

      // /api/hypotheses and /api/settings answer 401. /api/price-alerts answers
      // 200 {"alerts":[]} - measured 2026-08-06. That is not a leak, and the
      // empty-collection assertion below is what actually matters, but it is
      // inconsistent with its two siblings and worth recording.
      if (r.status() === 200) {
        test.info().annotations.push({
          type: 'known-issue',
          description:
            `${path} answers an anonymous caller with HTTP 200 instead of 401, ` +
            `unlike /api/hypotheses and /api/settings. No data is exposed - the ` +
            `collection is empty - but the inconsistency is real.`,
        });
        expect(body, `${path} returned data to an anonymous caller`).not.toContain(FIXTURES.aId);
        expect(body, `${path} returned A's hypothesis anonymously`).not.toContain(FIXTURES.hypothesisId);
        expect(
          /\[\s*\]/.test(body) || body.length < 60,
          `${path} answered 200 anonymously AND returned rows: ${body.slice(0, 160)}`,
        ).toBeTruthy();
      } else {
        expect([401, 403], `${path} must reject an anonymous caller`).toContain(r.status());
      }
    }
  });

  test("a forged token for A's user id is rejected", async ({ request }) => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const forged = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: FIXTURES.aId, role: 'authenticated', email: FIXTURES.aEmail })}.`;
    const r = await getGuarded(request, '/api/hypotheses', {
      headers: { Authorization: `Bearer ${forged}` }, failOnStatusCode: false,
    });
    expect([401, 403], 'an unsigned token claiming to be A was accepted').toContain(r.status());
  });
});
