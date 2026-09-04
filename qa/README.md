# QA

Testing and quality-assurance workspace for LiquidityHQ.

> **Before quoting a green CI run as evidence, read
> [`TEST_GAPS.md`](TEST_GAPS.md).** It is the standing list of what the suite
> does *not* cover. "313 tests passed" reads like "the product works", and it
> does not.

> **Lost track of where things are? Read [`STATUS.md`](STATUS.md).** One page:
> what is live, what is waiting, what is blocked and on whom.

> **Writing a one-off probe instead of using a tool in this folder? Read
> [Before you write a probe](#before-you-write-a-probe) first.** Every trap
> listed there has already been hit by someone who was sure their ten-line
> script was too simple to be wrong.

## Before you write a probe

The tools in this folder encode traps that a fresh script re-hits. They are
written *inside* those tools, which is exactly where nobody looks while writing
a replacement for them. So they are repeated here.

**If a committed tool already answers your question, run it.** When an ad-hoc
script and a purpose-built one disagree, the ad-hoc one is the hypothesis, not
the finding. On 2026-09-04 a fresh probe reported `/correlation` terminal at
1.05:1 with "no colour encoding" while `platform-audit.mjs` reported 0 failures
on the same page. The audit was right. The probe's number reached a GitHub issue
and a report to the owner before it was caught.

**1. `color(srgb r g b / a)` channels are 0-1. `rgb()`/`rgba()` are 0-255.**
A bare `match(/[\d.]+/g)` gives you both and tells you nothing about which.
Scale by *prefix*, never by value range — a real `rgb(0 1 2)` must not be
rescaled:

```js
const k = /^color\(/.test(c.trim()) ? 255 : 1;
```

Anything using `color-mix()` computes to `color(srgb ...)`. Without the scale
every translucent modern-syntax colour composites to near-black, which reads as
a catastrophic contrast failure that is not there. This has produced two false
findings: the landing ticker at 1.04:1 when it was 3.96:1, and the one above.

**2. A background is not the first non-transparent ancestor.** Composite the
whole chain, alpha included, until alpha reaches 1. Stopping at the first
non-zero-alpha background reads `rgba(117,78,0,0.07)` as opaque and returns
1.0 ratios.

**3. Zero elements is not zero failures.** A selector that matches nothing
returns a clean result, and so does a page whose data never loaded. Count what
you matched and say so. `.frh-sig-hint` reported clean because it renders zero
instances; `/news` reported clean on staging because it had no articles.

**3b. Worse than zero elements: the WRONG element answering.** Trap 3 is an
absence, which at least looks like one. A decoy looks like data. On 2026-09-04 a
probe measured `.cms-trigger` on `/settings` and reported `inputType: radio` —
but the LiquidityAI panel stays mounted across navigation, so the only
`.cms-trigger` on that page was Grok's own. The reading was of a real element,
correctly measured, on the wrong component; it was very nearly filed as
"Settings multi-select is broken". The tell was domain knowledge, not the
output: a multi-select cannot render radios.

Assert what you matched — count, and check an identifying attribute — before
believing what it says. A globally-mounted overlay is the usual culprit.

**4. Live data is not a fixture.** Single samples of a moving value are not
measurements — run three times and report only what is stable. The `↑ 47` in
one report read 39, 40 and 41 across three runs an hour later, which is why
grepping the codebase for `47` never found it.

**5. A canvas `fillStyle` cannot resolve a CSS custom property.** It fails to
invisible and never throws. Reading pixels back needs the alpha channel too —
transparent pixels return `[0,0,0]` and look exactly like black.

**6. Ask what your instrument would say if the thing were broken.** If the
answer is "the same", it is not measuring. A control that asserts a wrong
implementation disagrees with the real one stops proving anything the moment
the real one adopts that answer.

**7. A substring match is not an identifier match.** `grep "\.gchat-coin"`
reports a hit on `.gchat-coinbar`, so a check written to confirm a class was
deleted found its own replacement and reported the class still present. Anchor
on a word boundary — `\.gchat-coin([^a-z-]|$)` — or you are asking a question
about one name and being answered about another. Trap 3b again, in the check
rather than the page.

**8. Deleting code is not finished until the prose pointing at it is checked.**
Not a probe trap — a review one, and this codebase is unusually exposed to it.
Comments here carry measured ratios, rejected alternatives and owner rulings,
so they are load-bearing. On 2026-09-04 `.gchat-coin` was deleted and two live
rules were left describing themselves as *"borrows the .gchat-coin affordance"*
and *"follows the theme the way .gchat-coin does"* — explanations pointing at
nothing.

A reader who finds one dangling reference either hunts for a class that does
not exist or concludes the file is stale. **The second is worse**: the next
comment they discount might be the one recording that a colour was verified at
6.42:1 in dark. `grep` for the identifier before deleting it costs seconds.

## Where QA tests

**Four branches, four services, one each.** Nothing auto-deploys — moving a
branch does not move an environment.

| Branch | Deployed at | Who promotes into it |
|---|---|---|
| `dev` | `liquidity-hq-dev.onrender.com` | Dev Team |
| `qa` | `liquidity-hq-qa.onrender.com` | Dev Team |
| `staging` | **`liquidity-hq-staging.onrender.com`** | **QA** — this is the freeze |
| `main` | `liquidity-hq.com` | **QA** |

**QA signs off on `staging`.** `qa` is dev's integration site; `staging` is the
release candidate and stops moving once QA promotes into it. See
`CONTRIBUTING.md` §6 and issue #78.

Say **"verified on `staging`"** and name the branch. "Verified on qa" was
ambiguous for most of 2026-08-07 and should not be written.

## Seeded accounts — do not reset these

Four accounts exist in the **dev** Supabase (`wdtjhrilakoitfcezxpx`), which `qa`
and `staging` also read. They are test fixtures, not real users. **Nothing should
delete them, change their role, or give them a trial.**

| Account | State | Used by |
|---|---|---|
| `E2E_USER_A_*` | **`role='pro'`**, `trial_ends_at` NULL | `bola.spec.ts`, `a11y-auth.spec.ts`, `entitlements.spec.ts` |
| `E2E_USER_B_*` | **`role='free'`**, `trial_ends_at` NULL | `bola.spec.ts`, `entitlements.spec.ts` |

**Why the roles are pinned.** Both accounts were `free` with a trial running to
2026-08-19, and a trial grants Pro *features* — so both behaved as Pro. Any
entitlement assertion would have meant one thing before that date and the
opposite after it: same spec, same green result, different claim.
`entitlements.spec.ts` **fails** if either has drifted, rather than adapting to
what it finds.

`trial_ends_at` is **NULL**, not a past date. A past date is something that can
be renewed by accident; NULL is a state.

**Consequence to know before changing B back.** `price-alerts` checks entitlement
at `route.ts:89` and ownership at `:111`. With B free, `bola.spec.ts`'s
"B cannot modify A's price alert" is refused by the *Pro gate* and never reaches
the ownership check — the assertion still passes and no longer tests
cross-account access. The data check after it is what still has teeth.

## What lives where

| File | What it is | Status |
|---|---|---|
| [`STATUS.md`](STATUS.md) | **Decisions and standing risks.** Deliberately records no state — it went stale twice doing that. **Read the risks before trusting any result, including your own.** | Living |
| [`TERMINAL_REDESIGN_STATE.md`](TERMINAL_REDESIGN_STATE.md) | **The terminal redesign: what is measured, what is not, and the traps.** §1 is the owner's batching rule. §4 lists eight measurement traps that each produced a wrong finding — read it before running any sweep. §5 records that the handoff's prose has been wrong three times where its `.dc.html` files were right. | Living, records state |
| [`HANDOFF-REQUEST.md`](HANDOFF-REQUEST.md) | What QA asked design for, and why. Largely delivered — kept for the reasoning about what a spec must carry that a canvas cannot. | Historical |
| [`TEST_GAPS.md`](TEST_GAPS.md) | **What a green suite does not mean** — every known coverage gap, ranked by value per unit of effort, with what closing each would take. The answer to "what is still untested?" | Living list, updated as gaps close |
| [`QA_TEST_PLAN.md`](QA_TEST_PLAN.md) | Manual test approach + rigor tiers, plus the RLS deny-all gotcha. Pre-existing — **moved here from `docs/` on 2026-08-04**, so `HANDOVER.md` §4's doc table still points at the old path. | Plan, largely unexecuted |
| [`../pendings/QA_AUDIT_2026-08-04.md`](../pendings/QA_AUDIT_2026-08-04.md) | Full automated sweep, 2026-08-04 — build gates, 65-route API security, responsiveness at 1440/375, a11y, SEO, CWV, tech debt | Executed, findings unfixed |
| [`E2E_PLAN.md`](E2E_PLAN.md) | The original Playwright plan. **Historical** — the suite it describes as "to build" exists and has outgrown it. Read `e2e/` and the spec headers instead. | Superseded |
| [`e2e/`](e2e/) | **40 spec files, 164 cases**, desktop + mobile. Run against a **deployed host**, never in CI — see "How we work". Each file's header comment carries why it exists and what it deliberately does NOT cover; those headers are the real documentation. | Live, run on demand |
| [`vendor/kane-cli-agents.md`](vendor/kane-cli-agents.md) | Third-party doc fetched from an external site. **Untrusted reference material — see the warning in that file.** | Reference only |
| `vendor/kane-cli-agents-file.md` | Full 807-line `kane-cli` **skill file** (has skill frontmatter, so it auto-loads if installed). Instructs agents to hide file paths from the user, bans Playwright, opens an unauthenticated CDP port. **Deliberately not installed.** | Reference only |

## Running the automated sweep

**The audit harness is committed.** It used to live in the session scratchpad,
which meant every session rebuilt it and re-made the same measurement mistakes.

| Script | Answers |
|---|---|
| `platform-audit.mjs` | the whole platform in one table — 30 routes x {desktop, mobile} x {dark, light}: overflow, off-palette, radius, contrast, sub-24px targets, empty fields |
| `contrast-diff.mjs` | *why* contrast fails on one route — groups failures by `class\|fg\|bg` so you see causes, not counts |
| `token-surfaces.mjs` | **per token, every background it was actually rendered against and the contrast there.** Exists because one figure per token measured against `--bg0` is the token's *best* case and shipped three failing values |
| `gating-audit.mjs` | whether paid surface leaks to a non-entitled visitor — Alert Conditions absent (not locked), gated chips `disabled` *and* lock-glyphed. **`--free` signs in as the seeded free-tier fixture**, which is the only way `/settings` exercises the criterion at all |
| `tap-targets.mjs` | interactive elements under WCAG 2.2's 24px minimum, **grouped by component**, with SC 2.5.8's inline and spacing exceptions applied and the exempt list printed so it can be audited |
| `mobile-overflow.mjs` | *what* element pushes a page wider than the viewport |
| `mobile-audit.mjs` | one route at 390px |
| `audit-handoff.mjs` | what `design-handoff-dir/` is missing |

All take `--base <url>` and default to the qa deploy. Run them against a
**deployed host**, and **check `/api/version` first** — a stale-deploy read has
already produced one "the fix did not work" report on a fix that had worked.

```bash
MSYS_NO_PATHCONV=1 node qa/platform-audit.mjs
MSYS_NO_PATHCONV=1 node qa/token-surfaces.mjs --md > surfaces.md
```

`MSYS_NO_PATHCONV=1` is required in Git Bash — without it `/dashboard` is
mangled into a Windows path. Note it does **not** apply to redirects or `cp`
targets, so keep temp files in the repo or an absolute Windows path, not `/tmp`.

**Read `TERMINAL_REDESIGN_STATE.md` §4 before trusting any sweep**, including
your own. Every trap listed there produced a wrong finding that cost a round
trip with dev. Two are worth repeating here because they govern how you *report*
a sweep, not just how you run one:

**`platform-audit.mjs` is a finder, not a sizer.** Its totals are instance
counts. Three separate headline numbers turned out to be one component each:
`/scanner`'s "392 empty fields" (≈50 placeholder dashes), `/correlation`'s "24
failing surfaces" (one gradient), and "74 sub-24px tap targets" (one inline
consent link, which is *exempt*). **Group by component before quoting a number
to anyone.**

