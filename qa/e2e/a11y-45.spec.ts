/* QA #1185 owner item 45 on a deployed site: the accessibility statement's promises on Dashboard, Arena and Settings, and the Help page's answers. Dispatch-only; informational [P45] lines, nothing saved (writes stubbed, AI fenced).
 *   A   axe, WCAG 2.x A/AA rules including 2.2, both themes, 1280 and 390
 *   K   keyboard: every Tab stop up to 90 differs visibly from its unfocused self; whether a skip link exists
 *   D   dialogs opened from the page keep focus inside while open, close on Escape and give focus back
 *   N   scores, grades, chips and badges that carry no text name
 *   RM  animations still running with reduced motion asked for
 *   H   what the Help answers say is there */
import { test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { AUTH_READY } from './_auth';
import { open, arm, untilSettled, type Persona } from './_matrix';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: reads a deployed site (-f base_url=<site>)');
test.describe.configure({ timeout: 300_000, retries: 0 });
const AXE = join(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js');
const CASES: Array<[Persona, string]> = [['out', '/dashboard'], ['out', '/arena'], ['pro', '/dashboard'], ['pro', '/arena'], ['pro', '/settings'], ['free', '/arena']];
async function prep(browser: import('@playwright/test').Browser, persona: Persona, path: string, theme = 'dark', width = 1280, reduced = false) {
  const ctx = await open(browser, persona, theme, width); const page = await ctx.newPage(); await arm(page, 'normal', { persona });
  if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 150_000 }); await untilSettled(page, 40_000); await page.waitForTimeout(4_000);
  return { ctx, page };
}
const say = (kind: string, title: string, data: unknown) => console.log(`[P45] ${kind} ${title}: ${JSON.stringify(data)}`);

for (const [persona, path] of CASES) for (const theme of ['dark', 'light'] as const) for (const width of [1280, 390] as const) {
  test(`A ${persona} ${path} ${theme} ${width}`, async ({ browser }) => {
    test.skip(persona !== 'out' && !AUTH_READY, 'no fixtures');
    const { ctx, page } = await prep(browser, persona, path, theme, width);
    try {
      await page.addScriptTag({ path: AXE });
      const v = await page.evaluate(async () => { const ax = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: Array<{ id: string; impact: string; nodes: Array<{ target: string[]; failureSummary?: string; html: string }> }> }> } }).axe; const r = await ax.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }); return r.violations.map((x) => ({ id: x.id, impact: x.impact, n: x.nodes.length, first: x.nodes.slice(0, 3).map((n) => `${n.target.join(' ').slice(0, 70)} | ${(/contrast of ([\d.]+)/.exec(n.failureSummary ?? '')?.[1] ?? '')} ${n.html.replace(/\s+/g, ' ').slice(0, 70)}`) })); });
      say('A', `${persona} ${path} ${theme} ${width}`, v);
    } finally { await ctx.close().catch(() => {}); }
  });
}

