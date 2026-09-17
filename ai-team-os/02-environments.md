# Environments

Four environments, one branch each, one job each. The names matter less than the
property: **each environment answers a different question**, and collapsing two
of them removes an answer.

| Environment | Question it answers |
|---|---|
| Development | Does the change work at all? |
| Integration (QA) | Does it work together with everything else merged today? |
| Staging | Is this exact bundle the one we are willing to ship? |
| Production | What users actually have. |

## Rules that come from painful experience

**One hostname per branch.** If you cannot tell which branch an environment is
serving by looking at its address, someone will test the wrong build and report
a pass. Expose a version endpoint that reports the **running** commit and
branch, and quote that endpoint rather than the branch name. "I merged it" and
"it is live" are different claims.

**Staging is a release candidate, not rolling integration.** A release pull
request's source branch is also the branch it accumulates: every promotion into
it silently grows a release that was already signed off. Keep the candidate on
its own branch, and never promote into staging while a release from staging is
open. Ship the open release first, or close it.

**Say which environment a result came from, every time.** A pass without an
environment is not a result.

## Data

**Write down which environments share a database.** Sharing is common on small
budgets and it is fine, as long as it is visible. What is not fine is finding
out later: a test write in the integration environment is a real write in the
development one, so a clean test run is not proof that the data path is clean.

**Never point a lower environment at production data.** Not for one test, not
temporarily. If someone needs production-shaped data, seed it.

**Production schema changes are additive-only when there is no backup.**
Add a column, backfill it, then switch the code. Dropping something in the same
release as the code that stopped using it leaves no way back. Always treat a
migration as the highest-risk item in a release, and apply it **before** the
deploy that needs it.

**A migration file that carries sections for two environments is a trap.** If
both sections are live SQL, running the file anywhere creates the other
environment's objects too. Keep one section live and comment the other out with
a note saying it is applied separately, and when reviewing such a file ask
"what would this create on the *other* project?", not just "do the definitions
match?".

## Secrets and environment variables

- Secrets live where the project's `PROJECT.md` says and nowhere else. Not in
  chat, not in an issue, not in a commit, not in a screenshot.
- **Never copy a production secret into a lower environment.** If a lower
  environment needs a credential, issue it a separate one, so a leak is
  contained and revocable.
- If a pull request adds an environment variable, the PR says so and lists which
  environments still need it. Set it on production **before** the release
  deploy.
- Build-time variables are baked in at build time. Setting one after a build
  changes nothing until the next build. This confuses everyone at least once.
- When an environment is missing many variables, whole features are silently
  absent there, and tests that "pass" may not have exercised anything. Write
  down which features cannot be tested in which environment.

## Scheduled jobs and anything outside the repo

Cron jobs, webhooks, DNS, CDN rules and external schedulers are invisible to a
code search. A route with no in-app caller is not necessarily dead; it may be
called every five minutes by something the repo has never heard of. List every
such dependency in `PROJECT.md`, and check that list before declaring anything
unused.
