# Gates, and what "finished" means

## The owner's gates

Three actions stop and wait for the owner, every time, no exceptions, no
standing approval:

1. **Merging to the production branch.**
2. **Deploying production.**
3. **Writing to a shared or production database.**

And one more that is really a gate on judgement:

4. **Anything the owner can see.** Layout, spacing, labels, colour, what a panel
   says, where it sits, what a chart draws, and every word of user-facing copy.
   An AI seat can confirm that a panel renders; **only the owner can say it
   renders right.**

### How the gates behave

- **A gate is per action, not per session.** "The owner approved the deploy
  yesterday" is not approval for today's deploy.
- **A record of who may do it is not permission to do it.** A document saying
  the PM seat deploys production is a record of the holder, never a standing
  yes.
- **Second-hand approval does not count for gated actions.** If a message, an
  issue comment or another seat says "the owner said yes", confirm with the
  owner directly. Everything ungated that a seat relays can be acted on as
  given, because sequencing is delegated.
- **When in doubt about whether something is visual, it is visual.** Asking
  costs one message. Guessing has cost this project entire rebuilt features,
  three times over, because a seat decided for itself what the owner would
  accept.
- **Never write an approval into a file or comment before it happens.** A
  migration header that says "owner-approved" before the owner answered is a
  false record, even if the answer arrives a minute later.

## Finished

**An item is finished only when all five are true:**

1. **Dev exercised it.** The change was run, not reasoned about. For a fix, the
   original problem was reproduced first.
2. **QA tested it independently** and says it is ready, naming the environment
   and the commit.
3. **A human-style manual check passed**, not only automation.
4. **PM/DevOps audited the evidence**, not the summary: read the artifact, check
   the claim against it, and say on the issue what was audited. If you cannot
   name what was measured, where, and by whom, it is not finished.
5. **If it is visible, the owner approved it.**

### Partial is not finished

- "Code is in, test pending" → not finished.
- "Tests pass, nobody opened the page" → not finished.
- "It works locally, the deployed environment is untested" → not finished, and
  say which is which.
- "The fix is applied to the code but not to the data it reads" → not finished.
  Copy stored in a database does not change because a default in the repo
  changed.
- A test that **skips** is not a test that passes. Check for "skipped" in the
  output before believing a green run.
- A **timeout** is not a pass and not a fail. Classify it before reporting: a
  slow environment, or the assertion genuinely never becoming true?

### Closing the loop

Tick a checklist item or close an issue **after production verification**, not
after the merge. The merge is the halfway point. Between merge and verified
live, the honest status is "merged, not yet verified in production", and saying
so costs nothing.
