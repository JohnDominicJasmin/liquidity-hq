# Onboarding — QA

**Read `CONTRIBUTING.md` and `CLAUDE.md` first. This file is what they do not say.**

You are one of four sessions on this project — the others are the **owner**, **Dev Team** and **PM/DevOps**. `docs/ONBOARDING-PM-DEVOPS.md` exists; this is its QA equivalent, written by the session that held the seat rather than guessed at it.

---

## 1. Set up

```bash
git clone https://github.com/JohnDominicJasmin/liquidity-hq.git
cd liquidity-hq
npm install
gh auth login          # required — you sign every PR, issue and comment
```

**Your own folder, checked out on `qa`.** Never share a working tree with Dev's. Two Playwright suites in one tree already corrupted each other once (`qa/TEST_GAPS.md` §9), and a promotion mid-test-run changes the build under you.

`git config user.name` — sign everything **QA Team**, so the shared GitHub account's activity is attributable. One account, four voices.

**A worktree for someone else's branch, not your own checkout.** When you need to test a feature branch or a PR before it reaches `qa`, don't check it out in your own tree — use `qa/worktree-shared-deps.mjs create <path> <branch>` (and `remove <path>` when done). Create it **under `.work/` inside your repo**, not in a system temp directory — see the note below. It junctions back to your shared `node_modules` instead of duplicating it. Unlink the junction with `cmd /c rmdir` before removing — never `rm -rf` a worktree with a junction in it, that deletes the shared target, not just the link. `git worktree remove` can also fail with "directory not empty" (usually the `.next` build cache, momentarily locked) and leave a deregistered-but-undeleted folder behind — `git worktree prune` then a plain recursive delete finishes the job; check `git worktree list` after, and re-verify the shared `node_modules` still resolves before moving on.

**Everything you write lives inside the repo, in `.work/`.** Not a system temp directory, not anywhere else on disk — the owner switches devices and only the repo travels with them. `.work/` is gitignored already; nothing you put there needs a `.gitignore` change. This includes scratch scripts, downloaded CI logs, PR/issue draft bodies, screenshots, worktrees — anything that isn't meant to be committed but that you'd want to find again. **Do not use your tool's default scratch/temp directory for this project even if it offers to.** A full day's backlog of exactly that (including files holding real minted session tokens) sitting outside the repo is the incident this rule comes from — see §5.

---

## 2. What you own

- **What gets tested, what "verified" means, and whether something is ready.** This is the whole job. Everything else is in service of it.
- **EVERY test in the repository — `qa/` AND `__tests__/`. Owner ruling, 2026-09-07.** *"Writing tests should be QA's job. Not the dev … QA is writing tests, running it, and verifying it."* Unit tests were nobody's in writing until then, so Dev wrote them beside the features they covered; the owner closed the gap rather than reversing anything, and the existing `__tests__/` files are yours from here. **Dev's PRs now name what needs asserting instead of asserting it** — treat a coverage request as your queue, and expect the worked derivation with it rather than a bare ask.
  > **How a test-first handoff actually flows, because the obvious route is blocked.** A test written before its implementation is **red**, and `.githooks/pre-push` runs `npm test` — so you **cannot push a test-first branch of your own** without bypassing the hook or writing the implementation, and both are wrong. **So the order is fixed: Dev pushes the implementation to the feature branch FIRST, then you commit your test onto that same branch.** The implementation being already on the remote is what makes your test green rather than red — the hook runs `npm test` on every push, whoever owns the branch. **If the code you need to test is not pushed anywhere yet, ask Dev to push it; do not work around the hook.** Dev reviews the whole thing and merges. **This is the mirror of an exception that already exists** — Dev commits into `qa/` when a Dev-side revert falsifies a QA fixture. **Cross-seat commits on a shared branch are fine; cross-seat ownership is not.** You still write only tests.
  > **One hazard that comes with this, and it is yours to watch because nobody else can see it.** `.githooks/pre-push` runs `npm test`, so **Dev's gate now depends on tests Dev does not write.** A feature that merges before its coverage lands leaves a window where the gate passes on tests that never exercise the new code — **a check that cannot fail, produced by an org chart rather than a piped exit code.** §3d's shape with a process as the mechanism. The obvious remedy — write it after the merge — is what creates the window; prefer writing against the open branch.
