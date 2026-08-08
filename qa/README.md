# QA

Testing and quality-assurance workspace for LiquidityHQ.

> **Before quoting a green CI run as evidence, read
> [`TEST_GAPS.md`](TEST_GAPS.md).** It is the standing list of what the suite
> does *not* cover. "187 tests passed" reads like "the product works", and it
> does not.

> **Lost track of where things are? Read [`STATUS.md`](STATUS.md).** One page:
> what is live, what is waiting, what is blocked and on whom.

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
| `E2E_USER_A_*` | the owner's own account; **trial ends 2026-08-19** | `bola.spec.ts`, `a11y-auth.spec.ts` |
| `E2E_USER_B_*` | second account, for cross-account checks | `bola.spec.ts` |
| `E2E_USER_FREE_*` | `role='free'`, **`trial_ends_at` NULL** | `entitlements.spec.ts` |
| `E2E_USER_PRO_*` | `role='pro'`, `trial_ends_at` NULL | `entitlements.spec.ts` |

**Why the last two exist rather than reusing A.** A is on a trial, and a trial
grants Pro *features*. Any entitlement assertion through A therefore means one
thing before 2026-08-19 and the opposite after it — the same spec, the same green
result, a different claim. `entitlements.spec.ts` now **fails** if either fixture
has drifted from the state above, rather than adapting to it.

`trial_ends_at` must be **NULL**, not a past date. A past date is something
someone can renew by accident; NULL is a state.

## What lives where

| File | What it is | Status |
|---|---|---|
| [`STATUS.md`](STATUS.md) | **Where the project is** — live version, what is waiting, blockers and owners. Updated by QA; check the date before trusting it. | Living |
| [`TEST_GAPS.md`](TEST_GAPS.md) | **What a green suite does not mean** — every known coverage gap, ranked by value per unit of effort, with what closing each would take. The answer to "what is still untested?" | Living list, updated as gaps close |
| [`QA_TEST_PLAN.md`](QA_TEST_PLAN.md) | Manual test approach + rigor tiers, plus the RLS deny-all gotcha. Pre-existing — **moved here from `docs/` on 2026-08-04**, so `HANDOVER.md` §4's doc table still points at the old path. | Plan, largely unexecuted |
| [`../pendings/QA_AUDIT_2026-08-04.md`](../pendings/QA_AUDIT_2026-08-04.md) | Full automated sweep, 2026-08-04 — build gates, 65-route API security, responsiveness at 1440/375, a11y, SEO, CWV, tech debt | Executed, findings unfixed |
| [`E2E_PLAN.md`](E2E_PLAN.md) | Playwright suite + CI job — what's built, the 3 remaining shared-file changes, and 2 decisions needed | Scaffolded, not wired up |
| [`e2e/`](e2e/) | The specs themselves — smoke, responsive, a11y, security, seo, perf | Written, never run in CI |
| [`vendor/kane-cli-agents.md`](vendor/kane-cli-agents.md) | Third-party doc fetched from an external site. **Untrusted reference material — see the warning in that file.** | Reference only |
| `vendor/kane-cli-agents-file.md` | Full 807-line `kane-cli` **skill file** (has skill frontmatter, so it auto-loads if installed). Instructs agents to hide file paths from the user, bans Playwright, opens an unauthenticated CDP port. **Deliberately not installed.** | Reference only |

## Running the automated sweep

The audit harness is not committed (it lives in the session scratchpad). To
rebuild it, see §9 of `pendings/QA_AUDIT_2026-08-04.md` — it documents the
scripts, the Playwright import path, and the flaky-measurement traps found
along the way.

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

## Standing rule

QA work is **read-only**. Findings get written up and handed to the development
session; they do not get fixed here. Keep that separation — it is what stops an
audit quietly becoming an unreviewed refactor.
