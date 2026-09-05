# QA

Testing and quality-assurance workspace for LiquidityHQ.

> **Before quoting a green CI run as evidence, read
> [`TEST_GAPS.md`](TEST_GAPS.md).** It is the standing list of what the suite
> does *not* cover. "313 tests passed" reads like "the product works", and it
> does not.

> **Lost track of where things are? Read [`STATUS.md`](STATUS.md).** One page:
> what is live, what is waiting, what is blocked and on whom.

> **Writing a one-off probe instead of using a tool in this folder? Read
> [Before you write a probe](#before-you-write-a-probe) first.** Every trap
> listed there has already been hit by someone who was sure their ten-line
> script was too simple to be wrong.

## Before you write a probe

The tools in this folder encode traps that a fresh script re-hits. They are
written *inside* those tools, which is exactly where nobody looks while writing
a replacement for them. So they are repeated here.

**Nearly all of them are one shape: an instrument answering a question ADJACENT
to the one asked, and returning something well-formed.** Not an error and not a
crash — a well-formed result, correctly computed, about the wrong thing.
Sometimes a plausible number; **sometimes a clean zero, which is worse, because a
zero reads as good news.**

The exceptions announce themselves in their own first line. Everything else is
in the family, and no entry needs a preamble to say which.

**This paragraph used to assert a count, and it was wrong both times it was
checked.** It said *"nine of eleven, only 7 and 8 sit outside"*, then *"ten of
thirteen, only 7, 8 and 13"*. Trap 3 is titled "Zero elements is not zero
failures" and returns clean zeros, so *"not a zero"* excluded a member from the
day it was written. Trap 7's own last line reads *"Trap 3b again, in the check
rather than the page"* — naming itself a member while the preamble listed it as
an exception. Trap 12 was added on top of both.

Recorded rather than quietly fixed, because **the paragraph describing this list
kept making exactly the error the list is about** — a claim that sounds right and
is about something adjacent to what it names. Twice, on a page written by people
watching for it.

The count is gone rather than corrected. **A claim that has to be re-derived by
hand on every edit is a claim that will be wrong**, and neither of the two people
who edited this paragraph re-derived it. That is the durable lesson and it cost
three passes to find; the numbered incidents below are just the ways the shape
has actually shown up here.

These form a sequence, and each passes the previous check:

```
13   is the page still working after whatever I installed on it?
3    did I match anything at all?
3b   did I match the right component?
11   do the things I matched carry the property I am claiming about?
```

**12 sits across the whole sequence**, because it is the one where every check above
passes and the answer is still wrong: the page works, the selector matches, the
component is right, and the FIXTURE was outside the range that could have
produced a visible result.

#756's twenty borders existed, were on the right page, were correctly measured,
and were neutral. Every guard in place was satisfied. **A wrong subject that
happens to pass is more durable than one that fails**, because nothing ever
comes back to it.

**If a committed tool already answers your question, run it.** When an ad-hoc
script and a purpose-built one disagree, the ad-hoc one is the hypothesis, not
the finding. On 2026-09-04 a fresh probe reported `/correlation` terminal at
1.05:1 with "no colour encoding" while `platform-audit.mjs` reported 0 failures
on the same page. The audit was right. The probe's number reached a GitHub issue
and a report to the owner before it was caught.

**1. `color(srgb r g b / a)` channels are 0-1. `rgb()`/`rgba()` are 0-255.**
A bare `match(/[\d.]+/g)` gives you both and tells you nothing about which.
Scale by *prefix*, never by value range — a real `rgb(0 1 2)` must not be
rescaled:

```js
const k = /^color\(/.test(c.trim()) ? 255 : 1;
```

Anything using `color-mix()` computes to `color(srgb ...)`. Without the scale
every translucent modern-syntax colour composites to near-black, which reads as
a catastrophic contrast failure that is not there. This has produced two false
findings: the landing ticker at 1.04:1 when it was 3.96:1, and the one above.

**2. A background is not the first non-transparent ancestor.** Composite the
whole chain, alpha included, until alpha reaches 1. Stopping at the first
non-zero-alpha background reads `rgba(117,78,0,0.07)` as opaque and returns
1.0 ratios.

**3. Zero elements is not zero failures.** A selector that matches nothing
returns a clean result, and so does a page whose data never loaded. Count what
you matched and say so. `.frh-sig-hint` reported clean because it renders zero
instances; `/news` reported clean on staging because it had no articles.

**3b. Worse than zero elements: the WRONG element answering.** Trap 3 is an
absence, which at least looks like one. A decoy looks like data. On 2026-09-04 a
probe measured `.cms-trigger` on `/settings` and reported `inputType: radio` —
but the LiquidityAI panel stays mounted across navigation, so the only
`.cms-trigger` on that page was Grok's own. The reading was of a real element,
correctly measured, on the wrong component; it was very nearly filed as
"Settings multi-select is broken". The tell was domain knowledge, not the
output: a multi-select cannot render radios.

Assert what you matched — count, and check an identifying attribute — before
believing what it says. A globally-mounted overlay is the usual culprit.

**4. Live data is not a fixture.** Single samples of a moving value are not
measurements — run three times and report only what is stable. The `↑ 47` in
one report read 39, 40 and 41 across three runs an hour later, which is why
grepping the codebase for `47` never found it.

**5. A canvas `fillStyle`/`strokeStyle` cannot resolve a CSS custom property —
and it does NOT fail to invisible. It silently KEEPS THE PREVIOUS COLOUR.**

This entry said "fails to invisible" until 2026-09-04. That was wrong, and wrong
in the direction that matters. Measured in Chromium:

```
initial fillStyle              #000000     spec default, not transparent
= 'var(--amber)' on default    #000000     unchanged — black, not invisible
= '#3fb950'                    #3fb950
= 'var(--amber)' again         #3fb950     KEEPS THE GREEN
strokeStyle, same              unchanged
throws?                        no
```

Assigning an invalid colour to a canvas context is a **no-op**: the attribute
keeps whatever it held. So a `var()` on canvas does not disappear — it paints in
whatever the last overlay set, which **looks deliberate**. An invisible line
gets noticed; a line in the wrong colour does not.

Found in production code the same day: `KLineProChart`'s EMA9 and EMA200 had
been painting green, borrowed from the S/R support line, and turned pink the
moment a pink overlay drew ahead of them. The file had already recorded the
suspicion and nobody had confirmed it.

Reading pixels back needs the alpha channel too — transparent pixels return
`[0,0,0]` and look exactly like black.

**6. Ask what your instrument would say if the thing were broken.** If the
answer is "the same", it is not measuring. A control that asserts a wrong
implementation disagrees with the real one stops proving anything the moment
the real one adopts that answer.

**7. A substring match is not an identifier match.** `grep "\.gchat-coin"`
reports a hit on `.gchat-coinbar`, so a check written to confirm a class was
deleted found its own replacement and reported the class still present. Anchor
on a word boundary — `\.gchat-coin([^a-z-]|$)` — or you are asking a question
about one name and being answered about another. Trap 3b again, in the check
rather than the page.

**8. Deleting code is not finished until the prose pointing at it is checked.**
Not a probe trap — a review one, and this codebase is unusually exposed to it.
Comments here carry measured ratios, rejected alternatives and owner rulings,
so they are load-bearing. On 2026-09-04 `.gchat-coin` was deleted and two live
rules were left describing themselves as *"borrows the .gchat-coin affordance"*
and *"follows the theme the way .gchat-coin does"* — explanations pointing at
nothing.

A reader who finds one dangling reference either hunts for a class that does
not exist or concludes the file is stale. **The second is worse**: the next
comment they discount might be the one recording that a colour was verified at
6.42:1 in dark. `grep` for the identifier before deleting it costs seconds.

**9. A custom property's scope is not global, and both obvious ways to look for
one assume it is.** A `--token` can live in three places: a stylesheet rule, a
`:root` block, or an **element's inline `style`**. A grep of `globals.css` finds
the first two. `getComputedStyle(document.documentElement).getPropertyValue()`
finds the first two. Nothing finds the third.

On 2026-09-04 both sessions independently reported `--ec-muted` as "declared
nowhere" and filed it. It is set per row at `app/econ-calendar/page.tsx:298` as
a deliberate switch — inline beats every selector, and an inline value that
*reads* a custom property still inherits, so one declaration on the row moves
four cells at once. The technique is documented thirty lines above the code both
of us measured.

**Two instruments scoped to global agreeing about a property that lives on an
element is not corroboration**, and the second reading made the first look
verified. To check: grep the **consuming file** for element-scope declarations
(`['--x' as string]:` or `'--x':`) before concluding a token is missing. That
one command separates "genuinely undeclared" from "declared where you did not
look" — `/news` has no such declarations and its `--border` really is missing;
`/econ-calendar` has one and its `--ec-muted` was never broken.

**10. A fixed `waitForTimeout` LOOKS like it handled the timing.** That is what
makes it worse than no wait at all — an unhandled race is visibly unhandled,
while `await p.waitForTimeout(14000)` reads as deliberate and reports whatever
state it happened to land in.

On 2026-09-04 a probe requesting terminal **light** reported `--badge-0` as the
`:root` dark value and found **0** `.coin-icon` elements. Neither was a finding:
the theme had not applied and the data had not loaded. The same script with a
longer sleep would have "passed" and the numbers would have been quoted.

**Assert the preconditions instead of waiting for them.** Poll for the state the
test requires, then say so in the output:

```js
for (let i = 0; i < 40; i++) {
  ok = await p.evaluate(t => document.documentElement.getAttribute('data-theme') === t
    && document.querySelectorAll('.coin-icon').length > 0, theme);
  if (ok) break;
  await p.waitForTimeout(1000);
}
if (!ok) { console.log('PRECONDITION NOT MET — not reporting from this state'); continue; }
```

Print the **actual** `data-theme`, `data-design` and element count beside every
result. A run that cannot say what state it measured has not measured anything.

**11. A passing check on the wrong elements is the decoy trap at its purest.**
#756 was closed after measuring 20 `.coin-icon` borders at 16.49 and 16.57 —
comfortably clear, 20 real elements, correctly measured, and **not one of them
carried the hue under test**. The badge palette renders on dots behind sign-in;
the borders on that page are neutral.

The check passed *because* it was looking at the wrong thing. Before believing a
clean result, confirm the elements you matched are the ones the claim is about —
not merely that they exist and pass. Trap 3 counts them; this one asks whether
they are the right ones.

**12. A fixture outside the range under test looks exactly like a regression.**
On 2026-09-04, verifying that #813's headless `LiqFeed` still fed the chart, the
probe reported **zero cluster ink on the canvas**. Correct component, correct
selector, correct colour, a page that had rendered — and the honest reading of
it was "hiding the card unplugged the chart", which is precisely the defect the
review existed to catch.

It had not. The seeded liquidation history sat at **108,000–121,500 while BTC
was trading at 79,400**, so every cluster line resolved to a y-coordinate off
the visible axis and drew nothing. The overlay's own guard (`if (y < 0) return
[]`) did its job silently.

**A correct instrument pointed at input outside the observable window returns
the same output as a broken subject.** Traps 3 and 3b ask whether you matched
anything and whether it was the right thing; this one asks whether your INPUT
could have produced a visible result at all. Derive the fixture from the live
subject — the seed here now reads the chart's own klines and places bands inside
that range — rather than choosing plausible-looking constants.

**Neither "my instrument is wrong" nor "the code is wrong" is the default — the
precondition check is what separates them, and it is cheap.**

That is the whole entry, and the pair of incidents behind it is why. #766 was
filed as *"I could not get the lines to draw"* when the measurement was right
and the defect was real. Trap 12 nearly reported a working component as broken
when the fixture was the problem. **They are not opposite errors. They are the
same error** — a verdict reached without the precondition check — and they only
look opposite because the verdicts happened to point different ways.

So the lesson taken from #766, *distrust the clean result*, is not the guard.
Applied here it produces the second failure at exactly the speed it prevented
the first. What separates them is one question asked before either verdict:
**could this input have produced a visible result at all?**

**13. A probe can break the page it is measuring, and this one did.** *Outside
the family — every other entry is epistemic, where the measurement is fine and
the question is wrong. This one is causal: it changed the subject before
measuring it.* Same run:
capturing the research prompt meant wrapping `window.fetch` to intercept
`/api/grok` before it could reach a paid API. The shim forwarded everything else
with `orig.apply(this, arguments)`.

`this` is `window` only when `fetch` is called as `window.fetch(...)`. Called
bare — `fetch(url)`, which is how most library code calls it — `this` is
`undefined` and native `fetch` throws *Illegal invocation*. **Every network
request on the page failed.** The chart never initialised, `.klc-wrap canvas`
matched zero elements, and the probe dutifully reported zeros for all nine
colours it was sampling.

Two things make it worth writing down. The fix is one word (`orig.apply(window,
arguments)`), and the symptom pointed at the application rather than at the
probe — the numbers were about the right page, the right selectors and the right
colours, and every one of them was produced by a page the probe itself had
disabled.

**Being causal rather than epistemic is what makes its guard different.** Every
other guard here runs on the output — did I match anything, was it the right
thing, does it carry the property. This one has to run before the measurement:
after installing any shim, override or route, assert the page still WORKS — one
element that only exists if the app got its data — before trusting a single
number that comes back.

`canvases = 0` was that assertion available for free, it ran, it printed the
answer, and I read past it. **That is a different failure from not having a
check**, and the only guard on offer for it is knowing it is possible.

**14. The sweep that runs every time could not see the defect class that
shipped.** 2026-09-05, and this is the most expensive entry on the page because
it is about coverage rather than a single wrong number.

`qa/platform-audit.mjs` swept `/learn` on every audit — 124 page loads, four
design/theme combinations — and reported it **clean** while the page's logo and
**both hero buttons, the primary CTA included, could not be clicked**. The
terminal app nav was painted over them. Nothing in the audit was wrong. Contrast,
overflow, radius, tap-target size and empty labels all pass on a button nobody
can press, because **not one of those checks asks whether a control is
reachable.**

The check that caught it was `layout.spec.ts`, in the Playwright suite, which
runs on exactly one trigger: a PR into `main`. The three releases before it —
2026-08-29, 09-02 and 09-03 — shipped with that workflow disabled for cost. So
the defect class was invisible to the tooling that runs constantly and visible
only to a gate that was switched off.

**Two lessons, and the second is the one that generalises.**

A clean audit means "clean on the properties this tool measures", never "clean".
Say which properties when reporting one. `/learn` was reported clean for weeks
and the report was accurate; it just never made a claim about clickability and
nobody noticed the gap between what was measured and what was believed.

And **a defect class that only the expensive release-time gate can see is a
defect class that ships whenever that gate is off.** The fix is not to run the
suite more often — it costs real money and the owner switched it off deliberately.
It is to move the cheap half of the check into the tool that already runs: a
hit-test at each control's centre costs nothing when the sweep is already on the
page with a laid-out DOM. `platform-audit.mjs` now reports `coveredCount` per
row for this reason.

**15. Reading `innerText` before `aria-label` invents duplicate names that no
screen reader would ever announce.** Same day, found by Dev Team while fixing
what QA had filed.

`no-duplicate-controls.spec.ts` computed a control's label as
`innerText || aria-label`. Accessible-name precedence is the other way round —
`aria-labelledby`, then `aria-label`, then content. `components/Tip.tsx` renders
`<span role="button" aria-label={text}>ⓘ</span>`, so every tooltip's accessible
name is its own distinct text and its `innerText` is always `ⓘ`. Content-first
meant the `aria-label` was never reached and **every Tip on a page collided with
every other Tip.**

#846 was filed with five findings. Three were this. A screen reader announces
those correctly and distinctly today.

**What makes it worse than an ordinary false positive is where the fix would
have landed.** The only way to satisfy the broken measurement is to give each
`ⓘ` a different visible glyph — so acting on the finding degrades the interface
to please an instrument that was wrong. A false positive that costs a round trip
is cheap; one whose remedy damages the product is not.

The general form: **when a probe computes a value the platform also defines,
implement the platform's rule, not an approximation of it.** Accessible name,
visibility, focus order and stacking all have specifications, and a plausible
two-term fallback is the shape this error takes every time.

**16. A list that looks like a rename is usually a different measurement.**
Three instances on 2026-09-05, all caught the same way, which is what makes it a
trap rather than three mistakes.

`layout.spec.ts`'s mobile baseline named `nav.mobile-tab-bar` on every entry.
That element is the CURRENT design's bottom bar; after #748 the bar at
`bottom: 0` is `nav.tnav-tabs`. The obvious move — and the one I was one edit
from making — is to copy the list and swap the element name. **Measured
instead:**

```
only in terminal   /alerts, /arena
only in current    /funding, /scanner, /journal, /news, /playbook
in both            /briefing, /calc, /dashboard, /faq, /offline
```

Seven entries against ten, five shared. The two designs lay their pages out
differently, so *which* control ends up under a fixed bar differs with them —
the bar being 4px taller is not the only variable. The renamed copy would have
asserted five overlaps that do not happen and missed two that do, and it would
have looked completely reasonable in review.

Same shape twice more the same afternoon. A `--accent-2: #0052CC` declaration
found by grep, correctly computed at 2.99:1, in a scope a guard at
`globals.css:4880` means never governs the element — a confident correction to
dev, half-written, that would have been wrong. And dev computing a fix against a
measured ground that the fix itself moves, because the chip is a self-tint: the
ground is the ink at 13.3%, so changing the token changes the surface too.

**Three different mechanisms, one last step that saved all three: check what is
actually behind the number before believing it.** The transformation is always
the cheap-looking part, and it is always the part that is wrong — a rename, a
grep hit, a ground held constant. If you are about to derive a measurement from
another measurement instead of taking it, take it.

**And the fourth instance is the one that says when the check gets skipped.**
Two hours after writing the paragraph above, I found `.lp-footer-col a:hover`
reading `--accent-2`, computed the token's value in terminal light, and reported
a 2.76:1 failure that #854 had fixed as a bonus. **The selector does not render
in terminal at all** — terminal's landing uses a different root, so there is no
`.lp-root` and no `.lp-footer-col` on that page. A CSS rule existing is not an
element rendering. Trap 3 with an extra step, walked into by the person who had
just written trap 16.

Dev Team did the same thing in the same hour, repeating the finding onward
without checking it. Their diagnosis is the durable part and it belongs here:

> **the check gets skipped on findings that flatter, not on findings that are
> hard.**

Neither of us failed at the technique — we had both just used it successfully on
harder problems. We skipped it on a result we liked. A fix that quietly does more
than it claims, a bug found in someone else's blind spot, a number that confirms
what you already argued: those are the ones to re-check, and the pleasure of
having found them is the signal, not the reward.

## Where QA tests

**Four branches, four services, one each.** Nothing auto-deploys — moving a
branch does not move an environment.

| Branch | Deployed at | Who promotes into it |
|---|---|---|
| `dev` | `liquidity-hq-dev.onrender.com` | Dev Team |
| `qa` | `liquidity-hq-qa.onrender.com` | Dev Team |
| `staging` | **`liquidity-hq-staging.onrender.com`** | **QA** — this is the freeze |
| `main` | `liquidity-hq.com` | **QA** |

**QA signs off on `staging`.** `qa` is dev's integration site; `staging` is the
release candidate and stops moving once QA promotes into it. See
`CONTRIBUTING.md` §6 and issue #78.

Say **"verified on `staging`"** and name the branch. "Verified on qa" was
ambiguous for most of 2026-08-07 and should not be written.

## Seeded accounts — do not reset these

Four accounts exist in the **dev** Supabase (`wdtjhrilakoitfcezxpx`), which `qa`
and `staging` also read. They are test fixtures, not real users. **Nothing should
delete them, change their role, or give them a trial.**

| Account | State | Used by |
|---|---|---|
| `E2E_USER_A_*` | **`role='pro'`**, `trial_ends_at` NULL | `bola.spec.ts`, `a11y-auth.spec.ts`, `entitlements.spec.ts` |
| `E2E_USER_B_*` | **`role='free'`**, `trial_ends_at` NULL | `bola.spec.ts`, `entitlements.spec.ts` |

**Why the roles are pinned.** Both accounts were `free` with a trial running to
2026-08-19, and a trial grants Pro *features* — so both behaved as Pro. Any
entitlement assertion would have meant one thing before that date and the
opposite after it: same spec, same green result, different claim.
`entitlements.spec.ts` **fails** if either has drifted, rather than adapting to
what it finds.

`trial_ends_at` is **NULL**, not a past date. A past date is something that can
be renewed by accident; NULL is a state.

**Consequence to know before changing B back.** `price-alerts` checks entitlement
at `route.ts:89` and ownership at `:111`. With B free, `bola.spec.ts`'s
"B cannot modify A's price alert" is refused by the *Pro gate* and never reaches
the ownership check — the assertion still passes and no longer tests
cross-account access. The data check after it is what still has teeth.

## What lives where

| File | What it is | Status |
|---|---|---|
| [`STATUS.md`](STATUS.md) | **Decisions and standing risks.** Deliberately records no state — it went stale twice doing that. **Read the risks before trusting any result, including your own.** | Living |
| [`TERMINAL_REDESIGN_STATE.md`](TERMINAL_REDESIGN_STATE.md) | **The terminal redesign: what is measured, what is not, and the traps.** §1 is the owner's batching rule. §4 lists eight measurement traps that each produced a wrong finding — read it before running any sweep. §5 records that the handoff's prose has been wrong three times where its `.dc.html` files were right. | Living, records state |
| [`HANDOFF-REQUEST.md`](HANDOFF-REQUEST.md) | What QA asked design for, and why. Largely delivered — kept for the reasoning about what a spec must carry that a canvas cannot. | Historical |
| [`TEST_GAPS.md`](TEST_GAPS.md) | **What a green suite does not mean** — every known coverage gap, ranked by value per unit of effort, with what closing each would take. The answer to "what is still untested?" | Living list, updated as gaps close |
| [`QA_TEST_PLAN.md`](QA_TEST_PLAN.md) | Manual test approach + rigor tiers, plus the RLS deny-all gotcha. Pre-existing — **moved here from `docs/` on 2026-08-04**, so `HANDOVER.md` §4's doc table still points at the old path. | Plan, largely unexecuted |
| [`../pendings/QA_AUDIT_2026-08-04.md`](../pendings/QA_AUDIT_2026-08-04.md) | Full automated sweep, 2026-08-04 — build gates, 65-route API security, responsiveness at 1440/375, a11y, SEO, CWV, tech debt | Executed, findings unfixed |
| [`E2E_PLAN.md`](E2E_PLAN.md) | The original Playwright plan. **Historical** — the suite it describes as "to build" exists and has outgrown it. Read `e2e/` and the spec headers instead. | Superseded |
| [`e2e/`](e2e/) | **40 spec files, 164 cases**, desktop + mobile. Run against a **deployed host**, never in CI — see "How we work". Each file's header comment carries why it exists and what it deliberately does NOT cover; those headers are the real documentation. | Live, run on demand |
| [`vendor/kane-cli-agents.md`](vendor/kane-cli-agents.md) | Third-party doc fetched from an external site. **Untrusted reference material — see the warning in that file.** | Reference only |
| `vendor/kane-cli-agents-file.md` | Full 807-line `kane-cli` **skill file** (has skill frontmatter, so it auto-loads if installed). Instructs agents to hide file paths from the user, bans Playwright, opens an unauthenticated CDP port. **Deliberately not installed.** | Reference only |

## Running the automated sweep

**The audit harness is committed.** It used to live in the session scratchpad,
which meant every session rebuilt it and re-made the same measurement mistakes.

| Script | Answers |
|---|---|
| `platform-audit.mjs` | the whole platform in one table — 30 routes x {desktop, mobile} x {dark, light}: overflow, off-palette, radius, contrast, sub-24px targets, empty fields |
| `contrast-diff.mjs` | *why* contrast fails on one route — groups failures by `class\|fg\|bg` so you see causes, not counts |
| `token-surfaces.mjs` | **per token, every background it was actually rendered against and the contrast there.** Exists because one figure per token measured against `--bg0` is the token's *best* case and shipped three failing values |
| `gating-audit.mjs` | whether paid surface leaks to a non-entitled visitor — Alert Conditions absent (not locked), gated chips `disabled` *and* lock-glyphed. **`--free` signs in as the seeded free-tier fixture**, which is the only way `/settings` exercises the criterion at all |
| `tap-targets.mjs` | interactive elements under WCAG 2.2's 24px minimum, **grouped by component**, with SC 2.5.8's inline and spacing exceptions applied and the exempt list printed so it can be audited |
| `mobile-overflow.mjs` | *what* element pushes a page wider than the viewport |
| `mobile-audit.mjs` | one route at 390px |
| `audit-handoff.mjs` | what `design-handoff-dir/` is missing |

All take `--base <url>` and default to the qa deploy. Run them against a
**deployed host**, and **check `/api/version` first** — a stale-deploy read has
already produced one "the fix did not work" report on a fix that had worked.

```bash
MSYS_NO_PATHCONV=1 node qa/platform-audit.mjs
MSYS_NO_PATHCONV=1 node qa/token-surfaces.mjs --md > surfaces.md
```

`MSYS_NO_PATHCONV=1` is required in Git Bash — without it `/dashboard` is
mangled into a Windows path. Note it does **not** apply to redirects or `cp`
targets, so keep temp files in the repo or an absolute Windows path, not `/tmp`.

**Read `TERMINAL_REDESIGN_STATE.md` §4 before trusting any sweep**, including
your own. Every trap listed there produced a wrong finding that cost a round
trip with dev. Two are worth repeating here because they govern how you *report*
a sweep, not just how you run one:

**`platform-audit.mjs` is a finder, not a sizer.** Its totals are instance
counts. Three separate headline numbers turned out to be one component each:
`/scanner`'s "392 empty fields" (≈50 placeholder dashes), `/correlation`'s "24
failing surfaces" (one gradient), and "74 sub-24px tap targets" (one inline
consent link, which is *exempt*). **Group by component before quoting a number
to anyone.**