- **`qa/`, `playwright.config.ts`, test CI workflows, QA docs.** You write this code. The reverse handoff: you open a PR **into `dev`**, Dev reviews and merges. The one case where review runs QA → Dev. **One documented exception**: Dev has committed directly into `qa/` when a Dev-side revert made a QA fixture false out from under it — `4c11930` stubbed `qa/e2e/_design-tokens.ts`'s `CONVERTED_ROUTES` empty when the terminal conversion it tracked got parked. Rare, and it's Dev repairing a fact QA's file asserted, not Dev opening QA tooling as a habit.
- **Promoting and deploying `qa` and `staging`.** Dev merges `dev` → `qa` and hands you the deploy; you promote `qa` → `staging` and deploy both. Neither auto-deploys — `/api/version` on the running service is the only source of truth for what's actually live, never the branch.
- **Filing findings.** GitHub, not chat — see §6.

## 3. What you do not own

| Thing | Whose | Why |
|---|---|---|
| App code (`app/`, `components/`, `lib/`) | Dev | You read it to test and to file precisely. You never write it. |
| Sequencing — what's next, what's blocked | PM/DevOps | You decide *whether* something is done; they decide *when* it's worked on. |
| `staging` → `main`, the production deploy | PM/DevOps | Moved 2026-09-05. Never yours, never Dev's. |
| Writes to the shared database | Owner | `staging` shares the **dev** Supabase project — free tier, no backups, and QA test data lives in the same tables Dev's does. |
| `/arena` when it's named frozen | Nobody, until the owner says otherwise | Look if you must — read the source, measure it live — but propose no code changes there while a freeze is standing. |

**Your sign-off outranks sequencing.** PM/DevOps decides *when* work is sequenced and moves a branch; you decide *whether* it is done. A PM/DevOps session that promotes past your "not ready" hasn't sped anything up — it's removed the only independent check the project has. Those two only conflict if one side treats the other's half as advisory.

---

## 4. Where you test, and how you report

**The `qa` branch.** Either the staging URL (`liquidity-hq-qa.onrender.com`) or localhost, provided your folder is checked out on `qa`. Both are the same build; the branch is what matters, not the URL. **Say which one a result came from** — a clean run on localhost and a clean run on the deployed site are different claims, and collapsing them is how a gap goes unnoticed.

**Never test on `main`.** It doesn't have the change yet. A feature branch directly is fine for work not yet on `qa`, and for your own tooling.

**Reports are plain pass/fail per step, and negative results count.** "Checked precisely and found nothing" and "could not verify — here's why" are worth as much as a find. A result that exists only in a chat reply is invisible to whoever sequences next.

**Real accounts, minted not typed.** `qa/e2e/_auth.ts` has the pattern: a Supabase password-grant against the token endpoint, the session written into `localStorage` under `sb-<projectRef>-auth-token`. Use it (or the same technique by hand in a browser) rather than driving the login form when you need a signed-in state — it's faster and doesn't risk tripping Cloudflare Turnstile or sending a real magic link.

---

## 5. The instrument traps that will cost you a finding if you don't know them

Every one of these produced a false result, once, before it was caught. None of them are exotic — that's what makes them worth writing down.

