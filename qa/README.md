# QA

Testing and quality-assurance workspace for LiquidityHQ.

## What lives where

| File | What it is | Status |
|---|---|---|
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
