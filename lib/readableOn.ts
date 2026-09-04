/* Pick black or white for text sitting on an arbitrary background, by
 * measuring rather than by remembering (#707).
 *
 * WHY THIS EXISTS RATHER THAN A LOOKUP TABLE. /hours paints six session bands
 * as translucent colours over the page ground. Two fixes were tried and both
 * failed, because both assumed one text colour could serve every band:
 *
 *     '#fff'        fails all six bands in light   (1.43 - 1.78)
 *     var(--txt)    fails three bands in dark      (2.33 - 4.42)
 *
 * There is no third token that clears all six in both themes - the bands land
 * light in light mode and mid-tone in dark, and a mid-tone band is equidistant
 * from both ends. The colour has to be chosen per band, and once it is chosen
 * per band it must not be WRITTEN per band: a six-entry map goes stale the
 * moment a band colour moves, and nothing fails when it does. That is #736's
 * and #663's shape, twice over.
 *
 * So the rule is the source of truth. Give it the band and the ground and it
 * computes the answer, which stays correct through any palette change without
 * anyone remembering this file exists.
 *
 * SCOPE: sRGB relative luminance per WCAG 2.x. Deliberately not APCA - the
 * project's bar is 4.5:1 and every measurement on every issue in this area is
 * a WCAG ratio, so introducing a second scale here would make two numbers that
 * cannot be compared. */

export type Rgb = [number, number, number];

/** `#rgb`, `#rrggbb`, `rgb()`, `rgba()`, `color(srgb …)` and `transparent`.
 *  Returns the colour and its alpha separately, because a band's alpha is the
 *  whole reason it needs compositing before it can be measured.
 *
 *  `color(srgb …)` IS NOT OPTIONAL IN A BROWSER (#774, #771). Every
 *  `color-mix()` in this codebase computes to it - `getComputedStyle` returns
 *  `color(srgb 0.458824 0.305882 0 / 0.1)` where the stylesheet says
 *  `color-mix(in srgb, var(--accent) 10%, transparent)`. Without this branch a
 *  chain walk skips that layer silently and measures the wrong ground. I did
 *  exactly that on #771, an hour after arguing the rule belonged where probes
 *  get written, and reported 5.56 for an element that measures 4.82.
 *
 *  SCALED BY PREFIX, NEVER BY VALUE RANGE. `color(srgb …)` channels are 0-1;
 *  `rgb()` channels are 0-255. Deciding from the values - "these all look
 *  small, they must be 0-1" - misreads a real `rgb(0 1 2)`. The prefix is the
 *  only thing that actually says which.
 *
 *  EVERYTHING ELSE STILL RETURNS null, and that is load-bearing rather than
 *  incidental. `oklch()`, `lab()`, `hsl()` and `color(display-p3 …)` are not
 *  handled, and a caller that gets `null` leaves a visible hole; a caller that
 *  gets a confidently wrong number produces a finding. That distinction cost an
 *  hour on #774. The tests pin it so nobody later adds a lenient fallback. */
export function parseCssColor(input: string): { rgb: Rgb; alpha: number } | null {
  const s = input.trim();

  if (s === 'transparent') return { rgb: [0, 0, 0], alpha: 0 };

  /* `srgb` only. display-p3, rec2020 and the rest share this syntax with
     DIFFERENT primaries, so treating them as srgb would be the value-range
     mistake in another costume. */
  const srgb = /^color\(\s*srgb\s+([^)]+)\)$/i.exec(s);
  if (srgb) {
    const raw = srgb[1].split(/[\s/]+/).filter(Boolean);
    if (raw.length < 3) return null;
    const num = (t: string) => (t.endsWith('%') ? Number(t.slice(0, -1)) / 100 : Number(t));
    const ch = raw.slice(0, 3).map(num);
    if (ch.some(Number.isNaN)) return null;
    const alpha = raw.length > 3 ? num(raw[3]) : 1;
    if (Number.isNaN(alpha)) return null;
    return { rgb: ch.map(c => c * 255) as Rgb, alpha };
  }

  const hex6 = /^#([0-9a-fA-F]{6})$/.exec(s);
  if (hex6) {
    return { rgb: [0, 2, 4].map(i => parseInt(hex6[1].slice(i, i + 2), 16)) as Rgb, alpha: 1 };
  }
  const hex3 = /^#([0-9a-fA-F]{3})$/.exec(s);
  if (hex3) {
    return { rgb: [0, 1, 2].map(i => parseInt(hex3[1][i] + hex3[1][i], 16)) as Rgb, alpha: 1 };
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (fn) {
    const parts = fn[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
    const alpha = parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1;
    return { rgb: [parts[0], parts[1], parts[2]], alpha };
  }
  return null;
}

/** Flatten a translucent colour onto an opaque one. */
export function compositeOver(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return [0, 1, 2].map(i => fg[i] * alpha + bg[i] * (1 - alpha)) as Rgb;
}

export function relativeLuminance(rgb: Rgb): number {
  const chan = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(rgb[0]) + 0.7152 * chan(rgb[1]) + 0.0722 * chan(rgb[2]);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const BLACK: Rgb = [0, 0, 0];
export const WHITE: Rgb = [255, 255, 255];

/** Whichever of black or white reads better on `surface` once `surface` has
 *  been flattened onto `ground`.
 *
 *  `ground` is required and not defaulted. A translucent surface measured
 *  against nothing is measured against white, which is the answer for exactly
 *  one theme - and silently having the light-theme answer in dark is the bug
 *  this function replaces. Callers read the real ground from the live
 *  stylesheet so there is no second copy of it. */
export function readableOn(
  surface: string,
  ground: Rgb | string,
): { color: '#000' | '#fff'; ratio: number } | null {
  const parsed = parseCssColor(surface);
  if (!parsed) return null;
  /* A ground that will not parse returns null rather than falling back to
     white. Guessing here would reproduce the exact defect: an answer computed
     against a background that is not the one on screen. */
  const groundRgb = typeof ground === 'string' ? parseCssColor(ground)?.rgb : ground;
  if (!groundRgb) return null;
  const flat = compositeOver(parsed.rgb, groundRgb, parsed.alpha);
  const onBlack = contrastRatio(BLACK, flat);
  const onWhite = contrastRatio(WHITE, flat);
  /* local/no-bare-hex-colour disabled, with the reason it asks for: these two
     literals are the OUTPUT of a contrast measurement against the live ground,
     not a colour someone picked and hoped about. The rule exists because a
     hardcoded colour does not adapt to theme - this one adapts to the theme by
     construction, since the ground it is measured against came from
     getComputedStyle. Tokenising it would break it: --txt is near-white in
     dark, and "near-white" is what fails on the light bands. */
  return onBlack >= onWhite
    // eslint-disable-next-line local/no-bare-hex-colour
    ? { color: '#000', ratio: onBlack }
    // eslint-disable-next-line local/no-bare-hex-colour
    : { color: '#fff', ratio: onWhite };
}
