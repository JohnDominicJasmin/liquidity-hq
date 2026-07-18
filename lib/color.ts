/** Applies alpha to any CSS color - a hex literal ('#34d399') or a custom
    property (`var(--green)`) - via color-mix. String concatenation like
    `color + '44'` only works when color is a bare hex literal; it silently
    breaks (invalid CSS) the moment that literal is swapped for a var().
    hexAlpha is the same two-hex-digit suffix devs already reach for
    (e.g. '44' for a border, '14' for a faint bg), converted to a percentage
    internally so call sites don't need to do the math by hand. */
export function withAlpha(color: string, hexAlpha: string): string {
  const pct = Math.round((parseInt(hexAlpha, 16) / 255) * 100);
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}
