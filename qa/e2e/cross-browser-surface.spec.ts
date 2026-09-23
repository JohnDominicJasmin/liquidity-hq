import { test, expect, type Page } from '@playwright/test';

/* #1410: what a rendering engine breaks, measured the same way on every engine.
 *
 * RUN THROUGH ITS OWN CONFIG, NOT THIS SUITE'S:
 *   E2E_BASE_URL=https://liquidity-hq-staging.onrender.com \
 *     npx playwright test --config qa/crossbrowser.config.ts
 * The ordinary suite never picks this up (that config's testMatch names only this
 * file, and this file is excluded from the production allowlist).
 *
 * THE POINT IS THE COMPARISON, NOT THE ABSOLUTE NUMBERS. Each project is one engine
 * at one width, and `chromium-*` is the control column: a reading here is a finding
 * only when Chromium disagrees with it on the same page at the same width. Without
 * that column every pre-existing defect in the app reads as a Firefox bug, which is
 * how a cross-browser pass turns into a week of chasing things that were already
 * broken everywhere.
 *
 * WHAT IT ASSERTS versus WHAT IT RECORDS, and the split is deliberate:
 *
 *   ASSERTED - unambiguous in any engine, so a failure is a defect on its own:
 *     an uncaught page error, the document scrolling sideways, a storage round-trip
 *     that silently does not round-trip, a canvas element that exists at zero size.
 *
 *   RECORDED - needs the other columns to mean anything, so it is measured and
 *     annotated rather than asserted: which font family actually resolved, whether
 *     a canvas has non-blank pixels, how many sockets opened, whether a service
 *     worker registered, which app storage keys exist.
 *
 * A spec that only records is the vacuous pass this project keeps finding, and a
 * spec that asserts on engine differences it cannot interpret is a spec nobody can
 * keep green. This does both halves on purpose, and says which is which in the
 * annotations so the report is readable without rerunning it.
 *
 * ANONYMOUS AND READ-ONLY. Signed out, no account, staging only, no writes beyond
 * the visitor's own browser storage. No AI credits. */

const PAGES = ['/dashboard', '/scanner', '/arena', '/upgrade', '/about'] as const;

interface Surface {
  url: string;
  /* WHAT WAS ACTUALLY ON SCREEN. Three of these five routes are app pages, and a
     signed-out visitor may get an AuthGate instead of the page itself - in which
     case "0 canvases drew" means "there was no chart to draw", not "the chart
     failed". Recorded rather than assumed, so the report cannot quietly compare a
     gate in one engine against a dashboard in another. */
  gated: boolean;
  pageErrors: string[];
  consoleErrors: string[];
  docScrollWidth: number;
  docClientWidth: number;
  overflowing: string[];
  canvases: { count: number; zeroSized: number; blank: number; drew: number };
  sockets: { created: number; opened: number };
  storage: { localOk: boolean; sessionOk: boolean; appKeys: string[] };
  serviceWorker: { supported: boolean; registered: boolean };
  fonts: { loaded: boolean; sampled: { el: string; family: string; size: string }[] };
  zeroHeightPanels: string[];
}

/** Installed BEFORE any page script so nothing is missed - the same reason
 *  network capture has to be armed before the navigation, not after it. */
async function armInstrumentation(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __qaSockets: { created: number; opened: number } };
    w.__qaSockets = { created: 0, opened: 0 };
    const Original = window.WebSocket;
    if (Original) {
      // A wrapper rather than a proxy: Firefox and Chromium disagree about how a
      // proxied WebSocket behaves under `new`, and this only needs to count.
      const Wrapped = function (this: unknown, url: string | URL, protocols?: string | string[]) {
        w.__qaSockets.created++;
        const sock = protocols === undefined ? new Original(url) : new Original(url, protocols);
        sock.addEventListener('open', () => { w.__qaSockets.opened++; });
        return sock;
      } as unknown as typeof WebSocket;
      Wrapped.prototype = Original.prototype;
      (Wrapped as unknown as Record<string, unknown>).OPEN = Original.OPEN;
      (Wrapped as unknown as Record<string, unknown>).CLOSED = Original.CLOSED;
      window.WebSocket = Wrapped;
    }
  });
}

