/* THE ANON WRITE GRANTS ARE GONE, AND NOTHING THE APP NEEDS WENT WITH THEM (security audit #1413, the anon-revoke migration, dev project block).
 * API-level cells against the shared DEV database through its public REST endpoint (what the browser's anon / signed-in clients really use). No page is loaded.
 *   G1  anon can still READ labels (the app reads them with the anon key)
 *   G2  anon can still INSERT a bounded liquidation event (LiqFeed records the live feed from the browser); a row outside the bounds is refused
 *   G3  anon is REFUSED, by missing privilege (not by row-level security), on INSERT / UPDATE / DELETE for the 11 app tables. A refusal by privilege reads "permission denied for table"; one by RLS reads "row-level security". The
 *       statements are harmless even if the grant came back: an empty INSERT body, UPDATE/DELETE with a filter that matches no row (the first column IS NULL).
 *   F1  signed in as fixture A: a journal trade can be CREATED, EDITED and DELETED (the app's journal does exactly these three through the user's own token)
 *   F2  signed in as fixture A: onboarding progress can be saved (the row is re-written with its OWN value, so the fixture's state does not change)
 * WHAT IT CANNOT PROVE: that a page renders (the browser specs do); prod's grants (the prod block is separate). The only row it leaves behind is one tiny liquidation event (coin QAGRANTS), which the purge job removes. */
import { test, expect } from '@playwright/test';
import { SUPABASE_URL, SUPABASE_ANON, FIXTURES, AUTH_READY, AUTH_SKIP_REASON, signIn } from './_auth';

const P = process.env.NEXT_PUBLIC_APP_ENV === 'prod' ? 'lhq_' : 'lhq_dev_';
const FIRST: Record<string, string> = { ai_call_log: 'id', alert_fires: 'id', alert_grok_log: 'id', hypotheses: 'id', hypothesis_evidence: 'id', labels: 'key', live_signals: 'id', muted_alerts: 'key', price_alerts: 'id', trades: 'id', user_onboarding: 'user_id' };
const anonHeaders = { apikey: SUPABASE_ANON, authorization: `Bearer ${SUPABASE_ANON}`, 'content-type': 'application/json' };
const rest = (path: string) => `${SUPABASE_URL}/rest/v1/${path}`;

