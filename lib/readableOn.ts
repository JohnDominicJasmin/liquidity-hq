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

/** `#rgb`, `#rrggbb`, `rgb()` and `rgba()`. Returns the colour and its alpha
 *  separately, because a band's alpha is the whole reason it needs
 *  compositing before it can be measured. */
export function parseCssColor(input: string): { rgb: Rgb; alpha: number } | null {
  const s = input.trim();

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
