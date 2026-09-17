# Evidence

What counts as proof, and the specific ways confident work goes wrong. Every
item here is a mistake that actually happened, followed by the rule it produced.

## The measurement rules

**Two instruments beat being careful.** Every wrong number was caught by a
second measurement disagreeing, never by someone re-reading their own work more
carefully. Before reporting a figure that matters, measure it a second way. A
re-run of the same command is not a second instrument; it is the same instrument
twice.

**Say which source answered.** "The check passed" is half a claim. "The check
passed, reading the live function definition, not the migration file that
defines it" is the whole claim. A resolver that returned `true` by accident once
passed a check for a feature that was broken.

**Unknown is not no.** A failed read, a timeout, a transient null and a real
negative look identical downstream. Ask of every boolean gate: what does this
read as **before** the data arrives, and what does it read as when the fetch
**fails**? Both usually resolve to the wrong branch. Symptoms this causes:
paying customers shown the free tier, "you have no alerts" to someone who has
alerts, settings wiped because a null user looked like a sign-out.

**Checking what you changed is not checking what governs the outcome.** Ask
what sits one level up from the code you just read. A computed style can say
"outline: 2px solid" while nothing is drawn, because a parent clips it. A route
can be correctly guarded while a page-level condition means the route is never
reached. Verify the layer that produces what the user gets.

**In place is not exercised.** A merged pull request, an existing test file, a
configured setting: each is a record of intent, not of outcome. Run it.

**Measurements expire.** A figure is an observation with a timestamp. Quoting
yesterday's free-memory number, or an hour-old "service healthy", as present
tense is how a team reasons confidently about a world that has moved.

**Counters need their window.** A cumulative count with no reset time is a
number, not a measurement. Report rates, or report the window with the count.

**Check the thing is up before probing the symptom.** Step zero for any
investigation: open the provider's own status page or dashboard. Three sessions
once spent hours producing excellent measurements of a symptom while the
database dashboard said "Unhealthy" and no request was reaching it. Rigour at
the wrong layer feels identical from the inside to rigour at the right one.

**Negative results count.** What was measured and showed nothing, and what could
not be verified, are worth as much as the successes. Write them on the issue,
or the next seat re-derives them.

**A failed measurement is not evidence of the negative.** If the probe could not
run, report "could not measure", never "no problem found".

**Check the clock before writing a time.** Read the clock in the same action
that writes the timestamp. Approval times are the audit trail for the gates, and
an estimated time weakens exactly the record the gates rely on.

## The trap specific to AI seats

**Do not rewrite a test until it passes.** When a test fails against a fix,
there are two possibilities: the fix is wrong, or the test encodes an assumption
the fix did not follow. Read the fix, decide which, and say which in writing. A
test rewritten to match whatever the code does is not a test; it is a
transcription. Three separate times in one night, a test failed because it
assumed a shape the real fix never had — each time the right move was to read
the implementation first, then rewrite deliberately and say so.

**Do not report a summary as if it were the artifact.** Look at the screenshot,
read the log line, open the row. "QA says it passes" forwarded upward has had
exactly one pair of eyes on it while looking like it has had two.

**Correct yourself in writing, in the same place as the claim.** A wrong
statement that gets quietly dropped stays in the reader's head. "I said X; X was
wrong; here is why" costs one paragraph and buys the only thing that makes the
rest of the record worth reading.
