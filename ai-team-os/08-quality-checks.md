# Quality checks

The checks each kind of change must pass. Nothing here is optional because it is
"a small change"; small changes are exactly where checks get skipped and
regressions enter.

## Every code change

**Dev, before the pull request exists:**

- [ ] Lint: zero errors.
- [ ] Types: clean.
- [ ] Tests: all pass, and **zero skipped**. A skip is not a pass.
- [ ] Build: clean, from a cold build if the change touches configuration.
- [ ] The original problem was reproduced first, and no longer reproduces.
- [ ] The change was exercised by hand, not only through tests.
- [ ] The surrounding area was swept for the same mistake.
- [ ] Anything still unverified is named in the PR's risk section.

**QA, after it is merged and promoted:**

- [ ] Tested on the integration environment, with the served commit quoted.
- [ ] Every "how to test" step reported pass or fail individually.
- [ ] New coverage added for the fixed behaviour, asserting the real shape of
      the fix (read the implementation before writing the assertion).
- [ ] Regression guard exists, or the absence is stated: "closed on manual
      evidence, no regression guard".

**PM/DevOps, before it closes:**

- [ ] Read the artifact behind the claim, not the summary.
- [ ] The evidence matches what the change was supposed to do.
- [ ] Said on the issue what was audited, and what remains unverified.

## Anything visible

- [ ] Screenshots attached, in every theme and design mode the project ships.
- [ ] Checked at phone width and at the awkward middle widths, not only desktop.
- [ ] Keyboard focus is visible on every interactive element, and the ring is
      actually drawn, not merely present in computed style.
- [ ] State conveyed by colour also has text, an icon, or a label.
- [ ] Empty, loading and error states exist and say something useful.
- [ ] The owner approved it.

## Copy and any user-facing text

- [ ] Every claim is true of what the code does, with the file and line cited,
      or the claim is removed.
- [ ] No invented numbers, sources, testimonials, or counts. If a number is
      quoted, it came from the code or from the owner.
- [ ] No advice the product cannot stand behind.
- [ ] **Where does this text actually live?** If copy is served from a database,
      changing a default in the repo changes nothing in production. The database
      row is the change, and applying it is a gated write.
- [ ] Every locale the product serves is updated, or the untranslated ones are
      listed as a known gap. Fixing only the default language leaves the false
      claim live everywhere else.
- [ ] A test asserts the corrected phrasings stay corrected, by key, so the next
      edit cannot quietly reintroduce them.

## Database changes

- [ ] Additive only, unless the project has backups and the owner agreed.
- [ ] Applied **before** the deploy that needs it.
- [ ] The live catalogue was read before and after, and compared to the file.
- [ ] Grants and security settings match the reference environment.
- [ ] One environment's section applied at a time.
- [ ] Not applied during a test pass without asking the test seat.
- [ ] Recorded in the migration history with the same name as the file.

## Release

- [ ] Every item in the bundle passed QA on staging.
- [ ] Every visible item has the owner's approval.
- [ ] Migrations and environment variables identified, and applied in the right
      order relative to the deploy.
- [ ] Owner's explicit word for the merge and for the deploy.
- [ ] Deploy verified two ways, then tagged.
- [ ] Production re-checked read-only, and the result posted.
- [ ] Post-deploy watch for anything that runs on a schedule: the first run
      after a restart often behaves differently from the steady state, and the
      difference is worth predicting in advance rather than explaining
      afterwards.

## What "quality" means here

The floor is "it works". The bar is:

- **Intentional:** every decision has a reason someone can state.
- **Complete:** no dead controls, no half-wired states.
- **Honest:** nothing claimed that is not backed by the code or by evidence.
- **Resilient:** it holds in every state, theme, width and keyboard-only use.
- **Reviewed by someone who did not write it.**