test.describe('anon write grants (dev project)', () => {
  test.skip(!AUTH_READY || !SUPABASE_URL || !SUPABASE_ANON, AUTH_SKIP_REASON);
  test.describe.configure({ timeout: 120_000 });

  test('G1. anon can still read labels', async ({ request }) => {
    const r = await request.get(rest(`${P}labels?select=key,locale&limit=5`), { headers: anonHeaders });
    expect(r.status()).toBe(200); const rows = await r.json(); expect(Array.isArray(rows) && rows.length).toBeGreaterThan(0);
  });

  test('G2. anon can still insert a bounded liquidation event; one outside the bounds is refused', async ({ request }) => {
    const ok = await request.post(rest(`${P}liq_events`), { headers: { ...anonHeaders, prefer: 'return=minimal' }, data: { coin: 'QAGRANTS', side: 'LONG', usd: 1000, price: 100, source: 'BN', ts: Date.now() } });
    console.log(`[G2] bounded insert -> ${ok.status()}`); expect(ok.status(), `the live feed's insert was refused: ${await ok.text()}`).toBe(201);
    const bad = await request.post(rest(`${P}liq_events`), { headers: anonHeaders, data: { coin: 'QAGRANTS', side: 'SIDEWAYS', usd: 1000, price: 100, source: 'BN', ts: Date.now() } });
    console.log(`[G2] out-of-bounds insert -> ${bad.status()}`); expect(bad.status()).toBeGreaterThanOrEqual(400);
    const upd = await request.patch(rest(`${P}liq_events?coin=eq.QAGRANTS`), { headers: anonHeaders, data: { usd: 5 } }); console.log(`[G2] anon update -> ${upd.status()}`); expect(upd.status(), 'anon can update liquidation events').toBeGreaterThanOrEqual(400);
  });

  test('G3. anon is refused by PRIVILEGE on INSERT, UPDATE and DELETE for every app table', async ({ request }) => {
    const bad: string[] = [];
    for (const [t, col] of Object.entries(FIRST)) {
      const table = `${P}${t}`;
      const probes: Array<[string, () => Promise<{ status: () => number; text: () => Promise<string> }>]> = [
        ['INSERT', () => request.post(rest(table), { headers: anonHeaders, data: {} })],
        ['UPDATE', () => request.patch(rest(`${table}?${col}=is.null`), { headers: anonHeaders, data: {} })],
        ['DELETE', () => request.delete(rest(`${table}?${col}=is.null`), { headers: anonHeaders })],
      ];
      for (const [verb, run] of probes) {
        const r = await run(); const body = await r.text(); const byPrivilege = /permission denied/i.test(body);
        console.log(`[G3] ${table} ${verb} -> ${r.status()} ${byPrivilege ? 'permission denied' : body.slice(0, 80)}`);
        if (!(r.status() >= 400 && byPrivilege)) bad.push(`${table} ${verb}: ${r.status()} ${body.slice(0, 100)}`);
      }
    }
    expect(bad, 'anon still holds a write grant (or the refusal is not a privilege one)').toEqual([]);
  });

  test('F1. signed in as fixture A: a journal trade is created, edited and deleted', async ({ request }) => {
    const token = await signIn(FIXTURES.aEmail, FIXTURES.aPassword); const H = { apikey: SUPABASE_ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation' };
    let id = '';
    try {
      const c = await request.post(rest(`${P}trades`), { headers: H, data: { coin: 'QATEST', direction: 'LONG', entry_price: 1, stop_loss: 1, notes: 'qa-anon-grants create', user_id: FIXTURES.aId } });
      console.log(`[F1] create -> ${c.status()}`); expect(c.status(), `a signed-in user could not save a trade: ${await c.text()}`).toBe(201); id = (await c.json())[0].id;
      const u = await request.patch(rest(`${P}trades?id=eq.${id}`), { headers: H, data: { notes: 'qa-anon-grants edited' } });
      console.log(`[F1] edit -> ${u.status()}`); expect(u.status(), `a signed-in user could not EDIT a trade: ${await u.text()}`).toBeLessThan(300);
      const got = await (await request.get(rest(`${P}trades?id=eq.${id}&select=notes`), { headers: H })).json(); expect(got[0]?.notes, 'the edit did not take').toBe('qa-anon-grants edited');
      const d = await request.delete(rest(`${P}trades?id=eq.${id}`), { headers: H });
      console.log(`[F1] delete -> ${d.status()}`); expect(d.status(), `a signed-in user could not DELETE a trade: ${await d.text()}`).toBeLessThan(300);
      const gone = await (await request.get(rest(`${P}trades?id=eq.${id}&select=id`), { headers: H })).json(); expect(gone, 'the trade is still there').toEqual([]); id = '';
    } finally { if (id) await request.delete(rest(`${P}trades?id=eq.${id}`), { headers: H }).catch(() => {}); }
  });

  test('F2. signed in as fixture A: onboarding progress can be saved (re-written with its own value)', async ({ request }) => {
    const token = await signIn(FIXTURES.aEmail, FIXTURES.aPassword); const H = { apikey: SUPABASE_ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation' };
    const g = await request.get(rest(`${P}user_onboarding?user_id=eq.${FIXTURES.aId}&select=tour_seen,profile_complete`), { headers: H }); expect(g.status()).toBe(200); const row = (await g.json())[0]; expect(row, 'fixture A has no onboarding row').toBeTruthy();
    const u = await request.patch(rest(`${P}user_onboarding?user_id=eq.${FIXTURES.aId}`), { headers: H, data: { tour_seen: row.tour_seen, profile_complete: row.profile_complete } });
    console.log(`[F2] update own row -> ${u.status()}`); expect(u.status(), `onboarding progress could not be saved: ${await u.text()}`).toBeLessThan(300);
  });
});
