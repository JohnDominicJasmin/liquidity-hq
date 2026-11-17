/* SHARED HELPERS for the audit specs (audit-matrix, audit-routes, audit-lang, audit-widths, audit-plans, audit-a11y). Everything here is read-only: it opens a context for a persona, arms the paid-AI fence and the write stubs,
 * watches console / HTTP errors, waits until nothing says "loading", and measures one page. See audit-matrix.spec.ts for the full list of measurements. */
import type { Page, Browser } from '@playwright/test';
import { signedInContext } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

export const PAGES = ['/', '/dashboard', '/arena', '/markets', '/liq', '/scanner', '/funding', '/correlation', '/news', '/research', '/briefing', '/hours', '/econ-calendar', '/calc', '/journal', '/alerts', '/settings', '/playbook', '/upgrade', '/learn', '/faq', '/help', '/about', '/changelog', '/status', '/login'] as const;
/** the 12 main app pages (languages, widths, plans, upstream-down, accessibility) */
export const MAIN12 = ['/', '/dashboard', '/arena', '/markets', '/liq', '/scanner', '/funding', '/correlation', '/news', '/research', '/briefing', '/upgrade'] as const;
export type Persona = 'out' | 'free' | 'pro' | 'trial' | 'checking';
export const PROD = process.env.E2E_ALLOW_PRODUCTION === '1';
export const slug = (path: string) => (path === '/' ? 'home' : path.replace(/\//g, '_').replace(/^_/, '') || 'root');

const RAW_KEY = /\b[A-Z][A-Z0-9]{2,}(?:_[A-Z0-9]{2,}){1,}\b/g;
const RAW_OK = /^(BTC|ETH|SOL|USDT|USD|API|CPI|FOMC|RSI|MACD|EMA|SMA|VWAP|OHLC|HTML|JSON|UTC|NFP|PPI|PCE|GDP|ATH|ATL|OI|LONG_SHORT)$/;


export async function open(browser: Browser, persona: Persona, theme: string, width: number, lang = 'en') {
  const viewport = { width, height: width < 500 ? 844 : width < 1000 ? 1024 : 900 };
  const ctx = persona === 'out' ? await browser.newContext({ viewport }) : await signedInContext(browser, persona === 'pro' ? 'a' : 'b', { viewport, theme: theme as 'light' | 'dark' });
  await ctx.addInitScript(([t, l]) => { try { localStorage.setItem('lhq_lang_v1', l); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem('theme', t); } catch { /* private */ } }, [theme, lang]);
  await ctx.addInitScript(() => { const w = window as unknown as { __lcp?: number }; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lcp = Math.round(e.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch { /* unsupported */ } });
  return ctx;
}

export async function arm(page: Page, net: string, o: { persona?: Persona; down?: boolean } = {}) {
  await installPaidAiFence(page);
  if (o.persona === 'trial') {
    await page.route(/\/rest\/v1\/lhq_(dev_)?user_subscriptions\?/, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const res = await route.fetch(); const body = await res.json().catch(() => null); if (body == null) return route.fulfill({ response: res });
      const patch = (r: Record<string, unknown>) => ({ ...r, role: 'free', trial_ends_at: new Date(Date.now() + 10 * 86_400_000).toISOString(), current_period_end: null });
      return route.fulfill({ response: res, body: JSON.stringify(Array.isArray(body) ? (body.length ? body.map(patch) : [patch({})]) : patch(body)) });
    });
  }
  if (o.persona === 'checking') await page.route(/\/rest\/v1\/lhq_(dev_)?user_subscriptions\?/, async (route) => { await new Promise((r) => setTimeout(r, 5_000)); return route.fallback(); });
  if (o.down) {
    /* UPSTREAM DOWN: every exchange host unreachable, their sockets closed, and our own market-data routes answer 503 (what the server returns when it cannot reach Binance and Bybit) */
    await page.route((u) => /(binance\.com|bybit\.com|binance\.vision|coingecko\.com|coinglass|deribit|llama\.fi|alternative\.me)/i.test(u.hostname), (r) => r.abort());
    await page.routeWebSocket(/.*/, (ws) => ws.close());
    await page.route(/\/api\/(proxy|funding|market|liq|oi|ls|cmc|macro|fng|news|econ|onchain|stablecoin|scanner|correlation|hours|rsi|ath|dry-powder)[^?]*(\?|$)/, (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'stand-in: upstream down' }) }));
  }
  await page.route(/\/api\/(settings|journal|alerts|labels\/write|telegram)[^?]*(\?|$)/, (route) => { const m = route.request().method(); if (m === 'GET' || m === 'HEAD') return route.fallback(); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: [], rejected: [], settings: null }) }); });
  if (net === 'slow') { const c = await page.context().newCDPSession(page); await c.send('Network.enable'); await c.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: Math.round((400 * 1024) / 8), uploadThroughput: Math.round((200 * 1024) / 8) }); }
}

