# Templates: release PR, status update, stopping point, tracker issue

## Release pull request

```md
## Summary
Release <n>: <candidate branch> → <production branch>. <One line: the theme of
this bundle.> Owner approval required before this merges and before it deploys.

## What's in this release
Grouped by area, each item: what it fixes for a user, and its QA verdict.
- <area> — <change>. QA: pass (<test reference>).

## Gates
- Visible items and their owner approvals: <list, with when each was given>.
- Migrations: <files>, in what order relative to the deploy, and a note that
  applying them is a separate owner-gated action.
- Environment variables: <new ones, and which environments still need them>.
- Anything the deploy will not fix by itself: <e.g. text served from a database
  keeps the old value until its rows are applied>.

## How to test (production, read-only)
The aggregate of each item's steps. No writes to production data, no test
messages to real users.

## Risk level
<Low/Medium/High>, plus every open item, each marked blocking or non-blocking,
and every "could not verify" caveat from the individual PRs.
```

## Status update to the owner (chat)

Five to eight lines, plain language, no internals.

```md
*Status update*

*Fixed and live:* <what a user would notice>.
*Approved and going in:* <what is waiting to ship>.
*In testing:* <what is being checked now>.
*Waiting on you:* <the decisions, one line each>.

Next update in about <n> hours.
```

Rules: never name what the owner has asked to keep out of that channel; no
credentials; no personal detail; no internal tooling or seat names; no user
counts or business figures unless the owner asked for them.

## Stopping point (posted on the issue, before any pause)

```md
**<Seat>: parking here — <reason>.**

**Pushed, nothing local-only:** <branch> at <commit>. <Or: what is local, and
why.>
**Done:** <what is finished and verified>.
**Not done:** <what remains, in the order to resume>.
**Owed:** <any check, gate, or measurement not yet run>.
**Machine:** processes stopped, verified by <how>. Watchers stopped.
```

## Tracker issue (for many small related findings)

```md
## Summary
<One sentence: the area and the shape of the problem.>

## Findings
- [ ] **1.** <finding> — <rule or expectation it breaks>. <Where.>
- [ ] **2.** ...

## How this list is used
- The owner picks item numbers; nothing outside the picked numbers is touched.
- Items are grouped into batches small enough to review in one sitting.
- A box is ticked only after production verification, not after the merge.

## Priority
<How severity was assigned, so the next reader can apply the same scale.>
```

Why a tracker rather than one issue per finding: a pile of fragments hides the
shape of the problem and inflates the open count until nobody reads it. One
tracker per area keeps the decision in one place.
