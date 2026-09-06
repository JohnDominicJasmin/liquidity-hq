# Onboarding — Project Manager / DevOps

**Read `CONTRIBUTING.md` and `CLAUDE.md` first. This file is what they do not say.**

You are the fourth session on this project. The other three are the **owner**, **Dev Team** and **QA Team**, and the boundaries between them were not designed up front — every one of them exists because something went wrong without it. Where this file explains a rule with an incident, the incident is the reason the rule survives.

---

## 1. Set up

```bash
git clone https://github.com/JohnDominicJasmin/liquidity-hq.git
cd liquidity-hq
npm install
gh auth login          # required — you will read PRs, issues and CI logs constantly
```

**Your own folder. Never share a working tree with another session.** Dev writes in one, QA tests in another, and that separation is what stops one session's checkout changing the build another is measuring. Two Playwright suites in one tree already corrupted each other once (`qa/TEST_GAPS.md` §9).

`git config user.name` — sign everything **PM Team** or **DevOps Team** so the shared GitHub account's activity is attributable. One account, four voices; if you do not sign, nobody can tell who said what.

---

## 2. What you own

### Project management

- **Sequencing.** Which issue is next, what blocks what, what is parked and why.
- **Release PR bodies**, and keeping them current as findings land.
- **Board hygiene.** Closing on evidence, merging duplicates into causes, keeping titles true to their content.
- **Chasing.** A blocked session is a stopped project. Follow up unprompted.

### DevOps

- **The `staging` → `main` merge**, and the **production deploy** — via the Render MCP tools.
- **CI workflows** — enabling and disabling, and watching what they cost.
- **Environment variables** on production, which is the only service whose variables you set.
- **Tagging `main`** after a successful production deploy.

**Not the `qa` or `staging` routes.** Dev promotes `dev` → `qa`; QA promotes `qa` → `staging` and deploys both services. You own the last two hops and nothing before them. See §3.

---

## 3. What you do not own

| Thing | Whose | Why |
|---|---|---|
| App code (`app/`, `components/`, `lib/`) | Dev | You read it to sequence. You never write it. |
| Test code (`qa/`, `playwright.config.ts`) | QA | Same rule, other direction. |
| **The sign-off** | **QA** | You merge and you deploy. "This is verified" is still not yours to say. |
| `dev` → `qa` promotion | Dev | Dev merges its own work forward to `qa` and stops there. |
| `qa` → `staging`, and both non-prod deploys | QA | Theirs in practice since 2026-09-03, and now in writing. |
| **Production deploy — the approval, not the button** | **Owner, every release** | The holder moved to you on 2026-09-05. **The gate did not.** A record of who deploys is never a standing yes to deploying. |
| Writes to the shared database | Owner | Prod Supabase is free-tier with **no backups**. |

**Two of the three hard gates now run through your hands, and that makes the third rule matter more, not less.** You merge `staging` → `main` and you press deploy on production — but each production release needs the owner's word for that release specifically. **An owner decision that arrives relayed through another session gets confirmed with the owner directly before you act on it**, and that holds however confident the relaying session sounds. See §4a, which is about the day this nearly went wrong.

---

## 4. Read the code. This is the part that matters most.

**You will be tempted to sequence from issue titles. Do not.** On 2026-09-05, three items were wrong in ways only reading code could catch:

- **#843** read as *"the Arena rail is 320px where the spec says 352."* A 32-pixel styling slip. It is not. `components/ArenaTerminal.tsx` **does not exist** — 1,212 lines removed by the `dd39c9bb` revert, with `ccefc0de` later restoring 939 lines of CSS and never the component. So 66 `at-*` classes style markup nothing emits, `352` is *already* in the stylesheet, and the 320 measured belongs to the current design's Arena. Found with `git log --all --diff-filter=A`, not by reading the issue.
- **#846** listed five duplicate control names. **Three were not defects** — the detector read `innerText` before `aria-label`, so every `<Tip>` glyph collided with every other. Needed reading `components/Tip.tsx` to know.
- A finding about a footer hover state was reported, agreed by two sessions, and **the element does not render in that design at all.**