for (const [persona, path] of CASES.slice(0, 5)) for (const theme of ['dark', 'light'] as const) {
  test(`K ${persona} ${path} ${theme}`, async ({ browser }) => {
    test.skip(persona !== 'out' && !AUTH_READY, 'no fixtures');
    const { ctx, page } = await prep(browser, persona, path, theme);
    try {
      await page.evaluate(() => {
        const sig = (e: Element) => { const one = (n: Element | null) => { if (!n) return ''; const c = getComputedStyle(n); return [c.outlineStyle, c.outlineWidth, c.outlineColor, c.boxShadow, c.borderTopColor, c.borderBottomColor, c.borderBottomWidth, c.backgroundColor, c.color, c.textDecorationLine].join('|'); }; return `${one(e)}#${one(e.parentElement)}`; };
        const w = window as unknown as { qaSig: (e: Element) => string; qaBase: Map<Element, string> }; w.qaSig = sig; w.qaBase = new Map();
        (document.activeElement as HTMLElement | null)?.blur?.(); window.scrollTo(0, 0);
        for (const e of Array.from(document.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]'))) w.qaBase.set(e, sig(e));
      });
      const none: string[] = []; const seen: string[] = []; let stops = 0, first = '';
      for (let i = 0; i < 90; i++) {
        await page.keyboard.press('Tab'); await page.waitForTimeout(220);
        const st = await page.evaluate(() => { const e = document.activeElement as HTMLElement | null; if (!e || e === document.body) return null; const w = window as unknown as { qaSig: (x: Element) => string; qaBase: Map<Element, string> }; const c = getComputedStyle(e); const ring = (c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0) || (!!c.boxShadow && c.boxShadow !== 'none'); const base = w.qaBase.get(e); const r = e.getBoundingClientRect(); return { id: `${e.tagName.toLowerCase()}.${(typeof e.className === 'string' ? e.className : '').trim().split(/\s+/)[0]}:${(e.getAttribute('aria-label') || e.innerText || e.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 24)}`, shows: ring || (base != null && base !== w.qaSig(e)), unknown: base == null && !ring, offscreen: r.width === 0 || r.height === 0 }; });
        if (!st) continue; stops++; if (!first) first = st.id; seen.push(st.id); if (!st.shows) none.push(`${st.id}${st.unknown ? ' (appeared later)' : ''}${st.offscreen ? ' (zero size)' : ''}`);
      }
      const skip = await page.evaluate(() => Array.from(document.querySelectorAll('a[href^="#"]')).map((a) => (a as HTMLElement).textContent?.trim() ?? '').filter((t) => /skip/i.test(t)));
      say('K', `${persona} ${path} ${theme}`, { stops, distinct: new Set(seen).size, first, noVisibleChange: none.length, list: [...new Set(none)].slice(0, 12), skipLinks: skip });
    } finally { await ctx.close().catch(() => {}); }
  });
}

const dialogState = (page: Page) => page.evaluate(() => { const d = Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"],dialog[open]')).filter((x) => { const r = x.getBoundingClientRect(); const c = getComputedStyle(x); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden'; }).pop(); const a = document.activeElement as HTMLElement | null; return d ? { open: true, name: (d.getAttribute('aria-label') || (d.querySelector('h1,h2,h3') as HTMLElement | null)?.innerText || d.getAttribute('aria-labelledby') || '').trim().slice(0, 40), modal: d.getAttribute('aria-modal'), inside: !!a && d.contains(a), active: `${a?.tagName.toLowerCase()}:${(a?.getAttribute('aria-label') || a?.innerText || '').trim().slice(0, 20)}` } : { open: false, name: '', modal: null, inside: false, active: `${a?.tagName.toLowerCase()}:${(a?.getAttribute('aria-label') || a?.innerText || '').trim().slice(0, 20)}` }; });
for (const [persona, path] of CASES) for (const width of [1280, 390] as const) {
  test(`D ${persona} ${path} ${width}`, async ({ browser }) => {
    test.skip(persona !== 'out' && !AUTH_READY, 'no fixtures');
    const { ctx, page } = await prep(browser, persona, path, 'dark', width);
    try {
      const names = await page.evaluate(() => Array.from(document.querySelectorAll('button,[role="button"]')).map((b, i) => { const e = b as HTMLElement; const r = e.getBoundingClientRect(); const label = (e.getAttribute('aria-label') || e.innerText || e.title || '').trim().replace(/\s+/g, ' ').slice(0, 40); const pops = e.hasAttribute('aria-haspopup') || e.hasAttribute('aria-expanded'); if (!r.width || !r.height || (e as HTMLButtonElement).disabled) return null; if (/delete|remove|sign ?out|log ?out|connect|save|submit|upgrade|research|ask|buy|pay|cancel|push|enable|test/i.test(label)) return null; if (!pops && !/indicator|strateg|search|menu|setting|alert|help|info|more|add|choose|select|\+|^q$|^i$/i.test(label)) return null; e.setAttribute('data-qa45', String(i)); return { i, label }; }).filter(Boolean) as Array<{ i: number; label: string }>);
      const results: unknown[] = []; const done = new Set<string>();
      for (const n of names) {
        if (done.has(n.label) || done.size >= 14) continue; done.add(n.label);
        const b = page.locator(`[data-qa45="${n.i}"]`).first();
        if (!(await b.isVisible().catch(() => false))) continue;
        await b.focus().catch(() => {}); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
        const opened = await dialogState(page);
        if (opened.open) {
          let escaped = ''; for (let i = 0; i < 25; i++) { await page.keyboard.press('Tab'); const s = await dialogState(page); if (!s.open) { escaped = 'dialog closed while tabbing'; break; } if (!s.inside) { escaped = `focus left to ${s.active} at tab ${i + 1}`; break; } }
          await page.keyboard.press('Escape'); await page.waitForTimeout(700); const after = await dialogState(page);
          const returned = await b.evaluate((e) => e === document.activeElement).catch(() => false);
          results.push({ opener: n.label, dialog: opened.name, modal: opened.modal, focusOnOpen: opened.inside, trap: escaped || 'held', escapeCloses: !after.open, focusReturned: returned });
          if (after.open) { await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(6_000); break; }
        } else { await page.keyboard.press('Escape'); await page.waitForTimeout(300); if (new URL(page.url()).pathname !== path) { await page.goto(path, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(6_000); break; } }
      }
      say('D', `${persona} ${path} ${width}`, { openersTried: [...done], dialogs: results });
    } finally { await ctx.close().catch(() => {}); }
  });
}

for (const [persona, path] of CASES.slice(0, 5)) {
  test(`N RM ${persona} ${path}`, async ({ browser }) => {
    test.skip(persona !== 'out' && !AUTH_READY, 'no fixtures');
    const { ctx, page } = await prep(browser, persona, path, 'light', 1280, true);
    try {
      const nameless = await page.evaluate(() => Array.from(document.querySelectorAll('[class*="score"],[class*="grade"],[class*="chip"],[class*="badge"],[class*="dot"],[class*="pill"]')).filter((e) => { const r = e.getBoundingClientRect(); if (!r.width || !r.height || e.closest('[aria-hidden="true"]')) return false; const t = ((e as HTMLElement).innerText || '').trim(); const named = t || e.getAttribute('aria-label') || e.getAttribute('title') || e.querySelector('[aria-label],title,.sr-only'); const parentText = ((e.parentElement as HTMLElement | null)?.innerText || '').trim(); return !named && !parentText; }).map((e) => (typeof (e as HTMLElement).className === 'string' ? (e as HTMLElement).className : e.tagName).slice(0, 50)));
      await page.waitForTimeout(3_000);
      const anim = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').map((a) => { const t = (a.effect as KeyframeEffect | null)?.target as HTMLElement | null; const d = a.effect?.getTiming(); return `${(a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? 'script'} on ${t?.tagName.toLowerCase()}.${(typeof t?.className === 'string' ? t.className : '').split(/\s+/)[0]} ${d?.iterations === Infinity ? 'infinite' : 'finite'} ${String(d?.duration)}`; }));
      say('N', `${persona} ${path}`, { nameless: [...new Set(nameless)].slice(0, 10), count: nameless.length });
      say('RM', `${persona} ${path}`, { running: anim.length, list: [...new Set(anim)].slice(0, 10) });
    } finally { await ctx.close().catch(() => {}); }
  });
}

test('H the Help answers against the pages', async ({ browser }) => {
  test.skip(!AUTH_READY, 'no fixtures');
  const ctx = await open(browser, 'pro', 'dark', 1280); const page = await ctx.newPage(); await arm(page, 'normal', { persona: 'pro' });
  try {
    for (const path of ['/help', '/settings', '/alerts', '/scanner', '/dashboard']) {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 150_000 }); await untilSettled(page, 40_000); await page.waitForTimeout(4_000);
      if (path === '/help') for (const q of await page.locator('main button[aria-expanded="false"], main summary').all()) await q.click({ timeout: 2_000 }).catch(() => {});
      const t = await page.evaluate(() => (document.querySelector('main') ?? document.body).innerText.replace(/\s+/g, ' '));
      if (path === '/help') { for (let i = 0; i < Math.min(t.length, 6000); i += 1500) console.log(`[P45] H help text ${i / 1500}: ${t.slice(i, i + 1500)}`); continue; }
      const nav = await page.evaluate(() => Array.from(document.querySelectorAll('header button, nav button')).map((b) => (b.getAttribute('aria-label') || (b as HTMLElement).innerText || '').trim()).filter(Boolean).slice(0, 12));
      say('H', path, { password: /password/i.test(t), language: /language/i.test(t), connectTelegram: /connect telegram/i.test(t), timeframesWords: t.match(/.{0,40}(timeframes?).{0,40}/i)?.[0] ?? null, mute: t.match(/.{0,30}mute.{0,60}/i)?.[0] ?? null, scanCards: await page.locator('.scan-card').count(), header: path === '/dashboard' ? nav : undefined });
    }
  } finally { await ctx.close().catch(() => {}); }
});
