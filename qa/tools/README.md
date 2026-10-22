# QA's run tooling

Scripts QA drives by hand: the real-account regression harness, the How-to-test probes, and the mutation runner. Not part of any test
run — `npm test` and Playwright never import from here.

**Why it is in the repo at all.** Until 2026-10-22 all of it lived in `liquidity-hq-qa/qa-resume-2026-10-01/scripts/`, next to the
checkout but outside it, so it existed on one laptop and nowhere else. The owner moved the Dev and QA sessions to cloud sessions, and a
cloud session starts from GitHub: anything not committed is stranded. PM asked for it, and `qa/` is QA's to write (`CONTRIBUTING.md` →
*When QA writes code*).

## What runs today

| Path | What it does |
|---|---|
| `regress/rlib.mjs` | The harness every regression script opens through: real sessions for the seeded **dev-project** test accounts, an allowlist fence, writes answered locally, paid AI GETs answered locally. **Refuses production.** |
| `regress/memguard.mjs` | One headless Chromium at a time, aborting below 1.6 GB free (PM, 2026-10-21). Every launch goes through it. |
| `regress/regress-pages.mjs`, `pages.mjs` | The page sweep: status, error boundary, console and page errors, failed requests, sideways scroll at the requested width, dark and light. |
| `regress/ask5.mjs` | The five Ask entry points: prefilled, nothing sent before Send, exactly one `POST /api/grok-chat` after it. |
| `regress/regress-auth.mjs`, `regress-crud.mjs`, `regress-buttons.mjs`, `regress-arena.mjs`, `regress-i18n.mjs` | The rest of the #1640 regression. |
| `qa-howto-arena/lib.mjs` | The lighter harness for How-to-test runs: a **synthetic** session (fake token, plan answered locally), so nothing reaches a real account. |
| `qa-howto-arena/prod-1676.mjs` | The release check on production QA can run without a real account: signed-out pages, and that Ask is prefilled and sends nothing before Send. |
| `mutate-batch.mjs` | Breaks the code one edit at a time and requires a named test to go red. `node mutate-batch.mjs <repoRoot> <mutations.json>`; the file's bytes are restored after every run. |
| `regress/selftest-marketguard.mjs` | Proves the market-data guard below, both ways, in seconds. No deployed site and no account. **It is the one run that needs a machine with exchange access**, since its positive case is "the exchange answered". |

## The market-data guard

`rlib` lets public exchange GETs through on purpose, so when an exchange host is **unreachable** the page simply has no prices — and an
empty result reads as a calm market rather than a failure. That is the silent-stop shape #1649 exists to prevent, and a cloud container is
geo-blocked by Bybit and Binance (#1688), so it is now the common case rather than a rare one.

- `marketDataOutcome(ctx)` — which exchange hosts this context asked for, which answered, and why any failed.
- `assertMarketDataReached(ctx, label)` — **throws** if every exchange host failed. A run that asked for no market data is unaffected.

**Which passes enforce it today:** `regress-pages.mjs` (a blocked row is written as an `error`, so a later run retries it rather than
counting it) and `ask5.mjs`. **The others do not yet** — `regress-auth`, `regress-crud`, `regress-buttons`, `regress-arena`,
`regress-i18n` — so add the call when you next touch one, and do not assume a green run there saw a live market.

Everything else here is a one-off probe kept for its reasoning, not because it still runs.

## Before you run anything

- **Set `E2E_BASE_URL` for every Playwright run.** Unset, `playwright.config.ts` builds and boots the app locally, which is the heaviest
  job on the machine. These scripts take `QA_BASE` instead and default to the qa service.
- **Credentials are never in here.** `rlib.mjs` reads `.env.e2e.local` / `.env.local` from the checkout; both are gitignored and neither
  travels with the repo. Without them the real-account scripts cannot mint a session — ask the owner, who holds them.
- **Evidence is written next to the checkout**, in `../qa-evidence/`, never inside the repo. `QA_ROOT` / `QA_OUT` override it.
- **Paths.** **Everything under `regress/`, plus `qa-howto-arena/lib.mjs`, `qa-howto-arena/prod-1676.mjs` and `mutate-batch.mjs`, finds
  the checkout from its own location and runs anywhere.** `QA_REPO`, `QA_ROOT` and `QA_OUT` override. Verified by grep: no absolute
  `C:/Users` path is left in that set outside prose comments.
  **The one-off probes elsewhere in this folder still carry this laptop's absolute paths** and will not run in another checkout until the
  one you need is fixed — 102 files. They were archived as they were rather than rewritten blind: a silent rewrite of a script nobody
  re-ran is how a tool starts lying about what it measured.
  **How this list got shorter:** Dev, reviewing the PR that moved all this, found `regress/regress-crud.mjs` reading the QA folder's
  `.env.e2e.local` by absolute path — inside the very change whose purpose was portability. Credentials now come from `rlib.envVar`, and
  the other six in the live set were swept at the same time.
- **`rlib.mjs` refuses production and refuses any Supabase project but dev.** The production scripts are the ones that say `prod` in the
  name, they are read-only, and they never sign in.

## What does not work away from the owner's laptop

- Anything driving the owner's own Chrome, or a service on `localhost`.
- The free-memory guard still works, but it measures the machine the session is on, not the owner's.