export type Log = { errs: string[]; bad: string[]; failed: string[] };
export function watch(page: Page): Log {
  const l: Log = { errs: [], bad: [], failed: [] };
  page.on('pageerror', (e) => l.errs.push(`pageerror ${String(e.message).slice(0, 140)}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon|net::ERR|third-party|captcha|turnstile|google|Cloudflare/i.test(m.text())) l.errs.push(`console ${m.text().slice(0, 140)}`); });
  page.on('response', (r) => { try { const u = new URL(r.url()); if (r.status() >= 400 && !/\/_next\/|favicon/.test(u.pathname)) l.bad.push(`${r.status()} ${r.request().method()} ${u.host === new URL(page.url() || 'http://x').host ? '' : u.host}${u.pathname}`.slice(0, 120)); } catch { /* ignore */ } });
  page.on('requestfailed', (r) => { const u = r.url(); if (/\/api\//.test(u) && !/ERR_ABORTED/.test(r.failure()?.errorText ?? '')) l.failed.push(`${r.failure()?.errorText} ${u.slice(0, 90)}`); });
  return l;
}

/* time until nothing on the page still says it is loading, polled every 400 ms, capped */
export async function untilSettled(page: Page, capMs: number) {
  const t0 = Date.now(); let stuck: string[] = [];
  while (Date.now() - t0 < capMs) {
    stuck = await page.evaluate(() => {
      const vis = (e: Element) => (e as HTMLElement).offsetParent !== null;
      const sk = Array.from(document.querySelectorAll('.skel-bar')).filter(vis).length;
      const txt = Array.from(document.querySelectorAll('body *')).filter((e) => e.children.length === 0 && vis(e) && /^(loading|preparing|checking|scanning)\b/i.test((e.textContent || '').trim())).map((e) => (e.textContent || '').trim().slice(0, 40)).slice(0, 4);
      return [...(sk ? [`${sk} skeleton bars`] : []), ...txt];
    }).catch(() => ['(page not evaluable)']);
    if (stuck.length === 0) return { ms: Date.now() - t0, stuck: [] as string[] };
    await page.waitForTimeout(400);
  }
  return { ms: capMs, stuck };
}

export const measure = (page: Page, phone: boolean) => page.evaluate(({ phone, rawOk }) => {
  const vw = window.innerWidth; const all = Array.from(document.querySelectorAll('body *')) as HTMLElement[];
  const visible = (e: HTMLElement) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
  const fixedUp = (e: HTMLElement) => { for (let p: HTMLElement | null = e; p && p !== document.body; p = p.parentElement) { const pos = getComputedStyle(p).position; if (pos === 'fixed' || pos === 'sticky') return true; } return false; };
  const fitsClip = (e: HTMLElement) => { for (let p = e.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) { if (getComputedStyle(p).overflowX !== 'visible' && p.getBoundingClientRect().right <= vw + 1) return true; } return false; };
  const d = (e: HTMLElement) => { const c = (typeof e.className === 'string' ? e.className : '').trim().split(/\s+/)[0]; return `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${c ? '.' + c : ''} "${(e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 30)}"`; };
  const past = all.filter((e) => visible(e) && !fixedUp(e) && e.getBoundingClientRect().right > vw + 1 && !fitsClip(e));
  const onScreen = (e: HTMLElement) => { const r = e.getBoundingClientRect(); return r.right > 0 && r.left < vw && r.bottom > 0 && r.top < innerHeight * 3; };
  /* an overflow:auto / scroll box is a deliberate scroller (a chip row, a drawer) and an off-canvas drawer is not on screen: only overflow:hidden / clip boxes that cut their own text count */
  const clipped = all.filter((e) => visible(e) && ['hidden', 'clip'].includes(getComputedStyle(e).overflowX) && e.scrollWidth > e.clientWidth + 1 && onScreen(e) && (e.innerText || '').trim().length > 0 && getComputedStyle(e).textOverflow !== 'ellipsis');
  const small = phone ? (Array.from(document.querySelectorAll('a[href],button,[role=button],[role=tab],[role=switch],input:not([type=hidden]),select,summary')) as HTMLElement[]).filter((e) => { if (!visible(e)) return false; const r = e.getBoundingClientRect(); return Math.min(r.width, r.height) < 24; }) : [];
  const text = document.body.innerText || '';
  const raw = Array.from(new Set((text.match(/\b[A-Z][A-Z0-9]{2,}(?:_[A-Z0-9]{2,}){1,}\b/g) ?? []).filter((k) => !new RegExp(rawOk).test(k)))).slice(0, 6);
  const bad = Array.from(new Set((text.match(/\b(NaN|undefined|null|Infinity|\[object Object\])\b/g) ?? []))).slice(0, 5);
  const un = text.split('\n').filter((l) => /(unavailable|not available|couldn.?t load|could not load|no data)|^\s*—\s*$/i.test(l) && l.length < 120).slice(0, 4);
  /* CONTRAST: solid backgrounds only (the first ancestor with an opaque or blended background colour; an image or gradient behind the text makes it unmeasurable and it is skipped) */
  const parse = (s: string) => { const m = /rgba?\(([^)]+)\)/.exec(s); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = (c: { r: number; g: number; b: number }) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const bgOf = (e: HTMLElement) => { let acc: { r: number; g: number; b: number } | null = null; const stack: Array<{ r: number; g: number; b: number; a: number }> = []; for (let p: HTMLElement | null = e; p; p = p.parentElement) { const cs = getComputedStyle(p); if (cs.backgroundImage !== 'none') return null; const c = parse(cs.backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } } acc = { r: 255, g: 255, b: 255 }; if (!stack.length) return null; for (let i = stack.length - 1; i >= 0; i--) { const c = stack[i]; acc = { r: c.r * c.a + acc.r * (1 - c.a), g: c.g * c.a + acc.g * (1 - c.a), b: c.b * c.a + acc.b * (1 - c.a) }; } return acc; };
  const low: string[] = []; let lowN = 0; let checked = 0;
  for (const e of all) { if (checked > 500) break; if (!visible(e)) continue; const own = Array.from(e.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 1); if (!own) continue; checked++; const cs = getComputedStyle(e); const fs = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight, 10) >= 700; if (fs >= 18 || (fs >= 14 && bold)) continue; const fg = parse(cs.color); const bg = bgOf(e); if (!fg || !bg || fg.a === 0) continue; const f = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) }; const l1 = lum(f), l2 = lum(bg); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); if (ratio < 4.5) { lowN++; if (low.length < 5) low.push(`${ratio.toFixed(2)} ${d(e)}`); } }
  return { vw, docW: document.documentElement.scrollWidth, past: past.length, pastList: past.slice(0, 4).map((e) => `${d(e)} right=${Math.round(e.getBoundingClientRect().right)}`), clipped: clipped.length, clippedList: clipped.slice(0, 4).map((e) => `${d(e)} ${e.scrollWidth}>${e.clientWidth}`), small: small.length, smallList: small.slice(0, 5).map((e) => `${d(e)} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`), raw, bad, un, lowN, low, checked, lcp: (window as unknown as { __lcp?: number }).__lcp ?? null };
}, { phone, rawOk: RAW_OK.source });


/** LANGUAGE CHECKS for a non-English page: html lang / dir actually applied, English sentences left in the visible text (a line of 4+ latin words that is mostly latin letters), and for RTL the logo side and physical-left text. */
export const langCheck = (page: Page, lang: string) => page.evaluate((lang) => {
  const html = document.documentElement; const text = document.body.innerText || '';
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const english = lines.filter((l) => lang !== 'en' && /[A-Za-z]{3,}(\s+[A-Za-z]{2,}){3,}/.test(l) && (l.match(/[A-Za-z]/g) ?? []).length > l.length * 0.6 && !/^[A-Z0-9\s/.\-·]+$/.test(l)).slice(0, 6).map((l) => l.slice(0, 70));
  const logo = document.querySelector('header a, nav a, [class*=logo]') as HTMLElement | null; const lr = logo?.getBoundingClientRect();
  const leftAligned = lang === 'ar' ? Array.from(document.querySelectorAll('p,li,h1,h2,h3')).filter((e) => (e.textContent || '').trim().split(/\s+/).length > 3 && getComputedStyle(e).textAlign === 'left').length : 0;
  return { htmlLang: html.lang, dir: html.dir || getComputedStyle(html).direction, englishLines: english.length, englishSample: english, logoCenterX: lr ? Math.round(lr.left + lr.width / 2) : null, vw: innerWidth, leftAligned };
}, lang);
