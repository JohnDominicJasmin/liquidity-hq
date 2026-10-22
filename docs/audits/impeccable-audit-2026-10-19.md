# Impeccable audit: liquidity-hq.com (2026-10-19)

Scope: 27 live production pages, signed out. Evidence: Impeccable detector (desktop 1280px, Arena also 390px), axe-core accessibility scan per page (desktop), Playwright phone pass at 390x844 (overflow, tap sizes), navigation/resource timing, and a code read of `app/globals.css` and components on `main`.
Not tested: keyboard tab-through, screen readers, light theme, signed-in/Pro views, touch gestures on the chart.

## Audit Health Score

| # | Dimension | Score | Key finding |
|---|---|---|---|
| 1 | Accessibility | 2 | /liq table rows broken for screen readers (axe critical, 22 rows); contrast fails on /news and /liq |
| 2 | Performance | 2 | Every page loads ~610-665 KB of compressed JavaScript and 136-216 requests, even Terms/Privacy |
| 3 | Theming | 2 | Token system and light/dark exist, but 730 hex literals in globals.css and 144 in components |
| 4 | Responsive | 2 | No horizontal scroll on any page, but most phone controls are under 44px (Arena 82 of 123) |
| 5 | Implementation Integrity | 3 | Coherent, product-specific; a few template tells (eyebrow chip, kicker labels, nested cards) |
| **Total** | | **11/20** | **Acceptable (significant work needed)** |

## Implementation Integrity verdict: PASS
The UI is clearly built for this product (liquidity map, funding, scanner, AI read), not a reskinned template. Detector found none of the heavy AI tells (no purple gradients, gradient text, glassmorphism, emoji icons, fake proof). Verified tells: homepage hero eyebrow chip, uppercase kicker labels above headings on 6 pages, cards nested in cards on Dashboard and Live tracking, glow on status dots.

## Findings

### P1 (fix before release)
1. **/liq table rows not readable by screen readers.** `div[role="table"] > .liq-row[role="row"]` missing required cells (axe `aria-required-children`, critical, 22 rows). /impeccable harden
2. **Buttons nested inside clickable elements on /scanner** (axe `nested-interactive`, 6). Keyboard and screen-reader users get two controls in one. /impeccable harden
3. **Contrast failures.** /news tab count badges white on #e2685f = 3.3:1 (needs 4.5:1); /liq `.gex-meta` text fails AA. WCAG 1.4.3. /impeccable polish

### P2 (next pass)
4. **Systemic tiny text**: 8.5-10px labels (Arena Strategy panel, homepage hero mockup, Dashboard, Live tracking, phone tab bar). /impeccable typeset
5. **Small tap targets on phone**: most controls under 44px on every app page (e.g. Arena 82/123, Funding 92/120, News 85/114). /impeccable adapt
6. **Heavy JavaScript everywhere**: ~610-665 KB compressed JS on all pages incl. static legal pages; 136-216 requests. /impeccable optimize
7. **No H1** on 10 pages (Dashboard, Arena, Scanner, Markets, Econ calendar, Research, Journal, Live tracking, Playbook, About). /impeccable harden
8. **Arena chart canvas uses a positive tabindex** (tab order jumps). /impeccable harden
9. **Scrolling ticker regions not keyboard-focusable** (/, /funding, /correlation). /impeccable harden
10. **Upgrade "Sign up" link distinguished by color only** (`link-in-text-block`). /impeccable polish
11. **Template tells**: hero eyebrow chip ("50 markets · Signals + alerts"); kicker labels ("What you get", "How it works", "Pricing", "Pro Plan", "SUPPORT", "Legal", "Important Information"); cards inside cards on Dashboard and Live tracking. /impeccable distill

### P3 (polish)
12. Glow on live/connecting/error status dots (7 pages): keep the dot, drop the glow. /impeccable quieter
13. Bounce easing on the Anti-Chop toggle and the AI chat panel. /impeccable animate
14. Reduced-motion covers only ticker, skeleton, score fill and a toast; thinking-dot and chat-panel animations are not covered. /impeccable animate
15. Footer disclaimer lines ~130 characters (26 pages). /impeccable layout
16. 730 hex literals in globals.css, 144 in components (not split into token-definition vs stray use). /impeccable extract

## Patterns
- Small text and small tap targets are systemic, not one-off: the information-dense panels were sized for desktop mouse use.
- The global JavaScript bundle is shared by every page, so static pages pay the app's cost.

## Positive findings
- No horizontal scroll at 390px on any of the 27 pages.
- No JavaScript errors on load on any page.
- Contrast is mostly AA: only 4 failing nodes across 27 pages; the CSS documents its contrast fixes.
- Light and dark themes exist; 22 focus-visible rules; reduced-motion handled for the ticker.
- No fabricated proof, stats or testimonials anywhere.

## Recommended order
1. [P1] /impeccable harden: /liq table semantics, /scanner nested buttons
2. [P1] /impeccable polish: /news and /liq contrast
3. [P2] /impeccable typeset: 8.5-10px labels
4. [P2] /impeccable adapt: phone tap targets
5. [P2] /impeccable optimize: per-page JavaScript
6. [P2] /impeccable distill: eyebrow chip, kickers, nested cards
7. /impeccable polish: final pass
