# E2E test suite + CI job — implementation plan

**Written 2026-08-04. Largely CARRIED OUT on 2026-08-05** — see
`pendings/QA_E2E_FINDINGS_2026-08-05.md` for what executing it actually found.
This file is kept for its reasoning (§1 in particular); read the status table
below before trusting any individual section.

| § | Item | Status |
|---|---|---|
| 1 | Why Playwright and not a hosted service | still the standing decision |
| 2 | What exists | accurate, but the baselines it quotes are **superseded** — see below |
| 3.1 | `package.json` scripts + devDependency | **done** |
| 3.2 | `.gitignore` entries | **done** |
| 3.3 | CI `e2e` job | **done** — `ci.yml`, `needs: build` |
| 4.1 | Supabase env in CI | **decided: option A.** Needs 3 repo secrets — owner action, see the findings doc §4 |
| 4.2 | Turnstile in CI | unchanged, still correct |
| 5 | BOLA / IDOR | **still open. Still the biggest gap.** |
| 6 | Suggested sequence | steps 1–5 done, step 6 outstanding |

⚠️ **The baseline numbers quoted in §2 below are wrong.** Executing the suite
showed tap targets are **217** (at the suite's 390×844), not 159, and that
`/arena` and `/briefing` fail CLS where audit §3.2 claimed 0.000 everywhere.
`qa/e2e/_shared.ts` is authoritative; the reasoning is in the findings doc §1.

Executing it also found three defects in the suite itself — most importantly
the mobile project silently defaulting to WebKit, so **all 108 mobile tests had
never run**. "Typechecks and lints clean" was not evidence the suite worked.

---

## 1. Why this and not a hosted service

Evaluated `kane-cli` (LambdaTest/KaneAI) and rejected it for now:

- The QA gap is *"nobody executed the plan"*, not *"tests are hard to write"*.
  A SaaS does not fix execution; a CI job does.
- Pre-revenue, and there is an explicit standing decision not to pay for
  tooling until there is revenue (the Coinglass call in `PENDING.md`).
- It routes browser sessions — including auth flows and Supabase traffic —
  through a third party, and leaves a detached Chrome on an unauthenticated CDP
  port 9222–9230 that outlives the CLI.
- Playwright already did the entire 2026-08-04 audit locally, free.

Revisit if real users arrive and cross-browser/real-device coverage is needed.

---

## 2. What already exists

| File | Covers |
|---|---|
| `playwright.config.ts` | Prod build on port 3100, desktop 1440×900 + iPhone 13, `webServer` boots the app |
| `qa/e2e/_shared.ts` | Route list, **baselines**, and the `settle()` stylesheet guard |
| `qa/e2e/smoke.spec.ts` | All 32 routes load, render styled, no uncaught JS; `/login` really renders |
| `qa/e2e/responsive.spec.ts` | Zero horizontal overflow at both widths (strict); viewport meta |
| `qa/e2e/a11y.spec.ts` | alt text / duplicate ids / `lang` (strict); tap targets + accessible names (baseline) |
| `qa/e2e/security.spec.ts` | 20+ OWASP probes — BFLA, cron fail-closed, `alg:none`, honeypot, traversal, headers, CORS, injection (all strict) |
| `qa/e2e/seo.spec.ts` | robots/sitemap + titles (strict); duplicate descriptions, missing h1, canonical coverage (baseline) |
| `qa/e2e/perf.spec.ts` | CLS < 0.1, LCP < 2500ms; third-party fan-out on `/refund` |

### The baseline mechanism — read before touching a number

`qa/e2e/_shared.ts` exports `BASELINE`, the known-failing counts from the audit:

```ts
tapTargetsUnder24:   217   // §4.1 - CORRECTED 2026-08-05 from 159; see below
controlsWithoutName:   4   // §4.2
pagesWithoutH1:       13   // §6.4
pagesWithCanonical:    0   // §6.2 - inverted, must only go UP
```

The tap-target figure was corrected **upward**, which the rule below otherwise
forbids. That was legitimate exactly once, because 159 was a mis-measurement of
unchanged code rather than a number the app later regressed past: audit §4.1
counted `/playbook`'s 55 `button.pb-star` controls as one table row. It is not
precedent. `_shared.ts` carries the full reasoning inline.

Every spec passes on today's code. A spec fails only when a count gets **worse**.
When something is fixed, lower the baseline in the same commit — that is the ratchet.

**Do not raise a baseline to make a build pass.** That converts a regression into
the new normal, which is precisely how 93 lint warnings became a backlog nobody owns.

---

## 3. Changes still required

### 3.1 `package.json`

```diff
   "devDependencies": {
+    "@playwright/test": "^1.60.0",
     "@capacitor/android": "^8.4.0",
```

```diff
   "scripts": {
     "test": "node --test __tests__/*.test.mts",
+    "test:e2e": "playwright test",
+    "test:e2e:ui": "playwright test --ui",
+    "test:e2e:report": "playwright show-report qa/e2e-report",
```

Then:

```bash
npm install --save-dev @playwright/test@^1.60.0
npx playwright install --with-deps chromium
```

Note `playwright@1.60.0` is currently installed **globally**, not in the project.
The suite needs the project-local `@playwright/test` runner — they are different
packages.

### 3.2 `.gitignore`

```diff
+qa/e2e-report/
+test-results/
```

### 3.3 `.github/workflows/ci.yml` — new job

Append after the existing `build` job:

```yaml
  e2e:
    name: E2E (Playwright)
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci

      # Chromium only. Firefox/WebKit triple the install time and this app
      # ships as a Chromium-based PWA + Capacitor Android shell.
      - name: Install Chromium
        run: npx playwright install --with-deps chromium

      # playwright.config.ts webServer runs `npm run build && npm start`.
      - name: Run E2E
        run: npm run test:e2e
        env:
          CI: true
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.E2E_SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.E2E_SUPABASE_ANON_KEY }}
          NEXT_PUBLIC_TURNSTILE_SITE_KEY: ${{ secrets.E2E_TURNSTILE_SITE_KEY }}

      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: playwright-report
          path: qa/e2e-report/
          retention-days: 14
```

Cost: roughly +4–6 min per push (Chromium install ~1 min, build ~2–3 min, suite
~2 min). `needs: build` means it will not run if lint/typecheck/unit already failed.

---

## 4. ⚠️ Two decisions needed before this goes green

### 4.1 CI needs Supabase env vars — or some specs must relax

The existing `build` job compiles without env vars because nothing reads them at
module scope. **Runtime is different.** `AuthProvider` builds its client from
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`; without them `sb`
is null. It degrades gracefully (`if (!sb) { setLoading(false); return; }`), but
these will likely fail:

- `smoke.spec.ts` → `/login renders its form, not a stuck loading state`
- any later signed-in test

Also relevant: `NEXT_PUBLIC_*` is **inlined at build time**, so these must be
present for the `webServer` build step, not just at run time.

Pick one:

| Option | Trade-off |
|---|---|
| **A — add dev-project secrets** (recommended) | Point `E2E_SUPABASE_*` at the **dev** project `wdtjhrilakoitfcezxpx`, never prod. Anon key only, never the service-role key. Highest fidelity. |
| B — guard auth specs behind `test.skip(!process.env.E2E_SUPABASE_URL)` | No secrets in CI, but the login path goes untested — the app's front door |
| C — run E2E locally only, via a pre-push hook | Zero CI cost, zero enforcement |

**A is the recommendation**, with the anon key only. It is a public key by
design and the dev project holds no real user data.

### 4.2 Turnstile will not solve in CI

`/login` renders a Cloudflare Turnstile widget. In CI it either fails or shows
the *"For testing only"* strip. The specs only assert the form renders, so this
is fine today — but **any future test that submits the login form must use
Cloudflare's always-passing test sitekey** (`1x00000000000000000000AA`), not the
production key. Do not attempt to bypass the widget.

---

## 5. The gap this suite does not close

**BOLA / IDOR — OWASP API #1 — remains UNVERIFIED.** There is no test proving
user B cannot read user A's journal entries, alerts, settings, or subscription
row. `security.spec.ts` has a `test.fixme` placeholder marking it.

To close it: create `E2E_TOKEN_A` / `E2E_TOKEN_B` repo secrets holding Supabase
access tokens for the two existing test accounts, then write cross-account reads
against `/api/price-alerts`, `/api/settings`, `/api/hypotheses`, and the trade
journal. Roughly 20 minutes once the tokens exist.

This is the highest-value remaining QA work. Everything else in the audit is a
known, catalogued defect; this is the one place an unknown could still be hiding.

---

## 6. Suggested sequence

1. `npm install --save-dev @playwright/test` + `npx playwright install chromium`
2. Add the three `package.json` scripts and the `.gitignore` entries
3. Run `npm run test:e2e` locally — **confirm green before touching CI**
4. Decide §4.1, add secrets if option A
5. Add the `e2e` job to `ci.yml`, push to `dev`, confirm green
6. Get the two test tokens and close the BOLA gap (§5)
7. From then on: every audit fix lowers a baseline in the same commit
