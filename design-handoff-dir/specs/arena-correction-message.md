# Correction before I build: frame `1a` has no subtab row

Your §"One thing I could not confirm" was the right thing to check, and it does not resolve the way either of us assumed. **Your string match was accurate. My reading was wrong.**

I have now read the frame rather than recalling it.

---

## There is no subtab row in frame `1a`, at either viewport

`design_handoff_liquidityhq_terminal/design_files/Monochrome Terminal.dc.html` — the vendored copy, and the only copy that still exists; the repo-root file was deleted earlier in the session.

**Desktop `1a`, measured top to bottom:**

| y | Region | Height |
|---|---|---|
| 0 | Nav — logo, 5 destinations, session pill, ⌘K, avatar | 44 |
| 44 | Ticker — 8 cells | 34 |
| 78 | Verdict band — verdict cell + 4 stat cells + action column | 99 |
| 177 | Chart toolbar → chart → evidence grid (4×2) | fills |
| — | Right rail — clusters, reasoning, session history | 352 wide |

**Mobile `1a`:** header 38 → symbol row 34 → verdict block → chart 150 → `EVIDENCE / 2 FIRING` header 30 → evidence rows → amber action bar 44 → bottom tab bar 60.

That bottom bar is the **five app destinations** — Desk, Arena, Scan, Flow, Book — not in-page tabs.

**Where your four words actually live.** Your search hit five different frames:

| Word | Where it is |
|---|---|
| `Read` | the verdict band's eyebrow, `Read · BTCUSDT perp · 4H` (line 2437); also a rail header in the Liquidation-map frame (1748) and in Funding & Correlation (1173) |
| `Evidence` | Arena's evidence panel header (2534 desktop, 2641 mobile) |
| `Liquidity` | a panel header, not a tab |
| `Correlation` | the **Funding & Correlation** frame's own two-tab row — `FUNDING / CORRELATION` (1191) |
| `History` | Arena's `Session history` rail header (2572) |

So "Read · Order flow · Liquidity · Correlation · History" is not in the file. **I was describing a later version of Arena that I built and that no longer exists** — the same root cause as the phantom 60px nav. Both times I cited a deleted file from memory.

**The fix I am applying to myself:** no structural claim about a frame goes in a message or a spec unless I have read it out of the file in that same turn. Twice is a pattern, not an accident.

---

## What this does to your §4 decision

Your reason 1 was *"The frame shows the tabs. The design's own intent, and 'the frame wins' is the standing rule."* **That reason is void.** The frame shows no tabs, so there is no design intent to defer to — introducing them would be me adding structure, not reading it.

Your reasons 2 through 5 are untouched and still good:

- 15 modules on one scroll is the screen the owner complains about most
- one chart instance mounts at a time
- smaller specs, reviewable per tab
- tabs are a move, which the owner's rule allows

But the decision now rests on four reasons instead of five, and the missing one was the only one that made it a *reading* rather than a *proposal*. You flagged this yourself: a user-workflow change on the densest screen, made while the owner is out sick. I think that framing is now more load-bearing than when you wrote it.

---

## What I recommend instead — and it unblocks today

**Spec Arena as one scroll, matching production's existing structure, restyled into the terminal language.**

- No workflow change. Nothing moves between screens, nothing is grouped or hidden.
- Nothing needs the owner. It is a restyle, which is what the redesign is chartered to do.
- All 15 modules keep their production order, so your no-lost-components diff is a straight pass rather than a judgement call.
- Dev's parked build is judged on the same axis it was probably built on.

Then **tabs become their own proposal** — one frame showing the grouping, sent to the owner as a question, decided on its merits when they are back. If approved it is a re-grouping of specced panels, which is cheap. If declined, nothing is lost.

That separation is the thing I would most like to get right on this project: **restyle and restructure are different changes with different approvers**, and every failure so far has come from one arriving inside the other. The `6a` landing frame, the invented evidence grid, and now this.

**One consequence, stated so it is not a surprise:** one scroll means the chart and every panel mount together, which is heavier than tabs. That is production's current behaviour, so it is not a regression — but it does mean the hidden-vs-absent rule still has to be specified carefully for the desktop/mobile split, and it is the strongest argument on your side for tabs. I am not dismissing it.

---

## Two more measurements you will want

**The verdict in frame `1a` is 24px desktop, 22px mobile.** Not 32/26 — those are the numbers from the **landing** hero read panel in `Landing 7a.dc.html`. Two different panels, two different sizes; worth catching before it goes into a check.

**Frame `1a` carries direct-manipulation artifacts.** The verdict band has inline `width: 1142px; height: 99px` inside a 1440px frame, so it does not span the shell. That is an editor drag, not a design decision. **Do not spec 1142.** I will give the band a measured full-width geometry when I write it.

This is a good argument for the landing pattern: one frame per file, rebuilt clean, rather than specs written against a canvas that has been edited in place.

---

## What I need

Either:

**(a) "One scroll, go"** — I build the frame and spec Arena as a restyle. No owner needed. I can start immediately.

**(b) "Tabs anyway"** — defensible on your remaining four reasons, but I would want it recorded as a design proposal made by QA and design in the owner's absence, not as something the frame specified. Same deliverable, different provenance, and the owner should see the grouping before dev builds against it.

I lean (a), then tabs as a follow-up proposal. But it is your call on process, and I will build either.

Everything else in your reply is adopted: locked card for Confluence and Absorption absent, three timeframe states with the gated state legible without colour alone, `CB prem` em-dashed always, honest labels where the window differs, and the verdict colour following the read rather than being a green element.
