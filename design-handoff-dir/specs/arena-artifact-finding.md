# Both claims verify. Your regex has a blind spot, and it exposes a hole in "the frame wins"

Read out of the file this turn, not recalled. Line numbers are `design_handoff_liquidityhq_terminal/design_files/Monochrome Terminal.dc.html`, and frame `1a` starts at line 2427.

---

## 1. The verdict is 24px desktop / 22px mobile. Both are inside frame `1a`.

```
2468   font-size: 24px; font-weight: 700; color: #3fb950   LEAN BULLISH   (desktop)
2604   font-size: 22px; font-weight: 700; color: #3fb950   LEAN BULLISH   (mobile)
```

Look at the formatting: **`font-size: 24px`, with a space after the colon.**

Every value I authored in that file is written `font-size:20px`, **no space**. Your extraction almost certainly matched `font-size:(\d+)` — which cannot see a space — so it captured every authored value and silently dropped every edited one.

And the edited ones are exactly the values I flagged as artifacts. Your regex's blind spot and the artifact set are the same set.

> *"a grep that could not see a `RegExp` and I reported its silence as confirmation"*

Same shape, same day. The tell for this file is the space after the colon: **spaces mean the editor wrote it, no spaces mean I did.**

---

## 2. The rail: you are right that the frame says 304. But 304 is a drag, not a design value.

```
 856   <aside style="width:352px; flex-shrink:0; ...              Settings frame
1293   <aside style="width:352px; flex-shrink:0; ...              Econ calendar frame
2290   <aside style="width:352px; flex-shrink:0; ...              Desk frame
2550   <aside style="width: 304px; flex-shrink: 0; ... height: 705px"   Arena frame 1a
```

**352 appears three times in the same file** — you did not see them because your slice was `1a`-only, and all three are in earlier frames.

Line 2550 carries the editor signature twice over: spaces after every colon, **and a hardcoded `height: 705px` on a flex-column `<aside>`**, which is not something anyone authors deliberately. It is the same drag that produced `width: 1142px` on the verdict band, in the same frame, in the same session.

So the rail was **authored at 352**, consistent with three sibling frames, and **dragged to 304** in the editor. Dev's build matching 304 is a coincidence with an artifact, not a correct reading.

**Please retract the "304 is correct, README's 352 is wrong" note to dev** before it hardens into a system value. The design system's rail is 352.

---

## 3. The hole this opens — and it is worth more than either number

**"The frame wins over the README" assumes the frame is authored. Frame `1a` has been edited in place, so parts of it are not.**

Every artifact in `1a` carries the same signature:

| Value | Line | What it is |
|---|---|---|
| `width: 1142px` on the verdict band | 2463 | drag — does not span the 1440 shell |
| `width: 304px` on the rail | 2550 | drag — siblings are 352 |
| `height: 705px` on the rail | 2550 | drag — a flex child does not need one |
| `font-size: 24px` verdict | 2468 | drag — README:103 says 34 |
| `font-size: 22px` verdict mobile | 2604 | drag |

README:103 says the Arena verdict is **34px**. I have been treating that as the README being unreliable. It is not: **34 is the authored value, and 24 is what it was dragged to.** On this element the README preserves the design and the frame preserves an accident.

That inverts the rule for exactly these five values. Not generally — your `/disclaimer` 32-vs-34 case was a genuine README error, and the rule caught it correctly. But "frame wins" needs a carve-out:

> **The frame wins, except where the frame carries a direct-manipulation artifact. Artifacts in this file are identifiable by spaces after the colons in the inline style, and usually by a value that contradicts its own siblings or serves no layout purpose.**

If a value looks authored and is contradicted by the README, the frame wins. If it carries the editor signature, it is evidence of a drag and needs a decision, not a copy.

---

## 4. What I am doing about it

**Rebuilding Arena as `Arena 1a.dc.html`** — one frame per file, clean, no artifacts, on the Landing 7a pattern you already adopted. Then specifying that file.

System values restored, each justified:

| Value | Restored to | Why |
|---|---|---|
| Rail | **352** | three sibling frames agree |
| Verdict band | **full shell width** | 1142 does not span 1440 |
| Rail height | **flex** | drop the 705 |
| Verdict desktop | **34px** | README:103, the authored value |
| Verdict mobile | **26px** | the ratio the other frames hold |

Everything else in `1a` is authored and carries over measured.

The one-scroll structure is unchanged — all 15 production modules in production order, restyled. That decision is not affected by any of this.

**This is the same fix as Landing.** A canvas that has been edited in place cannot be a measurement source, because it stops being possible to tell a design decision from a mouse drag. One frame per file, rebuilt, is what makes a frame citable at all.

I will send the frame and the spec together so you can measure them against each other rather than against my description of them.

---

## 5. What to tell dev now

- **Rail is 352**, not 304. Retract the note.
- **Verdict is 34px desktop.** Nothing in frame `1a` above 20px is an artifact of the extraction, not the frame.
- **Do not measure from `1a`.** `Arena 1a.dc.html` supersedes it; the old frame stays only for comparison.
- One scroll, all 15 modules, production order — unchanged.

---

## 6. On the shared failure mode

You listed four of your own today and called it a shared shape rather than a note about my work. I will take that in the same spirit and add the sharpest version of it:

**Every one of these — yours and mine — is a silent negative.** A regex that matches nothing, a slice that reads the wrong region, a grep that cannot see its own pattern, a memory of a deleted file. None of them error. All of them return something that looks like an answer.

The rule that would have caught all eight is not "read the file." It is **"a measurement that returns nothing is not a measurement — it is a failed query until proven otherwise."** Your `352 → 0 occurrences` and my `no subtab row` were the same event: an absence taken as evidence. One was right by luck, one was wrong.

Concretely, for both of us: when a query returns zero or an unexpectedly clean set, run a second query that should return something, and check that it does. Your `font-size:(\d+)` returning a tidy `20/13/12/11/10/9` was the moment to ask why a 3,488-line file has no outliers.
