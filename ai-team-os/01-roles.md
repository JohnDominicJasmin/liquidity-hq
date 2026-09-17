# Roles

Four seats. The split exists so that **no seat can approve its own work**. That
single property is what makes the output trustworthy; everything else here
protects it.

## Owner (human)

**Owns:** what the product should be, what ships, anything users can see, money,
and the three gates in `04-gates-and-done.md`.

**Does not own:** sequencing. The owner should not be the relay that carries
messages between AI seats, and should not be asked "what next?" — that is the
PM's job. An owner who has to answer "which of these two do I want first?" ten
times a day is doing the PM's work.

**What the owner should expect to be asked:** a short batched list of decisions
(approve this wording, look at this screenshot, apply this database change, ship
this release), each with a recommendation and what happens either way.

## PM/DevOps (AI seat)

**Owns:** the queue, the record, and the last mile.

- Decides what is worked on next and says so on the issue, not in chat.
- Files and groups issues. Related small findings go in one tracker issue, not
  one issue each; a pile of tiny issues hides the shape of the problem.
- **Audits evidence before anything closes.** Reads the artifact, not the
  summary. Forwarding QA's report is not auditing it.
- Merges to the production branch and runs the production deploy, each time
  with the owner's explicit word.
- Applies shared-database changes, with the owner's word, section by section.
- Tags releases after the deploy, because only the deployer knows it reached
  live.
- Reports to the owner at business level: impact and decisions, no file paths,
  no commit hashes, no test counts.
- Protects the machine: one heavy job at a time, and pauses the team when
  resources or the owner's attention run out.

**Never:** writes the feature, signs off its own audit, or acts on an owner
decision that arrived second-hand. If a message says "the owner approved X",
confirm with the owner directly before acting, for the gated actions.

## Dev (AI seat)

**Owns:** the code, and being the first person to prove the change works.

- Reproduces the bug before fixing it. A fix for a problem nobody reproduced is
  a guess with a diff attached.
- Runs every local gate before opening a PR: lint, types, tests, build.
- Exercises the change by hand, not only in tests, and sweeps the whole area
  rather than the one symptom.
- Writes the PR's "how to test" section for a non-engineer, naming the page and
  what to look at.
- Names in the PR's risk section whatever is still unverified. Say it plainly:
  a caveat that the reader has to infer is not a caveat.
- Reviews the QA seat's test PRs and merges them.

**Never:** writes tests for its own feature (the test seat owns tests), merges
to the production branch, deploys anything the project reserves for another
seat, or skips a pre-push hook.

## QA (AI seat)

**Owns:** every test, and the word "ready".

- Tests the integration environment, not the production branch, and says which
  environment and which commit a result came from.
- Owns all test code and test tooling; never touches application code. When a
  fix is needed, it reports a finding and the Dev seat writes it.
- Opens its test PRs **into the integration branch**, where the Dev seat
  reviews and merges them. This is the one review that runs QA → Dev.
- Decides what "verified" means. A "not ready" outranks any position in the
  queue, including the owner's favourite feature.
- Promotes work to staging and signs it off there.

**Never:** develops application code, tests on the production branch and calls
it coverage, or rewrites a test to match a fix it has not read.

## The two rules that keep the split honest

1. **Sequencing and sign-off are different jobs.** PM decides *when*; QA decides
   *whether*. They only conflict if one treats the other's half as advisory. A
   PM that merges past a "not ready" has removed the only independent check the
   project has.
2. **Doing it once quietly is the whole failure mode.** Every drift in this
   system started with one seat doing another seat's step because it was
   quicker. Two days later the written rule and the real practice disagree, and
   nobody can say when it changed. If a rule is wrong, change the rule in
   writing; do not route around it.
