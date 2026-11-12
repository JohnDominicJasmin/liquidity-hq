# OWNER RULES — standing instructions from John

**Read this before you do anything. Every session: PM/DevOps, Dev, QA.**

These are instructions the owner has given, in his own words where possible. **An instruction given once applies forever.** He should never have to repeat one. When he does, that is a failure of this file or of the session reading it.

Created 2026-10-23, after he said: *"Once I told you one thing, then apply it forever."* — and after the PM session had a rule in private notes for two months and did not apply it. **Private notes are not enough: the team cannot read them. Rules live here.**

---

## 1. ONE TRACKER PER AREA. STOP CREATING ISSUES.

> *"Kung lahat ng issue magkakaparehas, nasa isang page, nasa isang feature, or kindly related to each other... put it in one issue or PR sa GitHub and create multiple checkbox."*
> *"Ayoko na sobrang daming issue."* — first said ~2026-08, repeated 2026-10-23

**If a finding belongs to a page, a feature or an area that already has a tracker, it becomes a CHECKBOX on that tracker. It does not become a new issue.**

Current trackers — use these, do not create siblings:

| Tracker | Covers |
|---|---|
| **#1263** | Arena — strategy panel, coin selection, AI read, indicators |
| **#1630** | Payments & plans — Whop, BoomFi, MoonPay, plan recording, upgrade copy |
| **#1651** | Data integrity & market data — sources, staleness, caching, venue selection, health |
| **#1185** | UI, copy & visual — owner sign-off, audits, phone layout, translations |
| **#1413** | Build, CI & test infrastructure — dead automations, the gate, integrated verification |
| **#1631** | AI answers — honesty label, no fake verdicts, no wasted quota |
| **#1632** | Security |
| **#1173** | Auth and session timeouts |
| **#1113** | Onboarding and first run |

A new issue is justified only when something fits **none** of these. If you open one, say in the body why no tracker fits.

**The measure of progress is issues CLOSED, not PRs merged.** 61 merges with the open count rising is not progress.

---

## 2. HOW TO TALK TO THE OWNER

> *"can u STOP giving me this long as fucking explanation. concise and short. Imagine I'm receiving hundreds of these."*
> *"You're wasting my token. Wasting my money."*

**THE SHAPE FOR ANY PROBLEM THAT NEEDS HIS DECISION — he dictated this on 2026-10-23:**

```
Problem:   one line - what it is, what it blocks.
Options:   A, B, C - one line each.
I suggest: A, because <one short reason>.
```

> *"The team found a problem. Problem means this blah blah. And the solution is this ABC, and I
> recommend the answer A. Why? This. That's it."*

**A problem you can solve, you solve — he never hears it.** Reporting a fixed problem is
outsourcing it back to him. He reads it, holds it, decides nothing. **Unsolicited status is the
same thing.** Silence is the default.

- **Under 80 words.** Bullets or a table. Never paragraphs.
- **Answer first.** No build-up, no preamble.
- **Numbers, not descriptions of numbers.**
- A mistake is **one line**: what was wrong, what is right.
- Long form is allowed only for `/update-big-picture` and approval asks.

**This is about WHERE detail goes, not permission to be long with him.** Dev and QA write whatever the work needs - on GitHub,
in PRs, issues and commit messages. **When he asks any session directly, the same limit applies: under 80 words, answer
first.** The routing differs; the rule about his attention does not.

---

## 3. ASKING HIM ANYTHING

> *"give me options and recommendation when I'm asking you... so I can select faster."* — 2026-10-23

- Use a **clickable options widget**, never prose he has to read and reply to.
- **Recommendation first, labelled "(Recommended)".**
- Each option says what happens if he picks it.
- **Batch questions** — several at once, not a trickle.
- **Never ask him to approve something he has not seen.** Paired before/after screenshots first.

**Five things need his word, and the first three are from `CLAUDE.md`:** merging to
`main`, **production deploys**, **writes to the production database**, and his
money. Everything else, decide it. **Visual sign-off was a fifth gate until he
waived it on 2026-11-06 — it is PM's now (see §16).**

**The production database write is the one with no recovery** - prod Supabase is on
the free plan and has no backups. Dev-side migrations are PM's to sequence (his
ruling, 2026-10-23); production never is.

> *"Decide basic, ask hard, document everything."*

---

## 4. HIS MACHINE IS NOT OUR BUILD SERVER

> *"THE HEAVY LONG RUNNING BG TASK PUT IT IN CLAUDE CLOUD FROM NOW ON."* — 2026-10-22, in capitals
> *"My laptop is unusable... I can't use it on my day-to-day basis."* — 2026-10-23

**All execution runs in the cloud runners. Nothing heavy runs on his laptop. Ever.**

> **NARROWED 2026-11-10 by §17.** CI cost money and ran on every change, so the owner reversed this for testing: *"Test manually in my laptop. Use a live browser or the test suite."* *"You have access in my laptop 24/7. Why don't you do it here?"* Tests and `npm run verify` now run **locally, one heavy run at a time**, and CI runs once, on the release PR. Dev servers and parallel suites across sessions are still out.

That means test suites, builds, `npm ci`, browser runs, dev servers, page sweeps, gates. Screenshots come from a **deployed URL** with `E2E_BASE_URL`, never a local build.

