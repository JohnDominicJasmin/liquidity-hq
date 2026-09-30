/* #1113 option-4 rollout: PageHint added to the 8 pages that did not have one (news, alerts, settings,
 * dashboard, calc, econ-calendar, hours, playbook); calc/econ-calendar drop their old subtitle AND, per the
 * owner's final call after seeing the screenshot batch (d4bf1cdf), their old h1 too - PageHint is the sole
 * intro now, matching scanner/journal; SpotlightTour trims from 5 steps to 2 (1 + 5).
 *
 * Structure only, same limit as every component file tonight - no exported function, no DOM test library.
 * Screenshots (all 8 pages, first-visit, fake-session harness, no real creds) confirmed 7 of 8 render
 * correctly; the 8th (settings) was a real placement bug (S-SETTINGS), fixed by dev in 079d59cb and now
 * asserted for real below, not a todo. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function anchorOnce(src: string, needle: string, label: string): number {
  const n = src.split(needle).length - 1;
  assert.equal(n, 1, `${label}: anchor occurs ${n} time(s), expected exactly 1 - re-read the current source`);
  return src.indexOf(needle);
}

/* ══ The 7 pages confirmed correct by screenshot (news, alerts, dashboard, calc, econ-calendar, hours,
   playbook) - settings is separate below, it is NOT in this list. ══ */

const SIMPLE_PAGES = [
  { file: 'app/news/page.tsx', wrap: 'news-term-wrap', pageKey: 'news', titleKey: 'NEWS_HINT_TITLE', bodyKey: 'NEWS_HINT_BODY' },
  { file: 'app/alerts/page.tsx', wrap: 'alerts-term-wrap', pageKey: 'alerts', titleKey: 'ALERTS_HINT_TITLE', bodyKey: 'ALERTS_HINT_BODY' },
  { file: 'app/hours/page.tsx', wrap: 'hours-term-wrap', pageKey: 'hours', titleKey: 'HOURS_HINT_TITLE', bodyKey: 'HOURS_HINT_BODY' },
  { file: 'app/playbook/page.tsx', wrap: 'playbook-term-wrap', pageKey: 'playbook', titleKey: 'PLAYBOOK_HINT_TITLE', bodyKey: 'PLAYBOOK_HINT_BODY' },
  { file: 'components/DashboardTerminal.tsx', wrap: 'dashboard-grid', pageKey: 'dashboard', titleKey: 'DASHBOARD_HINT_TITLE', bodyKey: 'DASHBOARD_HINT_BODY' },
];

for (const p of SIMPLE_PAGES) {
  test(`S1. ${p.pageKey}: PageHint is the first child of the page wrapper, with this page's own key/title/body - confirmed rendering correctly by screenshot`, () => {
    const source = stripComments(read(p.file));
    const wrapAt = anchorOnce(source, `"${p.wrap}"`, `the ${p.wrap} class`);
    const hintNeedle = `<PageHint pageKey="${p.pageKey}" title={t('${p.titleKey}')} body={t('${p.bodyKey}')} />`;
    const hintAt = anchorOnce(source, hintNeedle, `${p.pageKey}'s PageHint tag`);
    assert.ok(hintAt > wrapAt, `PageHint is not inside (or not right after) the ${p.wrap} div - re-check placement`);
    assert.ok(hintAt - wrapAt < 200, `PageHint is not the first thing inside the ${p.wrap} div (${hintAt - wrapAt} chars away) - something was inserted between the wrapper and the hint`);
  });
}

/* ══ calc: PageHint replaces the old subtitle entirely ══ */

test('S2. calc: PageHint is present with the right key/copy, and the old CALC_PAGE_SUBTITLE div is gone - not just unused, actually removed from the render', () => {
  const source = stripComments(read('app/calc/page.tsx'));
  anchorOnce(source, "<PageHint pageKey=\"calc\" title={t('CALC_HINT_TITLE')} body={t('CALC_HINT_BODY')} />", 'calc\'s PageHint tag');
  assert.doesNotMatch(source, /CALC_PAGE_SUBTITLE/, 'the old subtitle text is still referenced in calc/page.tsx');
});

/* S2b was "CALC_PAGE_TITLE is not referenced at all". That held the owner's call (no visible title above the
 * hint) but also forbade the page having any heading, and qa/e2e/seo.spec.ts caught the cost on qa (2656e4c):
 * pages without an <h1> went 13 -> 14, the new one being /calc. The fix keeps the owner's call exactly - nothing
 * visible - and gives the page a heading only screen readers and search engines get. So the title key may appear
 * once, inside an sr-only h1, and nowhere a visitor can see it. */