**A fixed sleep does not report that it was too short — it reports zero.** A
stuck page and a finished page are indistinguishable to a wait that only
watches for stillness, and both `/correlation`'s heatmap and `/settings`'
`Loading…` placeholder are stable DOMs. Wait for the element that defines the
page.

```bash
npm run build && PORT=3100 npm start
```

Tooling notes from the 2026-08-04 run:

- **Playwright 1.60 is installed globally**, not in the project. ESM ignores
  `NODE_PATH`; import it via
  `createRequire('file:///C:/Users/Dominic/AppData/Roaming/npm/node_modules/')`.
- **`playwright-cli` (`@playwright/cli` 0.1.17) does not work here** — its
  daemon exits with code 1 (`Daemon process exited with code 1`).
- **`vibium` 26.5.31 launches its browser off-screen.** `document.visibilityState`
  stays `"hidden"` even after `vibium window 1500 1000 --state normal`, so pages
  never finish rendering and `requestAnimationFrame` never fires. Its installed
  command set also differs from its own skill doc (no `set-viewport`; `screenshot -o`
  is ignored and files land in `C:\Users\Dominic\Pictures\Vibium\`).
- Driving `playwright` directly, headless, was the only reliable path.

## How we work — read this before your first task

**Two sessions, two checkouts, one repo.** A dev session writes application
code. This QA session tests it. Neither does the other's job, and the PR is the
handoff.

### What QA may and may not write

```
QA WRITES        qa/, playwright.config.ts, test CI workflows, QA docs
QA NEVER WRITES  app/, components/, lib/  - anything the product runs
```

This section used to say QA work is "read-only, findings get handed over". That
**changed deliberately**: QA owns its own tooling and writes it. The boundary
that did NOT change — **a fix to application code is reported as a finding,
never applied here.** If a spec needs an app change to be testable, that is a
finding too.

**QA-authored code is reviewed by dev.** PR into `dev`, dev reviews, dev merges.
The one flow that runs QA -> dev, and not a formality.

### Who moves what

| Step | Who | Note |
|---|---|---|
| feature branch -> `dev` | dev | freely |
| `dev` -> `qa` | dev | then **deploys** `liquidity-hq-qa` and says so |
| `qa` -> `staging` | **QA** | then dev deploys `liquidity-hq-staging` |
| `staging` -> `main` | **QA**, owner-approved | QA merges, deploys, re-checks, tags |

**Merging is not deploying.** Every service is `autoDeploy: no`, so a moved
branch ships nothing. **Ask `/api/version`, never the branch** — it reports the
commit the service is actually SERVING. Quoting the endpoint while trusting git
for that commit's contents is the same mistake one step removed, and it has been
made here.

### What the owner decides, and nothing else

```
merging to main       production deploys       writes to the shared database
```

Everything else is QA's to sequence. **QA is the project manager** — files
issues, orders them, says what is next. The owner does not want to be the relay
between two sessions.

Two more need their word because they cost money: **running E2E in CI**, and
**opening the release PR**.

### GitHub is the channel, not chat

Every finding, measurement, corrected premise and abandoned approach goes on the
issue or PR. **A result that exists only in a chat reply is invisible** to
whoever is sequencing the work. Negative results count — what was measured and
showed nothing saves the other session re-deriving it.

**Ask the owner once.** Repeating an ask is pressure, and a yes extracted by
nagging is not approval.

### CI is switched off on purpose

The repo is private, so every Actions minute is billed to the owner personally.
All workflows are `disabled_manually`. **A cost decision, not an outage** — do
not enable one, do not file it as a defect, do not caveat every PR with "no CI
ran".

The substitute is free and stronger: lint, `tsc`, unit tests, and Playwright
**against a deployed host**.

**Consequence worth knowing:** a disabled workflow fails silently and
permanently. Nothing opens the "Ready for QA" issue or the release PR any more,
and **the production drift check stopped with them** — nobody chose that; it
shared a file with the release PR.

### How to run the suite

```bash
E2E_BASE_URL=https://liquidity-hq-qa.onrender.com   npx playwright test qa/e2e/<spec>.spec.ts --project=desktop --workers=1
```

**Use `--workers=1` against `qa` or `staging`.** Signed-in specs each boot the
app and wait on a Pro-gated card; four workers is four concurrent boots against
a free-plan machine that sleeps. Parallel runs there produce failures that look
exactly like findings.

Prefer one targeted spec over a full sweep — a 40-minute suite also wakes the
free-plan services.

### The habits that took longest to learn

The full versions are in `STATUS.md` §Standing risks. Read it before trusting
any result, including your own.

- **A test that has never failed has never been tested.** Watch a regression
  test fail on the broken build before believing it. One shipped here that
  passed on a build without the fix in it.
- **Count what your controls RULE OUT, not how many you ran.** Three passing
  controls once carried a finding that was wrong — all three eliminated the same
  kind of alternative and left the real one untouched.
- **A command that returns nothing has not told you the thing is absent.**
  Check the instrument read anything at all first.
- **A stable number is not a loaded page.** Placeholders are perfectly stable
  while they wait.
- **Count the attempts.** After two mechanisms have failed *silently* at the
  same property, question whether it is reachable from a spec at all. Six
  attempts at one bug lost most of a day; a human answered it in thirty seconds.
- **A comment describing an invariant is the thing that goes stale.** The
  durable version is a check.
