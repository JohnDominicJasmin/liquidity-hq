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
`main`, **production deploys**, **writes to the production database**, his money,
and visual sign-off. Everything else, decide it.

**The production database write is the one with no recovery** - prod Supabase is on
the free plan and has no backups. Dev-side migrations are PM's to sequence (his
ruling, 2026-10-23); production never is.

> *"Decide basic, ask hard, document everything."*

---

## 4. HIS MACHINE IS NOT OUR BUILD SERVER

> *"THE HEAVY LONG RUNNING BG TASK PUT IT IN CLAUDE CLOUD FROM NOW ON."* — 2026-10-22, in capitals
> *"My laptop is unusable... I can't use it on my day-to-day basis."* — 2026-10-23

**All execution runs in the cloud runners. Nothing heavy runs on his laptop. Ever.**

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

---

## 8. WHAT "CLOSED" MEANS

> owner's definition, 2026-09-10

An issue — or a checkbox — closes only when **all five** hold:

1. QA tested it. 2. QA audited it. 3. It passed manual testing. 4. **PM audited it.** 5. **If it is visual, the OWNER approved it.**

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

## Keeping this file true

**PM/DevOps owns it.** When the owner gives a new instruction, it goes in here **in the same session he gives it**, in his words, with the date. When an instruction is superseded, the old text stays with a note saying what replaced it and when — a rules file that hides its own history teaches nothing.

**If he has to repeat himself, this file failed.**
