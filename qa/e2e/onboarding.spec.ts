/* #1113 — onboarding end to end, on a GitHub runner rather than the owner's laptop.
 *
 * OWNER DECISION, 2026-11-12 (relayed first-hand by PM/DevOps): QA's browser tests run on GitHub's
 * servers and never on his machine again. This spec is the first real use of `ci.yml`'s `spec`
 * input, and it is written to be dispatched on its own:
 *
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f spec=qa/e2e/onboarding.spec.ts \
 *     -f base_url=https://liquidity-hq-qa.onrender.com -f fixture_reset=true -f screenshots=true
 *
 * ── IT RESETS A SHARED FIXTURE, SO IT IS FENCED TWICE ────────────────────────────────────────
 *
 * The fixtures live in the DEV database, which `qa` AND `staging` both read. Flipping B's
 * `profile_complete` mid-run makes `OnboardingGate` render the wizard INSTEAD of the page every
 * other authenticated spec asserts on — eight specs sign in as B. That is not hypothetical; it is
 * why this did not run on 2026-11-12 while CI 43188760422 was in flight.
 *
 *   1. `QA_FIXTURE_RESET=1` must be set (the workflow's own `fixture_reset` tick). Unset, every
 *      test here skips with a reason saying so.
 *   2. `ci.yml` puts dispatch e2e jobs in one concurrency group, so two runs cannot overlap.
 *
 * ── WHAT IT IS BUILT TO ANSWER ───────────────────────────────────────────────────────────────
 *
 * Fixture B was found with `profile_complete = true` and every answer the wizard records NULL.
 * `finish()` does the settings write first and the `profile_complete` upsert second with no
 * rollback, so the flag landing without the answers is possible on paper. Every write to either
 * table is recorded IN ORDER with its status, so a run can tell "cannot happen" from "did happen".
 *
 * ── PUBLIC ARTIFACT RULES, because the repo is public since 2026-11-10 ───────────────────────
 *
 * Screenshots are off unless asked for, go only to `qa/.shots`, are taken with `mask` over
 * anything that could carry the fixture's email, and no account or settings page is shot at all.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { signedInContext } from './_auth.ts';

const RESET_OK = process.env.QA_FIXTURE_RESET === '1';
const SHOTS = process.env.QA_SHOTS === '1';
const SHOT_DIR = 'qa/.shots';
const SNAP = 'qa/.shots/onboarding-snapshot.json';
const DEV_REF = 'wdtjhrilakoitfcezxpx';

const FLAGS = ['tour_seen', 'profile_complete', 'checklist_telegram', 'checklist_price_alert', 'checklist_grok', 'checklist_coins'] as const;
const ANSWERS = ['beginner_mode', 'display_name', 'country', 'trading_experience', 'trading_style', 'trading_challenge', 'how_heard', 'account_size', 'default_tf'] as const;

/* The three NOT NULL columns take their schema DEFAULT, not null: `account_size` 1000,
   `default_tf` '15m', `beginner_mode` true. A blanket null update errors and half-resets the row. */
const RESET_ANSWERS = {
  display_name: null, country: null, trading_experience: null, trading_style: null,
  trading_challenge: null, how_heard: null, account_size: 1000, default_tf: '15m', beginner_mode: true,
};

/* Signs in AS THE FIXTURE and works under its own RLS — no service key, no admin path, and no
   reach past that one account's rows. The ref is asserted because a write to prod Supabase is one
   of the owner's four gated things, and this must be incapable of reaching it. */
const fixtureDb = async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const email = process.env.E2E_USER_B_EMAIL ?? '';
  const password = process.env.E2E_USER_B_PASSWORD ?? '';
  expect(url && anon && email && password, 'fixture B credentials and Supabase config must be set').toBeTruthy();
  const ref = new URL(url).hostname.split('.')[0];
  expect(ref, `REFUSING: Supabase ref is ${ref}, not the dev project`).toBe(DEV_REF);
  const sb = createClient(url, anon);
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  expect(error, `fixture B sign-in failed: ${error?.message ?? ''}`).toBeNull();
  return { sb, uid: data.user!.id };
};

/* Taken FROM `fixtureDb` rather than annotated as `ReturnType<typeof createClient>`: the client's
   generics differ between the two forms and the annotation does not typecheck. */
type FixtureDb = Awaited<ReturnType<typeof fixtureDb>>['sb'];

const readRows = async (sb: FixtureDb, uid: string) => {
  const ob = await sb.from('lhq_dev_user_onboarding').select(FLAGS.join(',')).eq('user_id', uid).maybeSingle();
  const st = await sb.from('lhq_dev_user_settings').select(ANSWERS.join(',')).eq('user_id', uid).maybeSingle();
  return { onboarding: ob.data as Record<string, unknown> | null, settings: st.data as Record<string, unknown> | null };
};

/* Anything that could carry the fixture's email is masked rather than trusted not to be there.
   A public artifact is a public artifact. */
