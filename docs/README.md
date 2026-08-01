# Documentation

Long-form docs live here. Three files stay in the repo root on purpose:
`CLAUDE.md` and `AGENTS.md` (loaded automatically by tooling, and `CLAUDE.md`
pulls in `AGENTS.md` by relative path) and `README.md` (GitHub renders it).

| File | What it covers |
|---|---|
| [HANDOVER.md](HANDOVER.md) | **Start here when picking this project up cold.** Current progress, testing status (what's verified vs not), open issues, prioritised next steps, owner-only actions, and the gotchas worth not relearning |
| [PRICING_AND_LIMITS.md](PRICING_AND_LIMITS.md) | Free / Trial / Pro: who is entitled, daily limits, which file owns each rule, and the invariants that keep the paywall and the limits agreeing. **Read before changing `lib/limits.ts`.** |
| [ARCHITECTURE.md](ARCHITECTURE.md) | App structure, table registry, data flow |
| [INFRASTRUCTURE.md](INFRASTRUCTURE.md) | Render services, Supabase projects, cron jobs, env vars. Several schedulers live outside this repo (cron-job.org, n8n) and are invisible to a code search - this is the source of truth for them |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Visual language, tokens, component conventions |
| [feature-inventory.md](feature-inventory.md) | Every feature and what it costs to run |
| [QA_TEST_PLAN.md](QA_TEST_PLAN.md) | Unit/integration/system/E2E/UAT plan for the 2026-08-07 to 2026-07-30 security batch - what's verified, what isn't, and a real gotcha about testing right after a Render deploy |

## Work in progress

`../pendings/` holds active roadmap and migration notes: `PENDING.md`,
`OPS_ROADMAP.md`, `I18N_MIGRATION.md`, `LEMONSQUEEZY.md`.

It was deliberately left where it is rather than folded in here. Those
filenames are cited from application source and from a dozen historical
migration files, and migrations are a record of what was run - rewriting them
to chase a directory move would be worse than the inconsistency.
