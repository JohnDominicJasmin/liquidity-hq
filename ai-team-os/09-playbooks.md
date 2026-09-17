# Playbooks

Step-by-step for the things this team does repeatedly. Each one exists because
doing it from memory produced a mistake at least once.

## Release

1. **PM:** confirm the candidate branch is deployed to staging and that the
   staging environment serves that exact commit. Quote the version endpoint.
2. **PM:** confirm every item in the bundle has a QA pass, and every visible
   item has the owner's approval. List anything unverified.
3. **PM:** identify migrations and new environment variables. Apply variables to
   production **before** the deploy. Migrations follow the order in
   `08-quality-checks.md`.
4. **PM → owner:** one message: what ships, the risk, what is unverified, and a
   request for the two approvals (merge and deploy).
5. **PM:** merge with a merge commit, keeping the candidate branch.
6. **PM:** trigger the production deploy. Confirm which account or workspace
   before acting.
7. **PM:** verify two ways — the host's deploy status and the version endpoint,
   polled until it flips. Then tag the deployed commit, dated.
8. **PM:** apply any gated database work now, with its own verification
   (before/after reads, checksums across rows and locales).
9. **QA:** read-only production re-check. No writes, no test messages to real
   users. Post per-step results.
10. **PM:** watch anything scheduled for its first run after the restart, and
    explain any difference from the steady state before someone else notices it.
11. **PM:** post the release record on the release PR and report to the owner in
    plain language.

## Hotfix

1. Cut from the production branch.
2. Reproduce, fix, and exercise it. Say in the PR what was **not** verified,
   because skipping the integration branch skips the normal testing.
3. Owner's word, deploy, verify, tag.
4. Merge back into the integration **and** development branches, or the next
   release silently reverts the fix.

## Rollback

1. Roll back first, diagnose second. Redeploy the previous good build.
2. Verify the rollback the same two ways as a deploy.
3. Only then investigate, and write the cause on the issue.
4. If a destructive database change shipped and there are no backups, there is
   no rollback. Say so immediately and escalate to the owner.

## Audit or batch of findings

1. Audit produces a **numbered list** in one tracker issue, each item with the
   rule it breaks and a one-line reason.
2. The owner picks item numbers. Nothing outside the picked numbers is touched.
3. PM groups the picked items into small batches that can be reviewed in one
   sitting, and sequences them.
4. Each batch: Dev builds, QA tests, PM audits, owner approves anything visible.
5. Tick the tracker's checkboxes only after production verification.

## Changing user-facing text that lives in a database

1. Find out where the text actually comes from. If the running app reads rows
   from a database, editing a default in the repo changes nothing live.
2. Change the repo default **and** write a migration for the rows, every locale.
3. Put a before/after table in the PR. That table is what the owner approves.
4. A test asserts the corrected wording by key, so it cannot regress quietly.
5. Apply to the lower environment first, verify rendering, then production with
   the owner's word.
6. Verify with checksums per locale across both environments, not by reading a
   few rows.

## Getting a screenshot of a state that needs signing in

1. Never type credentials. If the state needs a signed-in session, the **owner**
   signs in and hands over the browser session, or a seat with a legitimate test
   fixture takes the job.
2. If the state only appears on failure (a fallback banner, an error state),
   simulate the failure at the network layer in a test browser rather than
   editing shared source.
3. Revert every temporary change and say in the write-up exactly how the state
   was forced.

## Pause and resume

1. Warn both seats before the stop.
2. Each seat: finish the step in hand, push, post a stopping point on the issue,
   stop every process it started (verify by port and PID), stop watchers.
3. PM verifies the park independently, writes the resume checklist, and disables
   anything scheduled that would fire while parked.
4. On resume: check machine resources first, restore watchers and schedules, then
   hand out the first task from the checklist.

## Machine resource triage

1. Measure free memory before any heavy job, and name the threshold in
   `PROJECT.md`.
2. One heavy job at a time. The seat holding the slot says so.
3. If a job is killed, **stop and report**. What is forbidden is the blind
   loop: retrying the same command unchanged, because each attempt makes the
   machine worse and teaches nothing new.
4. **One deliberate retry is allowed, and only one**, when something has
   actually changed: the low-memory fallback from `PROJECT.md` is now applied,
   a competing job has finished, or the PM seat has assigned the single heavy
   slot. Say which of those changed before retrying. If that attempt dies too,
   stop for real and escalate.
5. Report to the owner what is consuming resources, including their own
   applications, with numbers.
6. Use the known low-memory fallback rather than inventing one under pressure,
   and write it in `PROJECT.md` the first time it works so the next seat does
   not have to find it again.

## Weekly hygiene

- Tags exist for every production deploy.
- Merged branches deleted.
- Issue count reviewed: small related findings grouped into trackers.
- Anything marked "unverified" revisited, especially caveats that were excused
  by a temporary condition — nothing revisits those automatically.
- Instructions with no expiry re-read. A pause set for a good reason months ago
  is still in force, and nobody is watching the date.
