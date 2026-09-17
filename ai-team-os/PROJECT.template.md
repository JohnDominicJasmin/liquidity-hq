# PROJECT.md

Fill this in once per project. Every other file in `ai-team-os/` reads its
values from here. **Leave nothing as `<placeholder>`.** A missing value is how a
session ends up guessing, and a guess that looks like a fact is the most
expensive thing in this system.

Keep secrets out of this file. It records **where** a secret lives, never the
secret.

## Product

- **What it is, in one sentence:** `<plain language, as a user would say it>`
- **Who uses it:** `<audience>`
- **Owner:** `<name or role>` — the only person who approves the gates in
  `04-gates-and-done.md`.
- **Owner's reporting preference:** `<business level / technical / both>`
- **Owner's working pattern:** `<hours, days, how to batch questions>`

## Repository

- **Repo:** `<host/org/repo>`
- **Default branch:** `<main>`
- **Branch flow:** `<dev>` → `<qa>` → `<staging>` → `<main>`
- **Branch naming:** `<type>/<short-kebab-description>`
- **Commit format:** `<type>(<scope>): <summary>`
- **Pre-push checks run locally:** `<lint, types, tests>` — never bypassed.

## Environments

| Environment | Branch | URL | Database | Auto-deploy | Who deploys |
|---|---|---|---|---|---|
| Development | `<dev>` | `<url>` | `<db>` | `<yes/no>` | `<seat>` |
| Integration / QA | `<qa>` | `<url>` | `<db>` | `<yes/no>` | `<seat>` |
| Staging | `<staging>` | `<url>` | `<db>` | `<yes/no>` | `<seat>` |
| Production | `<main>` | `<url>` | `<db>` | `<yes/no>` | `<seat>` |

- **Environments that share a database:** `<list them, or "none">` — if any two
  share one, say so loudly here. A test write in one is a real write in the
  other.
- **Version endpoint:** `<path that reports the running commit and branch>`
- **Production backups:** `<yes and how / NO>` — if none, every schema change is
  additive-only and irreversible.

## Services and tools

- **Code hosting / CI:** `<tool, and what the team may do with it>`
- **App hosting:** `<tool, services, plans, build-minute caps>`
- **Database:** `<tool, project ids, table prefixes per environment>`
- **Chat / reporting:** `<tool, channel, which identity posts>`
- **Error and analytics:** `<tools>`
- **Scheduled jobs:** `<where they live — often outside the repo>`
- **Anything the repo cannot see:** `<external cron, webhooks, DNS, CDN>`

## Secrets

- **Where they live:** `<local env file, hosting dashboard, secret manager>`
- **Never:** printed in chat, pasted into an issue, committed, or copied
  between environments.
- **Which env vars are build-time:** `<list>` — setting one after a build does
  nothing until the next build.

## Machine limits

- **Total RAM:** `<n GB>` — how many heavy jobs can run at once: `<usually one>`
- **Known low-memory workarounds:** `<e.g. single-worker build flag>`
- **Browser and other apps that compete for memory:** `<list>`

## Project-specific gates

Beyond the standard three (production release, shared-database write, anything
the owner can see), this project also requires the owner's word for:

- `<add, or "nothing further">`
