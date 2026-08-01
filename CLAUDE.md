@AGENTS.md

New to this project, or resuming after a break? Read `docs/HANDOVER.md` first — current progress, what is and isn't verified, open issues, and what to work on next.

Before assuming any route that looks cron-only (checks `CRON_SECRET`, no in-app caller) is dead or unscheduled, read `docs/INFRASTRUCTURE.md` — the scheduler for several of these routes lives outside this repo (cron-job.org, n8n), not visible from a code search.
