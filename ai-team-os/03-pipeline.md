# Pipeline

How a change gets from an idea to production, and who touches it at each step.

```
idea → issue → branch → PR (Dev gates) → integration branch → QA pass
     → staging → release PR → owner's word → production → tag → prod re-check
```

## Step by step

**1. Issue first.** Anything worth doing gets an issue, and related small
findings get grouped into one tracker issue rather than one issue each. The
issue, not chat, is where the decision and the evidence live. Chat is where
people notice things; the issue is where the project remembers them.

**2. Branch.** `<type>/<short-kebab-description>`, named after the user-facing
area, not an internal symbol: `fix/chart-blank-on-empty-symbol`, not
`fix/getBars-null-guard`. The reader of a branch list should be able to tell
what a branch affects.

**3. Dev's own gates, before the PR exists.** Lint, types, tests, build, and an
actual exercise of the change. For a bug fix, reproduce the bug first, then fix
it, then confirm the reproduction is gone. Sweep the surrounding area for the
same mistake; the second instance of a defect found after "done" is the same
failure as not finding it.

**4. Pull request.** Always the same sections: summary, what changed, why, **how
to test**, risk level, screenshots if anything visual. "How to test" is the
handoff, written for a non-engineer on the integration environment: name the
page, name what to look at. If the change needs test coverage, the PR says what
to assert and why; the QA seat writes the test.

**5. Merge into the integration branch.** The Dev seat merges its own feature
branches there, and nobody waits for the owner to say so. An open PR is the
reviewer's queue, not the author's.

**6. Promotion to the integration environment.** Fast-forward only. If it will
not fast-forward, the branch diverged: fix that, do not force. Ask the test seat
"ok to push?" first, as a timing courtesy: a promotion mid-test-run changes the
build under the tester. No answer means go.

**7. QA pass.** The test seat works the "how to test" steps on the integration
environment, reports pass or fail per step, and says which commit it tested.
Failures go back to Dev as findings; QA never fixes application code.

**8. Staging.** The test seat promotes and signs off there. Approved work parks
in staging until a release goes out.

**9. Release pull request, opened by hand.** Automation that opens it on every
promotion re-runs the whole gate suite for a release nobody intended to ship
yet, so this is deliberate manual work. Whoever pushes staging checks that a
release PR exists and opens one if not. The release PR aggregates the "how to
test" steps for the whole bundle and collects every "could not verify" caveat in
its risk section.

**10. The owner's word.** Merging to the production branch and deploying
production are separate approvals from the owner, each time, and they are not
the same thing as the owner approving the feature earlier.

**11. Deploy, then verify, then tag.** Merging is not deploying. If the host
does not auto-deploy the production branch, nothing ships until someone triggers
it. After the deploy, verify against the version endpoint and the host's own
deploy status — two instruments — then tag the deployed commit. Tag after
deploying, not after merging: only the deployer knows it reached live.

**12. Production re-check.** The test seat re-runs the release's steps against
production, read-only: no writes to production data, no test messages to real
users. Post the result on the release PR.

## Hotfix

A hotfix skips the integration branch, which means it skips testing. Cut it from
the production branch, then merge it back into **both** the integration branch
and the development branch, or the next release will revert it. Say in the PR
exactly what was not verified.

## Rollback

When production breaks, roll back first and diagnose second. Redeploy the
previous build from the host, which reverts the build, not the repository. If a
destructive database change shipped and there are no backups, there is no
rollback: this is why schema changes are additive-only.

## Drift

Check, on a schedule and after every production deploy, that what production
serves matches the production branch and that the deployed commit is tagged. If
the check cannot reach the service, it reports **nothing** — a failed
measurement is not evidence of drift, and treating it as one trains everyone to
ignore the alarm.
