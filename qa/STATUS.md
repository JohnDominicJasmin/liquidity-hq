# Where the project is

**One page. If you only read one thing, read this.**

Kept current by QA. Last updated **2026-08-08**.

If the date above is more than a day old, treat every number below as stale and
check the branches yourself — a status doc nobody updates is worse than none,
because it reads as current.

---

## Right now

| | |
|---|---|
| **Live in production** | `ec171db`, tagged `v2026.08.08`, verified on the live build |
| **Production deploys** | 🛑 **HALTED by the owner.** Nothing merges to `main` or deploys until they lift it |
| **Parked on `staging`** | 17 commits — release PR **#121**, gate red until #130 + #124 land |
| **Waiting on `qa`** | 6 commits / 3 PRs |

**One-line version:** production is healthy and frozen on purpose. The queue is
growing because the freeze stops promotion, which is the expected cost, not a
fault.

---

## Waiting on the OWNER — nothing moves on these without them

| | What | Blocks |
|---|---|---|
| **#126** | PAT, or drop the auto-opened release PR. A bot-created PR never runs CI — the check is **absent, not failing**, so the PR is unmergeable with nothing red to explain why | every release after the halt |
| — | **LemonSqueezy test-mode keys.** Not needed to start the webhook harness; needed to prove we are wired to the right store | payments integration proof |
| — | **Lift the halt, or not.** #121 contains no app code | 17 commits |
| — | **Dunning behaviour.** When a renewal card fails, nothing tells the user — they lose access one day with no warning. Product decision | one payments branch |

---

## Dev Team

| | What | State |
|---|---|---|
| **#52** | six `data-testid` attributes, `components/` only | cleared to start |
| — | **Lapsed-Pro:** does a cancelled user's price alert keep firing? They cannot disable it — PATCH refuses free accounts | reading `dispatchPush` |
| — | The two unhandled webhook events (`payment_failed`, refunds) | after the owner decides |
| — | CONTRIBUTING note: **never require PR approvals** while dev and QA share one account — it cannot be satisfied by anyone | agreed, not written |

---

## QA — in order

| | What | Why it matters |
|---|---|---|
| 1 | **Contrast baseline decision** | 5 entries a live run does not observe. Fixed, or not rendering? The sweep now FAILS until someone says which |
| 2 | **Arabic RTL** | five languages ship, one is tested. RTL is a mirrored layout, not translated words |
| 3 | **Payments webhook harness** | 114 lines decide who is a paying customer, never run against a payload in any environment. Needs nothing from anyone |
| 4 | **BOLA fix** | B's alert seeded (`id=2`). Re-run as A-against-B so the caller clears the Pro gate and reaches the ownership check |
| 5 | **#127** trigger test | signup creates the trial row via a DB trigger. Drop it and users silently lose 14 days of Pro |
| 6 | **#72** PII scrubbing | never verified on a real event. No longer blocked — `beforeSend` runs client-side, and the quota is free now |
| 7 | **Visual regression** | nothing has ever compared what a page looks like |
| 8 | **#120** | confirm the entitlements spec RUNS on the next release, and which direction it asserted |

---

## Open issues and what closes each

| # | Closes when |
|---|---|
| #129 | #130 deploys and a live check returns 401 |
| #127 | a spec asserts the signup trigger still exists |
| #126 | a release PR opens **and its CI queues** unattended |
| #125 | `staging` moves (auto) |
| #120 | the spec runs, not skips, on a release PR |
| #114 | every spec touching market data installs fixtures, then `workers` unpins with zero 429s |
| #109 | #111 reaches production and is re-checked |
| #103 | the DOM test lands — the runtime fix (#128) is already merged |
| #82 | the release deploys and dev confirms the log line in prod |
| #78 | the workflow change is settled; kept open deliberately as the coordination thread |
| #72 | a spec asserts PII is scrubbed from a real outgoing envelope |
| #52 | six attributes land and the specs are re-anchored |

---

## Standing risks

- **Payments have never been exercised.** No purchase has granted Pro, no lapsed
  subscription has been shown to re-lock, and the webhook handler has never seen
  a real payload. Highest launch risk.
- **Arabic is a mirrored layout nobody has loaded.** One of five shipped locales.
- **Nothing has ever looked at a rendered page** — `TEST_GAPS.md` §2.
- **`push/test`'s Pro gate is verified by nothing** — CI has no admin key, so the
  route 401s regardless of entitlement. Stated, not solved.
- **The contrast sweep is data-dependent.** Fixtures exist for 17 third-party
  endpoints but our own `/api/*` routes still feed several surfaces.
- **`qa` and `dev` share one Supabase project.** A clean QA run is not proof the
  data path is clean.
- **No PR in this repo can ever be approved** — one shared account. Adding an
  approval requirement to any ruleset would deadlock releases permanently.

---

## Keeping this honest

- Update the date on every change. A stale status doc is a liability.
- Numbers come from `git` and the GitHub API, not memory.
- When a blocker clears, move it out the same day. A list that only grows stops
  being read.
