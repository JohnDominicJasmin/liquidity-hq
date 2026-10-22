/* Production, after the release: PUBLIC reads only, signed-out, nothing written, no browser (memory is short).
 * GET requests to public pages and public data, one at a time, each read once. */
const HOST = 'https://liquidity-hq.com';
const get = async (p, opt = {}) => { const r = await fetch(HOST + p, { redirect: 'manual', signal: AbortSignal.timeout(60_000), ...opt }); return r; };

// 1. the version block
const v = await (await get('/api/version')).json();
console.log(`VERSION commit ${String(v.commit).slice(0, 7)} branch ${v.branch} appEnv ${v.appEnv}`);
console.log(`  configured (${Object.keys(v.configured ?? {}).length} keys): ${JSON.stringify(v.configured)}`);

// 2. public pages, status only
const ROUTES = ['/', '/about', '/faq', '/terms', '/privacy', '/refund', '/disclaimer', '/upgrade', '/login', '/forgot-password', '/learn', '/glossary', '/news', '/markets', '/arena', '/alerts', '/dashboard', '/briefing', '/scanner', '/journal', '/offline', '/ko', '/zh'];
const rows = [];
for (const p of ROUTES) { try { const r = await get(p); rows.push(`${p} ${r.status}${r.status >= 300 && r.status < 400 ? '->' + r.headers.get('location') : ''}`); } catch (e) { rows.push(`${p} ERR ${e.name}`); } }
console.log('PAGES: ' + rows.join(' | '));

// 3. what the site serves as labels: any English value that still says $25, and the price keys
const en = await (await get('/api/labels?locale=en')).json();
const stale = Object.entries(en).filter(([, val]) => typeof val === 'string' && val.includes('$25')).map(([k]) => k);
console.log(`LABELS en: ${Object.keys(en).length} rows; English values still containing "$25": ${JSON.stringify(stale)}`);
for (const k of ['UPGRADE_PRICE_MONTHLY', 'UPGRADE_PRICE_FORTNIGHTLY', 'UPGRADE_PRICE_ANNUAL', 'UPGRADE_CHECKOUT_BUTTON_CTA', 'FAQ_Q_PRO_PRICE_A', 'ALERTS_EMA_SIGNAL_DESC']) console.log(`  ${k} = ${JSON.stringify(String(en[k]).slice(0, 100))}`);

// 4. the server-rendered text of /upgrade and /faq (what arrives before any script runs)
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
for (const p of ['/upgrade', '/faq']) {
  const t = text(await (await get(p)).text());
  const hits = [...t.matchAll(/[^.]{0,60}(\$\d+[^.]{0,50}|coming soon[^.]{0,50}|Get Pro[^.]{0,40}|How much does Pro cost[^.]{0,80})/gi)].map((m) => m[0].trim().slice(0, 130));
  console.log(`SSR ${p}: ${hits.length} price/CTA fragments: ${JSON.stringify(hits.slice(0, 8))}`);
}
