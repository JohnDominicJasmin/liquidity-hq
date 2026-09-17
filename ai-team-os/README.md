# AI Swarm Team OS

A way of running software delivery with one human owner and three AI sessions: a
**PM/DevOps** seat, a **Dev** seat, and a **QA** seat. It is not a prompt
collection. It is the operating agreement they work under: who owns what, what
counts as finished, which actions stop and wait for the owner, and how each
claim gets checked before anyone says "done".

This folder is **project-agnostic**. Every project-specific value lives in one
file you fill in, `PROJECT.md`. Nothing else in here names a client, a repo, a
URL, a database or a channel.

## Why it exists

Three AI sessions can produce work far faster than one person can review it. The
risk is not that they write bad code, it is that they write **confident** code:
a fix that was never exercised, a test rewritten until it passed, a claim that
"production is fine" measured against the wrong thing. Every rule in here exists
because that happened and cost time. The short reason is written next to each
rule, because a rule without its reason gets dropped by the next reader.

## Install into a new project (about five minutes)

1. Copy this whole folder to the new repo's root: `ai-team-os/`.
2. Copy `PROJECT.template.md` to `PROJECT.md` and fill it in. Leave nothing as
   `<placeholder>`; an unfilled value is how a session ends up guessing.
3. Append this block to the project's agent entry file (`CLAUDE.md`,
   `AGENTS.md`, or whatever the tool reads at session start):

   ```md
   <!-- ai-team-os:start -->
   ## How this team works
   Read `ai-team-os/README.md`, then `ai-team-os/PROJECT.md`, then the file for
   your seat in `ai-team-os/roles/`. The gates in
   `ai-team-os/04-gates-and-done.md` are not negotiable.
   <!-- ai-team-os:end -->
   ```
4. Open three sessions, one per seat, each in its **own working copy** of the
   repo. Separate folders are load-bearing: the seat that writes code must not
   be the seat that reviews it, and a shared folder makes that impossible to
   enforce.
5. Give each seat its role file as the first instruction, and give the PM seat
   the owner's standing preferences (reporting level, working hours, what they
   want to be asked about).

## What "finished" means here

**Finished is not "the code is written". Finished is all five, every time:**

1. Dev exercised the change and reproduced the original problem first.
2. QA tested it independently and says it is ready.
3. It passed a manual check, not only an automated one.
4. PM/DevOps audited the evidence, not the summary.
5. If the owner can see it, the owner approved it.

Partial does not count. "The fix is in, the test is pending" is not finished.
"Tests pass but nobody opened the page" is not finished. A seat that reports
50% as done has not saved anyone time; it has moved the cost to whoever finds
out later.

## File map

| File | What it answers |
|---|---|
| `PROJECT.md` | Every value specific to this project. Fill it in first. |
| `01-roles.md` | Who owns what, and what each seat must never do. |
| `02-environments.md` | The four environments, their data, their secrets. |
| `03-pipeline.md` | How code moves from a branch to production. |
| `04-gates-and-done.md` | Owner gates, and the definition of finished. |
| `05-evidence.md` | What counts as proof. How measurements go wrong. |
| `06-comms.md` | Where decisions are recorded, how seats talk, reporting. |
| `07-tools.md` | Using code hosting, hosting/deploys, the database, chat, a browser. |
| `08-quality-checks.md` | The checks each kind of change has to pass. |
| `09-playbooks.md` | Step-by-step for releases, hotfixes, rollbacks, pauses. |
| `10-lessons.md` | The failures that produced these rules. |
| `roles/` | One file per seat, written from that seat's side. |
| `templates/` | Fill-in shapes: PR, report, release notes, status update. |

## The three ideas the rest of it rests on

- **The seat that wrote it never signs it off.** Review is a different pair of
  eyes, not the same pair reading twice.
- **Unknown is not no.** A failed read, a timeout, an empty response and a real
  negative all look identical in a log. Treat them as different states, or the
  system will quietly lie to you.
- **Two instruments beat care.** Every wrong number in this project's history
  was caught by a second measurement disagreeing, never by someone being more
  careful the first time.
