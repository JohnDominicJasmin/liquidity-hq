# Lessons

The failures that produced the rules, kept short. They are here because a rule
without its reason gets dropped by the next reader, and because most of these
are invisible from inside the mistake: careful work at the wrong layer feels
exactly like careful work at the right one.

No client, product or person is named. The pattern is the useful part.

## Verification

**The dashboard nobody opened.** Two seeded accounts started failing sign-in.
Three sessions investigated for hours and produced genuinely good work:
reproductions, control cases, competing hypotheses. Nobody opened the database
provider's own dashboard, which said "Unhealthy" with zero requests reaching the
database. Every symptom fell out of that instantly. → **Check the thing is up
before probing the symptom.**

**The style that said yes while nothing was drawn.** A focus ring fix was
verified by reading the computed style: "outline: 2px solid". On some inputs the
parent clipped the ring, so zero pixels were drawn. A pixel count found it. →
**Verify the layer that produces what the user gets, not the layer you changed.**

**The right answer from the wrong place.** A check compared a migration file
rather than the live function definition. It passed, and the live function
differed. → **Say which source answered the question.**

**The test that agreed with anything.** A test asserted that a line of source
*mentioned* a variable. An inverted implementation would have passed it. →
**Assert behaviour, not the presence of words in code.**

**Three tests rewritten in one night.** Each failed against a real fix because it
encoded a shape the fix never had. The correct move each time was to read the
implementation, then rewrite deliberately and say so in the PR. → **Never
rewrite a test until it passes; decide first which of the two is wrong.**

**The guessed timestamps.** Approval times were written into the record from
memory and were about forty minutes out. Approval times are the audit trail for
the owner's gates. → **Read the clock in the same action that writes the time.**

## State and data

**"You have no alerts" to someone who had alerts.** A failed read fell through a
default to a confident empty list. The same week: a paying customer shown the
free tier after one failed subscription read, and saved settings wiped because a
transient null user looked like a sign-out. → **Unknown is not no; every gate
needs a third state.**

**The wording that shipped but never appeared.** Copy was corrected in the repo
and the release deployed. Production kept the old words, because production
serves rows from a database and the repo file was only a fallback. → **Find out
where the running app reads the text from.**

**One language fixed, four still lying.** The same claim was removed in English
and left in four machine-translated locales. → **A copy fix covers every locale
the product serves, or it names the gap.**

**The migration that would have touched the wrong project.** A file carried live
SQL for two environments; running it anywhere created the other one's objects,
including a trigger on a production authentication table. It was caught by
reading both live catalogues. → **One environment's section live at a time; ask
what a file would create on the other project.**

## Process

**The release that grew after sign-off.** Because a release pull request's
source branch keeps accumulating, three approved releases silently gained
unreviewed work. → **The candidate gets its own branch, and no promotions into
it while a release is open.**

**"Shipped" that was not live.** Three times in one day, code was merged and
announced while the site still served the old build, because the host does not
auto-deploy. → **Verify against a version endpoint, and quote it instead of the
branch.**

**The rule that assigned work to someone forbidden to do it.** A written table
gave a seat a duty that a standing instruction forbade. It was ignored rather
than followed, and the document and reality disagreed for two days. → **A rule
that resolves to "responsible for something you may not do" gets ignored; fix
the rule in writing.**

**The redesign built three times.** A visual rework was built and rejected
three times because the earlier rejections were recorded as bare reverts with no
reason. The open ticket read as unfinished work rather than a declined change. →
**Say why on every revert. An open ticket outlives an unrecorded "no".**

**The paused automation nobody dated.** A release automation was disabled for a
correct reason and stayed off for a month, skipping silently. → **An instruction
with no expiry is a bug; put a date and an owner on every pause.**

**The dependency folder shared between seats.** Linking one seat's dependency
tree into another working copy emptied two real packages, which then looked like
an application bug. → **Never share a dependency tree between working copies.**

## Machine and cost

**The box at six percent free.** Builds were killed, pushes failed, and two
seats each assumed the other's process was the problem. → **Measure memory
first, one heavy job at a time, and report what is consuming it, including the
owner's own applications.**

**The loop that made it worse.** A killed build was retried repeatedly; each
retry consumed more memory and produced no new information. → **After a
resource kill, stop and report.**

## Working with the owner

**The approval that was not.** A document recording who performs production
deploys was read as standing permission to deploy. → **A record of the holder is
never a standing yes.**

**The header written before the answer.** A migration comment claimed
"owner-approved" before the owner had replied. It became true a minute later,
which is not the point. → **Never write an approval before it exists.**

**The pause read too early.** An instruction about *how* to pause was read as
"pause now", and the team stopped mid-task. → **When two readings lead to
opposite actions and the time is not explicit, follow the schedule already
agreed and ask.**
