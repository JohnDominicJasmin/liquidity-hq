/* #1632 item 15: DOES `/api/labels` HAND THE OPS CONSOLE'S COPY - AND THE AI VENDOR'S NAME - TO ANYONE WHO ASKS?
 *
 * THIS CHECK IS EXPECTED TO FAIL UNTIL THE FIX LANDS. That is the point: it was written against the unfixed route and measured
 * failing, so a green run later means something. Measured on production 2026-10-23, no cookie and no header: 180,842 bytes,
 * 2,651 keys, 195 of them `OPS_*`, and five of those name the AI vendor in their VALUE.
 *
 * WHY A VISUAL AUDIT COULD NEVER HAVE FOUND IT. Nothing renders these strings outside `/ops`, so every screenshot pass and every
 * rendered sweep we run is blind to them - the same class as #1284, where the instrument answered a different question. The payload
 * is the surface here, not the page.
 *
 * ASSERTION 3 IS THE ONE WORTH KEEPING AFTERWARDS. Excluding `OPS_*` happens to fix both findings today, because all five
 * vendor-naming non-legal keys are `OPS_*`. Assertion 3 does not depend on that: it reads every VALUE in the anonymous payload and
 * allows the vendor's name only in the four legal keys, so it still fires if a vendor name appears in a product label tomorrow -
 * which is the regression nobody can catch by looking at a screen.
 *
 * usage: node qa/tools/regress/labels-no-admin-copy.mjs <base-url> [--locale en]
 *   exit 0 = no OPS_* keys and no vendor name outside the four legal keys
 *   exit 1 = a leak is present (expected today; the output names what leaked)
 *   exit 2 = could not run */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] || '').replace(/\/$/, '');
if (!BASE) { console.error('usage: labels-no-admin-copy.mjs <base-url> [--locale en]'); process.exit(2); }
const LOCALE = process.argv.includes('--locale') ? process.argv[process.argv.indexOf('--locale') + 1] : 'en';

const REPO = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/, '');
const env = {};
for (const f of ['.env.e2e.local', '.env.local']) {
  const p = `${REPO}/${f}`;
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.replace(/^﻿/, ''));
    if (m && !(m[1] in env)) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
for (const [k, v] of Object.entries(process.env)) if (!(k in env) && typeof v === 'string' && v !== '') env[k] = v;

/* The four keys that KEEP the vendor's name, and why: privacy and consumer law expect a third-party processor to be named, so these
   are the one place the owner's "never show the model" rule yields. Taken from the payload itself on 2026-10-23 and cross-checked
   against OWNER-RULES rule 5, which lists three - the fourth, DISCLAIMER_SECTION_PLATFORM_IDENTITY_BODY, names the vendor to say we
   are NOT affiliated with it, which is the same legal purpose. If this list ever needs a fifth member, that is a decision for the
   owner and not a test edit. */
const LEGAL_KEYS = new Set([
  'DISCLAIMER_SECTION_AI_ANALYSIS_BODY',
  'DISCLAIMER_SECTION_PLATFORM_IDENTITY_BODY',
  'PRIVACY_SECTION_THIRD_PARTY_BODY',
  'TERMS_SECTION_THIRD_PARTY_DATA_BODY',
]);
const VENDOR = /grok|xai|x\.ai/i;