test('S2b. calc: no VISIBLE title above the hint (owner\'s h1-drop, d4bf1cdf) - CALC_PAGE_TITLE appears only in the screen-reader heading', () => {
  const source = stripComments(read('app/calc/page.tsx'));
  const uses = source.split('CALC_PAGE_TITLE').length - 1;
  assert.equal(uses, 1, `CALC_PAGE_TITLE is referenced ${uses} time(s) in calc/page.tsx - expected exactly once, in the sr-only h1`);
  anchorOnce(source, `<h1 className="sr-only">{t('CALC_PAGE_TITLE')}</h1>`, 'calc\'s screen-reader heading');
  const h1s = source.match(/<h1\b[^>]*>/g) ?? [];
  assert.deepEqual(h1s, ['<h1 className="sr-only">'], `calc/page.tsx has a visible h1 again (${h1s.join(', ')}) - the owner dropped the visible title; only the sr-only one is allowed`);
});

test('S2c. calc: the screen-reader heading is really invisible - `.sr-only` is the visually-hidden pattern, defined once', () => {
  const css = read('app/globals.css');
  const rules = css.match(/(^|\n)\s*\.sr-only\s*\{[^}]*\}/g) ?? [];
  assert.equal(rules.length, 1, `.sr-only is defined ${rules.length} time(s) in app/globals.css - a second rule could make the calc heading visible`);
  const r = rules[0].replace(/\s+/g, ' ');
  for (const decl of ['position: absolute', 'width: 1px', 'height: 1px', 'overflow: hidden', 'clip: rect(0,0,0,0)']) {
    assert.ok(r.includes(decl), `.sr-only no longer has "${decl}" - the calc h1 may show on screen, which the owner's h1-drop forbids`);
  }
  const overrides = css.match(/[^\n{}]*\.sr-only\b[^{\n]*\{/g) ?? [];
  assert.equal(overrides.length, 1, `.sr-only is also targeted by another selector (${overrides.map((o) => o.trim()).join(' | ')}) - check it does not un-hide the heading`);
});

/* ══ econ-calendar: PageHint replaces the subtitle, but the standalone source credit survives ══ */

test('S3. econ-calendar: PageHint is present, ECON_CALENDAR_SUBTITLE is gone, but the data-source credit (e.g. "forexfactory+fed+computed") still renders on its own, not deleted along with the subtitle', () => {
  const source = stripComments(read('app/econ-calendar/page.tsx'));
  anchorOnce(source, "<PageHint pageKey=\"econ-calendar\" title={t('ECON_CALENDAR_HINT_TITLE')} body={t('ECON_CALENDAR_HINT_BODY')} />", 'econ-calendar\'s PageHint tag');
  assert.doesNotMatch(source, /ECON_CALENDAR_SUBTITLE/, 'the old subtitle text is still referenced');
  // d4bf1cdf: the owner's h1-drop restructured this line - it moved up and picked up the header's own
  // vertical rhythm (padding: '20px 0 16px') in place of the plain fontSize/color-only div it replaced.
  // Re-verified against origin/dev before updating this anchor, not just from the report that flagged it.
  anchorOnce(source, "{source && (\n        <div style={{ padding: '20px 0 16px', fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{source}</div>", 'the standalone source-credit line');
});

test('S3b. econ-calendar: the old h1 (ECON_CALENDAR_TITLE) is dropped too, per the owner\'s final h1-drop (d4bf1cdf) - PageHint is the sole intro, not a duplicate title above it', () => {
  const source = stripComments(read('app/econ-calendar/page.tsx'));
  assert.doesNotMatch(source, /ECON_CALENDAR_TITLE/, 'ECON_CALENDAR_TITLE (the old h1) is still referenced in app/econ-calendar/page.tsx - it should have been dropped alongside the subtitle');
});

/* ══ settings: was THE FINDING on 0ff6e71e - PageHint had landed on the signed-OUT limited branch, not the
   signed-in one, even though its own approved copy describes signed-in-only features (trading profile,
   notifications, subscription). Fixed by dev in 079d59cb (one line moved, nothing else touched). Confirmed
   fixed two ways: source below, and a re-shot fake-signed-in-session screenshot of /settings. Real assertion
   now, no longer `todo`. ══ */

test('S-SETTINGS. the settings hint is on the SIGNED-IN settings page only, not the signed-out limited view - 079d59cb, was a todo on 0ff6e71e', () => {
  const source = stripComments(read('app/settings/page.tsx'));
  const hintAt = anchorOnce(source, "<PageHint pageKey=\"settings\" title={t('SETTINGS_HINT_TITLE')} body={t('SETTINGS_HINT_BODY')} />", 'the settings PageHint tag');
  const signedOutWrapperAt = anchorOnce(source, '<div className="st-page settings-term-wrap" data-testid="settings-page">', 'the signed-out limited-view wrapper');
  const signedInWrapperAt = anchorOnce(source, '<div className="st-page" data-testid="settings-page">', 'the signed-in full-view wrapper');
  assert.ok(signedOutWrapperAt < signedInWrapperAt, 'source order assumption broke - re-derive before trusting the rest of this test');
  assert.ok(hintAt > signedInWrapperAt, 'PageHint is at or before the signed-in wrapper - it has not moved off the signed-out branch');
  assert.ok(hintAt - signedInWrapperAt < 200, `PageHint is not near the top of the signed-in render (${hintAt - signedInWrapperAt} chars away)`);
});

/* ══ SpotlightTour: trimmed to steps 1 + 5, finish still routes to Arena ══ */

test('S4. STEPS has exactly two entries - the old steps 2/3/4 (funding/OI/Telegram) are gone, not just unreferenced', () => {
  const source = stripComments(read('components/SpotlightTour.tsx'));
  const stepsAt = anchorOnce(source, 'const STEPS: {', 'the STEPS array declaration');
  const arrayBody = source.slice(stepsAt, source.indexOf('];', stepsAt));
  const entries = [...arrayBody.matchAll(/tagKey:\s*'SPOTLIGHT_TOUR_STEP(\d)_TAG'/g)].map((m) => m[1]);
  assert.deepEqual(entries, ['1', '5'], `STEPS should contain exactly step 1 then step 5, found: ${entries.join(', ') || '(none)'}`);
});

test('S5. isLast is derived from STEPS.length, not a hard-coded index - trimming the array could not silently break "finish" detection', () => {
  const source = stripComments(read('components/SpotlightTour.tsx'));
  anchorOnce(source, 'const isLast  = step === STEPS.length - 1;', 'the isLast derivation');
});

test('S6. finishing the (now 2-step) tour still routes to /arena, unchanged by the trim', () => {
  const source = stripComments(read('components/SpotlightTour.tsx'));
  const at = anchorOnce(source, 'function next() {', 'the next() handler');
  const body = source.slice(at, source.indexOf('function back()', at));
  assert.match(body, /if \(isLast\) \{\s*close\(\);\s*router\.push\('\/arena'\);/, 'the finish path no longer closes and routes to /arena on isLast');
});

test('S7. the retired Step2Visual/Step3Visual/Step4Visual functions are actually gone from the file, not left as dead code alongside a trimmed STEPS array', () => {
  const source = stripComments(read('components/SpotlightTour.tsx'));
  for (const fn of ['function Step2Visual', 'function Step3Visual', 'function Step4Visual']) {
    assert.doesNotMatch(source, new RegExp(fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${fn} is still defined - dead code left behind`);
  }
});

/* ══ Labels ═════════════════════════════════════════════════════════════════════════════════════════ */

const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
const ALL_KEYS = [...SIMPLE_PAGES, { titleKey: 'CALC_HINT_TITLE', bodyKey: 'CALC_HINT_BODY' }, { titleKey: 'SETTINGS_HINT_TITLE', bodyKey: 'SETTINGS_HINT_BODY' }, { titleKey: 'ECON_CALENDAR_HINT_TITLE', bodyKey: 'ECON_CALENDAR_HINT_BODY' }]
  .flatMap((p) => [p.titleKey, p.bodyKey]);

test('L1. all 16 new hint keys are registered and have a non-empty English default', () => {
  const keys = read('lib/labelKeys.ts');
  assert.equal(ALL_KEYS.length, 16, 'the expected-key list itself does not total 16 - the rollout scope changed');
  for (const k of ALL_KEYS) {
    assert.ok(keys.includes(`'${k}'`), `${k} is not in lib/labelKeys.ts`);
    assert.ok(typeof defaults[k] === 'string' && defaults[k].trim().length > 0, `${k} has no default text`);
  }
});

test('L2. the migration\'s live and commented-dev rows both equal the shipped default, for all 16 keys, exactly', () => {
  const sql = read('supabase/migrations/20260928a_labels_page_hint_rollout.sql');
  const rows = (commented: boolean) => {
    const out: Record<string, string> = {};
    for (const raw of sql.split('\n')) {
      const line = raw.trim();
      const isCommentRow = line.startsWith("-- ('");
      const isLiveRow = line.startsWith("('");
      if (commented ? !isCommentRow : !isLiveRow) continue;
      const bare = commented ? line.slice(3) : line;
      const parts = bare.replace(/^\('/, '').replace(/'\)[,;]?\s*$/, '').split("','");
      if (parts.length === 3 && parts[1] === 'en') out[parts[0]] = parts[2].split("''").join("'");
    }
    return out;
  };
  const live = rows(false), dev = rows(true);
  assert.deepEqual(Object.keys(live).sort(), [...ALL_KEYS].sort(), 'the live block seeds a different key set than expected');
  assert.deepEqual(live, dev, 'the commented dev block has drifted from the live block');
  for (const k of ALL_KEYS) assert.equal(live[k], defaults[k], `${k}: migration and shipped default differ`);
});
