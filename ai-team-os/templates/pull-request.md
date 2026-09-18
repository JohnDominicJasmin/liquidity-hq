# Pull request template

Copy this shape for every change. The sections are not decoration: "how to
test" is the hand-off to the test seat, and "risk" is where an unverified thing
becomes visible instead of inferred.

```md
## Summary
- One or two lines, in plain language, of what this changes for a user.

## What changed
- File or area: what it does now, and what it did before.
- Group by area, not by commit. Cite `file:line` for anything a reviewer will
  want to check.
- Say explicitly if anything is a pure move with no behaviour change.

## Why
The problem this solves, and the evidence it was real: the reproduction, the
measurement, or the issue that reported it. If a claim in the code or copy was
wrong, cite the source that shows what is actually true.

## How to test (QA)
Written for a non-engineer on the integration environment.
1. Go to <page>.
2. Do <action>.
3. Expect <observable result>.
Say which environment, and name anything that needs a particular account state.
For coverage: what to assert and why. The test seat writes the test.

## Risk level
Low / Medium / High, and then the honest part:
- what is **not** verified, and why;
- what could break that this change touches;
- any migration, environment variable, or data change, and the order it must be
  applied relative to the deploy;
- for anything visible: screenshots, and a note that owner sign-off is required.

## Screenshots
Every theme and design mode the project ships, plus phone width if the change is
visual. Say how any forced state was produced.
```

## Rules that apply to every PR

- One logical change per commit; no "fix stuff" messages.
- Body required for anything the test seat will look at: what changed, why, and
  what to check.
- If a gate could not be run (a build that needs more memory, a test that needs
  a credential), say so in the risk section rather than leaving it implied.
- Never claim an approval that has not happened.
- Update the PR body when the change grows. A stale table is worse than no
  table, because someone will approve the wrong wording from it.
