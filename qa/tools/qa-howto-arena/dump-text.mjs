/* Dump the visible text of public pages (read-only) for manual comparison. usage: node dump-text.mjs <url> <out-file> [wait-ms] */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';
const [, , url, out, waitArg = '5000'] = process.argv;
const b = await chromium.launch(); const ctx = await b.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', locale: 'en-US', viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage();
const r = await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); await p.waitForTimeout(Number(waitArg));
const t = await p.evaluate(() => { const tbl = [...document.querySelectorAll('table')].map((t) => [...t.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => c.innerText.replace(/\s+/g, ' ').trim()).join(' | ')).join('\n')).join('\n----\n'); return document.body.innerText + '\n\n=====TABLES=====\n' + tbl; });
writeFileSync(out, t); console.log(r?.status(), t.length);
await b.close();