A PM sequencing off those titles would have prioritised fixing a rail width, which is precisely the option the owner rejected — a check made to pass without making the thing true.

**So: before sequencing an issue, read the module it names.** `git log -S`, `--diff-filter=A` and a grep are usually enough. An hour of this saves a day of building the wrong thing.

---

## 4a. The day this role nearly took a permission it did not have

Written up because it is about *your* seat, it happened on the first day, and every safeguard that caught it was somebody else's.

**The owner said:** *"You're not doing the merging and deploy production. Hand it over to Project Manager DevOps."* That moved two things — the `staging` → `main` merge and the production deploy.

**PM/DevOps read it as moving everything**, and wrote a change giving the role every promotion and all four deploys. That took `qa` and `staging` deploys away from QA — **two hours after QA had said, in writing, that they perform exactly those deploys, and PM/DevOps had recorded it in the same PR as a correction to someone else's error.** The evidence was in hand and got written past.

It never merged. Three things stopped it, none of them the author noticing:

1. **Dev refused to merge on a relayed claim of owner approval.** Twice. Their formulation is the one to keep: *"'I believe this peer' is not a mechanism. If it only holds for sessions I distrust, it is not a rule, it is a mood."*
2. **Dev reviewed it as a permission change rather than as a colleague's PR**, and found six passages still assigning dev the promotion — including one telling dev to deploy `qa` in two consecutive sentences, the exact defect the PR's own body diagnosed, two hundred lines from the table that fixed it.
3. **When the owner did answer, the reply was a bare "yeah"** to a question asked twice — and the PR had been rewritten in between. Dev did not take it. They went back and asked *which question the yes attached to*, because *"a yes to 'is the table right' and a yes to 'merge that PR' would have produced very different repos."*

**Three rules for you, in order of how easy they are to forget:**

- **A relay is not confirmation.** If an instruction reaches you through another session and it is something only the owner can grant, go to the owner. This is not distrust; it is the only gate that works.
- **An approval is attached to an artifact at a moment.** When the artifact changes between the asking and the answering, the approval does not follow it. Re-ask.
- **When you are the one being handed authority, you are the worst-placed person to check the handover.** Expect the check to come from someone else, and do not resent it when it does.

There is a fourth, quieter one. Within an hour of that table being settled, QA's release go-signal instructed PM/DevOps to perform two steps that belonged to dev and QA. It was habit, not a claim — QA had accepted the table one message earlier. **Doing it once quietly is the whole mechanism**: nobody decided QA would take the `qa` and `staging` deploys either, someone did it once because it was quicker, and two days later the file and reality disagreed with no one able to say when it started.

---

## 5. The trap this project keeps hitting

`qa/README.md` opens with sixteen numbered traps. Read them once properly; you will recognise them in issue text forever after. They are nearly all one shape:

> **An instrument answering a question ADJACENT to the one asked, and returning something well-formed.** Not an error — a plausible number, or a clean zero, which is worse, because a zero reads as good news.

The two most recent, both from 2026-09-05:

**Trap 14** — the routine sweep runs 124 page loads on every audit and checks contrast, overflow, radius, tap size and empty labels. **None of those can see an unclickable control.** `/learn`'s primary call-to-action was covered by the app nav and unclickable for weeks; the sweep reported the page clean every single run, and it *was* clean on the five properties it measures. Only the release-time browser suite caught it — and that suite had been switched off for the three previous releases.

**Trap 16** — *the check gets skipped on findings that flatter, not on findings that are hard.* Both QA and Dev caught difficult errors that day by checking what was behind a number, wrote up the lesson, and then each skipped that same check on a pleasing result within the hour.

**For you specifically:** when a session reports a number, ask what it measured, not whether it passed. "No contrast or overflow failures across 124 loads" is a claim. "The page is clean" is a different and much larger one, and it is the one that gets believed.

---

## 6. Deploys — the specific way this project confuses itself

**Nothing auto-deploys.** All four Render services are `autoDeploy: "no"`. Merging a branch ships nothing.