async function measure(page: Page, path: string): Promise<Surface> {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', e => pageErrors.push(`${e.name}: ${e.message}`.slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });

  await armInstrumentation(page);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  // Hydration, first data, first paint of any canvas. Fixed rather than
  // condition-based: the conditions are exactly what is under test, so waiting
  // for them would hide the engine that never reaches them.
  await page.waitForTimeout(8000);

  const data = await page.evaluate(() => {
    const vis = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const name = (el: Element) => {
      const id = el.id ? `#${el.id}` : '';
      const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
      return `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 60);
    };

    // Horizontal overflow: the document itself, and which visible elements cross the edge.
    const de = document.documentElement;
    const overflowing = Array.from(document.querySelectorAll('body *'))
      .filter(el => vis(el) && el.getBoundingClientRect().right > de.clientWidth + 1)
      .slice(0, 8).map(name);

    // Canvas: present, sized, and did it actually draw anything.
    const canvasEls = Array.from(document.querySelectorAll('canvas'));
    let zeroSized = 0, blank = 0, drew = 0;
    for (const c of canvasEls) {
      if (c.width === 0 || c.height === 0) { zeroSized++; continue; }
      try {
        const ctx = c.getContext('2d');
        if (!ctx) { blank++; continue; }
        const { data: px } = ctx.getImageData(0, 0, Math.min(c.width, 300), Math.min(c.height, 300));
        let painted = false;
        for (let i = 3; i < px.length; i += 4) { if (px[i] !== 0) { painted = true; break; } }
        painted ? drew++ : blank++;
      } catch {
        // A tainted or shield-blocked canvas throws on read - itself a finding.
        blank++;
      }
    }

    // Storage, which is what a privacy shield blocks first.
    let localOk = false, sessionOk = false;
    try { localStorage.setItem('__qa_probe', '1'); localOk = localStorage.getItem('__qa_probe') === '1'; localStorage.removeItem('__qa_probe'); } catch { localOk = false; }
    try { sessionStorage.setItem('__qa_probe', '1'); sessionOk = sessionStorage.getItem('__qa_probe') === '1'; sessionStorage.removeItem('__qa_probe'); } catch { sessionOk = false; }
    let appKeys: string[] = [];
    try { appKeys = Object.keys(localStorage).filter(k => k.startsWith('lhq') || k === 'theme').slice(0, 12); } catch { appKeys = []; }

    // Fonts: did the self-hosted faces load, and what actually resolved on real text.
    const sampled = ['.tnav-item', 'h1', 'body'].map(sel => {
      const el = document.querySelector(sel);
      if (!el) return { el: sel, family: '(absent)', size: '-' };
      const s = getComputedStyle(el);
      return { el: sel, family: s.fontFamily.slice(0, 80), size: s.fontSize };
    });

    const zeroHeightPanels = Array.from(document.querySelectorAll('main, section, .card, .tpanel, [data-testid]'))
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 100 && r.height === 0 && getComputedStyle(el).display !== 'none';
      }).slice(0, 8).map(name);

    const w = window as unknown as { __qaSockets?: { created: number; opened: number } };
    return {
      gated: !!document.querySelector('[class*="auth-gate"]'),
      docScrollWidth: de.scrollWidth,
      docClientWidth: de.clientWidth,
      overflowing,
      canvases: { count: canvasEls.length, zeroSized, blank, drew },
      sockets: w.__qaSockets ?? { created: 0, opened: 0 },
      storage: { localOk, sessionOk, appKeys },
      fonts: { loaded: (document as unknown as { fonts?: { status?: string } }).fonts?.status === 'loaded', sampled },
      zeroHeightPanels,
    };
  });

  const serviceWorker = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false, registered: false };
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      return { supported: true, registered: regs.length > 0 };
    } catch { return { supported: true, registered: false }; }
  });

  return { url: path, pageErrors, consoleErrors, ...data, serviceWorker };
}

for (const path of PAGES) {
  test(`${path} renders and runs`, async ({ page }, testInfo) => {
    const s = await measure(page, path);
    const engine = testInfo.project.name;

    // RECORDED - the comparison columns. Printed as well as annotated so a failed
    // run still leaves the readings in the log.
    testInfo.annotations.push({ type: 'surface', description: JSON.stringify({ engine, ...s }) });
    // eslint-disable-next-line no-console
    console.log(`[xbrowser] ${engine} ${path} :: ${s.gated ? 'AUTH GATE (not the page itself)' : 'page content'}, ` +
      `canvas ${s.canvases.drew}/${s.canvases.count} drew, ` +
      `sockets ${s.sockets.opened}/${s.sockets.created} open, sw ${s.serviceWorker.registered ? 'registered' : s.serviceWorker.supported ? 'none' : 'unsupported'}, ` +
      `fonts ${s.fonts.loaded ? 'loaded' : 'NOT loaded'}, storage ${s.storage.localOk ? 'ok' : 'BLOCKED'}, ` +
      `appKeys ${s.storage.appKeys.length}, errors ${s.pageErrors.length}`);

    // ASSERTED - defects in any engine, no comparison needed.
    expect(s.pageErrors, `uncaught JavaScript on ${path} in ${engine} - the page may look fine and still have stopped running`).toEqual([]);
    expect(s.docScrollWidth,
      `${path} scrolls sideways in ${engine}: scrollWidth ${s.docScrollWidth} > clientWidth ${s.docClientWidth}. Crossing the edge: ${s.overflowing.join(', ') || '(none identified)'}`)
      .toBeLessThanOrEqual(s.docClientWidth + 1);
    expect(s.canvases.zeroSized, `${path} has ${s.canvases.zeroSized} zero-sized canvas element(s) in ${engine} - a chart that was never given a size draws nothing`).toBe(0);
    expect(s.storage.localOk && s.storage.sessionOk,
      `storage does not round-trip on ${path} in ${engine} (local ${s.storage.localOk}, session ${s.storage.sessionOk}) - the theme, language and consent all live there`).toBe(true);
    expect(s.zeroHeightPanels, `${path} has wide panels with zero height in ${engine} - a collapsed panel shows nothing and reports no error`).toEqual([]);
  });
}
