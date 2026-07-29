@AGENTS.md

Before assuming any route that looks cron-only (checks `CRON_SECRET`, no in-app caller) is dead or unscheduled, read `docs/INFRASTRUCTURE.md` — the scheduler for several of these routes lives outside this repo (cron-job.org, n8n), not visible from a code search.