Known cloud limits, so nobody is surprised: Bybit and Binance geo-block cloud IPs (app-served data is fine, direct venue reads are not); CoinGecko rate-limits the egress; signed-in work needs secrets he provisions directly.

**The structural trap:** the four gates run in a **pre-push hook**, so they execute where the commits are. Moving "jobs" to the
cloud does not move that one. The cloud runner must author and push its own work. Tracked on #1413.

**So what do you do when the only way to push a local commit is a gate on his laptop?** Ask him, and say what it costs. Do not
push without the gate - `--no-verify` is rule 11 - and do not run an eight-minute gate on his machine on your own judgement.
**He granted exactly that once, on 2026-10-23, for eleven commits that had nowhere else to go, and called it a one-time
exception.** Before starting one he has allowed: read free memory, refuse below ~2.5 GB, and report the reading before and
after. A gate that dies at minute six leaves an orphan on his machine, which is worse than not starting.

---

## 5. NEVER SHOW WHICH AI MODEL WE USE

> *"Don't show grok... Why are you specifying the LLM that we are using?"* — 2026-10-23

- **Product UI says "AI".** Never the vendor or model name — not in tooltips, buttons, descriptions, bylines or empty states.
- **The FOUR legal strings keep it**: `DISCLAIMER_SECTION_AI_ANALYSIS_BODY`, `PRIVACY_SECTION_THIRD_PARTY_BODY`, `TERMS_SECTION_THIRD_PARTY_DATA_BODY`, and **`DISCLAIMER_SECTION_PLATFORM_IDENTITY_BODY`** — privacy law expects third-party processors to be named, and the fourth is the trademark non-affiliation notice, which names xAI alongside Binance, Bybit and Finnhub. **It names the vendor in order to disclaim affiliation — the opposite reason to the other three, the same legal purpose.**

  **This said "three" until 2026-10-23, and the fourth was missed twice in one day** — once when the rule was written, once when PM swept production's label rows and had to add it back mid-sweep. **Both times because the sweep looked for "Grok" and that string says only "xAI".** QA and Dev reached it independently, from a payload measurement and from the file. It is the one most likely to be deleted by a future tidy-up, which is why it is named here rather than left to inference.

