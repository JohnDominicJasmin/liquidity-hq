import type { Browser, BrowserContext, Page } from '@playwright/test';
import { installPaidAiFence } from './_no-paid-ai';

/* HELPERS FOR verify-1185-merged.spec.ts. Browser-side measurement only; nothing here writes anywhere or reaches a paid route.
 *
 *   signedOutContext   a context with the language, consent and (optionally) the theme seeded BEFORE the first frame, like draw-structure-box.spec.ts
 *   openPage           a page of that context with the paid-AI fence installed first (the fence must precede any stub of the spec's own)
 *   installNewsFixture the dev/qa/staging news table is empty (news-feed-fixture.spec.ts, #757), so /news renders no cards and the ticker never shows. The READ is served from five
 *                      synthetic rows in the browser, exactly as that spec does it; nothing is written. Headlines carry the words the classifiers key on, images come from a fixture
 *                      host that is itself answered in the browser, so no third-party request leaves the page.
 *   contrastProbe      runs inside the page: WCAG contrast of text under a size, plus named selectors */

export type Theme = 'dark' | 'light';

export async function signedOutContext(
  browser: Browser,
  o: { width: number; height?: number; theme?: Theme; lang?: string } = { width: 1280 },
): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height ?? (o.width < 500 ? 844 : 900) } });
  await ctx.addInitScript(
    ([lang, theme]: [string, string]) => {
      try {
        localStorage.setItem('lhq_lang_v1', lang);
        localStorage.setItem('lhq_analytics_consent_v1', 'denied');
        if (theme) localStorage.setItem('theme', theme);
      } catch { /* private mode */ }
    },
    [o.lang ?? 'en', o.theme ?? ''] as [string, string],
  );
  return ctx;
}

/** A page with the paid-AI fence installed straight after creation (OWNER-RULES: before any stub of the spec's own). */
export async function openPage(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  await installPaidAiFence(page);
  return page;
}

/** Settings writes answered locally, so a click on a chip or a menu never changes the shared fixture account. Reads are the real ones. */
export async function stubSettingsWrites(page: Page): Promise<void> {
  await page.route(/\/api\/settings(\?|$)/, async (route) => {
    const q = route.request();
    if (q.method() === 'GET') return route.fallback();
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ accepted: Object.keys((q.postDataJSON() ?? {}) as object).filter((k) => k !== 'knownAsOf'), rejected: [], settings: null }),
    });
  });
  await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async (route) => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 204, body: '' });
    return route.fallback();
  });
}

/* ---------- news fixture ---------- */

export const NEWS_FX = {
  breaking: 'Bitcoin plunges as exchange halts withdrawals after hack',
  bullish: 'Spot ETF inflow hits record as Bitcoin rally extends',
  vance: "JD Vance says he'll decide about 2028 presidential run",
  tariff: 'Trump signs new tariff order on imported steel',
  neutral: 'Ethereum developers schedule the next network upgrade',
} as const;

const FX_IMG_HOST = 'https://qa-fixtures.invalid';
/* A 1x1 PNG, base64. */
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

interface FxRow { dedup_key: string; headline: string; source: string; published_at: string; severity: string; cat: string; link: string | null; image: string | null }

/** Newest first. The newest row is a red (BREAKING) story WITH an image, so it is the hero card and the ticker has a red top. */
function fxRows(): FxRow[] {
  const mins = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
  const row = (i: number, headline: string, severity: string, ageMin: number, image: boolean): FxRow => ({
    dedup_key: `qa-v1185-${i}`, headline, source: 'QA Fixture', published_at: mins(ageMin), severity, cat: 'markets',
    link: `https://qa-fixtures.invalid/story-${i}`, image: image ? `${FX_IMG_HOST}/img-${i}.png` : null,
  });
  return [
    row(1, NEWS_FX.breaking, 'red', 2, true),
    row(2, NEWS_FX.bullish, 'amber', 4, true),
    row(3, NEWS_FX.vance, 'amber', 6, true),
    row(4, NEWS_FX.tariff, 'amber', 8, false),
    row(5, NEWS_FX.neutral, 'purple', 10, true),
  ];
}

export async function installNewsFixture(page: Page): Promise<void> {
  await page.route(`${FX_IMG_HOST}/**`, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG_1X1, 'base64') }));
  await page.route(
    (u) => u.href.includes('/rest/v1/') && /news\b/i.test(u.pathname),
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fxRows()) }),
  );
}

/* ---------- contrast ---------- */

export interface ContrastNode { sel: string; text: string; fg: string; bg: string; ratio: number; px: number }
export interface NamedSpec { label: string; sel: string; textRe?: string }
export interface ContrastReport {
  theme: string | null;
  scanned: number;
  skipped: number;
  failTotal: number;
  worst: ContrastNode[];
  named: Record<string, { count: number; min: number | null; worst: ContrastNode | null; failing: ContrastNode[] }>;
}