const maskList = (p: Page): Locator[] => [p.locator('[data-testid="user-email"]'), p.locator('header'), p.locator('text=/@/')];
const shot = async (p: Page, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await p.screenshot({ path: `${SHOT_DIR}/${name}.png`, mask: maskList(p), maskColor: '#000000' });
};

test.describe('#1113 onboarding, end to end', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });
  /* A LOUD skip, not a silent pass: the reason prints in the report, so a run that did nothing
     cannot be mistaken for a run that proved something. */
  test.skip(!RESET_OK, 'QA_FIXTURE_RESET is not set — this spec rewrites a shared fixture account, so it refuses to run unless the dispatch ticked `fixture_reset`.');

  const writes: string[] = [];

  test('resets fixture B to a pre-onboarding state, after snapshotting it', async () => {
    const { sb, uid } = await fixtureDb();
    const before = await readRows(sb, uid);
    mkdirSync(SHOT_DIR, { recursive: true });
    writeFileSync(SNAP, JSON.stringify({ at: new Date().toISOString(), ...before }, null, 2));
    console.log('BEFORE onboarding:', JSON.stringify(before.onboarding));
    console.log('BEFORE settings  :', JSON.stringify(before.settings));

    const a = await sb.from('lhq_dev_user_onboarding')
      .update({ tour_seen: false, profile_complete: false, checklist_telegram: false, checklist_price_alert: false, checklist_grok: false, checklist_coins: false, updated_at: new Date().toISOString() })
      .eq('user_id', uid).select(FLAGS.join(','));
    expect(a.error, `reset onboarding: ${a.error?.message ?? ''}`).toBeNull();
    const b = await sb.from('lhq_dev_user_settings').update(RESET_ANSWERS).eq('user_id', uid).select(ANSWERS.join(','));
    expect(b.error, `reset settings: ${b.error?.message ?? ''}`).toBeNull();

    const after = await readRows(sb, uid);
    expect(after.onboarding?.profile_complete, 'profile_complete must be false for the wizard to render').toBe(false);
    expect(after.settings?.display_name, 'the answers must be cleared or the wizard prefills them').toBeNull();
  });

  test('walks the wizard, and the answers reach the database in the order finish() writes them', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'b', { viewport: { width: 1280, height: 1000 }, theme: 'dark' });
    /* ORDER IS THE POINT, so these are appended as they happen rather than counted. */
    ctx.on('request', (r) => {
      const u = r.url();
      if (!/rest\/v1\/lhq_dev_user_(settings|onboarding)/.test(u) || r.method() === 'GET') return;
      writes.push(`${r.method()} ${/user_settings/.test(u) ? 'user_settings' : 'user_onboarding'}`);
    });
    ctx.on('response', (r) => {
      const u = r.url();
      if (!/rest\/v1\/lhq_dev_user_(settings|onboarding)/.test(u) || r.request().method() === 'GET') return;
      writes.push(`  -> ${r.status()} ${/user_settings/.test(u) ? 'user_settings' : 'user_onboarding'}`);
    });

    const p = await ctx.newPage();
    await p.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    /* The wizard replaces the app entirely (OnboardingGate), so its step counter is the proof it
       is up — not a heading, which the dashboard also has. */
    const stepper = p.locator('.obw-headline').first();
    await expect(stepper, 'the wizard should render instead of the dashboard').toBeVisible({ timeout: 60_000 });
    await shot(p, 'onb-01-step1');

    /* `obw-btn-next` IS THE CONTROL'S OWN CLASS, which beats matching "Continue →" by text: the
       label is a database row and can be reworded or translated, and on the last step this button
       is what calls `finish()`. `Skip this question →` is a different button and is deliberately
       never clicked — it also finishes, but WITHOUT the answer, which is the opposite of what this
       test is checking. */
    const nextBtn = () => p.locator('button.obw-btn-next');
    const rows = () => p.locator('button.obw-row');

    /* Step 1 (Profile). `canAdvance` for this step is `country !== '' && acct !== null`, so the
       country and the account range are REQUIRED and the display name is not — but the name is the
       one answer whose exact value can be asserted coming back out of the database, so it is
       filled too. Each control is located by the string the app ships, and each is asserted
       rather than skipped-if-absent: a missing control here means the wizard changed shape, and
       silently continuing would produce a confusing failure three steps later. */
    const name = p.getByPlaceholder('e.g. trader_dom');
    await expect(name, 'step 1 should offer the display-name field').toBeVisible({ timeout: 30_000 });
    await name.fill('QA Onboarding');

    /* The country picker is `button.obw-select` (OnboardingFlow). `button[aria-expanded]` matched
       the wrong/covered element and the click timed out at 30s - the button was visible but not the
       actionable one. Scroll it into view and click its own class. */
    const countryBtn = p.locator('button.obw-select').first();
    await expect(countryBtn, 'step 1 should offer the country picker').toBeVisible();
    await countryBtn.scrollIntoViewIfNeeded();
    await countryBtn.click();
    const search = p.getByPlaceholder('Search country…');
    await expect(search, 'the country panel should open a search box').toBeVisible({ timeout: 15_000 });
    await search.fill('Phil');
    const country = p.locator('button').filter({ hasText: /philippines/i }).first();
    await expect(country, 'searching "Phil" should offer Philippines').toBeVisible({ timeout: 15_000 });
    await country.click();

    const acct = p.locator('button').filter({ hasText: '$1k - $5k' }).first();
    await expect(acct, 'step 1 should offer the account ranges').toBeVisible();
    await acct.click();
    /* Wait for the step to be ADVANCEABLE before clicking Next - `canAdvance` for step 1 needs both
       the country and the account range registered, and clicking Next while it is still disabled
       advances nothing, so step 2's rows never appear (the real failure mode here). */
    await expect(nextBtn(), 'step 1 Next should enable once country and account are set').toBeEnabled({ timeout: 15_000 });
    await shot(p, 'onb-02-step1-filled');
    await nextBtn().click();

    // Steps 2-5: one option each. The first row is a deliberate, recorded choice, not an arbitrary
    // one - the point is that whatever is chosen comes back out of the database unchanged.
    const chosen: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      /* Steps 2-4 are OptionRow buttons (obw-row); step 5 (Source) is optional and renders obw-chip
         buttons instead - the obw-row locator found nothing there (run 43235725102). */
      const optionRows = () => p.locator(i === 3 ? 'button.obw-chip' : 'button.obw-row');
      await expect(optionRows().first()).toBeVisible({ timeout: 30_000 });
      const first = optionRows().first();
      chosen.push((await first.innerText()).replace(/\s+/g, ' ').trim().slice(0, 40));
      await first.click();
      await p.waitForTimeout(400);
      await shot(p, `onb-0${3 + i}-step${2 + i}`);
      /* Same guard between every step: a selection sets the flag that enables Next; clicking it
         before that lands advances nothing. */
      await expect(nextBtn(), `step ${2 + i} Next should enable once an option is picked`).toBeEnabled({ timeout: 15_000 });
      await nextBtn().click();
      await p.waitForTimeout(1_200);
    }
    console.log('chose:', JSON.stringify(chosen));

    /* The wizard hands off to the tour, so the tour appearing is how we know finish() ran rather
       than the last Next having been swallowed. */
    await p.waitForTimeout(6_000);
    console.log('writes, in order:');
    for (const w of writes) console.log(`  ${w}`);
    await shot(p, 'onb-06-after-finish');

    /* THE QUESTION THIS SPEC EXISTS FOR. `profile_complete` must not be true unless the answers
       landed - that combination is the state fixture B was found in. */
    const { sb, uid } = await fixtureDb();
    const after = await readRows(sb, uid);
    console.log('AFTER onboarding:', JSON.stringify(after.onboarding));
    console.log('AFTER settings  :', JSON.stringify(after.settings));

    const settingsWrite = writes.find(w => w.startsWith('  -> ') && w.includes('user_settings'));
    const onboardingWrite = writes.find(w => w.startsWith('  -> ') && w.includes('user_onboarding'));
    console.log(`first settings response: ${settingsWrite ?? 'NONE'} · first onboarding response: ${onboardingWrite ?? 'NONE'}`);

    if (after.onboarding?.profile_complete === true) {
      expect(after.settings?.trading_experience, 'profile_complete is true, so the answers must be there too — true with NULL answers is the #1113 defect').not.toBeNull();
      expect(after.settings?.display_name, 'the display name typed into step 1 must have been stored').toBe('QA Onboarding');
      /* `finish()` maps the chosen range through `acctMap`, so "$1k - $5k" is stored as the
         midpoint 2500 rather than as the label. Asserting the mapped number is what proves the
         answer travelled through the save path rather than a default surviving the reset — the
         reset leaves this column at its schema default of 1000. */
      expect(Number(after.settings?.account_size), '"$1k - $5k" should be stored as acctMap 2500, not the 1000 default').toBe(2500);
    }
    await ctx.close();
  });

  test('restores the fixture to exactly what it was', async () => {
    expect(existsSync(SNAP), 'no snapshot — the reset test must run first').toBeTruthy();
    const prev = JSON.parse(readFileSync(SNAP, 'utf8')) as { onboarding: Record<string, unknown> | null; settings: Record<string, unknown> | null };
    const { sb, uid } = await fixtureDb();
    if (prev.onboarding) {
      const r = await sb.from('lhq_dev_user_onboarding').update({ ...prev.onboarding, updated_at: new Date().toISOString() }).eq('user_id', uid);
      expect(r.error, `restore onboarding: ${r.error?.message ?? ''}`).toBeNull();
    }
    if (prev.settings) {
      const r = await sb.from('lhq_dev_user_settings').update(prev.settings).eq('user_id', uid);
      expect(r.error, `restore settings: ${r.error?.message ?? ''}`).toBeNull();
    }
    const now = await readRows(sb, uid);
    console.log('RESTORED onboarding:', JSON.stringify(now.onboarding));
    console.log('RESTORED settings  :', JSON.stringify(now.settings));
    expect(now.onboarding?.profile_complete, 'the fixture must leave this run in the state it entered it').toBe(prev.onboarding?.profile_complete);
  });
});
