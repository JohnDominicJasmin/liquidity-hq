// LiquidityHQ mark - "Ladder L": an L (stem + foot) beside 2 or 3 ascending
// bars. Recreated pixel-for-pixel from the design handoff's MarkLadder
// component (App logo redesign-handoff/project/MarkLadder.dc.html) - every
// percentage below is copied from that source, not eyeballed.
//
// The L's two rects are fixed regardless of variant. The bars differ:
// non-compact renders 3 (dim/accent/accent2, each 9.5% wide) sharing a
// baseline at 75.5%; compact (<=24px use) renders 2 thicker bars (14% wide,
// accent/accent2 only - no dim bar) so it doesn't turn to mush at small
// sizes. Every bar's top is computed from its own height so all bars share
// the same 75.5% baseline as the L's foot.
export type MarkTone = 'dark' | 'light' | 'mono';

interface BrandMarkProps {
  size: number;
  tone?: MarkTone;
  compact?: boolean;
  accent?: string;
  radiusPct?: number;
  className?: string;
}

const BASELINE = 75.5;

/* THE MARK IS A MONO LADDER WITH AMBER ON THE TALLEST BAR (owner ruling,
 * 2026-09-06, option C).
 *
 * The reasoning the owner bought, recorded because the values alone do not
 * carry it: AMBER MEANS "THE LIVE ONE" EVERYWHERE ELSE IN THE PRODUCT - the
 * active nav item, the primary CTA, the firing signal. The mark used to be
 * the one place colour meant nothing. Now it obeys the same rule the
 * interface does: three bars rising, and the one that is "current" is amber.
 *
 * WHY LITERALS AND NOT var(--token). Every value below IS a terminal token
 * and is annotated with which one - but `tone` is a PROP, not the page theme.
 * Eight of the nine call sites pass tone="dark" outright and only
 * PlatformFooter passes tone={theme}. `var(--bg0)` resolves against the
 * PAGE's theme, so a tone="light" mark on a dark page would silently draw the
 * dark palette and the prop would stop meaning anything. The literals keep
 * tone independent, which is what a brand asset needs and is why this
 * function was written with literals in the first place.
 *
 * Geometry is untouched - same rects, same 75.5% baseline, same radiusPct
 * 22.5. The owner kept the tile. This is a palette change only. */
function tonePalette(tone: MarkTone, accent: string) {
  if (tone === 'light') {
    /* The LIGHT tone is not the dark one with different numbers, and this is
       the branch to get wrong: --txt4 INVERTS from near-black to near-white,
       and the accent is #754e00 rather than #d9a626 - a dark amber that
       carries on a light ground. Copying the dark branch here is the obvious
       mistake and it would leave the shortest bar invisible. */
    return {
      bg:      '#f7f6f3',   // --bg0   light
      fg:      '#15181b',   // --txt   light
      dim:     '#aeaaa4',   // --txt4  light - near-WHITE, inverted from dark
      accent:  '#5e6267',   // --txt3  light - the middle bar, neutral
      accent2: accent,      // --accent light - the tallest bar, the only colour
    };
  }
  if (tone === 'mono') {
    /* The BARS stay white - that is the point of this tone, a ladder that
       reads without hue at all for a favicon mask or a print surface.
       
       THE GROUND DID NOT STAY. It was #080C15, a blue-tinted near-black from
       the palette the mark just left, which made the one tone nobody looks at
       the only place the old design survived. Now --bg0's value.

       NOTHING PASSES tone="mono". Checked across app/, components/, lib/, qa/
       and __tests__/ - zero call sites; it exists in the exported MarkTone
       union and this branch and nowhere else. Kept rather than deleted
       because the union is public API and a single-colour rendition is a real
       thing a brand asset needs eventually - but recorded as unused, because
       an untested branch quietly holding a superseded colour is exactly how
       #2E7BFF would have come back. */
    return { bg: '#08090a', fg: '#FFFFFF', dim: '#FFFFFF', accent: '#FFFFFF', accent2: '#FFFFFF' };
  }
  return {
    bg:      '#08090a',   // --bg0   dark
    fg:      '#e8e9ea',   // --txt   dark
    dim:     '#3a3f45',   // --txt4  dark - the shortest bar
    accent:  '#7c828a',   // --txt3  dark - the middle bar, neutral
    accent2: accent,      // --accent dark - the tallest bar, the only colour
  };
}