async function main() {
  /* ── 1. the anonymous payload: no cookie, no Authorization, no apikey ── */
  const res = await fetch(`${BASE}/api/labels?locale=${LOCALE}`, { cache: 'no-store', signal: AbortSignal.timeout(45_000) });
  if (!res.ok) { console.error(`GET /api/labels?locale=${LOCALE} answered HTTP ${res.status}`); return 2; }
  const raw = await res.text();
  let payload; try { payload = JSON.parse(raw); } catch { console.error('the response is not JSON'); return 2; }
  const labels = payload.labels ?? payload;
  if (typeof labels !== 'object' || labels === null) { console.error('no label map in the response'); return 2; }

  const keys = Object.keys(labels);
  console.log(`anonymous GET ${BASE}/api/labels?locale=${LOCALE}`);
  console.log(`  ${raw.length} bytes, ${keys.length} keys`);

  /* ASSERTION 1: zero admin-console keys. */
  const ops = keys.filter((k) => /^OPS_/.test(k));
  console.log(`\n1. OPS_* keys served anonymously: ${ops.length}  ${ops.length === 0 ? 'PASS' : 'FAIL'}`);
  if (ops.length) console.log(`   first ten: ${ops.slice(0, 10).join(', ')}`);

  /* ASSERTION 3: the vendor's name appears in no VALUE except the four legal keys. Checked on values, not keys, because a key named
     innocuously can carry the name in its text - which is exactly how `OPS_CARDS_AI_COST_TITLE` reads "AI cost · Grok". */
  const leaks = keys.filter((k) => typeof labels[k] === 'string' && VENDOR.test(labels[k]) && !LEGAL_KEYS.has(k));
  console.log(`\n3. values naming the AI vendor outside the four legal keys: ${leaks.length}  ${leaks.length === 0 ? 'PASS' : 'FAIL'}`);
  for (const k of leaks) console.log(`   ${k}: ${String(labels[k]).replace(/\s+/g, ' ').slice(0, 110)}`);

  /* ASSERTION 4, added after #1731: THE KEY NAMES ARE SERVED TOO. The response is a key -> value map, so an anonymous caller reads
     every key name as well as every value. Five keys carried the vendor's name on 2026-10-23 - NEWS_ASK_GROK_PROMPT,
     HYPOTHESIS_TRACKER_GROK_VERDICT_PREFIX, GROK_SIGNAL_CHART_FULLSCREEN, GROK_SIGNAL_CHART_EXIT_FULLSCREEN and
     OPS_CONFIG_FEATURE_GROK - and four of them are NOT `OPS_*`, so excluding admin copy does not remove them. Every sweep until
     then, this script included, looked only at values. No legal exception applies here: a disclosure needs the vendor named in its
     TEXT, never in its key. */
  const keyLeaks = keys.filter((k) => VENDOR.test(k));
  console.log(`\n4. KEY NAMES containing the vendor: ${keyLeaks.length}  ${keyLeaks.length === 0 ? 'PASS' : 'FAIL'}`);
  for (const k of keyLeaks) console.log(`   ${k}${/^OPS_/.test(k) ? '  (also caught by assertion 1)' : '  <- survives an OPS_ exclusion'}`);

  /* And the legal four must still be PRESENT - a fix that strips the vendor name everywhere would break the disclosure the law
     expects, and would otherwise pass assertion 3 silently. */
  const legalPresent = [...LEGAL_KEYS].filter((k) => typeof labels[k] === 'string' && VENDOR.test(labels[k]));
  console.log(`\n3b. legal keys still naming the processor: ${legalPresent.length} of ${LEGAL_KEYS.size}  ${legalPresent.length === LEGAL_KEYS.size ? 'PASS' : 'FAIL'}`);
  if (legalPresent.length !== LEGAL_KEYS.size) {
    console.log(`   missing: ${[...LEGAL_KEYS].filter((k) => !legalPresent.includes(k)).join(', ')}`);
    console.log('   a fix must EXCLUDE admin copy, not strip the vendor name from the legal disclosures.');
  }

  /* ASSERTION 2: an admin caller still gets the ops copy, or the console silently loses its text. Skipped rather than faked when no
     admin credential is configured - a skipped assertion that says so is worth more than a green that tested nothing. */
  let adminNote = 'SKIPPED - no E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD in the env files';
  if (env.E2E_ADMIN_EMAIL && env.E2E_ADMIN_PASSWORD && env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const auth = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
      body: JSON.stringify({ email: env.E2E_ADMIN_EMAIL, password: env.E2E_ADMIN_PASSWORD }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!auth.ok) adminNote = `admin sign-in failed: HTTP ${auth.status}`;
    else {
      const { access_token: token } = await auth.json();
      const adminRes = await fetch(`${BASE}/api/labels?locale=${LOCALE}`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(45_000),
      });
      const adminLabels = adminRes.ok ? await adminRes.json().then((j) => j.labels ?? j).catch(() => null) : null;
      const adminOps = adminLabels ? Object.keys(adminLabels).filter((k) => /^OPS_/.test(k)).length : 0;
      adminNote = `${adminOps} OPS_* keys for an admin caller  ${adminOps > 0 ? 'PASS' : 'FAIL - the ops console has lost its copy'}`;
    }
  }
  console.log(`\n2. ${adminNote}`);

  /* The payload is saved whole: a count without the artefact cannot be audited by anyone else, and the key names are the finding. */
  const dir = `${REPO}/../qa-evidence-guardrail`;
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/labels-leak-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(file, JSON.stringify({ base: BASE, locale: LOCALE, bytes: raw.length, keys: keys.length, opsKeys: ops, vendorLeaks: leaks.map((k) => ({ key: k, value: labels[k] })), vendorKeyNames: keyLeaks }, null, 2));
  console.log(`\nsaved ${file}`);

  const failed = ops.length > 0 || leaks.length > 0 || keyLeaks.length > 0 || legalPresent.length !== LEGAL_KEYS.size;
  console.log(failed ? '\nFAIL: the anonymous payload carries admin copy and/or the vendor name.' : '\nPASS: no admin copy, no vendor name outside the legal four.');
  return failed ? 1 : 0;
}

process.exitCode = await main();
