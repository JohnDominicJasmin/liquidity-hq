/* Translations layout check, one build per run: /dashboard /settings /arena /alerts + landing, in ko zh ar ru, at 390
 * and 1280. Run on qa (B) and on production (A, the same-page control). Same fence and synthetic Free session as
 * shots-layout-pairs2.mjs / control-overflow-ru.mjs. Language via localStorage 'lhq_lang_v1' AND the mocked
 * user_settings.language. Landing: /ko and /zh are the landing routes; ar and ru have none, so /ar and /ru are shot
 * as-is (whatever the build answers) - signed-out.
 * Measures per case: sideways scroll (documentElement.scrollWidth vs innerWidth/clientWidth) and the leaf elements
 * past the right edge; clipped nav/button/heading/tab/label elements (scrollWidth > clientWidth with overflow
 * hidden/clip or text-overflow ellipsis, or line-clamped/overflow-y hidden with scrollHeight > clientHeight);
 * visible text nodes split by script (native vs Latin-only words) for the English-fraction count.
 * usage: node translations-layout.mjs <base> <supabaseRef> <outdir>                                                */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const [BASE0, REF, OUT] = process.argv.slice(2);
const BASE = BASE0.replace(/\/$/, '');
const APP = new URL(BASE).host, SB = `${REF}.supabase.co`;
mkdirSync(OUT, { recursive: true });
const UID = '00000000-0000-4000-8000-00000000fa4e';
const session = JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'x', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
const MARKET = /binance|bybit|okx|coinbase|deribit|coingecko|kraken|fonts\.|gstatic/;
const LANGS = (process.env.LANGS || 'ko,zh,ar,ru').split(',');
const WIDTHS = [[390, 844], [1280, 800]];
const PAGES = (process.env.PAGES || '/dashboard,/settings,/arena,/alerts,landing').split(',');
const out = [];

async function open(browser, w, h, lang, signedIn) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(([k, v, l, si]) => { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem('lhq_lang_v1', l); if (si) localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, session, lang, signedIn]);
  await ctx.routeWebSocket((u) => new URL(u).host === SB, (ws) => ws.close());
  const row = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? o : [o]) });
  await ctx.route('**/*', async (r) => {
    const req = r.request(); const u = new URL(req.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    if (u.host === APP) { if (req.method() === 'GET' || req.method() === 'HEAD') return r.continue(); let f = []; try { f = Object.keys(JSON.parse(req.postData() || '{}')).filter((k) => k !== 'knownAsOf'); } catch { /* not JSON */ } return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: f, rejected: [], settings: {} }) }); }
    if (u.host === SB) {
      if (req.method() === 'GET' && /user_onboarding/.test(u.pathname)) return row(r, { user_id: UID, tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true });
      if (req.method() === 'GET' && /user_subscriptions/.test(u.pathname)) return row(r, { user_id: UID, role: 'free', trial_ends_at: null });
      if (req.method() === 'GET' && /user_settings/.test(u.pathname)) return row(r, { user_id: UID, risk_pct: 1, default_coin: 'btc', default_tf: '1h', watchlist: [], language: lang, field_updated_at: {} });
      return r.abort('failed');
    }
    if (req.method() === 'GET' && req.resourceType() !== 'document' && MARKET.test(u.host)) return r.continue();
    return r.abort('failed');
  });
  return ctx;
}