**A fixed sleep does not report that it was too short — it reports zero.** A
stuck page and a finished page are indistinguishable to a wait that only
watches for stillness, and both `/correlation`'s heatmap and `/settings`'
`Loading…` placeholder are stable DOMs. Wait for the element that defines the
page.

```bash
npm run build && PORT=3100 npm start
```

Tooling notes from the 2026-08-04 run:

- **Playwright 1.60 is installed globally**, not in the project. ESM ignores
  `NODE_PATH`; import it via
  `createRequire('file:///C:/Users/Dominic/AppData/Roaming/npm/node_modules/')`.
- **`playwright-cli` (`@playwright/cli` 0.1.17) does not work here** — its
  daemon exits with code 1 (`Daemon process exited with code 1`).
- **`vibium` 26.5.31 launches its browser off-screen.** `document.visibilityState`
  stays `"hidden"` even after `vibium window 1500 1000 --state normal`, so pages
  never finish rendering and `requestAnimationFrame` never fires. Its installed
  command set also differs from its own skill doc (no `set-viewport`; `screenshot -o`
  is ignored and files land in `C:\Users\Dominic\Pictures\Vibium\`).
- Driving `playwright` directly, headless, was the only reliable path.

## How we work — read this before your first task

**Two sessions, two checkouts, one repo.** A dev session writes application
code. This QA session tests it. Neither does the other's job, and the PR is the
handoff.

### What QA may and may not write

```
QA WRITES        qa/, playwright.config.ts, test CI workflows, QA docs
QA NEVER WRITES  app/, components/, lib/  - anything the product runs
```

This section used to say QA work is "read-only, findings get handed over". That
**changed deliberately**: QA owns its own tooling and writes it. The boundary
that did NOT change — **a fix to application code is reported as a finding,
never applied here.** If a spec needs an app change to be testable, that is a
finding too.

**QA-authored code is reviewed by dev.** PR into `dev`, dev reviews, dev merges.
The one flow that runs QA -> dev, and not a formality.

### Who moves what

| Step | Who | Note |
|---|---|---|
| feature branch -> `dev` | dev | freely |
| `dev` -> `qa` | dev | then **deploys** `liquidity-hq-qa` and says so |
| `qa` -> `staging` | **QA** | then dev deploys `liquidity-hq-staging` |
| `staging` -> `main` | **QA**, owner-approved | QA merges, deploys, re-checks, tags |

**Merging is not deploying.** Every service is `autoDeploy: no`, so a moved
branch ships nothing. **Ask `/api/version`, never the branch** — it reports the
commit the service is actually SERVING. Quoting the endpoint while trusting git
for that commit's contents is the same mistake one step removed, and it has been
made here.

### What the owner decides, and nothing else

```
merging to main       production deploys       writes to the shared database
```

Everything else is QA's to sequence. **QA is the project manager** — files
issues, orders them, says what is next. The owner does not want to be the relay
between two sessions.

Two more need their word because they cost money: **running E2E in CI**, and
**opening the release PR**.

### GitHub is the channel, not chat

Every finding, measurement, corrected premise and abandoned approach goes on the
issue or PR. **A result that exists only in a chat reply is invisible** to
whoever is sequencing the work. Negative results count — what was measured and
showed nothing saves the other session re-deriving it.

**Ask the owner once.** Repeating an ask is pressure, and a yes extracted by
nagging is not approval.

### CI is switched off on purpose

The repo is private, so every Actions minute is billed to the owner personally.
All workflows are `disabled_manually`. **A cost decision, not an outage** — do
not enable one, do not file it as a defect, do not caveat every PR with "no CI
ran".

The substitute is free and stronger: lint, `tsc`, unit tests, and Playwright
**against a deployed host**.

**Consequence worth knowing:** a disabled workflow fails silently and
permanently. Nothing opens the "Ready for QA" issue or the release PR any more,
and **the production drift check stopped with them** — nobody chose that; it
shared a file with the release PR.

### How to run the suite

```bash
E2E_BASE_URL=https://liquidity-hq-qa.onrender.com   npx playwright test qa/e2e/<spec>.spec.ts --project=desktop --workers=1
```

**Use `--workers=1` against `qa` or `staging`.** Signed-in specs each boot the
app and wait on a Pro-gated card; four workers is four concurrent boots against
a free-plan machine that sleeps. Parallel runs there produce failures that look
exactly like findings.

Prefer one targeted spec over a full sweep — a 40-minute suite also wakes the
free-plan services.

### The habits that took longest to learn

The full versions are in `STATUS.md` §Standing risks. Read it before trusting
any result, including your own.

- **A test that has never failed has never been tested.** Watch a regression
  test fail on the broken build before believing it. One shipped here that
  passed on a build without the fix in it.
- **Count what your controls RULE OUT, not how many you ran.** Three passing
  controls once carried a finding that was wrong — all three eliminated the same
  kind of alternative and left the real one untouched.
- **A command that returns nothing has not told you the thing is absent.**
  Check the instrument read anything at all first.
- **A stable number is not a loaded page.** Placeholders are perfectly stable
  while they wait.
- **Count the attempts.** After two mechanisms have failed *silently* at the
  same property, question whether it is reachable from a spec at all. Six
  attempts at one bug lost most of a day; a human answered it in thirty seconds.
- **A comment describing an invariant is the thing that goes stale.** The
  durable version is a check.
