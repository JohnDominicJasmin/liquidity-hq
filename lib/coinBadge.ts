// Deterministic per-coin badge color - not brand colors (most alts don't have a
// canonical one), just a stable, varied hue so each row gets a recognizable dot.
//
// RETURNS A TOKEN, NOT A HEX (#756). The twelve hues used to be literals here,
// so the dots did not follow the theme: as graphics against the light cards
// they measured 1.28 to 3.46, ten of twelve below 3:1. The values live in
// app/globals.css as --badge-0..11 with a light-theme override, which is the
// only place a per-theme value can live - this module is pure and has no idea
// which theme is active.
//
// Every consumer feeds the result to CSS - a background, a border, or
// withAlpha() which wraps it in color-mix() - so a var() works everywhere a
// hex did. Nothing does colour arithmetic on it in JS; if something ever needs
// to, it has to read the computed value rather than parse this.
export const BADGE_SLOTS = 12;

export function coinBadgeColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `var(--badge-${h % BADGE_SLOTS})`;
}