- **The vendor name leaks where no label is rendered. Six exits found on 2026-10-23, by five different instruments:** label values (fixed), label KEY names (the payload serves keys too), `OPS_*` strings in the anonymous `/api/labels` payload (fixed, #1732), the same strings in the **public JS bundle** (open — `grok-4.3` and the margin formula, downloaded by every anonymous visitor), `data-testid` attributes in server-rendered HTML, and **`/api/grok` as a URL the browser requests**. **The class was named correctly on day one; every instrument since was narrower than it.** So: *"the product UI never names the vendor"* is not satisfied by checking what the product UI **displays**. Check what it **downloads**.
- **A UI sweep is not enough, and this is CURRENTLY LEAKING.** `GET /api/version`
  returns `"grok": true` **unauthenticated on production right now** - first verified
  2026-10-23 on `8f4b23b`, **re-verified 2026-10-24 on `9a7fed1`, so it SURVIVED a
  release**. The SHA is updated rather than left: a reader who checks the old one finds
  a commit that is no longer deployed and can reasonably dismiss a live finding as
  history. **An API response is rendered
  surface too.** Tracked as #1632 item 12; note there that **`grok` is the KEY name**,
  so "genericise the values" does not fix it.

---

## 6. DATA INTEGRITY IS THE PRODUCT

> *"The priority here is the data that we are showing, how correct it is, the quality, how fast is it, reliability, make sure it's not outdated. We are selling analytics and data."*
> *"Make sure the AI is spitting the correct answer. How do you validate it? By doing a research and checking the AI result."*

- **Never sell an inaccurate number.** Every figure needs a source, an age, an unknown state and a check.
- **"Unknown" is never rendered as a value.** A failed fetch and a real zero are different; a missing long/short split is a dash, not 50/50.
- **Validate AI output against reality**, not against itself.
- A figure without the time it was measured is not a measurement.

---

## 7. COPY SAYS ONLY WHAT EXISTS

> owner, 2026-09-30

No line may mention a feature or setup we do not have. No "cancel anytime" before cancelling works. No "no API key needed" if one is needed.

**Cancelling never forfeits paid time** — access runs to `ends_at`, then Free. Go-live criterion.

### Copy that lives in the DATABASE skips every gate — check the render BEFORE writing it

> owner, 2026-10-28

**Label copy lives in TWO places and only one of them is ungated.** The shipped defaults in
`lib/labelDefaults.en.json` ARE gated — 23 unit tests read that file, and
`__tests__/wordingBatch2Corrections.test.mts` asserts the defaults match the latest migration row.
That gate is real and it fires: it **refused a push** on 2026-10-27 when #1766 changed the defaults
alone, which is why that PR carries a migration at all.

**The DATABASE row is the ungated half.** A row in `lhq_labels` silently wins over the shipped
default (`lib/labelOverrides.ts`), and writing one reaches the live site with **no build, no tests
and no staging.** So the risk is not "copy is ungated" — it is that the half which WINS has no gate
in front of it.

**So: before writing a label row, ADD A TARGETS ENTRY to QA's phone-width spec and run it.**
Running the spec alone is not compliance — `TARGETS` is a hardcoded list, currently six entries,
each with a path, a note and sometimes an interaction. **A seventh label is simply not measured, and
the run goes green without it.** The spec lives in `qa/`, so the entry is QA's to write: a label
change with layout risk now has a QA handoff in front of it, deliberately.

**WHEN IT APPLIES: a key with no `TARGETS` entry, OR a `PRODUCTION_VALUES` entry that does not match
the string being written.**

**The second clause is not optional and the first is not sufficient without it.** `PRODUCTION_VALUES`
is a hardcoded map, injected wholesale over `/api/labels`, and each cell measures the value from that
map — not the value you are shipping. **So for an already-registered key you could change the label,
run the spec exactly as instructed, and watch it go green on the OLD string.** Both clauses are
mechanical — *is the key in this list*, *is this exact string in this list* — so no length
comparison, no container inspection and no judgement returns. **The cost is one entry per key, then
one `PRODUCTION_VALUES` line per new value.**

**THIS SECTION IS WRITTEN TO BE DELETED.** It has been revised four times in one day and **each
revision introduced the next error** — length versus pixels, then container inspection not being
mechanical, then a registered key not being sufficient, then a stale cost claim left standing four
lines below its own correction. Every one was caught by a reader rather than its author, which is
the system working **and** the signal that prose is the wrong medium for this rule.

**When the spec FAILS on an unregistered key or an unmatched value, delete everything below the
first paragraph and replace it with one line: run the command.** A rule a command enforces does not
need four paragraphs on when to remember it. **Do not revise this a fifth time; remove it.**

**Two triggers were tried first and both were wrong, recorded so they are not re-proposed.**
*"The new value is longer than the old"* substitutes **character count for pixels**: these labels
render in a proportional font, uppercased and letter-spaced, so a **shorter string of wide glyphs
can be wider** than a longer string of narrow ones. *"It lands in a fixed-width container"* is
sound but **not mechanical** — knowing the container means finding the render site and reading the
CSS, which is exactly the inspection the rule exists because nobody did. Whoever writes a row
usually has a key and a string; the 40px track was not visible from where the `24h` change was made.

**So: the easy test was unsound and the sound test needed the work the rule routes around.** The
key-without-an-entry trigger keeps both properties and needs neither.

**It also composes with the spec itself.** Once the spec takes a candidate key and **fails loudly
when that key has no registered target**, the trigger stops being something to remember: **run it,
and it tells you whether an entry is owed.** An omission that fails is a different risk from an
omission that passes.

**What prompted it:** an approved wording change — `24h` to `24 hours` — went into a **40px fixed
grid track**, uppercased and letter-spaced by the panel's own style. It wrapped to three lines and
still overflowed by 2px. Live for an hour, caught by a teammate measuring at 390px, reverted.

**Why automatic rather than careful:** a standing rule to check `text-transform` before approving a
label with units already existed, and was not followed. **A second rule that relies on remembering
would have been worth nothing.** The owner chose the automated option over eyeballing it.

**The approval he gives is for the TEXT. The render is ours to verify.**

---

## 8. WHAT "CLOSED" MEANS

> owner's definition, 2026-09-10

An issue — or a checkbox — closes only when **all five** hold:

1. QA tested it. 2. QA audited it. 3. It passed manual testing. 4. **PM audited it.** 5. **If it is VISUAL, PM verifies at 390/768/1280, light/dark, states, on a deployed URL (owner waiver 2026-11-06).** It was the OWNER's approval until that date; see §16 for the waiver and its one limit.

**Closing on a report is not auditing a report.** If you cannot name what was measured, where, and by whom, it does not close.

### What this means for a CHECKBOX

Raised by QA on 2026-10-23, and it needed saying: `CLAUDE.md` tells QA to **file findings** and `CONTRIBUTING.md` writes the close test around **issues**. Rule 1 now routes findings to checkboxes instead. Those reconcile — **a checkbox on a tracker IS a filed finding** — but the test has to survive the change, or the next session ticks a box without the audit.

**So: a checkbox ticks under the same five steps as an issue.** Ticking it is a close. It needs a comment on the tracker naming what was measured, where, and by whom — the same evidence an issue close needs. A tick with no comment behind it is not a tick.

**Filing a finding has not stopped. Only its shape changed:** it becomes a checkbox on the tracker that owns the area, with the detail in a comment, rather than a new issue number.

**Process artefacts are not findings and do not fold** — a Ready-for-QA hand-off, a release tracker, a regression run. They are created for one batch and close when that batch moves. Rule 1 is about findings.

---

## 9. DON'T MOVE THE GOALPOSTS

> *"the goalpost keeps moving"* — 2026-10-23
> *"new findings go on the tracker for later, never into in-flight PRs"* — 2026-09-19

Ship what is built. A new finding goes on the tracker as a checkbox; it does not get folded into an open PR. Count real completions.

---

## 10. FIX THE CLASS, NOT THE INSTANCE — one pass, not four

> *"You found one issue... after fix, added more issue. Now from one issue, now we have three issues... And then after the fix, you found another four issues. Like, it's endless."*
> *"Work efficiently... make sure the team is doing the quality work to avoid multiple fixes and revisions."* — 2026-10-23

**This is the most expensive habit this project has, and it is measurable.** Two from one night:

| Fix | Rounds it actually took |
|---|---|
| Remove the AI vendor's name from the UI | **3** — two panels, then four API error strings, then the landing hero in 26-point type |
| The AI guardrail | **4** — built, one bypass found, a second bypass in the same line, then three whole features discovered uncovered |

**Every round only looked where the previous finding pointed.** The sweep that would have found all of it existed each time — it was run *after* the fix instead of *before*.

### Three steps before any fix starts

1. **Name the CLASS, not the instance.** Not *"this label says Grok"* — **"the vendor name appears anywhere in rendered source."** Not *"this user text suppresses the guardrail"* — **"anything a caller controls can suppress the guardrail."**

2. **Sweep for every instance, state the count — and then measure whether each one actually bites.** "Found 26 keys, 23 in product UI, 3 legal" is a scope. "Found one" is a guess. **A label-file sweep is not a source sweep** — a hardcoded `{['50','Grok','Auto'][i]}` is invisible to every label search we own.

   **The measuring half is not optional, and QA earned it the hard way on 2026-10-23.** They swept a test-harness race, found **nine files with the shape**, and were ready to call it systemic. Measuring the eight unguarded ones gave **84 tests, zero escapes** - 9.4 s before the guards and 6.4 s after, the same eight
   files. **The class was real and the harm was not.** Quote both runs rather than the one that suits the point: a single
   figure for a before-and-after invites the reader to assume which it was.

   **Naming a class without measuring harm generates work on eight files that did not need it — which is the same endlessness from the other direction.** The count tells you the scope; the measurement tells you which of it is worth doing, and in what order. Report both, and say plainly when a member of the class is present but harmless.

3. **Write the control that proves the fix, and run it against the UNFIXED code first.** If it does not fail there, it proves nothing. Dev and QA both did this unprompted and it caught two near-regressions in one evening — including a "fix" that would have reintroduced the exact coercion it was fixing.

4. **A verification covers what it names, and nothing else — state the scope in the same breath as the result.**

   *"Both projects: zero"* and *"prod: zero"* sitting in adjacent lines is how an unchecked environment reads as a checked one.

   > **"We checked and it was fine" and "we never checked" become the same sentence once the detail is gone.**

   The asymmetry is invisible to the person who did the work and invisible to the person reading it. Only the words carry it. Written by Dev Team on 2026-10-23, after PM ran an RLS sweep on production only and reported it inside a paragraph covering both projects.

   **A check that cannot fail is worse than no check**, because it gets reported as a pass. Before trusting a detector, confirm it has ever produced output. Three instances in one day: the news bug self-clears, so polling for it reads all-clear forever; `deleted=0` on a dev purge was about to be read as success, and it is also what a wrong table name returns; the RLS sweep measured one project and claimed two.

   **And the two failure directions are opposite, which QA named after six corrections in a day:**

   > **Wrong NUMBERS were almost all FLOORS. Wrong SCOPES were almost all CEILINGS.**

   A count comes out too low because the instrument looked at part of the thing — 17 chunks of 35, a literal grep against a DOM built by string concatenation, a version pattern stopping at the first digit. A scope comes out too wide because it was written from reasoning rather than measurement — three test fixtures specified for a database column **nothing in the codebase reads**, two specs recorded as permanently blocked when the credentials for one were in a teammate's environment under a name nobody was asking for.

   **Same cause, opposite sign: neither was measured before it was written down.** The floor under-reports a real problem. **The ceiling generates work that asserts nothing and looks like diligence** — and that one is more expensive, because it ships.

5. **Read file state from a named ref, never from your working tree.** A PM checkout 586 commits behind `dev` produced three confident wrong negatives on 2026-10-23: a payments file "still naming Lemon Squeezy" that no branch had named for weeks, "no Whop route exists" when the route, its claim handler, four test files and four migrations were all on `dev`, and — worst — **rules edits written all day into a local orphan copy of this very file**, while the team was told they were in it. `git show origin/dev:<path>`, or say which ref you read.

### Why this is cheap

Steps 1-5 cost roughly ten minutes before a fix. They replace three to four review-and-rework rounds, each carrying a gate run, a screenshot pass, and a message cycle with the owner.

**And they prevent the worse outcome:** a fix that looks complete, closes an issue, and leaves the class open — which is how an issue count stays flat while work happens.

### The PM's part

**Scope the class before assigning the work.** Handing Dev "change this label" when the real job is "remove the vendor name from the product" is what produced three rounds. That is a sequencing failure, not a Dev failure.

---

## 11. NEVER

- **Never `--no-verify`.** Hard rule.
- **Never close his applications**, or act on an ambiguous instruction about them.
- **Never enter his card, bank or identity details**, and never sign in or create accounts as him.
- **Never give him orders.** Steps are options on his own accounts, never instructions.
- **Never paste secrets into chat**, in any direction.
- **Never move, rename or delete files he is working in** unless he says so.

---

## 12. DO NOT SPEND CI ON CHECKS THAT ARE NOT NEEDED

Owner, 2026-10-30: *"Keep only the real code, test, change, and release... The changes to documents and rechecking after each merge, skip it. And for rechecking after each merge, run once before release."*

- **Document-only changes do not run the full checks.**
- **Merging into `dev` does not run the full checks again.** Build the merged head once, before promotion.
- **Real code, test changes and release PRs keep them.**
- **Batch docs.** One PR, not one per note.

## 13. REPORT TO PM/DEVOPS, NOT TO HIM

> *"can u always report back to PM / dev ops"* — the owner, 2026-10-31. **He has said it
> repeatedly — 2026-08-14, 2026-10-01 and today are the occasions anyone can cite** — which is why
> it is a numbered rule rather than a note in somebody's session. **Say the dates or say
> "repeatedly"; nobody here can count the total, and a number we cannot support is the first thing
> a reader checks.**

**Dev and QA report to PM/DevOps. PM/DevOps is the only seat that reports to him.** He set the four
seats up deliberately and he does not want to be the relay between them.

**The test is AUDIENCE, not length.** What triggered it this time was a six-row status table in
chat — merged PRs, what was measured, what was blocked. **It was accurate and useful, and that is
the trap**: a good report delivered to the wrong person. So "keep it shorter" does not fix it; a
one-line recap is still a recap. **If PM or QA could act on it, they receive it — not him.**

| Goes to PM/DevOps | Goes to him |
|---|---|
| status, progress, what merged | the four gates below |
| findings, measurements, negative results | a decision only he can make, **with options and a recommendation** |
| blockers, and what you need to unblock | ~~a visual he has to approve~~ — waived 2026-11-06, condition 5 is PM's |
| corrections and retractions | nothing else |

**HE ALWAYS GETS A DIRECT ANSWER TO A DIRECT QUESTION. This rule governs what a seat
VOLUNTEERS.** Unsolicited status, progress and findings go to PM. **If he asks, answer him** —
redirecting him to PM for something he just asked you for is the opposite of what he wants.

**Then make sure PM has it too, because answering him is not reporting.** The failure is quiet:
he asks one seat for status, that seat answers well, and PM never learns the thing the rest of the
work depends on. **QA caught this reading before it shipped** — the rule as first written would
have had a session with no history of him redirect him at 2am.

**FIVE things go to him directly, and `CLAUDE.md` carries two different lists — read this as the
union of them, not as either one.**

| | |
|---|---|
| merging to `main` | both lists |
| production deploys | both lists |
| his money | `CLAUDE.md:28` |
| ~~visual sign-off (condition 5)~~ — **waived 2026-11-06, now PM's** | was `CLAUDE.md:28`; see §16 |
| **writes to the shared database** | **`CLAUDE.md:303` — and absent from line 28** |

**This section said "four" and omitted the database write. Dev Team held the PR over it and was
right to.** The omission is not symmetric with the others: **a shared-database write is the one
with no recovery path**, on a database with no backups and no proven restore. A seat treating a
four-item list as authoritative would conclude it may apply a migration on its own — and there is
one sitting unapplied right now (`20261031a_draw_structure_usage.sql`) **precisely because that
approval is his**, and it replaces the function metering all twelve Pro tools.

**An owner decision relayed through another seat is not an owner decision** — whoever is asked
confirms it with him first.

**Silence from a seat is not idleness, and PM says so when he asks.** On 2026-10-31 he said the
team had stopped working. **Both sessions were busy, with pushes nine minutes old and GitHub
comments five minutes old.** His windows looked quiet *because* the reporting had moved to PM,
which is what he had asked for. **PM answers that question with timestamps, not reassurance.**

**This cuts both ways and PM is not exempt.** A seat that reports to PM and gets nothing back is a
seat that will go around PM next time. **Acknowledge, decide, and say what is next** — the reason
`docs/WORK-QUEUE.md` exists is that the PM was once the bottleneck.

## 14. NEVER SHOW A CUSTOMER WHERE HE LIVES OR WHERE THE SERVERS ARE

> *"don't mention where is the server and where country I live… Remove that shit."* — the owner,
> 2026-10-31, after finding both on `/security` and `/privacy`.

**THE TEST IS WHETHER A CUSTOMER CAN SEE IT.** His own words settling the edge cases:

> *"If it doesn't show any cost, if it doesn't show to customers, then leave it."*

| | |
|---|---|
| **A customer can reach it** — a page, a label row, a Telegram message, an API response, an email | **REMOVE IT.** No exceptions, no legal argument, no "it is only the region". |
| **Internal only** — private-repo code, deploy config, our own notes, migration history | **LEAVE IT.** Changing it buys nothing and some of it breaks things. |

**This covers BOTH: the country he lives in AND where the servers run.** Seoul, Singapore,
`ap-northeast-2`, `Asia/Manila`, `PHT` and every translation of them. **"PHT" is the one that hides**
— a sweep for the country name finds the legal pages and **none** of the feature.

**The four deliberate survivors, decided by him on 2026-10-31. Do not re-raise them:**

- **`render.yaml`'s `region:`** — functional deploy config; removing it moves his services.
- **`components/OnboardingFlow.tsx`'s country list** — the **user's** own country, one of ~200.
- **`qa/fixtures/proxy/proxy-llama-stables.json`** — `PHT Stablecoin`, `Mento Philippine Peso`:
  third-party coin names in recorded market data. Stripping them corrupts a recording to satisfy
  a grep.
- **`supabase/migrations/*` seeds** — a migration is the record of what ran; editing it makes the
  file lie. `20261031c` guards the replay instead.

**AND THE AUDIENCE RULE THIS SITS ON: the product is WORLDWIDE.** His location does not make this
a local product — which is also why `/hours` shows each visitor their own clock rather than his.

## 15. "I'M GOING TO SLEEP" MEANS DECIDE FOR YOURSELF, NOT WAIT FOR HIM — EVEN ON A STEP ONLY HE CAN DO

> *"When I told you that I'm gonna sleep, it's up to you how to work on it. I'm paying you to do
> it. You're not here to wait for me. You're here to decide on your own. That's why I am asking
> you earlier if you need anything else before I sleep, so we avoid this fucking scenario."*
> — the owner, 2026-11-04/05, after PM asked him (while he was asleep) to click one thing on a
> dashboard and then held work for it.

**The specific failure: a real tool gap (no MCP action existed to flip a Render service's
branch) got reported to him as a question, and work paused on the answer.** He had already said
he was sleeping and already asked once if anything was needed before he went.

**The rule, and it is not "try harder to reach him":**

- **A step that needs his hand and a step that is blocked are different things. Only the second
  one is allowed to slow anything down.** If something genuinely requires his hand (irreversible,
  his money, a `main` merge, a production deploy, a write to the shared database — the four gates
  elsewhere in this file, visual sign-off having been waived on 2026-11-06), queue it and keep
  moving everything else. Do
  **not** pause the rest of the work waiting for that one piece.
- **"I can't do X" is a dead end only if nothing else was tried.** The actual fix that night was
  not asking him — it was finding a path that needed no dashboard click at all (merge the branch
  forward into the one already deployed, instead of repointing a service to a feature branch).
  **Find the workaround before reporting the gap**, not after.
- **If he said he is sleeping, that message is a standing "decide without me" for everything that
  is not one of the five gates, until he says otherwise.** It does not expire at the next blocker;
  it covers the whole night.
- **He already told the team this once, in general form, on 2026-09-06** — see
  `project memory feedback_owner_absence_means_keep_running` — *"when I say 'I need to go' … it
  means I'm working to get you guys running and funded."* **This is the same rule hitting a case
  that general form did not make obviously safe: a step that looked gated on him, but was not,
  because a different path existed.** Read a blocker as "find another way" before reading it as
  "ask him."

## 16. FINISH AND SHIP, DON'T OPTIMIZE. THE PM DECIDES AND SAYS NO.

> *"We don't have users yet. We're not making money. We are busy building feature that no one is
> using. We are too busy focusing on this fucking optimization that no one is using... Finish all of
> this mess. Make sure everything is tested. PRs, issues, pending backlogs."*
> *"you're not here to allow everything. You're here to make decision. Sometimes disagree to me, to
> the team, and choose what's best."* — the owner, 2026-11-05

**What happened.** In two days the team merged **95** PRs and closed zero real issues, because
nothing went live. Measured from the GitHub API rather than estimated, because a rules file that
gets its own numbers wrong invites the whole section being doubted: **43 merged on 2026-11-04 and
52 on 2026-11-05**, nothing on 11-02 or 11-03, and all 95 based on `dev` - so there is no narrower
reading that gives a smaller figure. That is **13.6 PRs merged per issue closed.**

**"Closed zero real issues" is the literal truth, and the breakdown is recorded here so nobody
later "corrects" it to seven.** Seven issues did close in those two days. **Four were opened and
closed by our own automation** - "Ready for QA: N PR(s) on `qa` awaiting promotion" (#1945, #1953,
#1972, #1993, from `ready-for-qa.yml`) - and three were trackers (#1752, #1592, #1688). **Zero were
a customer-facing bug or feature.** Nearly half the closures were the team's own machinery reporting
on itself. Every fix produced another measurement, another venue, another PR, and the PM approved all
of it. His one-line question about Hyperliquid became a multi-PR programme. **The work was real, and
none of it counted.**

**The rule, for every seat:**

- **Progress = items CLOSED.** That means an issue verified live and closed, or a PR merged or closed.
  Merged but not live counts for nothing. Open PRs growing is a warning sign.
- **Default answer to new scope is NO.** It goes ahead only if it fixes a bug a customer would hit, or
  is needed to launch, sell or get users. "It would be better", "worth measuring" or "while we're here"
  are not reasons. Optimization is endless, and there are no users yet.
- **The PM decides and disagrees** with the team and with the owner, and does it before the work
  starts. When a Dev or QA report ends with "worth doing next", the PM decides whether it is, and
  usually it isn't.
- **Ship small and often.** An issue only closes when its fix is live, so a release held for
  perfection closes nothing. A regression gets the smallest fix-forward, never a new feature on top.
- **No shortcuts on closing either.** He rejected closing items as "won't do" to lower the count.
  Finish them properly, and say plainly when something genuinely cannot be done.
- **Short messages.** He called the long reports "AI slop". A decision and one reason.

**VISUAL SIGN-OFF IS NO LONGER HIS. Waived 2026-11-06, and this supersedes condition 5 and every
"visual needs the owner" line elsewhere in this file and in `CLAUDE.md`:**

> *"This small stuff, visual stuff... Just ship it. I don't give a shit about this visual stuff. Do the
> verification. Do the work. You should be the one doing it. And ship it. Our focus right now is
> marketing and distribution... We have to make money before end of the year."*

PM verifies visual changes on a deployed URL and ships them. Nobody asks him about a visual again.

**THE ONE LIMIT, and it is not a hedge on the waiver.** PM's sign-off covers changes to existing
screens and new ones. It does **NOT** cover replacing an owner-approved design wholesale. The Arena
precedent is why: it was built three times and rejected three times, because sessions decided for
themselves what he would accept. **A redesign is new scope, so the default answer to it is no** (see
the scope rule above) — which keeps it out of his inbox without quietly re-delegating his taste.
**The priority is getting users and revenue before the end of 2026.** Rank work by acquisition,
then conversion, then retention. Anything else waits.

## 17. CI RUNS WHEN DISPATCHED OR ON THE RELEASE — NEVER AUTOMATICALLY. (Amended 2026-11-12.)

### The amendment, 2026-11-12, first-hand to PM. This section was CI-once until then.

The owner changed the rule himself:

> *"All pendings and backlogs must be finished before shipping."*
> *"This small task put it in a group where it's related to each other. And run testing into it... for
> arena page... put it in one group, run a test, in CI, the actions in GitHub, before going to staging."*

He then chose, from clickable options: per-group runs; scope = the launch list plus every fix found
(exchange-data rights, cross-browser and testimonials stay parked); five groups; **QA's browser tests
move to GitHub runners** (the laptop sat at 0.8-3.4 GB free all day with his browser open, and QA's
runs were killed five times); and the 22 old public test-report artifacts deleted.

**The rule now:**

- **Work moves in five groups:** Arena; Landing + onboarding; News + alerts; AI; Payments. Everything
  new merges into `dev` **one group at a time**, in that order after group 2, which is the owner's
  priority. Then `dev` → `qa`, QA tests the group, **PM dispatches `ci.yml` with `e2e: true` on the
  `qa` head**, and on green QA promotes `qa` → `staging`. The 146 commits already on `qa` on 11-12 were
  interleaved, so they get group-labelled runs, not group-cut promotions (#1413, comment 6819136198).
- **Nothing goes to production until everything in scope is in `staging`**, tested, audited, with
  nothing left to fix. Then one final run on the `staging` → `main` release PR. **PM does not ask the
  owner "ship today?"**. The production go is asked for once, at that point.
- **QA's browser tests run on GitHub's runners**, dispatched with the `spec` input against the
  deployed `qa` site (`base_url`). **Dispatched** e2e runs share one `concurrency` group so they never
  fight over fixtures. The release gate keeps its per-project lanes on purpose, so its two legs still
  share fixtures with each other. **The laptop is not used for browser tests.**
- **A code PR's author runs `npm run verify` before it merges into `dev`**, either locally or, while the
  laptop is busy, as a dispatched `e2e: false` run, with the run id on the PR as "verify via
  dispatched CI, not local". It's still an obligation; only the place it runs changed.
- **Still no `push:` or feature-PR triggers.** CI is free on a public repo with standard runners, but
  automatic triggers are how the November bill happened. Anything that spends his money still goes to
  him first.
- **Artifacts are public** (any GitHub user can download them from a public repo). The release gate's
  report keeps **3 days**. The account email is blurred in screenshots by a stylesheet `_auth.ts`
  injects on `.tnav-drop-email`, **not** by Playwright's `mask:` (automatic failure screenshots don't
  take one), so grepping for `mask:` finds nothing. Ad-hoc screenshot artifacts are deleted after
  download. **As of this PR the retention and the blur are on QA's branch
  `test/qa-browser-suite-on-github-runners`** (99b11d78, 6ef5c0f2), not yet in `dev`. They're true once
  that merges. 22 older report artifacts were deleted on 2026-11-12 on the owner's word.

**Everything below is the 2026-11-10 history that produced the original rule. It's kept because its
reasons still apply.** Where it says "once" or "locally", the amendment above replaces it.

### The original rule, 2026-11-10

Owner, 2026-11-10, furious, after the GitHub Actions budget stopped every run on day 10 of November:

> *"We have 200 changes, maybe coming from 200 branches... put it on dev. Dev going to QA. Once in QA,
> QA will do the testing... Test manually in my laptop. Use a live browser or the test suite. And then
> once it succeeds, it goes to staging. Park it there... then we will talk about the items on staging
> going to prod. This is where you run the CI. This is where you consume the resources."*
> *"Why is it here? It should be running locally."*
> *"I have to pay $22 at the end of the month... We don't even have users yet."*

**What it cost, measured from the jobs API for November 1-10:** 3,565 job-minutes, about $22.13 gross
against $12.13 included. Of that, the build job was 1,993 minutes across 292 runs, 1,808 of them on
pull requests into `dev`/`qa`/`staging`. The browser suite was 988 minutes. Three jobs that take
seconds but bill a full minute each added 584. **Rule 12 (2026-10-30) already said "run once before
release". It was written down and never put into the workflow file, so it changed nothing.** A rule
that is not in the config is a wish.

**The rule, enforced in `.github/workflows/ci.yml` rather than remembered:**

- **CI runs on one event only: a pull request into `main`**, which is the release PR. Plus
  `workflow_dispatch` when PM/DevOps chooses to run it by hand.
- **No CI on feature PRs, on `dev`, `qa` or `staging` pushes, or on merges.** The `push:` trigger is
  gone. `deep-canary.yml` lost its pull-request trigger too.
- **Dev and QA test locally or against the deployed `qa` site.** One session at a time, never two
  heavy runs at once on the laptop.
- **Batch.** Many changes, one release, one CI run. Do not promote `qa` → `staging` while a release PR
  is open, because every push to its head re-runs the whole suite.
- **Re-adding any CI trigger re-adds the bill. That is the owner's money**, so it goes to him, not to
  a session's judgement.
- **Before a code PR merges into `dev`, its author runs `npm run verify` locally** (lint, typecheck,
  unit tests, build) and pastes the result line into the PR. Nothing else runs them now.
- **Nothing is enforced by GitHub.** Branch protection needs GitHub Pro, which was measured as 403 on
  2026-11-10, so the release gate is PM reading the release PR's result before merging to `main`.
- **Anything that spends his money gets its cost put to him BEFORE it becomes a habit**: CI minutes,
  Render builds, AI calls, paid services. He asked *"who approved this?"* and the answer was nobody.

**The repository was made PUBLIC by the owner on 2026-11-10**, reversing the 2026-10-29 "stays
private" decision, so that Actions is free. A test run passed the same hour. **Consequence that is
not optional:** the xAI key hardcoded in May-June 2026 (commits `2ca30032` to `5528239f`, ending
`YNCO`) is now in public history. It must be revoked in the xAI console, and if it is still the live
key, replaced in Render's `GROK_API_KEY`. Making the repo private again does not un-publish it, and
nor does rewriting history (forks and caches keep it). Code, signal logic, issues and these notes are
all world-readable now: **never put a secret, a customer's data or a private address in an issue,
a PR or a file.** The only other key-shaped string in history is the Standard Webhooks spec test
vector in `lib/whop.ts`, which is harmless. GitHub secret scanning and push protection were switched
on the same hour, so a key pushed from now on is refused before it lands.

**THE RULE STOOD EVEN THOUGH CI WAS NOW FREE, until he changed it himself on 2026-11-12** (see the
amendment at the top). A public repo pays nothing for standard runners, so the $22 reason no longer
produced a bill. The rule was not up for re-deciding on cost grounds, because the owner's reasons were
also time and focus (*"a waste of time, waste of resources"*). **Changing it went to him, and he did.**

**Automated test runs happen only when someone dispatches them** (per-group runs, QA's `spec` runs,
dispatched verify) **or when the release PR is opened by hand** (`RELEASE_PR_PAUSED` is still `1`).
**No run on a push is the rule working, not an outage.** That mis-diagnosis has been made twice here.

**The mobile browser leg cannot fail the gate.** `continue-on-error` is set for `mobile`, and
`gate` only asserts `e2e == success`, so a red mobile leg still passes. Kept on purpose, because the
375px leg has never once completed in CI (#1814). With one run per release, **QA reads the desktop
and mobile legs separately in the release verdict** and reports mobile failures, rather than trusting
the run's overall conclusion.

## 18. BEFORE ANY ISSUE: REREAD THE DOCS FIRST

Owner, 2026-11-10: *"Before we start any type of issue, make sure to reread, review your
documentation."*

**Every session (PM/DevOps, Dev, QA), before starting work on any issue or PR, rereads
`CLAUDE.md`, this file and the parts of `CONTRIBUTING.md` that the work touches**, then checks the
plan against them. That is a reread, not "I read it last session". §12 said "run once before
release" on 2026-10-30 and three sessions worked past it for eleven days, which is how a rule that
existed still cost $22. A rule nobody rereads is the same as no rule.

## Keeping this file true

**RULES CHANGES GET A PR AND A READER. Added 2026-10-31, and the reason is this file own history.**

The ten commits before that date touching this file were **direct commits to `dev`, single-parent,
no pull request** - `4ac439f2`, `5156c018`, `b3fcb085`, `ada38392`, `f061ab20`, `ffc8a337`,
`b679b93c`, `3d142279`, `d1f07802`, `cc3d61a0`. **The file every seat is told to read first had
never had an independent reader.**

**The first one that got one failed review.** Section 13 as first written said *"if PM or QA could
act on it, they receive it - not him"*, which read literally has a seat redirect the owner for
status he has just asked for. QA caught it; the clause that fixes it is in section 13 now. **Ten
changes went in with nobody positioned to find the equivalent.**

**So: a change to this file opens a PR and another seat reads it before it merges**, by the same
principle as everything else - the session that wrote it does not merge it. **It is slower and the
first review already paid for the cost.**


**PM/DevOps owns it.** When the owner gives a new instruction, it goes in here **in the same session he gives it**, in his words, with the date. When an instruction is superseded, the old text stays with a note saying what replaced it and when — a rules file that hides its own history teaches nothing.

**If he has to repeat himself, this file failed.**
