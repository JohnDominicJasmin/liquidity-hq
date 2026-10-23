import { test, expect } from '@playwright/test';
import { FIXTURES, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence, assertNoUnstubbedPaidAi } from './_no-paid-ai';

/* WHICH ELEMENT MAKES /arena 421px WIDE AT 390 - and is it a race or a state? (#1263)
 *
 * The state matrix found `/arena` reading `scrollWidth` 421 against a requested 390 in two of eight phone cells:
 * signed-out/dark and free/light. Dev's read, which is the one this probe is built on: **neither variable explains it.**
 * If it were the account state, signed-out would fail in both themes; if it were the theme, dark would fail in every
 * state. Each failing state passes in the other theme. That leaves TIMING - an element whose width is wrong only while
 * something has not settled, caught in the two cells whose measurement happened to land early.
 *
 * Dev also searched the CSS and ruled out, by reading rather than assuming: `.arena-ws`'s fixed 320px column (it has a
 * phone override at globals.css:3507), `UpgradeGateModal`/`LockedFeatureCard` (every container is width:100% with a
 * maxWidth, which clamps rather than overflows), and any `min-width` between 300 and 500px in globals.css. So a static
 * hunt may never find it, and the question moves to the harness.
 *
 * ── WHAT THIS DOES THAT THE MATRIX DID NOT ──────────────────────────────────────────────────────────────────────
 *
 * 1. NAMES THE ELEMENT. On overflow it records the five deepest right edges past the viewport - Dev's snippet. The
 *    widest right edge is the culprit; the rest are usually its ancestors.
 * 2. SAMPLES TWICE IN TIME, EARLY AND LATE. If 421 appears only in the early sample, this is a layout FLASH rather
 *    than a persistent overflow - a different fix and arguably a different severity. The matrix measured once, after a
 *    wait, which is why it saw this in two cells rather than in none or eight.
 * 3. REPEATS. Two of eight may be "one in four" rather than "these two cells", and that distinction decides whether
 *    Dev is hunting a race or a state. Each (state, theme) pair runs REPEATS times.
 *
 * ── AND IT REPORTS AN EMPTY OFFENDER LIST AS A RESULT, NOT A FAILURE ────────────────────────────────────────────
 *
 * If `scrollWidth` reads 421 and nothing's right edge exceeds the viewport, that IS the answer: the overflow is gone
 * by the time we look. It confirms timing and says to capture at first paint instead. A probe that treated that as
 * "found nothing" would throw away its most informative outcome.
 *
 * usage: E2E_BASE_URL=https://liquidity-hq-staging.onrender.com npx playwright test arena-overflow-probe --project=desktop */

const REPEATS = 4;
const WIDTH = 390;
const HEIGHT = 844;

/* Dev's snippet runs as a FUNCTION passed to page.evaluate, not as a string through eval. Playwright serialises the
   function to the page either way, so the behaviour is identical - and a string plus eval would be an unnecessary
   dynamic-code path in a test harness, which is worth avoiding even when the string is a constant in this same file. */

interface Box { right: number; w: number; over: boolean; tag: string; cls: string; id: string | null; testid: string | null }
interface Sample { when: 'early' | 'late'; scrollWidth: number; clientWidth: number; nodes: number; censusMs: number; offenders: Box[]; widestRight: Box[]; widestBox: Box[] }

const results: Array<{ state: string; theme: string; run: number; samples: Sample[] }> = [];

async function sample(page: import('@playwright/test').Page, when: 'early' | 'late'): Promise<Sample> {
  const m = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const describe = (el: Element) => {
      const r = el.getBoundingClientRect();
      return {
        right: Math.round(r.right),
        w: Math.round(r.width),
        over: r.right > vw + 1,
        tag: el.tagName.toLowerCase(),
        cls: (el.className?.toString?.() ?? '').slice(0, 60),
        id: el.id || null,
        testid: el.getAttribute('data-testid'),
      };
    };
    /* THE CENSUS TIMES ITSELF - Dev's line, and it turns a caveat into a figure. A census that took 12ms at the 600ms
       mark is a snapshot; one that took 300ms is a smear across half the interval, and the reader can tell which
       without anyone arguing about it. The rect reads force layout once rather than once per node (nothing mutates
       the DOM in the loop), so the exposure is wall-clock on a still-painting page - which is what this measures. */
    const t0 = performance.now();
    const all = Array.from(document.querySelectorAll('*'));
    /* THE CENSUS, IN EVERY CELL - Dev's refinement, and it needs no selector known in advance.
       The widest five right edges are recorded whether or not they overflow, so a PASSING cell shows whether the same
       element is present and merely not overflowing. That distinguishes two defects wearing one symptom: present
       everywhere and overflowing sometimes (something upstream is sized differently, the element is a victim) versus
       present only when it overflows (its own conditional render is the whole story, and the fix is one `&&`).
       Doing it per cell beats a second run keyed on the first run's selector, which would need the first run to have
       found something. */
    const widestRight = all.map(describe).sort((a, b) => b.right - a.right).slice(0, 5);
    /* And the widest elements by WIDTH, because Dev's reading is that the offender is binary-present at a FIXED width
       rather than a growing one - two cells landing on exactly 421 is not what ticking text does. An element 421px wide
       sitting inside a 390px viewport is the thing to look for, and it is findable even in a cell that does not
       overflow (clipped, scrolled, or positioned so its right edge stays inside). */
    const widestBox = all.map(describe).sort((a, b) => b.w - a.w).slice(0, 3);
    const censusMs = Math.round(performance.now() - t0);
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth: vw, nodes: all.length, censusMs,
      offenders: widestRight.filter((x) => x.over), widestRight, widestBox };
  });
  return { when, ...m };
}