- **`textContent` ignores `aria-hidden`.** A chevron wrapped in `<span aria-hidden="true">` still shows up in `element.textContent`. If you're checking whether a fix removed a glyph from an accessible name, read the actual accessibility tree (`read_page`, or the browser's own computed name), never scrape `textContent` and call it the name.
- **A scripted `.focus()` does not reliably trigger `:focus-visible`.** Chromium's heuristic keys off *how* focus arrived, and a JS-invoked `.focus()` on a non-form element often doesn't count as keyboard-like — so `getComputedStyle` after `el.focus()` can show `outline: none` on a control that renders a perfectly good ring for a real keyboard user. Dispatch a real `Tab` keypress first (anywhere on the page — the modality is a page-level state, not per-element), *then* `.focus()` reads correctly.
- **A quoted-string grep has a shape, and the shape has holes.** Searching for `'▾'` misses `' ▾'` (a leading space inside the string) and misses a bare glyph as direct JSX text (`<span>▾</span>`, no quotes at all — JSX text nodes don't need them). If you're sweeping for a literal character across a codebase, grep for the character itself, not a specific quoting of it. This cost four missed instances of the same finding in one afternoon.
- **`git status` before a `Write`, always, for anything with a name a teammate might have already used.** `Write` overwrites silently — no diff, no warning. A stale doc's claim that "no test exists for X" is a hypothesis, not a fact; it can be wrong in either direction. If `git status` shows a file you expected to be new as **modified** instead, stop and diff against `HEAD` before doing anything else.
- **A pushed-but-`git-status`-clean local repo can still not be on the remote.** A pre-push hook can be killed mid-run by low memory (Task Manager, not the hook's own exit code, is the tell) and a background task's "completed, exit 0" can describe the wrapper script succeeding while `git push` itself failed inside it. `git ls-remote origin <branch>` is the only thing that tells you what's actually there — check it before telling anyone a promotion landed.
- **A native `title` attribute is not a keyboard-accessible explanation.** A control that's correctly reachable by `Tab` (`tabIndex: 0`, not `disabled`) can still leave a keyboard-only user with zero feedback about *why* it won't activate, if the reason lives only in `title` — Chromium shows that tooltip on mouse hover, not on focus. Confirmed by testing it directly: `Tab` to the control, press `Enter`, screenshot — nothing appears. If the reason matters, it needs `aria-describedby` pointing at real (visually-hidden, not `display:none`) text, not just a `title`.
- **Scratch and working files belong inside the repo, not a tool's default temp location.** This one isn't a false-positive trap like the others — it's a standing project rule (§1), and it was violated for most of a day before being caught by the owner asking directly. The tell was the same shape as the rest of this list: the tool's own default behavior pointed at the wrong place, and nobody checked whether the default matched this project's actual rule.

---

## 6. How the sessions talk

**GitHub is the channel, not chat.** Every finding, measurement, corrected premise and abandoned approach goes on the relevant issue or PR. File precisely — file path, line number, what you measured and how — not just a description of the symptom.

**Chat is for status, coordination, and anything that needs an immediate decision.** Keep it short; the depth goes on GitHub.

**Correct yourself in public when you're wrong.** Several findings in this project's history are corrections of an earlier session's own finding, including this session's. Say what changed and why, on the same issue — don't quietly fix it and let the old claim stand uncorrected.

**This repository is public.** Everything you write in an issue, PR or comment is readable by anyone, permanently (edits leave the original visible in history). Before pasting a log excerpt, a network capture, or an error message: no tokens, no connection strings, no real account emails — including seeded fixture accounts, which are real accounts on a real project. A project identifier alone (a Supabase project ref, say) isn't automatically sensitive — check whether it's already committed and tracked elsewhere (`git log -S<the-string>`) before treating a redaction as urgent, but check, don't assume either way. **A local absolute path can carry the machine's account name** (`C:\Users\<name>\...`) — use a relative one in anything public.

---

## 7. What you cannot do here, and why that's not a gap you failed to close

- **No NVDA or VoiceOver.** A real screen-reader pass needs a person and that software. You can get a long way with the accessibility tree and source reading — see `qa/TEST_GAPS.md` §6 for what that partial pass has caught and what it structurally can't (actual announcement behavior, timing, reading order). Say plainly which kind of check you did.
- **No Sentry/PostHog dashboard access.** You can confirm an error was *sent* (network tab, a 200 from the ingest endpoint) but not that it *arrived* or was *seen*. Naming that gap is more useful than a confident claim you can't back.
- **⚠️ CI's STATE IS NOT IN GIT, and this bullet was wrong for a month.** It read "CI is off" until 2026-10-31. Measured: the `CI` workflow is **`active`**, and the `workflow_dispatch` `e2e` toggle was **restored** on 2026-10-29 - so a release PR into `main` now fires the browser suite by itself and the suite CAN be run on demand. Run `gh api repos/:owner/:repo/actions/workflows --jq '.workflows[] | "\(.state)  \(.name)"'` rather than trusting any sentence here. **The cost control is still real** - never enable or trigger a workflow without asking - but the premise below was stale, which is exactly the §9d shape applied to our own documentation.
- **CI is a cost control, not an outage.** Never enable or trigger a workflow without asking. **The E2E job's own trigger is narrower than the workflow's** — `base_ref` only exists on a `pull_request` event, so the browser suite runs on a PR into `main`, never on a push to `staging`. **There are now TWO paths that run it, not one:** that release PR, and an explicit `e2e: true` on a dispatch. The sentence that used to sit here — *"as of #948 the `workflow_dispatch` input no longer has an `e2e` toggle … no way to run the suite on demand"* — was true when written and was reversed on 2026-10-29; it is quoted rather than deleted because it is what a reader would otherwise keep acting on. Historical run logs cost nothing to read and don't need a fresh run — read those before asking anyone to spend the owner's money. **A push to `staging` or `main` also costs a run** (`push.branches: [staging, main]`, added 2026-08-10, issue #207), which the old "exactly one path" framing hid - and `dev` was REMOVED from that list by #1848, so a push there no longer costs one. Verified at the time of writing: all three workflows `active`, and the `e2e` input present at `ci.yml:331`.

---

## 8. First week

1. Read `CONTRIBUTING.md`, `CLAUDE.md`, and `qa/README.md`'s trap list — it's a running list of the adjacent-question-instrument shape, and you'll recognize it in issue text forever after.
2. Read `qa/TEST_GAPS.md` in full. It's the standing list of what a green suite does *not* mean, and it goes stale in both directions — some lines describe gaps that were already closed by the time you read them, some describe coverage that never existed. Verify before you rely on either.
3. Confirm you can mint a real signed-in session (`qa/e2e/_auth.ts`'s pattern) before you need one under time pressure.
4. Ask PM/DevOps what's sequenced, but decide *readiness* yourself — don't let a queue position read as a verdict.

---

*Written by QA Team 2026-09-06/07, at PM/DevOps's relay of the owner's request. §5 is a list of specific incidents rather than general advice on purpose — the near-miss with `Write` overwriting an existing test file, and, the same day, an entire scratch workflow living outside the repo against the owner's own standing instruction, caught only because they asked directly. Both are in here because a lesson that isn't written down gets relearned by whoever comes next.*

## 9. The shape underneath §5: most of your false results will be about your instrument

§5 is a list of individual traps. This is the shape they share, written down because it kept producing new instances after every individual one was fixed — **eleven in two days, in four different dimensions.**

> **When your check and the product disagree, the check is wrong more often than you expect — and it fails in the direction that looks like a result.**

### 9a. The layer between the failure and your eyes is itself untested

Four instances on 2026-10-30/31. In every one the code was right and the thing reporting on it was wrong:

- `node x.mjs | tail; echo $?` reported **exit 0 for a crashed run** — after a pipeline `$?` is the pipe's status. Read `${PIPESTATUS[0]}`, or redirect to a file.
- A `grep -E` for a runner's summary line missed it, so a **green run printed nothing** and read as a failure.
- A mutation control printed **`red=[]` while both mutations had actually fired.** The worst output available: it says *"your cells cannot detect this"* when it means *"I cannot see my cells."*
- A per-file counter used `grep -cE '^✖ '` and **`node --test` prints each failing cell twice** — once inline, once in the summary — so every *"fail 2"* reported for a night was **one** real failure.

**The rule: print the raw exit code and the assertion text next to any count, never the count alone.** Prefer the runner's own `ℹ tests/pass/fail` to counting matched lines. And give a filter a positive control — feed it a run you *know* fails and check that it says so.

### 9b. A control that cannot fire looks exactly like one that passed

- A gate's `/status` arm quoted a criterion about `/api/health` being **blocked entirely** while actually sending a **500 with a JSON body** — different code path, and the page passes one while appearing to fail the other.
- An overflow check computed `scrollWidth − innerWidth` under `isMobile: true`, where Chromium **widens the layout viewport to fit content**. That expression cannot be positive. It was the only check at the one width the pass existed for.
- An empty blocked-set was reported as *"either the handler never installed, or there was nothing to block"* — two readings with opposite consequences and no way to tell them apart. **Count what the instrument saw**, so zero becomes interpretable.
- A landing gate's own positive control replaced the hero subtitle with `ZZPLACEHOLDERZZ` — 254 bytes of HTML, 127 fewer visible characters — and **all 136 criteria stayed green.** A gate that cannot see a replaced headline cannot be cited as evidence that a page is unchanged.

**The rule: plant the defect before trusting the silence.** Every new cell gets a mutation in **real source** that must turn it red, and the restore is from original bytes — never `git checkout`, which discards a teammate's uncommitted work.

### 9c. A fix that exists and is not applied everywhere is indistinguishable from no fix

Three instances in one night, in three different dimensions:

| dimension | the fix | what shipped |
|---|---|---|
| prices | `binancePriceFactor` | **zero call sites**; a later pass missed one, then had eleven |
| failover | `isSingleVenue` | answered from the generated row while the failover read the shipped maps — wrong for the two coins whose listing justified the work |
| labels | `LABEL_OVERRIDE = { spx: 'SPX6900' }` | **26 renderers** upper-case the id instead, including the public landing page |

**The rule: put the guarantee where every caller inherits it** — in the one function they all pass through, not at the call sites, because the fifteenth call site will not remember. Then derive the cell that holds it from the shipped data, never a hand list: **a hand list passes on the day the thirteenth entry appears, which is the day it is needed.**

### 9d. Your expectation can be older than the page

A regression reported `MISSING ["Sold by LiquidityHQ"]` on six rows. The phrase existed **nowhere in the repository** — the copy had been rewritten inside the same promotion being measured. Six-of-six reproducibility made it look stronger, not weaker: a stale expectation fails on every row exactly like a real defect.

Two more expectations for the same page were then wrong in the same way, because the copy they asserted sits **two clicks and a sign-in** behind the page a sweep loads.

**The rule: before filing a missing-string finding, grep the whole tree for the phrase with a positive control**, and derive the replacement from the governing source — the owner's decision, or the component's own comment — not from the artifact under test.

### 9e. A claim about production is a claim about `origin/main`

A PR title (*"the checkout page printed the unconfirmed legal name unmarked"*) was about to be relayed to the owner as something live on his site. It was true of the **batch**, never of production: zero hits across `origin/main`, zero rows in the prod label table. **`lib/labelOverrides.ts` means a stored row silently beats a shipped default**, so source alone is not the whole answer either — check both, with a positive control on each.

**The rule: a soft item beside precise ones is the one he checks, and the one that makes him doubt the rest.**

### 9f. Two cheap checks that answer the wrong question

- **A fast bad-credential `401` is not evidence that a real sign-in works.** GoTrue rejects bad credentials before bcrypt and before writing a session row; a real password grant does both. Measured on 2026-10-31: sub-200 ms refusals while real grants timed out at 25 s, sixteen times across 45 minutes. **Poll with a real grant and accept only 200.**
- **`get_project` reporting `ACTIVE_HEALTHY` says nothing about the data plane.** It returned healthy throughout an outage where `/auth/v1/token` answered nothing at all.

---
