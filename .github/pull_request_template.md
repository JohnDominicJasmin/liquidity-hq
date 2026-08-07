<!--
  Auto-filled on every PR. Full rules: CONTRIBUTING.md section 3.
  Delete the italic prompts as you replace them. Do not delete the headings -
  "How to test (QA)" in particular is the dev to QA handoff, not documentation.

  FIRST LINE: delete whichever team you are not. Both roles post from the same
  GitHub account, so without this the author tells you nothing about who wrote
  it - and dev reviews QA's PRs while QA signs off dev's releases.
-->

**Dev Team** / **QA Team**

## Summary

*One or two sentences, plain language. What would you tell someone who has not been following this work?*

## What changed

*Bullets. User-facing terms first, technical detail after if it is needed at all.*

-

## Why

*The problem this solves. If it is a bug, what was actually wrong - not "it was broken".*

## How to test (QA)

*Numbered steps someone who cannot read code can follow, each with an expected result. Step 1 is normally where to test:*

*- The `qa` staging environment: https://liquidity-hq-qa.onrender.com (once this is merged to `qa` and deployed)*
*- Or locally on the `qa` branch: `git fetch && git checkout qa && git pull`*
*- Or this branch directly, if the change is not on `qa` yet: `git fetch && git checkout <branch>`*

*Name the viewport and theme if the change is visual. Say what a failure looks like, not only a pass.*

1.
2.
3.

## Risk level

*Low / Medium / High, and one line on what breaks if this is wrong.*

- **Low** — isolated, no shared code, easy to eyeball
- **Medium** — touches a shared component or a data path used elsewhere
- **High** — auth, payments, alert delivery, migrations, anything that fails silently or affects money or user data

## Checklist

- [ ] `npm run lint` — 0 errors
- [ ] `npx tsc --noEmit` — clean
- [ ] `npm test` — passing
- [ ] `npm run build` — exit 0
- [ ] **Database migration?** If yes, say which file, and confirm it is applied to dev/qa **before** this merges — see CONTRIBUTING.md section 7
- [ ] **New environment variable?** If yes, list it here and say which services still need it set. A var that exists only on dev is a broken deploy waiting to happen
- [ ] Anything I could not verify is stated in the PR, not left for QA to discover

> **Note on the browser suite.** CI runs Playwright on a PR into `main` only — the
> release. Feature PRs and `dev` → `qa` promotions get the four fast gates above and
> nothing more, so **the first automated browser check any change gets is at the
> release gate**. If this PR is risky enough that you want it sooner, run
> `npm run test:e2e` locally or use Actions → CI → Run workflow, and say so here.
> See CONTRIBUTING.md §4b.

## Screenshots (if UI change)

*Before and after. "N/A - no visual change" is a valid answer; leaving it blank is not.*
