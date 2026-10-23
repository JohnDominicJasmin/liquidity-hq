/* #1632 item 15, THE SECOND EXIT: do the admin console's strings ship inside the PUBLIC JS BUNDLE?
 *
 * The route fix (#1732) filters `OPS_*` out of `/api/labels`. It cannot touch this one: `components/LabelsProvider.tsx` is a client
 * component that imports `lib/labelDefaults.en.json` WHOLE, so every string in that file is compiled into a chunk and downloaded by
 * anyone who loads the page - with no request to `/api/labels` at all. Dev said so in the PR; this measures it.
 *
 * WHY IT IS THE WORSE OF THE TWO EXITS. It needs no API call, it is browser-cached, and it is invisible to every check we own: a
 * payload assertion passes, a screenshot shows nothing, and a label-file sweep looks at the file rather than at what is served.
 * Measured on production 2026-10-23: chunk `00idqgf~57b88.js`, 291,947 bytes, 195 distinct `OPS_*` key names, and the literal
 * string `grok-4.3` alongside "Margin = monthly Pro revenue minus estimated 14-day AI cost".
 *
 * WHAT IT READS. The anonymous HTML of the pages given, every `/_next/static/chunks/*.js` they reference, and nothing else. No
 * credentials, no browser, no writes - fetches only. It does not execute anything it downloads.
 *
 * usage: node qa/tools/regress/bundle-no-admin-copy.mjs <base-url> [path ...]
 *   default paths: / and /upgrade
 *   exit 0 = no admin key names and no vendor name in any chunk those pages load
 *   exit 1 = they are in there, and the output names the chunk and the count
 *   exit 2 = could not run */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] || '').replace(/\/$/, '');
if (!BASE) { console.error('usage: bundle-no-admin-copy.mjs <base-url> [path ...]'); process.exit(2); }
const PATHS = process.argv.slice(3).filter((a) => a.startsWith('/'));
const PAGES = PATHS.length ? PATHS : ['/', '/upgrade'];

const REPO = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/, '');
/* The vendor's name in any spelling it appears in, and the model id separately: the model id is the specific thing the owner named,
   so a report that says "vendor: yes" without saying whether the MODEL leaked is less useful than one that distinguishes them. */
const VENDOR = /grok|xai|x\.ai/i;
const MODEL = /grok-[0-9]/i;

const get = async (url) => {
  const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(60_000) });
  if (!r.ok) return null;
  return r.text();
};

async function main() {
  const findings = [];
  let chunksRead = 0;

  for (const page of PAGES) {
    const html = await get(`${BASE}${page}`);
    if (html == null) { console.error(`${page}: could not fetch the page`); return 2; }
    /* Only the chunks the page itself references. A sweep of every file under /_next/static would measure the build, not what a
       visitor to this page downloads - and the claim being tested is about the visitor. */
    const chunks = [...new Set((html.match(/\/_next\/static\/chunks\/[^"']+?\.js/g) ?? []))];
    console.log(`\n${page}: ${html.length} bytes of HTML, ${chunks.length} chunk(s) referenced`);

    for (const c of chunks) {
      const js = await get(`${BASE}${c}`);
      if (js == null) { console.log(`  ${c}  (unreadable, skipped)`); continue; }
      chunksRead++;
      const ops = new Set(js.match(/OPS_[A-Z0-9_]+/g) ?? []);
      const vendor = VENDOR.test(js);
      const model = js.match(MODEL)?.[0] ?? null;
      if (ops.size || vendor) {
        findings.push({ page, chunk: c, bytes: js.length, opsKeyNames: ops.size, vendor, model });
        console.log(`  ${c}  ${js.length} bytes  OPS_* key names: ${ops.size}  vendor: ${vendor ? 'YES' : 'no'}${model ? `  model: ${model}` : ''}`);
      }
    }
  }

  const dir = `${REPO}/../qa-evidence-guardrail`;
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/bundle-leak-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(file, JSON.stringify({ base: BASE, pages: PAGES, chunksRead, findings }, null, 2));

  const ops = findings.reduce((n, f) => n + f.opsKeyNames, 0);
  const vendorChunks = findings.filter((f) => f.vendor).length;
  console.log(`\nchunks read: ${chunksRead}`);
  console.log(`chunks carrying OPS_* key names: ${findings.filter((f) => f.opsKeyNames).length}  (max in one chunk: ${Math.max(0, ...findings.map((f) => f.opsKeyNames))})`);
  console.log(`chunks naming the AI vendor: ${vendorChunks}`);
  console.log(`saved ${file}`);

  if (ops || vendorChunks) {
    console.error('\nFAIL: the admin console\'s copy and/or the AI vendor ship in a chunk an anonymous visitor downloads.');
    return 1;
  }
  console.log('\nPASS: no admin key names and no vendor name in any chunk these pages load.');
  return 0;
}

process.exitCode = await main();
