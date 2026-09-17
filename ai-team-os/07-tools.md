# Tools

What each seat uses, what it may do with it, and the failure each tool tends to
produce. Tool names are examples; the rules transfer.

## Code hosting and issues (for example a Git host CLI)

- **Use it as the record.** Comment on issues and PRs from the command line so
  evidence lands where the next reader looks.
- Read state from the host rather than from memory: PR status, whether a branch
  merged, which commit a tag points at.
- **Never bypass local pre-push checks.** If a hook blocks a push because a test
  fails, the test is the problem to solve. Skipping the hook to "unblock" is how
  a broken integration branch reaches everyone else. If two seats are deadlocked
  (one needs a branch pushed that the hook rejects), hand the branch over
  locally instead — a peer can fetch straight from another working copy.
- Keep the branch list clean: delete merged branches; only long-lived branches
  and open-PR branches should exist.

## App hosting and deploys (for example a platform API or MCP)

- **Know whether auto-deploy is on per service.** If it is off, merging ships
  nothing. This is the single most common way a team believes it has released
  something it has not.
- Confirm which account or workspace you are acting in **before** a deploy, and
  ask the owner if there is any ambiguity. The wrong workspace can mean the
  wrong customer's service.
- After triggering a deploy, verify twice: the platform's own deploy status, and
  the app's version endpoint. Quote both.
- Read logs through the platform rather than guessing: filter by level and by
  text, and check both application and request logs. Note that some plans do
  not record request logs at all, which means "no request logged" is not
  evidence the request did not happen.
- Watch build-minute caps and paid plans. Deploying a non-production service by
  habit spends the owner's money.
- **Never click a deploy button through a browser session.** Use the API or CLI,
  where the action is logged and reviewable.

## Database (for example a hosted Postgres with an MCP)

- **Reads are free; writes are gated.** Any write to a shared or production
  database waits for the owner, each time.
- Verify before and after. Read the live catalogue (columns, functions, grants),
  apply, then read it again, and compare against the file that was supposed to
  produce it. Checksums over many rows beat eyeballing a few.
- Apply **one environment's section at a time** from a migration file that
  carries several.
- Match live grants, not just definitions: a function that exists in both
  environments but is callable by anonymous users in one is a security
  difference, not a formatting difference.
- Prefer the platform's migration mechanism so applied work is recorded in the
  history table, and name the applied migration after the file in the repo.
- **Never run schema changes during a test pass** without asking the test seat:
  a lock on a shared database takes every dependent environment down for
  minutes.

## Chat and reporting (for example a workspace bot)

- Post as the team's own bot identity, never as the owner's personal account.
- Read the token from the project's secret store and **never print it**.
- Respect the owner's content rules for that channel: what may be named, what
  must never be (customers, credentials, internal tooling, personal detail).
- Keep it short and plain: what changed, what is being tested, what is waiting.

## Browser automation

- Useful for one thing above all: **seeing what a user sees**. A rendered check
  catches the layer that source reading cannot.
- **Never type a password or any credential into a page.** If a signed-in view
  is needed, the owner signs in and hands over the session, or the work goes to
  a seat with a legitimate test fixture. Injecting session tokens is the same
  violation wearing different clothes.
- Treat automated network capture as a weak instrument: it commonly misses the
  first seconds of a page load and can misreport statuses. Confirm anything it
  claims with a server-side measurement or an in-page timing read.
- Do not trigger native dialogs; they freeze the automation channel.
- Close the tabs you opened.

## AI seats themselves

- **Each seat gets its own working copy of the repo.** Separate folders are what
  make "the seat that wrote it does not sign it off" enforceable.
- **Never junction or symlink one seat's dependency folder into another tree.**
  Two trees writing one dependency tree corrupts packages in ways that look like
  application bugs.
- Watch the machine: memory first. One heavy job at a time, and a known
  low-memory fallback (for example a single-worker build) written down in
  `PROJECT.md`.
- When a guardrail blocks an action, stop and surface it. Do not reword it, do
  not route it through another seat.