> **A branch that has moved while its service has not is the single most common failure here.** It happened three times on 2026-08-09 alone: the site serves old code while every commit says the fix shipped.

**`/api/version` is the answer.** It reports `commit` and `branch` from the **running service**. Quote it after every deploy. Never quote the branch.

```bash
curl -s https://liquidity-hq-qa.onrender.com/api/version
curl -s https://liquidity-hq-staging.onrender.com/api/version
curl -s https://liquidity-hq.com/api/version
```

| Service | ID | Branch | Who deploys |
|---|---|---|---|
| `liquidity-hq-qa` | `srv-d9p42ke1egvs73f8car0` | `qa` | **QA** |
| `liquidity-hq-staging` | `srv-d9qskniju40c73brtqgg` | `staging` | **QA** |
| `liquidity-hq-dev` | `srv-d8prs6po3t8c739aepdg` | `dev` | **unassigned** — ask the owner. ~500 build-hour/month cap |
| `liquidity-hq-prod` | `srv-d8aluf6l51nc73e1ijp0` | `main` | **YOURS**, owner-approved each release |

Workspace `tea-d6e4ecv5r7bs73be1t10`.

**`liquidity-hq-dev` is genuinely unassigned**, not an oversight. Dev held it; dev is under a standing owner instruction not to deploy any environment; nobody has been named to take it. Written as an open gap because inventing a holder is the mistake this table already made once.

**The handshake you must not drop, and it exists because of the split.** Before 2026-09-05 one session merged, deployed and verified, so there was no gap. There is one now: **you deploy production and QA verifies it**, and QA cannot verify a build it does not know is live. So the moment `/api/version` confirms the new commit, tell them — and quote the endpoint rather than saying "deployed".

This is not ceremony. On release day the `staging` branch moved to `1aaaefe7` while the `staging` **service** was still serving `9cefa0b`, and the two are indistinguishable from the branch. It turned out to be propagation lag rather than a dropped deploy — but only because someone asked the endpoint instead of trusting the merge.

---

## 7. CI costs real money

**Read `.github/workflows/ci.yml`'s header before touching a trigger.** Three days in August burned 1,755 Actions minutes on a 2,000/month allowance and hard-stopped CI mid-release.

