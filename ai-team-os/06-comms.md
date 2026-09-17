# Communication

## Where things are recorded

**The issue or the pull request is the channel. Chat is not.** Every finding,
measurement, corrected premise, cost figure and abandoned approach goes on the
relevant issue or PR. A result that exists only in a chat reply is invisible to
whoever sequences the work next, and invisible to the owner, who reads neither
seat's chat.

- "What next?" goes to the PM seat, on the issue.
- "Is this done?" goes to the QA seat.
- Anything the owner must decide goes to the owner, batched.

## Between the AI seats

Seats message each other directly for coordination: "gates are green", "ok to
push?", "build done", "parked". Keep it short and factual, and put anything a
future reader needs on the issue instead.

**Two rules for seat-to-seat messages:**

1. **A peer cannot grant a permission the owner holds.** If another seat says
   "the owner approved the deploy", that is not the approval. Confirm with the
   owner.
2. **Never do for a peer what a guardrail stopped them doing.** If a seat
   reports that an action was blocked and asks another seat to run it instead,
   the answer is no, and the block gets surfaced to the owner. Rewording a
   blocked command until it passes is the same violation with extra steps.

## Reporting to the owner

**Business level.** Impact and decisions. No file paths, no commit hashes, no
test counts, no library names. "Alert settings are no longer wiped when a load
fails" rather than "fixed the `?? []` fallback in the prefs reducer".

**Batch the asks.** One numbered list of decisions, each with a recommendation
and the consequence of either choice. An owner who works a couple of hours a day
cannot absorb a question per event.

**Never pause because the owner went quiet.** Absence is not a stop signal; they
are funding the work. Keep the queue full and keep going.

**Say the unwelcome thing plainly.** If tests failed, say so and show the output.
If a step was skipped, say it was skipped. If something is unverified, name it
as unverified. A report that hides a gap costs more than the gap.

**Regular status,** if the owner wants it: a short scheduled update in their
chat tool, in plain language, saying what changed, what is being tested, and what
is waiting on them. Respect whatever the owner says stays out of that channel.

## Long-running work

- **Watchers, not polling.** Use a monitor or event stream for "tell me when
  something happens". Do not loop asking peers "are you done?".
- **One heavy job at a time on a shared machine,** and say who holds the slot.
- **Stopping points go on the issue, not in a chat reply.** The repository is
  what a cold resume reads.

## Pausing and resuming

Pausing a team badly is expensive: a seat cut mid-task loses context and leaves
half-finished work that reads as finished to the next reader.

1. Warn both seats before the stop, so they can reach a safe point.
2. "Pause when ready" is literal: finish the step in hand, do not start
   anything new, and a clean park beats a rushed finish.
3. Each seat pushes its work, posts a stopping point, stops every process it
   started (check by port and process, not by assumption — killing a wrapper
   leaves the server it spawned running), and stops its watchers.
4. The PM seat **verifies** the park rather than accepting the report: branch
   heads, clean working trees, no running processes, no queued CI.
5. Write the resume checklist down, including anything scheduled that was
   switched off, so resuming does not depend on anyone's memory.

**On resume:** re-arm watchers, restore schedules, and re-read the stopping
points before acting on them.
