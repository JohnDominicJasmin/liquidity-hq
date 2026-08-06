import { test, expect } from '@playwright/test';
import { BASELINE } from './_shared';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext } from './_auth';

/**
 * Accessibility of the SIGNED-IN surface.
 *
 * Everything else in qa/e2e/ tests the signed-out app. Settings, TradeJournal
 * and the chat panel had been reached exactly once, by hand, on 2026-08-06 -
 * which is why the six findings in pendings/QA_A11Y_FINDINGS_2026-08-05.md §4
 * sat marked UNVERIFIED for a day. This spec is what makes them re-checkable
 * every run instead of once by a person who remembered to look.
 *
 * Verdicts from that verification, all measured in the browser:
 *
 *   U1  SettingsModal unlabelled inputs            CONFIRMED (9, not the ~24 claimed)
 *   U2  TradeJournal aria-label drift              REFUTED - see the test below
 *   U3  inline-edit controls with no name          CONFIRMED (4, exactly as claimed)
 *   U4  rule-builder selects with no label         CONFIRMED (3)
 *   U5  auth errors not announced                  CONFIRMED, and wider than claimed
 *   U6  GrokChat replies not announced             CONFIRMED
 *
 * WHY THE WAITS ARE SCOPED TO A FEATURE ELEMENT rather than a timeout or a
 * page-wide control count: an earlier pass of this same verification scored
 * "0 findings" on /journal because the journal had not rendered. The page still
 * had 112 visible controls at that moment - all of them nav chrome and footer -
 * so any "did the page load" guard based on counting would have passed. Every
 * waitFor below names an element the feature itself owns, and its absence fails
 * the test rather than quietly scoring zero.
 */

