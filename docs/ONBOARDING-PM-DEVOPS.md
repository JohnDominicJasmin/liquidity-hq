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

- **Deploys** for `liquidity-hq-dev`, `liquidity-hq-qa`, `liquidity-hq-staging` — via the Render MCP tools.
- **Branch promotion**, per the flow in `CONTRIBUTING.md`.
- **CI workflows** — enabling and disabling, and watching what they cost.
- **Environment variables** on non-production services.

---

## 3. What you do not own

| Thing | Whose | Why |
|---|---|---|
| App code (`app/`, `components/`, `lib/`) | Dev | You read it to sequence. You never write it. |
| Test code (`qa/`, `playwright.config.ts`) | QA | Same rule, other direction. |
| **The sign-off** | **QA** | You can move a branch and press deploy. "This is verified" is not yours to say. |
| Merging to `main` | QA, owner-approved | One of three hard gates. |
| Production deploys | QA, owner-approved | Second hard gate. |
| Writes to the shared database | Owner | Third. Prod Supabase is free-tier with **no backups**. |

**The three hard gates do not move because a session was added.** An owner decision that arrives relayed through another session gets confirmed with the owner directly before you act on it.

---

## 4. Read the code. This is the part that matters most.

**You will be tempted to sequence from issue titles. Do not.** On 2026-09-05, three items were wrong in ways only reading code could catch:

- **#843** read as *"the Arena rail is 320px where the spec says 352."* A 32-pixel styling slip. It is not. `components/ArenaTerminal.tsx` **does not exist** — 1,212 lines removed by the `dd39c9bb` revert, with `ccefc0de` later restoring 939 lines of CSS and never the component. So 66 `at-*` classes style markup nothing emits, `352` is *already* in the stylesheet, and the 320 measured belongs to the current design's Arena. Found with `git log --all --diff-filter=A`, not by reading the issue.
- **#846** listed five duplicate control names. **Three were not defects** — the detector read `innerText` before `aria-label`, so every `<Tip>` glyph collided with every other. Needed reading `components/Tip.tsx` to know.
- A finding about a footer hover state was reported, agreed by two sessions, and **the element does not render in that design at all.**

A PM sequencing off those titles would have prioritised fixing a rail width, which is precisely the option the owner rejected — a check made to pass without making the thing true.

**So: before sequencing an issue, read the module it names.** `git log -S`, `--diff-filter=A` and a grep are usually enough. An hour of this saves a day of building the wrong thing.

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

| Service | ID | Branch |
|---|---|---|
| `liquidity-hq-qa` | `srv-d9p42ke1egvs73f8car0` | `qa` |
| `liquidity-hq-staging` | `srv-d9qskniju40c73brtqgg` | `staging` |
| `liquidity-hq-dev` | `srv-d8prs6po3t8c739aepdg` | `dev` — **ask first**, ~500 build-hour/month cap |
| `liquidity-hq-prod` | `srv-d8aluf6l51nc73e1ijp0` | `main` — **not yours** |

Workspace `tea-d6e4ecv5r7bs73be1t10`.

**The handshake you must not drop.** `CONTRIBUTING.md` ties promotion and deploy together deliberately. Splitting them across sessions is exactly what creates the failure above. So: **whoever moves a branch says so immediately, and the deploy follows immediately.** If you deploy, tell QA the moment `/api/version` confirms it — QA cannot verify a build it does not know is live.

---

## 7. CI costs real money

**Read `.github/workflows/ci.yml`'s header before touching a trigger.** Three days in August burned 1,755 Actions minutes on a 2,000/month allowance and hard-stopped CI mid-release.

- The ~2 minute gate job runs on everything.
- The **~1 hour browser suite runs on exactly one automatic trigger** — a PR into `main`.
- The owner switches workflows on for a release and off again. Treat "disabled" as a cost decision, not an outage, and **never enable or trigger without asking.**

**Two things that will mislead you, both confirmed 2026-09-05:**

`gh workflow list` reports all three workflows `active` regardless. It cannot tell you whether they will run.

The release PR **does not open itself**. `release-signals.yml:65` is gated on `vars.RELEASE_PR_PAUSED != '1'`, and that variable has been `1` since 2026-08-09. Unsetting it restores the automation. Until then, **whoever pushes `staging` checks a release PR exists and opens it by hand.**

There is also a genuinely unexplained gap — **zero workflow runs of any kind between 2026-08-13 and 2026-09-05**, 23 days. The pause variable gates one job in one workflow and cannot account for it. Recorded as unexplained rather than guessed at; two sessions have already produced one wrong explanation each.

---

## 8. Where the release stands right now

**Do not onboard into a live release.** The owner's instruction is that this ships first, then you start. This section is so you can read the board on day one, not so you can act on it.

```
main      1ee554e   v2026.09.03   ← production, liquidity-hq.com
staging   9cefa0b                 ← stale, needs re-promotion from qa
qa        d1fed3d                 ← current candidate, verification in progress
dev       d1fed3d
```

**267 commits, 98 merged PRs, zero migrations.** One new environment variable, `SPIKE_ALERT_RECIPIENTS`, already set on prod.

**The headline is a design flip, not a feature.** `7435d87` makes the terminal design the default on every route, on the owner's own instruction. Production currently serves the previous design; after this release every visitor gets terminal. That is intended, and `?design=current` remains a rollback needing no deploy.

Remaining sequence:

1. Finish verification on `qa` — full sweep, four specs, contrast baseline re-record
2. Promote `qa` → `staging`, deploy, verify against `/api/version`
3. Open the release PR by hand (see §7) — the browser suite runs on it, ~1 hour
4. Merge to `main`, deploy prod, verify, tag `v2026.09.05`
5. Switch the three workflows back off — the owner asked for this explicitly

**Open and not blocking this release:** #850 (a keyboard-dead tooltip), #853 (rebuild `ArenaTerminal.tsx`), #852 and #855 (docs). **#843 closes into #853.**

**Two things unverified and honest about it:** the rotated Grok API key reports `configured: true`, which is presence and not validity — confirming it costs one real paid AI call per environment, and needs a signed-in session. And the grade-F health badge fix cannot be closed until a coin actually grades F while someone is looking.

---

## 9. How the sessions talk

**GitHub is the channel, not chat.** Every finding, measurement, corrected premise, cost number and abandoned approach goes on the issue or PR. A result that exists only in a chat reply is invisible to whoever sequences next — which will be you.

**Negative results count.** What was measured and showed nothing, and what could not be verified, are worth as much as the successes. Otherwise the next session re-derives them. Several entries in `qa/README.md` exist only because someone wrote down a wrong number and why it was wrong.

**The owner mostly watches QA's session.** They do not want to be the relay between sessions, and they have said so four separate times. Route work between sessions directly; take to the owner only decisions that are genuinely theirs — credentials, product scope, cost, and the three hard gates.

**Keep messages to the owner short.** Few lines. The depth goes on GitHub.

---

## 10. First week

1. Read `CONTRIBUTING.md`, `CLAUDE.md`, `qa/README.md`'s trap list, and `docs/HANDOVER.md`.
2. Read `qa/TEST_GAPS.md` — the standing list of what is **not** covered. "313 tests passed" reads like "the product works" and does not.
3. Read `.github/workflows/ci.yml`'s header comment in full before touching any trigger.
4. Watch one release end to end without driving it.
5. Ask which of QA's current duties transfer on which date. Do not assume — QA is currently doing several jobs, and an unannounced handover drops the one nobody claimed.

---

*Written by QA Team, 2026-09-05, at the owner's request. Dev Team should review anything here that describes their side.*
