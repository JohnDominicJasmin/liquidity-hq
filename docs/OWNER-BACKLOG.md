# Owner backlog — the real priority list

**Given by the owner on 2026-09-20, verbatim items below.** This is the list the
team works from. It outranks anything PM/DevOps has queued. Nothing here starts
until the owner says so (the team is paused until Wednesday's token reset).

**The owner's standing rule:** what makes users pay comes first — reliable data,
signals, decision-making, macro and technicals — plus payments, getting users,
and the site staying up under traffic. UI audits and polish are `priority: low`
and only run in a window the owner grants.

## The list, tagged

| # | Item (owner's words, condensed) | Priority | Already tracked? | State today |
|---|---|---|---|---|
| 1 | **Work on the payment gateway** (Lemon Squeezy) | **critical** | #861 | Owner working on it this weekend. Nothing the team can finish without it |
| 2 | **Real payment end-to-end** — prove a test purchase grants Pro | **critical** | #861 → #243 | Never done |
| 3 | **Ability to cancel a plan** | **critical** | not filed | Not built. Selling without it is a consumer-rights problem |
| 4 | **Lemon Squeezy account details** (owner has the email) | **critical** | not filed | Owner to supply; team can't configure without it |
| 5 | **Redistribution rights for the exchange data**, and hide the source behind our backend | **high** | #861 → #1116 | Legal question unanswered. Server routes already proxy most calls; some client-side calls still hit exchanges directly |
| 6 | **Traffic readiness: paid Render tier + caching before any marketing push** | **high** | not filed | Real risk: a viral post on the current tier means 502s and lost signups |
| 7 | **Load / stress testing** — nobody has measured behaviour under real traffic | **high** | partly #1157 | Never measured |
| 8 | **Error and product tracking connected** (GlitchTip, PostHog, and the rest via MCP) | **high** | #1420 | Production reports both keys PRESENT (2026-09-23 18:24Z, `b96dcb3`), reversing what this line said. A key is not an event: nobody has seen an error or an event arrive in either dashboard, so treat coverage as UNPROVEN rather than working |
| 9 | **Sign-in shows a gibberish domain** — put it on our own domain | **high** | not filed | Trust and deliverability problem at the exact moment a user signs up |
| 10 | **Marketing: system that posts to X on the owner's behalf**, plus manual Reddit threads | **high** | not filed | Not started. It's how users arrive |
| 11 | **Marketing / distribution / research team (new seat)** | **high** | not filed | Owner decision on the team shape |
| 12 | **Customer support presence** | **medium** | partly done | support@ exists and is live on the About page and the suspended-account message. No in-app support path |
| 13 | **Team office email** (beyond support@) | **medium** | not filed | The domain's mail plan carries one mailbox; more needs an upgrade |
| 14 | **Is the new Arena page's on-the-fly indicator work actually sound?** | **medium** | #1347 | Audited on 18 Sep. 10 of 16 findings fixed and live, including the one with data loss. The rest are edge cases, parked |
| 15 | **Cross-browser testing** — everything runs on Chromium only | **medium** | not filed | The owner's own Brave bug was found by hand, not by tests |
| 16 | **Testimonial section** | **medium** | not filed | Blocked: no users yet, and nothing here is ever faked |
| 17 | **Visual regression (screenshot comparison)** | **low** | not filed | Parked. Layout tests catch overlaps, not ugliness |

## What I'd do first, if the owner wants a recommendation

1. **Payments, end to end** (1, 2, 3, 4). Nothing else earns money.
2. **Don't market into a crash** (6, 8). A paid tier, caching, and error tracking
   before the first post. Tracking first, because without it a crash is invisible.
3. **Legal** (5). The redistribution answer decides whether Pro can be sold at all.
4. **Then getting users** (10, 11), with load testing (7) before the push.

## Not on this list, and that is deliberate

The UI audit (58 findings), the Arena audit leftovers, UI polish, the Russian
menu and the old design switch are all `priority: low` and parked. Built work
for them sits in open PRs, unmerged, until the owner grants a window.
