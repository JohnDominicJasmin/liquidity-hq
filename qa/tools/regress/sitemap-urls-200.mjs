/* #1740 / #1741: EVERY URL IN sitemap.xml MUST RETURN 200 - NOT A REDIRECT, NOT A 404.
 *
 * A sitemap entry that bounces is worse than its absence: it spends crawl budget to arrive nowhere, and a
 * redirecting entry tells a search engine the canonical URL is the one that does not serve the page.
 *
 * ── WHY THIS IS A COMMITTED TOOL AND NOT A ONE-OFF ─────────────────────────────────────────────────────────
 *
 * #1741 took the sitemap from 9 entries to 19 and its Risk level said plainly: "I have not fetched the ten
 * sitemap URLs". That gap was closed by hand on 2026-10-24 - 19 of 19, no redirect, no 404, none noindexed. But
 * the failure this guards against is in the FUTURE: a route renamed, a page put behind auth, an entry added to
 * the list by someone who did not fetch it. None of those show up in a diff and none break a build.
 *
 * ── TWO THINGS IT DOES THAT A NAIVE CHECK WOULD NOT ────────────────────────────────────────────────────────
 *
 * 1. REDIRECTS ARE NOT FOLLOWED (`redirect: 'manual'`). With following on, a 301 reports as the 200 it lands
 *    on, so the check passes while the sitemap is wrong. This is the single detail that makes the result mean
 *    anything, and it is the one a rewrite is most likely to drop.
 * 2. IT READS THE SITEMAP RATHER THAN A LIST. A hardcoded list verifies the list, not the sitemap - so a URL
 *    added later is unverified by exactly the check that exists to verify it.
 *
 * AND IT REPORTS `noindex` AS A FAILURE, which is not about HTTP at all: a sitemap asks a crawler to index a
 * page and `noindex` tells it not to. Either the entry or the tag is wrong, and both are silent.
 *
 * ── THIS CANNOT REVIEW AN UNDEPLOYED PR, AND THE DISTINCTION MATTERS ───────────────────────────────────────
 *
 * It checks the sitemap the target is SERVING. Run against production on 2026-10-24 it reported 9 entries, all
 * 200 - correct, and not the 19 of #1741, which was merged to `dev` and not yet deployed anywhere. A PASS here
 * says nothing about entries that exist only in a branch.
 *
 * To review a PR that adds entries, read the paths out of `app/sitemap.ts` on that branch and fetch them
 * against a host that serves the routes. That is how #1741's ten new entries were verified before merge: the
 * pages already existed on production, only the sitemap FILE was new, so the question "does each path serve a
 * 200" was answerable without deploying. That is a review step; this is the regression guard that runs after.
 *
 * The word count of the SERVER HTML is recorded for each page, not asserted. It is the measurement behind
 * #1740 item 3 - no public page emits copy before JavaScript runs - and the figures are what sized that work
 * (/playbook: 2,140 words and no h1). A count is not a pass criterion, so it prints and does not fail.
 *
 * usage: node qa/tools/regress/sitemap-urls-200.mjs [base-url]
 *   default base: https://liquidity-hq.com, because the sitemap names that host in every entry regardless of
 *   which service serves the file (`BASE` is a literal in app/sitemap.ts) - so pointing this at a preview URL
 *   checks the preview's sitemap FILE against PRODUCTION's routes, which is a different question. Pass a base
 *   deliberately, knowing that.
 *   exit 0 = every entry 200, no redirect, none carrying noindex
 *   exit 1 = at least one entry fails
 *   exit 2 = could not run (the sitemap itself did not load, or parsed to nothing) */

const BASE = (process.argv[2] || 'https://liquidity-hq.com').replace(/\/$/, '');
const TIMEOUT_MS = 45_000;

async function main() {
  const sm = await fetch(`${BASE}/sitemap.xml`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!sm.ok) { console.error(`GET ${BASE}/sitemap.xml answered HTTP ${sm.status}`); return 2; }
  const xml = await sm.text();
  const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);

  /* A sitemap that parses to nothing is a failure to measure, not a clean result. Without this, a changed
     format or an HTML error page served as XML would report "0 of 0 failed" and exit 0. */
  if (!urls.length) {
    console.error(`parsed 0 <loc> entries from ${BASE}/sitemap.xml (${xml.length} bytes) - refusing to report a pass over an empty set`);
    return 2;
  }

  console.log(`${BASE}/sitemap.xml -> ${urls.length} entries\n`);
  const rows = [];
  for (const url of urls) {
    const row = { url, status: 0, location: null, noindex: false, words: null, h1: null, err: null };
    try {
      /* redirect: 'manual' is the point of this tool - see the header. */
      const res = await fetch(url, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
      row.status = res.status;
      row.location = res.headers.get('location');
      if (res.status === 200) {
        const html = await res.text();
        row.noindex = /<meta[^>]+name=["']robots["'][^>]*noindex/i.test(html);
        row.h1 = (html.match(/<h1[\s>]/gi) || []).length;
        const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');
        row.words = (text.match(/[A-Za-z]{2,}/g) || []).length;
      } else {
        await res.arrayBuffer().catch(() => {});
      }
    } catch (e) { row.err = String(e?.message || e); }
    rows.push(row);

    const path = url.replace(BASE, '') || '/';
    const verdict = row.err ? `ERROR ${row.err}`
      : row.status === 200 ? `200  ${String(row.words).padStart(5)} words  ${row.h1} h1${row.noindex ? '  *** NOINDEX ***' : ''}`
      : `${row.status}${row.location ? `  -> ${row.location}` : ''}  *** NOT 200 ***`;
    console.log(`  ${path.padEnd(18)} ${verdict}`);
  }

  const notOk = rows.filter((r) => r.status !== 200 || r.err);
  const noindexed = rows.filter((r) => r.noindex);
  console.log(`\n${rows.length} entries: ${rows.length - notOk.length} returned 200, ${notOk.length} did not`);
  console.log(`carrying noindex: ${noindexed.length}${noindexed.length ? ` -> ${noindexed.map((r) => r.url).join(', ')}` : ''}`);
  for (const r of notOk) {
    console.log(`  FAIL ${r.url}: ${r.err ? r.err : `HTTP ${r.status}${r.location ? ` -> ${r.location}` : ''}`}`);
  }

  /* Recorded, never asserted - see the header. A page with little server HTML is a finding for #1740 item 3,
     not a broken sitemap entry, and failing on it would make this tool refuse to pass until an architecture
     change lands. */
  const thin = rows.filter((r) => r.status === 200 && r.words !== null && r.words < 50);
  const noH1 = rows.filter((r) => r.status === 200 && r.h1 === 0);
  console.log(`\nrecorded, not asserted: ${thin.length} entr${thin.length === 1 ? 'y' : 'ies'} under 50 words of server HTML, ${noH1.length} with no h1 (#1740 item 3)`);

  const failed = notOk.length > 0 || noindexed.length > 0;
  console.log(failed ? '\nFAIL: the sitemap points at something that does not serve a 200 indexable page.'
    : '\nPASS: every sitemap entry returns 200, unredirected, and none carries noindex.');
  return failed ? 1 : 0;
}

process.exitCode = await main();