test.describe('accessibility (signed in)', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  // Desktop only: these are the same DOM on mobile and running both doubles the
  // cost of the slowest specs in the suite for no extra signal.
  test.beforeEach(({ }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'same DOM as desktop');
  });

  /**
   * Accessible name by any of the routes that actually produce one.
   *
   * Deliberately generous - title= counts, a wrapping label counts. A control
   * only fails here if it has no name at all, so a finding cannot be an artefact
   * of a strict definition.
   *
   * One subtlety worth stating: own text names a <button>, but for an <input>,
   * <select> or <textarea> the "text" is the value or the option list, which is
   * not a name. Treating textContent as a name is what made an earlier pass
   * report the edit-form notes field as labelled - it was reading back the
   * fixture text stored in it.
   */
  const unnamedIn = (page: import('@playwright/test').Page, selector: string) =>
    page.evaluate((sel: string) => {
      const t = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      return [...document.querySelectorAll(sel)]
        .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
        .filter(el => {
          const tag = el.tagName.toLowerCase();
          const labelledby = (el.getAttribute('aria-labelledby') || '').split(/\s+/)
            .map(id => id && document.getElementById(id))
            .filter((n): n is HTMLElement => !!n)
            .map(n => t(n.innerText || n.textContent)).join(' ');
          const explicit = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
          const wrapping = el.closest('label');
          const ownText = (tag === 'button' || el.getAttribute('role') === 'button')
            ? t((el as HTMLElement).innerText || el.textContent) : '';
          return !(t(el.getAttribute('aria-label')) || t(labelledby)
            || (explicit ? t((explicit as HTMLElement).innerText || explicit.textContent) : '')
            || (wrapping && wrapping !== explicit
                ? t((wrapping as HTMLElement).innerText || wrapping.textContent) : '')
            || t(el.getAttribute('title')) || ownText);
        })
        .map(el => el.tagName.toLowerCase()
          + (typeof el.className === 'string' && el.className
              ? '.' + el.className.trim().split(/\s+/)[0] : '')
          + (el.getAttribute('placeholder')
              ? ` placeholder="${el.getAttribute('placeholder')}"` : ''));
    }, selector);

  const CONTROLS = 'input:not([type=hidden]), select, textarea, button, [role=button]';

  // ── U1 ──────────────────────────────────────────────────────────────────
  test('U1: SettingsModal controls have accessible names', async ({ browser }, testInfo) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('button.nav-tile', { state: 'visible', timeout: 40_000 });
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button.nav-tile')]
          .find(x => /settings/i.test((x as HTMLElement).innerText || ''));
        (b as HTMLElement | undefined)?.click();
      });
      // Absence fails the test. The modal not opening is not "zero findings".
      await page.waitForSelector('.smod-panel', { state: 'visible', timeout: 40_000 });

      const unnamed = await unnamedIn(page, `.smod-panel ${CONTROLS}`);
      // The other half of U1: the visible text IS there, it just names nothing.
      const orphanLabels = await page.evaluate(() =>
        [...document.querySelectorAll('.smod-panel label')]
          .filter(l => !l.getAttribute('for') && !l.querySelector('input,select,textarea'))
          .map(l => ((l as HTMLElement).innerText || '').trim().slice(0, 40)));

      testInfo.attach('settings-modal-unnamed.txt', {
        body: `unnamed controls:\n${unnamed.join('\n')}\n\nlabels naming nothing:\n${orphanLabels.join('\n')}`,
        contentType: 'text/plain',
      });

      expect(
        unnamed.length,
        `SettingsModal controls with no accessible name: ` +
        `${BASELINE.authUnnamedControls.settingsModal} -> ${unnamed.length}.\n` +
        `${orphanLabels.length} <label> elements in this modal carry the visible text but have ` +
        `no for= and wrap no control, so they name nothing: ${orphanLabels.join(', ')}.\n` +
        `Fix by adding id/htmlFor pairs. Do NOT add aria-label alongside the visible <label> - ` +
        `that overrides the visible text and breaks voice control (docs/HANDOVER.md §14).\n` +
        unnamed.join('\n'),
      ).toBeLessThanOrEqual(BASELINE.authUnnamedControls.settingsModal);
    } finally { await ctx.close(); }
  });

  // ── U2 ──────────────────────────────────────────────────────────────────
  /**
   * U2 was REFUTED, and this test guards the thing that is actually true rather
   * than the claim.
   *
   * The claim was that TradeJournal's aria-label strings had drifted from the
   * visible labels, citing "Entry *" against aria-label "Entry". Measured, that
   * is not drift: the asterisk is a required-field marker, and the accessible
   * name a voice-control user speaks is "Entry", which matches. Of the four
   * pairs only "Position Size ($)" differs from its aria-label "Position Size",
   * and that also matches what a user would say.
   *
   * What IS true and worth holding: all four visible labels have no for=, so
   * the aria-label is the ONLY name each field has. That is fine today, and it
   * is one careless edit from not being fine - if anyone adds htmlFor without
   * removing the aria-label, the aria-label silently wins and the visible text
   * stops being the name. So this asserts every field keeps a name, and that
   * no field ends up with both an aria-label and a real label association.
   */
  test('U2: TradeJournal log-trade fields keep exactly one source of name', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      await page.goto('/journal', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('input.tj-inp', { state: 'visible', timeout: 40_000 });

      const pairs = await page.evaluate(() =>
        [...document.querySelectorAll('.tj-field')].map(f => {
          const lbl = f.querySelector('label');
          const ctl = f.querySelector('input,select,textarea');
          if (!lbl || !ctl) return null;
          const t = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
          return {
            visible: t((lbl as HTMLElement).innerText),
            aria: t(ctl.getAttribute('aria-label')),
            htmlFor: lbl.getAttribute('for') || '',
            wraps: !!lbl.querySelector('input,select,textarea'),
          };
        }).filter(Boolean) as { visible: string; aria: string; htmlFor: string; wraps: boolean }[]);

      expect(pairs.length, 'no .tj-field label/control pairs found - the form did not render').toBeGreaterThan(0);

      const nameless = pairs.filter(p => !p.aria && !p.htmlFor && !p.wraps);
      expect(nameless, `log-trade fields with no name at all: ${JSON.stringify(nameless)}`).toEqual([]);

      // The override defect: an aria-label AND a real association. The
      // aria-label wins, so the visible text stops being the accessible name.
      const both = pairs.filter(p => p.aria && (p.htmlFor || p.wraps));
      expect(
        both,
        `These fields have an aria-label AND an associated <label>. The aria-label wins, so ` +
        `the visible text is no longer the accessible name and voice control breaks ` +
        `(docs/HANDOVER.md §14). Remove the aria-label, keep the association: ${JSON.stringify(both)}`,
      ).toEqual([]);
    } finally { await ctx.close(); }
  });

  // ── U3 ──────────────────────────────────────────────────────────────────
  test('U3: TradeJournal inline-edit controls have accessible names', async ({ browser }, testInfo) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      await page.goto('/journal', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('button.tj-tab', { state: 'visible', timeout: 40_000 });
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button.tj-tab')]
          .find(x => /history/i.test((x as HTMLElement).innerText || ''));
        (b as HTMLElement | undefined)?.click();
      });
      // Needs account A's fixture trade to exist. If it does not, this fails
      // rather than passing on an empty history - which would be a false green.
      await page.waitForSelector('button.tj-edit-btn', { state: 'visible', timeout: 40_000 });
      await page.evaluate(() => (document.querySelector('button.tj-edit-btn') as HTMLElement).click());
      await page.waitForSelector('.tj-edit-form', { state: 'visible', timeout: 20_000 });

      const unnamed = await unnamedIn(page, `.tj-edit-form ${CONTROLS}`);
      testInfo.attach('journal-inline-edit-unnamed.txt', { body: unnamed.join('\n'), contentType: 'text/plain' });
      expect(
        unnamed.length,
        `Inline-edit controls with no accessible name: ` +
        `${BASELINE.authUnnamedControls.journalInlineEdit} -> ${unnamed.length}.\n` +
        `A screen reader announces these as "edit text, blank". ` +
        `components/TradeJournal.tsx, the .tj-edit-form block.\n` + unnamed.join('\n'),
      ).toBeLessThanOrEqual(BASELINE.authUnnamedControls.journalInlineEdit);
    } finally { await ctx.close(); }
  });

  // ── U4 ──────────────────────────────────────────────────────────────────
  test('U4: TradeJournal rule-builder selects have accessible names', async ({ browser }, testInfo) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      await page.goto('/journal', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('button.tj-tab', { state: 'visible', timeout: 40_000 });
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button.tj-tab')]
          .find(x => ((x as HTMLElement).innerText || '').trim().toLowerCase().startsWith('rules'));
        (b as HTMLElement | undefined)?.click();
      });
      const openedBuilder = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')]
          .filter(x => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
          .find(x => /custom rule/i.test((x as HTMLElement).innerText || ''));
        if (!b) return false;
        (b as HTMLElement).click();
        return true;
      });
      expect(openedBuilder, 'the "+ Custom Rule" button was not found - the Rules tab did not render').toBe(true);
      await page.waitForSelector('select', { state: 'visible', timeout: 20_000 });

      const unnamed = await unnamedIn(page, 'select');
      testInfo.attach('journal-rule-builder-unnamed.txt', { body: unnamed.join('\n'), contentType: 'text/plain' });
      expect(
        unnamed.length,
        `Rule-builder selects with no accessible name: ` +
        `${BASELINE.authUnnamedControls.journalRuleBuilder} -> ${unnamed.length}.\n` +
        `These have inline styles, no class, no id and no label of any kind. ` +
        `A select's option text is not its name.\n` + unnamed.join('\n'),
      ).toBeLessThanOrEqual(BASELINE.authUnnamedControls.journalRuleBuilder);
    } finally { await ctx.close(); }
  });

  // ── U5 ──────────────────────────────────────────────────────────────────
  /**
   * WCAG 2.2 SC 4.1.3 Status Messages, Level AA.
   *
   * Signed out, so no fixtures needed - it lives here because it is the same
   * finding set. All three auth forms render the error into
   * `<div className="login-error">` with no role and no aria-live, so a screen
   * reader user submits, hears nothing, and has no way to know why nothing
   * happened. The claim named /login only; /forgot-password does it too.
   *
   * Triggering it: /login has no <form> element at all. The submit button is
   * disabled until Turnstile returns a token, but the password field carries
   * onEnter={submitPassword}, so Enter reaches the handler regardless. The
   * handler's own captcha branch then renders the SAME element the credential
   * failure renders. The message differs; the element under test does not.
   */
  test('U5: auth error messages are announced', async ({ page }) => {
    const forms: { path: string; act: () => Promise<void> }[] = [
      { path: '/login', act: async () => {
          await page.evaluate(() => {
            const b = [...document.querySelectorAll('button')]
              .find(x => /use password/i.test((x as HTMLElement).innerText || ''));
            (b as HTMLElement | undefined)?.click();
          });
          await page.waitForSelector('input[type=password]', { state: 'visible', timeout: 20_000 });
          await page.fill('input.login-email-input', 'qa-nonexistent@example.com');
          await page.fill('input[type=password]', 'wrong-password-123');
          await page.press('input[type=password]', 'Enter');
        } },
      { path: '/login', act: async () => {
          await page.fill('input.login-email-input', 'qa-nonexistent@example.com');
          await page.press('input.login-email-input', 'Enter');
        } },
      { path: '/forgot-password', act: async () => {
          await page.fill('input.login-email-input', 'qa-nonexistent@example.com');
          await page.press('input.login-email-input', 'Enter');
        } },
    ];

    const notAnnounced: string[] = [];
    for (const { path, act } of forms) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('input.login-email-input', { state: 'visible', timeout: 40_000 });
      await act();
      await page.waitForSelector('.login-error', { state: 'visible', timeout: 20_000 });
      const bad = await page.evaluate(() =>
        [...document.querySelectorAll('.login-error')]
          .filter(el => !el.getAttribute('role') && !el.getAttribute('aria-live'))
          .map(el => `${location.pathname}: "${((el as HTMLElement).innerText || '').trim().slice(0, 60)}"`));
      notAnnounced.push(...bad);
    }

    // Ratchet, not a hard assert - all 3 fail today. See BASELINE.unannouncedStatus
    // for why this is a baseline rather than a red build.
    expect(
      notAnnounced.length,
      `Auth errors that render visibly but are not announced: ` +
      `${BASELINE.unannouncedStatus.authForms} -> ${notAnnounced.length}. ` +
      `WCAG 2.2 SC 4.1.3 Status Messages, Level AA. Add role="alert" to the ` +
      `.login-error container in app/login/page.tsx and app/forgot-password/page.tsx, ` +
      `then lower this baseline in the same commit. Target is 0.\n` + notAnnounced.join('\n'),
    ).toBeLessThanOrEqual(BASELINE.unannouncedStatus.authForms);
  });

  // ── U6 ──────────────────────────────────────────────────────────────────
  /**
   * Also SC 4.1.3. A Grok reply streams into .gchat-msgs with no live region
   * anywhere in the panel, so a screen reader user asks a question and is never
   * told an answer arrived.
   *
   * Asserts on the container, not on a real reply: sending one costs an API call
   * per run and makes the test depend on a third party being up. The container
   * carrying aria-live is what makes any reply announced, so it is the right
   * thing to hold.
   */
  test('U6: GrokChat replies land in a live region', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('button.gchat-fab', { state: 'visible', timeout: 40_000 });
      await page.evaluate(() => (document.querySelector('button.gchat-fab') as HTMLElement).click());
      await page.waitForSelector('.gchat-msgs', { state: 'visible', timeout: 20_000 });

      const live = await page.evaluate(() => {
        const msgs = document.querySelector('.gchat-msgs')!;
        const panel = document.querySelector('.gchat-panel');
        return {
          onMsgs: msgs.getAttribute('aria-live') || msgs.getAttribute('role'),
          insidePanel: panel
            ? panel.querySelectorAll('[aria-live], [role=log], [role=status], [role=alert]').length : 0,
        };
      });

      const missing = (live.onMsgs === null && live.insidePanel === 0) ? 1 : 0;
      // Ratchet, not a hard assert - this fails today. See BASELINE.unannouncedStatus.
      expect(
        missing,
        `The Grok chat message list has no live region: ` +
        `${BASELINE.unannouncedStatus.grokChat} -> ${missing}. .gchat-msgs carries neither ` +
        `aria-live nor role, and there are ${live.insidePanel} live regions anywhere in the ` +
        `panel. A reply arrives with no announcement, so a screen reader user has no way to ` +
        `know the assistant answered. WCAG 2.2 SC 4.1.3, Level AA. ` +
        `Add aria-live="polite" (or role="log") to .gchat-msgs in components/GrokChat.tsx, ` +
        `then lower this baseline in the same commit. Target is 0.`,
      ).toBeLessThanOrEqual(BASELINE.unannouncedStatus.grokChat);
    } finally { await ctx.close(); }
  });
});