/** Runs inside the page (pass it straight to page.evaluate). Composites text colour and every ancestor background (alpha and opacity included) down to an opaque canvas.
 *  An ancestor with a background IMAGE (gradient) makes the background unknowable by arithmetic: that node is counted in `skipped`, never guessed. */
export const contrastProbe = (args: { maxPx: number; named: NamedSpec[] }): ContrastReport => {
  type RGBA = [number, number, number, number];
  const parse = (c: string): RGBA | null => {
    let m = /^rgba?\(([^)]+)\)$/.exec(c.trim());
    if (m) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      if (p.length >= 3 && p.every((x) => !Number.isNaN(x))) return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
      return null;
    }
    m = /^color\(srgb ([^)]+)\)$/.exec(c.trim());
    if (m) {
      const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number);
      if (p.length >= 3 && p.every((x) => !Number.isNaN(x))) return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1];
    }
    return null;
  };
  const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratioOf = (a: number[], b: number[]) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  const over = (top: RGBA, bottom: number[]): number[] => [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3]));

  const styleCache = new Map<Element, CSSStyleDeclaration>();
  const st = (el: Element) => { let s = styleCache.get(el); if (!s) { s = getComputedStyle(el); styleCache.set(el, s); } return s; };
  type VisEl = Element & { checkVisibility?: (o?: { checkOpacity?: boolean; checkVisibilityCSS?: boolean }) => boolean };
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const v = el as VisEl;
    return v.checkVisibility ? v.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true }) : st(el).visibility !== 'hidden';
  };
  const label = (el: Element) => {
    const cls = typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`;
  };
  /* The browser's own canvas is white; body and html paint over it, so it only shows if the page paints nothing. */
  const canvas0 = [255, 255, 255];

  /* null when the background cannot be resolved by arithmetic (an ancestor paints an image or gradient). */
  const measure = (el: Element): { ratio: number; fg: number[]; bg: number[] } | null => {
    const chain: Element[] = [];
    for (let n: Element | null = el; n; n = n.parentElement) chain.unshift(n);
    let canvas = canvas0.slice();
    let cum = 1;
    for (const n of chain) {
      const s = st(n);
      cum *= Number(s.opacity) || 0;
      /* html and body may carry a page-wide ambient gradient over an opaque colour; counting that as "unknowable" would skip the whole page. */
      if (n !== document.body && n !== document.documentElement && s.backgroundImage && s.backgroundImage !== 'none') return null;
      const bg = parse(s.backgroundColor);
      if (!bg) return null;
      if (bg[3] > 0) canvas = over([bg[0], bg[1], bg[2], bg[3] * cum], canvas);
    }
    const fgRaw = parse(st(el).color);
    if (!fgRaw || fgRaw[3] === 0) return null;
    const fg = over([fgRaw[0], fgRaw[1], fgRaw[2], fgRaw[3] * cum], canvas);
    return { ratio: ratioOf(fg, canvas), fg, bg: canvas };
  };
  const hex = (c: number[]) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
  const node = (el: Element, m: { ratio: number; fg: number[]; bg: number[] }): ContrastNode => ({
    sel: label(el), text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    fg: hex(m.fg), bg: hex(m.bg), ratio: Math.round(m.ratio * 100) / 100, px: parseFloat(st(el).fontSize),
  });

  /* general sweep: every element that owns a text node, under maxPx */
  const failing: ContrastNode[] = [];
  let scanned = 0; let skipped = 0;
  const seen = new Set<Element>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!(t.textContent || '').trim()) continue;
    const el = t.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') continue;
    if (el.closest('[disabled],[aria-disabled="true"],.sr-only')) continue;
    if (!visible(el)) continue;
    const px = parseFloat(st(el).fontSize);
    if (!(px < args.maxPx)) continue;
    const m = measure(el);
    if (!m) { skipped++; continue; }
    scanned++;
    if (m.ratio < 4.5) failing.push(node(el, m));
  }
  failing.sort((a, b) => a.ratio - b.ratio);

  /* named selectors: any size */
  const named: ContrastReport['named'] = {};
  for (const spec of args.named) {
    const re = spec.textRe ? new RegExp(spec.textRe, 'i') : null;
    const list: ContrastNode[] = [];
    document.querySelectorAll(spec.sel).forEach((el) => {
      if (!visible(el)) return;
      if (re && !re.test(el.textContent || '')) return;
      const m = measure(el);
      if (m) list.push(node(el, m));
    });
    list.sort((a, b) => a.ratio - b.ratio);
    named[spec.label] = { count: list.length, min: list.length ? list[0].ratio : null, worst: list[0] ?? null, failing: list.filter((x) => x.ratio < 4.5).slice(0, 5) };
  }

  return { theme: document.documentElement.getAttribute('data-theme'), scanned, skipped, failTotal: failing.length, worst: failing.slice(0, 5), named };
};
