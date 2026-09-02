# Arena spec — blocked, and one question that unblocks it

Thanks for the landing feedback. The range rule is adopted: **no spec of mine cites a range again — every value is a single number measured off a named element.** Same for citing the file a reader can actually open.

Before I write Arena, I read `app/arena/page.tsx` against the frame, and I have to stop and report. Same failure mode as `6a` on landing, worse ratio.

---

## 1. The frame covers 6 regions. Production composes 15 components.

`app/arena/page.tsx` imports these UI components:

```
KLineProChart          ConfluenceScore        MultiTFAlignment
MarketStructure        AbsorptionDetector     EMASignal
HigherTfMoveBadge      LiqHeatmap             UsageMeter
CoinMarketSnapshot     CoinIcon               Tip
PageHint               Warn                   UpgradeGateModal + LockedFeatureCard
```

Frame `1a` — which lives in **`design_handoff_liquidityhq_terminal/design_files/Monochrome Terminal.dc.html`**, not at the repo root; the root copy no longer exists — contains a verdict band, a chart, an evidence grid, a liquidation-cluster ladder, a reasoning paragraph and a session-history list.

Of those six, **one maps to a production component**: the chart, to `KLineProChart`.

And the evidence grid is worth naming plainly: **there is no `EvidenceGrid` in the codebase. I invented it.** It is a good way to show eight signals at a glance, but it is a proposal, not a redesign of something that exists — and a spec that presents it as the latter would have dev deleting real panels to make room for it.

A spec written against `1a` as drawn instructs dev to drop roughly 13 panels, including both Pro surfaces. That is the `6a` problem again, and this time I would rather flag it than build a `7a` on an assumption.

---

## 2. Your Pro question — production already answers it, twice, differently

You asked me to make the design call on what a free user sees in the Confluence slot, and mentioned dev's judgement was "nothing at all."

Production runs **two different patterns on this one screen**:

```tsx
// line 2093
{entitled && <AbsorptionDetector coin={selectedCoin} onData={handleAbsData} />}
// free user sees NOTHING

// line 2105
{entitled ? <ConfluenceScore … /> : <LockedFeatureCard onUnlock={() => setUpgradeGate(…)} />}
// free user sees a LOCKED CARD with a path into UpgradeGateModal
```

So "nothing at all" for Confluence is not a neutral choice — it **removes** the locked card and the `onUnlock` route into the upgrade modal. That is a §4 removal, and the thing removed is a conversion surface on the screen most likely to sell a subscription.

**My call: keep the locked card for Confluence, keep Absorption absent.** The asymmetry in production is already right — Confluence is the feature worth paying for, so its slot should sell; Absorption is a supporting signal, and a locked card for it would be noise. Dev's instinct was sound about the *rail*, wrong about the *panel*: the fix is to place Confluence somewhere a locked card fits, not to delete the card.

Which depends entirely on the question in §4.

---

## 3. A gap in my own frame: gated timeframes have no affordance

Timeframes are Pro-gated. `GATED_TFS` comes from `lib/limits.ts`; line 448 intercepts a gated selection and opens the modal; line 461 forces a free user off a gated timeframe onto `FREE_FALLBACK_TF`.

Frame `1a` shows six timeframes with 4H filled amber and the other five in `--txt3`, with **no indication which are gated**. As drawn, a free user clicks a dead control and gets a modal with no warning.

This needs a third visual state in the timeframe row — available, active, gated — and I will specify it. Noting it here because it is my omission, and because it is the kind of thing that ships silently: nothing errors, the modal is arguably correct behaviour, and no automated check fires.

---

## 4. The question, and my default

Frame `1a` already shows an in-page subtab row: **Read · Order flow · Liquidity · Correlation · History**.

**Do those tabs distribute the 15 modules, or is Arena one long scroll with the tabs as anchors?**

- *Distributed* — Read holds the verdict, chart and headline signals; Liquidity holds `LiqHeatmap` and the cluster ladder; Correlation holds `MultiTFAlignment`. Each tab is a frame and a spec. Only one chart instance mounts at a time.
- *One scroll* — all 15 stacked, tabs scroll to anchors. One very tall frame, one long spec, everything mounted at once.

It changes the frame I draw and the number of specs, so I would rather ask than guess.

**Default if you would rather not decide:** tabs distribute, and I do **Read** first as its own frame — verdict band, `KLineProChart`, `CoinMarketSnapshot`, `HigherTfMoveBadge`, `EMASignal`, `MarketStructure`, `ConfluenceScore` (Pro, locked card), `AbsorptionDetector` (Pro, absent), `UsageMeter`, `PageHint`, `Tip`. That is the densest tab and almost certainly what dev's parked build targets, so it is the spec that decides whether that build is salvaged.

Say go and I will build the frame, then spec it against the source rather than against my own drawing.

---

## 5. One correction back — you may be reading a stale spec

The nav item you flagged is already fixed in the shipped bundle. `design_handoff_landing/specs/landing.md:45` reads:

> **1. Nav height — resolved in the frame. No conflict remains.**

I rebuilt the frame at 56/52 and rewrote that section before packaging; what you quoted is a mid-turn draft I previewed earlier in the session. You were right that the text was dead — it was dead in the draft, and it is gone from the deliverable.

Worth confirming dev is building from `design_handoff_landing/`, since the same staleness would affect anything else quoted from that draft. If a value ever looks wrong, the bundle copy is authoritative over anything previewed in chat.

---

## 6. Adopted from your feedback

- **No ranges.** Every value a single number, measured off a named element in a named frame.
- **Cite the openable file.** `<file> · <badge>` where `<file>` is the path a reader can open.
- **Deletion cost in numbers.** Where a frame would drop production surface, I state the count — the §1 table above is that habit applied to Arena before writing rather than after.
- **Negative results volunteered.** §3 is my own omission; §1 names my invented component as an invention.

Palette confirmed at 15 tokens, all names correct, nothing to collapse. Light theme dark-only with the toggle absent, and the animated hero background removed — both noted as approved.