export default function BrandMark({
  size, tone = 'dark', compact = false, accent, radiusPct = 22.5, className,
}: BrandMarkProps) {
  /* The `accent` prop keeps its job - it drives the ONE coloured bar - but its
     default now depends on the tone, because --accent is #d9a626 in dark and
     #754e00 in light and a single default cannot be right for both. Callers
     that pass an explicit accent still win. Nine call sites today; none pass
     one, so this is API surface rather than live behaviour. */
  const p = tonePalette(tone, accent ?? (tone === 'light' ? '#754e00' : '#d9a626'));
  const bars = compact
    ? [{ left: 51, w: 14, h: 30, color: p.accent }, { left: 69, w: 14, h: 45.5, color: p.accent2 }]
    : [
        { left: 51,   w: 9.5, h: 17, color: p.dim },
        { left: 63.5, w: 9.5, h: 29, color: p.accent },
        { left: 76,   w: 9.5, h: 42, color: p.accent2 },
      ];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      style={{ flex: '0 0 auto', display: 'block' }}
      aria-hidden="true"
      /* ONE HOOK FOR THE WHOLE MARK (#449, amended 2026-09-06).
       *
       * THE ORIGINAL ARGUMENT, WHICH WAS CORRECT AND IS NOW SUPERSEDED: the
       * mark was blue - #2E7BFF, #6FD3FF, #1C3E76 - and that was the DESIGN
       * rather than drift, because the handoff's own logo.png decodes to
       * exactly those values and frame 7a references it three times at
       * 26/30/22px. Nothing about that reasoning was wrong. The owner simply
       * decided otherwise on 2026-09-06 and the mark is now a mono ladder
       * with amber on the tallest bar - see tonePalette above.
       *
       * KEPT, NOT DELETED, and the reason changed rather than disappeared.
       * The exemption used to exist because the mark's colours were NOT
       * palette colours. It now exists because a brand asset has its own
       * rules and should not be enforced against by a route colour check
       * even when its colours happen to agree with the palette. Deleting the
       * attribute would make the mark hostage to the next palette decision.
       *
       * `design-handoff-dir/design_files/assets/logo.png` still decodes to
       * the blue values and has NOT been regenerated. Do not "fix" this
       * component back to match the asset - the component is current and the
       * asset is stale, which is the opposite of the usual direction. */
      /* (original note continues) 
       *
       * The attribute lives here, on the component, rather than as a list of
       * call-site selectors in the spec. There are ten call sites across eight
       * files today, and the failure this replaces was precisely a
       * selector list that covered two footer children and missed the mark in
       * the nav - a screen gets converted, its logo is not in the list, and the
       * suite goes red on a decision nobody made.
       *
       * Whoever adds an eleventh call site gets the exemption for free. If the
       * mark is ever restated in palette colours, delete the attribute and the
       * spec entry together - the check should go back to enforcing on it. */
      data-brand-mark=""
    >
      <rect width="100" height="100" rx={radiusPct} ry={radiusPct} fill={p.bg} />
      <rect x="14" y="22" width="11.5" height="42" fill={p.fg} />
      <rect x="14" y="64" width="29" height="11.5" fill={p.fg} />
      {bars.map((b) => (
        <rect key={b.left} x={b.left} y={BASELINE - b.h} width={b.w} height={b.h} fill={b.color} />
      ))}
    </svg>
  );
}