function measure(lang) {
  const NATIVE = { ko: /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/, zh: /[\u4E00-\u9FFF\u3400-\u4DBF]/, ar: /[\u0600-\u06FF]/, ru: /[\u0400-\u04FF]/ }[lang];
  const de = document.documentElement;
  const vw = de.clientWidth, iw = window.innerWidth, sw = de.scrollWidth;
  const vis = (el) => { if (!el || !el.getBoundingClientRect) return false; const b = el.getBoundingClientRect(); if (b.width < 1 || b.height < 1) return false; if (b.right <= 0 || b.left >= iw) return false; if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false; return true; };
  const desc = (e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className).trim().split(/\s+/).slice(0, 2).join('.')}`;
  /* past the right edge: leaf-most offenders only */
  const over = [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > vw + 1 && e.getBoundingClientRect().width > 0);
  const overSet = new Set(over);
  const leaves = over.filter((e) => ![...e.children].some((c) => overSet.has(c))).slice(0, 8).map((e) => `${desc(e)} right=${Math.round(e.getBoundingClientRect().right)} "${(e.textContent || '').trim().slice(0, 40)}"`);
  /* clipping on nav / buttons / headings / tabs / labels */
  const SEL = 'nav, nav *, header, header *, button, button *, a, h1, h2, h3, h4, h5, h6, [role=tab], [role=button], label, th, [class*="tab"], [class*="btn"], [class*="chip"], [class*="title"], [class*="label"]';
  const clipped = [];
  for (const e of document.querySelectorAll(SEL)) {
    if (!vis(e)) continue;
    const txt = (e.textContent || '').trim(); if (!txt) continue;
    const cs = getComputedStyle(e);
    const hClip = e.scrollWidth > e.clientWidth + 1 && (cs.overflowX === 'hidden' || cs.overflowX === 'clip' || cs.textOverflow === 'ellipsis');
    const vClip = e.scrollHeight > e.clientHeight + 1 && (cs.overflowY === 'hidden' || cs.overflowY === 'clip' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none'));
    if (!hClip && !vClip) continue;
    if (e.clientWidth === 0 && e.clientHeight === 0) continue;
    const b = e.getBoundingClientRect();
    clipped.push({ el: desc(e), text: txt.slice(0, 60), sw: e.scrollWidth, cw: e.clientWidth, sh: e.scrollHeight, ch: e.clientHeight, h: hClip, v: vClip, ellipsis: cs.textOverflow === 'ellipsis', x: Math.round(b.x), y: Math.round(b.y + scrollY) });
  }
  /* visible text by script */
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const texts = []; let n;
  while ((n = tw.nextNode())) {
    const t = n.nodeValue.replace(/\s+/g, ' ').trim(); if (!t) continue;
    const p = n.parentElement; if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(p.tagName)) continue;
    if (!vis(p)) continue;
    const native = NATIVE.test(t), latin = /[A-Za-z]{3,}/.test(t);
    texts.push({ t: t.slice(0, 120), k: native ? 'native' : latin ? 'latin' : 'neutral' });
  }
  return { lang: de.lang, dir: de.dir || getComputedStyle(de).direction, innerWidth: iw, clientWidth: vw, scrollWidth: sw, sidewaysVsInner: sw > iw, sidewaysVsClient: sw > vw + 1, overLeaves: sw > vw + 1 ? leaves : [], clipped, texts };
}

const browser = await chromium.launch();
try {
  const v = await (await fetch(BASE + '/api/version')).json();
  out.push({ base: BASE, served: v.commit, branch: v.branch, at: new Date().toISOString() });
  { const c = await open(browser, 1280, 800, 'ko', true); const pg = await c.newPage(); await pg.goto(BASE + '/dashboard', { waitUntil: 'load', timeout: 120_000 }).catch(() => {}); await pg.waitForTimeout(6000); await c.close(); }
  for (const [w, h] of WIDTHS) for (const p of PAGES) for (const lang of LANGS) {
    const landing = p === 'landing';
    const path = landing ? `/${lang}` : p;
    const ctx = await open(browser, w, h, lang, !landing);
    const page = await ctx.newPage();
    let status = null;
    const t0 = Date.now();
    const labelsSeen = [];
    page.on('response', (r) => { if (r.url().includes('/api/labels')) labelsSeen.push({ url: r.url().replace(BASE, ''), status: r.status(), ms: Date.now() - t0 }); });
    try {
      const labelsWait = landing ? Promise.resolve(null) : page.waitForResponse((r) => r.url().includes(`/api/labels?locale=${lang === 'ar' ? '' : lang}`), { timeout: 45_000 }).then((r) => r.finished().then(() => 'ok')).catch(() => 'timeout');
      const resp = await page.goto(BASE + path, { waitUntil: 'load', timeout: 120_000 });
      status = resp?.status() ?? null;
      const labelsResult = await labelsWait;
      await page.waitForFunction(() => !document.querySelector('.obw-root.obw-loading'), null, { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(6000);
      const labelsInfo = { labelsResult, labelsSeen: [...labelsSeen] };
      const m = await page.evaluate(measure, lang);
      const name = `${w}-${landing ? 'landing' : p.slice(1)}-${lang}`;
      await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
      out.push({ page: path, width: w, askedLang: lang, status, landedOn: new URL(page.url()).pathname, shot: `${name}.png`, ...labelsInfo, ...m });
      console.log(`${name} status=${status} labels=${labelsInfo.labelsResult} ${JSON.stringify(labelsInfo.labelsSeen.map((x) => x.url + ':' + x.status + '@' + x.ms))} lang=${m.lang} sw=${m.scrollWidth}/${m.innerWidth} clipped=${m.clipped.length} latin=${m.texts.filter((x) => x.k === 'latin').length} native=${m.texts.filter((x) => x.k === 'native').length}`);
    } catch (e) { out.push({ page: path, width: w, askedLang: lang, status, error: String(e).slice(0, 200) }); console.log(`ERR ${path} ${w} ${lang} ${String(e).slice(0, 120)}`); }
    await ctx.close();
  }
} finally { await browser.close(); writeFileSync(`${OUT}/measure.json`, JSON.stringify(out, null, 1)); console.log(`done ${out.length - 1} cases -> ${OUT}`); }