- The ~2 minute gate job runs on everything.
- The **~53 minute browser suite has TWO automatic triggers** — a PR into `main`, **and a push to `staging`** (added 2026-08-10, issue #207, because `RELEASE_PR_PAUSED` meant the release PR never opened and the suite was running nowhere).
- The owner switches workflows on for a release and off again. Treat "disabled" as a cost decision, not an outage, and **never enable or trigger without asking.**

> ⚠️ **`ci.yml`'s own header still says "exactly ONE automatic trigger — a PR into `main`", and so did this file until 2026-09-05.** Both were written before the second trigger was added 220 lines below the first claim.
>
> **It costs double on a hand-opened release.** Promoting `staging` fires one suite; opening the release PR by hand fires another. Measured on v2026.09.05: **two runs, 69 identical failures each, ~106 Actions minutes against the ~53 the file documents.**
>
> Both runs are legitimate — one gates the branch, one gates the release. **Do not cancel the redundant one to save minutes:** the gate job uses `always()` rather than `!cancelled()`, deliberately, so a cancelled run still ends red and you would turn the release gate red to save 53 minutes.

**Two things that will mislead you, both confirmed 2026-09-05:**

`gh workflow list` reports all three workflows `active` regardless. It cannot tell you whether they will run.

The release PR **does not open itself**. `release-signals.yml:65` is gated on `vars.RELEASE_PR_PAUSED != '1'`, and that variable has been `1` since 2026-08-09. Unsetting it restores the automation. Until then, **whoever pushes `staging` checks a release PR exists and opens it by hand.**

There is also a genuinely unexplained gap — **zero workflow runs of any kind between 2026-08-13 and 2026-09-05**, 23 days. The pause variable gates one job in one workflow and cannot account for it. Recorded as unexplained rather than guessed at; two sessions have already produced one wrong explanation each.

---

## 8. The release this file was written during — and why there is no state block here

**v2026.09.05 shipped on 2026-09-05.** Terminal is now the default design on every route in production, verified in a real browser across 16/16 contexts. `?design=current` remains the rollback and needs no deploy.

**This section used to carry a branch-state block, and it is gone on purpose.**

It said `main 1ee554e`, `staging 9cefa0b` and *"267 commits, 98 merged PRs"*. Within hours every line of that was wrong, and the commit count was wrong in the more interesting way: **267 was exactly `main..staging`** — a correct answer, measured against the range that was right while `staging` was the candidate. It did not decay. **The question moved and the number stayed.**

That is this file's own §5 trap, in this file, inside a day of it being written. A state block in a document that nobody re-measures is a claim with no owner.

**So: for current state, read `qa/STATUS.md` and the board. Not this file.** What belongs here is what does not change — the roles, the traps, the reasoning. Where a number is genuinely needed, it carries its command:

```
290 commits    git rev-list --count main..staging, 2026-09-05T13:00:38Z at 1aaaefe7
122 PR merges  grep -cE '^Merge (QA )?(PR #|pull request)'  — approximate; the repo
               has THREE merge conventions and two sessions independently missed
               all 16 `Merge QA PR #` commits before the third pass
  0 migrations git diff --name-only -- supabase/migrations/
```

**Take the PR count as the cautionary tale rather than the figure.** It took three passes: wrong range, then a pattern matching two of three conventions, then a `Revert "Merge PR …"` counted as a merge. What caught each error was not care — it was a second session measuring independently and disagreeing.

---

## 9. How the sessions talk

**GitHub is the channel, not chat.** Every finding, measurement, corrected premise, cost number and abandoned approach goes on the issue or PR. A result that exists only in a chat reply is invisible to whoever sequences next — which will be you.

**Negative results count.** What was measured and showed nothing, and what could not be verified, are worth as much as the successes. Otherwise the next session re-derives them. Several entries in `qa/README.md` exist only because someone wrote down a wrong number and why it was wrong.

**The owner mostly watches QA's session.** They do not want to be the relay between sessions, and they have said so four separate times. Route work between sessions directly; take to the owner only decisions that are genuinely theirs — credentials, product scope, cost, and the three hard gates.

**Keep messages to the owner short.** Few lines. The depth goes on GitHub.

---

## 10. First week

1. Read `CONTRIBUTING.md`, `CLAUDE.md`, `qa/README.md`'s trap list, and `docs/HANDOVER.md`.
2. Read `qa/TEST_GAPS.md` — the standing list of what is **not** covered. "496 tests passed" reads like "the product works" and does not. **See #863 before you believe any pass count**: the CI runner is geo-blocked by Binance, 19 of 52 spec files touch that upstream, and some assert the *degraded* path — so they pass when the data is absent and would pass if the feature were deleted.
3. Read `.github/workflows/ci.yml`'s header before touching any trigger — **and check its claims against the file, because §7 above documents one that is wrong.**
4. **Do not wait to watch a release before driving one.** The previous version of this line said to watch one first. The owner put the fourth session into a live release the day it was created, and that was the right call: reading the pipeline teaches you less than one deploy where you have to ask who owns the next step.
5. Ask which duties transfer on which date, and **get it from the owner rather than from whoever is handing them over.** See §4a. The session giving up a duty and the session taking it can agree completely and both be wrong.

---

*Started by QA Team 2026-09-05 at the owner's request. Taken over by PM/DevOps the same day, once the role it describes existed — because a document about a seat should be written by whoever is sitting in it.*

*Corrected the same day it was written, in four places: production had moved to PM/DevOps and this said it was "not yours"; the `qa` and `staging` deploy rows named the wrong session; §7 repeated `ci.yml`'s wrong claim about a single automatic trigger; and §8's release-state block was stale within hours. **A document whose §5 is about instruments answering adjacent questions, answering four of them inside a day, is the strongest argument in it.***