for (const state of ['out', 'free'] as const) {
  for (const theme of ['dark', 'light'] as const) {
    for (let run = 1; run <= REPEATS; run++) {
      test(`/arena 390px · ${state} · ${theme} · run ${run}`, async ({ browser, page: plainPage }) => {
        test.skip(test.info().project.name !== 'desktop', 'the probe sets its own viewport');
        test.skip(state === 'free' && (!FIXTURES.bEmail || !FIXTURES.bPassword), 'no credentials for the free account');

        let page = plainPage;
        let ctx: Awaited<ReturnType<typeof browser.newContext>> | null = null;

        if (state === 'free') {
          ctx = await signedInContext(browser, 'b', { viewport: { width: WIDTH, height: HEIGHT }, theme });
          page = await ctx.newPage();
        } else {
          await page.setViewportSize({ width: WIDTH, height: HEIGHT });
          await page.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch { /* private mode */ } }, theme);
        }
        await installPaidAiFence(page);

        try {
          if (state === 'free') await gotoSignedIn(page, '/arena');
          else await page.goto('/arena', { waitUntil: 'domcontentloaded' });

          /* EARLY: deliberately soon after the document exists, to catch a flash the matrix's 3-4s wait would miss. */
          await page.waitForTimeout(600);
          const early = await sample(page, 'early');

          /* LATE: after the page has had time to settle, which is where the matrix measured. */
          await page.waitForTimeout(4000);
          const late = await sample(page, 'late');

          results.push({ state, theme, run, samples: [early, late] });
          // eslint-disable-next-line no-console
          console.log(`PROBE ${JSON.stringify({ state, theme, run,
            early: { sw: early.scrollWidth, over: early.offenders.length, censusMs: early.censusMs, nodes: early.nodes },
            late: { sw: late.scrollWidth, over: late.offenders.length, censusMs: late.censusMs, nodes: late.nodes },
            offenders: (late.offenders.length ? late.offenders : early.offenders),
            widestBoxLate: late.widestBox })}`);

          /* The assertion is on the LATE sample, because that is what a user is left looking at. An early-only
             overflow is recorded and reported rather than failed - it is a different defect. */
          expect(late.scrollWidth,
            `/arena ${state}/${theme} run ${run}: scrollWidth ${late.scrollWidth} against clientWidth ${late.clientWidth}`)
            .toBeLessThanOrEqual(late.clientWidth + 1);
        } finally {
          assertNoUnstubbedPaidAi(page, `/arena ${state}/${theme} run ${run}`);
          await ctx?.close();
        }
      });
    }
  }
}

test.afterAll(() => {
  if (!results.length) return;
  const over = (s: Sample) => s.scrollWidth > s.clientWidth + 1;
  const earlyOnly = results.filter((r) => over(r.samples[0]) && !over(r.samples[1])).length;
  const lateToo = results.filter((r) => over(r.samples[1])).length;
  // eslint-disable-next-line no-console
  console.log(`\nARENA OVERFLOW PROBE: ${results.length} runs | overflowing early only: ${earlyOnly} | still overflowing late: ${lateToo}`);
  // eslint-disable-next-line no-console
  console.log('If "early only" is the larger number this is a layout FLASH, not a persistent overflow - a different fix.');
  for (const r of results) {
    const [e, l] = r.samples;
    // eslint-disable-next-line no-console
    console.log(`  ${r.state}/${r.theme}/run${r.run}: early ${e.scrollWidth} (${e.offenders.length} over, census ${e.censusMs}ms over ${e.nodes} nodes), late ${l.scrollWidth} (${l.offenders.length} over, census ${l.censusMs}ms)`);
  }
});
