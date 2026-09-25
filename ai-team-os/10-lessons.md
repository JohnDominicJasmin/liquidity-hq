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

**The test whose name and behaviour had come apart.** A spec titled and
commented "open the chat from the news page" never navigated to the news page —
it exercised a different page entirely, passed, and reported on something real.
Anyone reading the suite to find out whether that path was covered would have
concluded yes. → **A green test measuring something other than its claim is
worse than no test, because the gap looks filled.** Found by the author
re-reading their own file, not by review.

**The test that agreed with itself.** An assertion searched the whole request
body for an indicator's name — a name that also appears, unconditionally, in a
section unrelated to the thing under test. It would have passed on a run that
never selected that indicator at all. → **Scope an assertion to the exact
text the feature produces, then ask what else in the payload could satisfy it.**

**The early return that passed.** A test bailed out with an explanatory
annotation when its injected failure appeared not to reproduce. Green, proving
nothing: a route pattern that silently stopped matching would have produced the
same result. Fixed by counting the injected failures and asserting at least one
fired. → **An early return is a silent pass. Assert that your setup actually
happened.**

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

**The state machine that travelled backwards.** A fix replaced a loaded/not-loaded
boolean with loading/error/ready, correctly. Then a background refresh on an
unrelated screen was wired to the same states, so one failed poll demoted
confirmed-good data to "error" — and because the write guard keyed on "ready",
the user was locked out of editing data the app was still holding correctly.
→ **"Known" must be sticky. Only a genuinely new context may reset it.** The
forward version of this bug is unknown shown as a definite no; this is the
reverse, and it appears almost exclusively inside fixes for the forward one.

**The third state that stopped one layer short.** The same fix gave the data
provider three states and left the component's prop a boolean. Every way of
collapsing three into two reproduced one of the two bugs: a permanent loading
skeleton, or an input that accepts writes it should refuse. → **A third state
has to reach the surface the user is looking at, and that surface needs a real
error state with a way out.**

**The retry that gave no sign of life.** An error state shipped with a Retry
button wired straight to a refetch. Deliberately, no loading flash — so a slow
or repeatedly failing retry looked identical to a click that never registered.
→ **A control with no pending state is a control the user cannot tell is
working.** Distinguish a user-initiated retry from a background one.

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

**The red test that would have stopped the team.** Tests written to demonstrate
unfixed bugs — the right order, since a test written after a fix tends to encode
the fix's shape — were about to merge plain-red. That fails the suite for
everyone, including the pre-commit checks of the person writing the very fix
those tests are waiting for, and a suite expected to be red stops being read.
→ **Mark a red-by-design test expected-to-fail. It keeps the suite honest, it
fails loudly the moment a fix makes it pass, and removing the marker belongs in
the fix's own diff.** Mark only the tests that actually demonstrate the defect:
one whose subject is a real but latent hazard can legitimately pass.

**The author who flipped their own gate.** The instruction "remove the
expected-to-fail markers as part of your fix" was given to the seat writing the
fix. Removing that marker is the act of declaring the test now passes — so it
quietly converted an independent check into a self-report, and it had the code
author editing the test seat's files. → **The seat that wrote the fix does not
get to declare it verified**, however small the edit that would do so.

**The commit with nowhere to go.** A finished test was pushed onto a branch
whose pull request had already merged. It sat there looking done, with no path
into the main line, and would have been lost silently. → **After pushing, check
the branch still has an open route to its base.**

**The stale ref that invented an outage.** A reviewer compared two branches
against a locally cached base ref and concluded a merge had never landed. It
had; only the local copy was old. Fetching the ref being compared against
reversed the answer. → **A stale local ref produces a confident wrong
conclusion about the state of the world.** Same shape as every other
wrong-source error, applied to version control.

## Machine and cost

**The box at six percent free.** Builds were killed, pushes failed, and two
seats each assumed the other's process was the problem. → **Measure memory
first, one heavy job at a time, and report what is consuming it, including the
owner's own applications.**

**The loop that made it worse.** A killed build was retried repeatedly; each
retry consumed more memory and produced no new information. → **After a
resource kill, stop and report.**

**Twenty-seven watchers that were all believed dead.** A background monitor was
stopped and restarted many times across one session. Stopping the task ended the
wrapper each time and never the loop inside it, so the loops accumulated — every
one of them invisible in the task list and individually too cheap to notice, on
a machine where memory was the binding constraint the whole time. → **Write
long-lived watchers as bounded loops that exit on their own, and check for
them by command line at the operating-system level, not by the task list saying
they stopped.** A handful of short-lived shells is normal; an orphan is one
whose command line names a loop.

**The second instrument that measured the wrong window.** A reviewer started a
memory sampler to corroborate a build's reported peak, then told the team it
matched — before reading the sampler's own output. It had started after the
build finished and never measured it. → **A second instrument has to overlap
the event. Start it before, and read it before quoting it.**

## Working with the owner

**The approval that was not.** A document recording who performs production
deploys was read as standing permission to deploy. → **A record of the holder is
never a standing yes.**

**The scope ruling made from a description.** A seat reported that a new
notice "visually overlaps" a floating button, and called it pre-existing and
out of scope. The PM agreed, in writing, on that basis. Then the screenshot
showed the button sitting on top of the end of the sentence: the notice was
unreadable, so the feature the PR existed to deliver did not work. The ruling
had to be reversed. → **Open the artifact before ruling on scope, and record
the reversal with its reason rather than leaving two contradictory rulings on
the thread.** The seat's description was accurate; a description is still not
the artifact.

**Two seats filing the same finding a minute apart.** A finding surfaced in a
review thread; the test seat filed it as its own issue while the PM filed it as
an instance of a wider tracker. → **Say on the thread that you are taking a
finding elsewhere, before you file.** The duplicate cost nothing here because
both write-ups were good, but the habit is what keeps an issue list readable.

**The header written before the answer.** A migration comment claimed
"owner-approved" before the owner had replied. It became true a minute later,
which is not the point. → **Never write an approval before it exists.**

**The pause read too early.** An instruction about *how* to pause was read as
"pause now", and the team stopped mid-task. → **When two readings lead to
opposite actions and the time is not explicit, follow the schedule already
agreed and ask.**
