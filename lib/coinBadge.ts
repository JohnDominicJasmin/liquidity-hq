// Deterministic per-coin badge color - not brand colors (most alts don't have a
// canonical one), just a stable, varied hue so each row gets a recognizable dot.
const BADGE_PALETTE = [
  '#f7931a', '#627eea', '#9945ff', '#00aae4', '#f3ba2f', '#00c08b',
  '#f87171', '#4ade80', '#fbbf24', '#60a5fa', '#f472b6', '#2dd4bf',
];

export function coinBadgeColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return BADGE_PALETTE[h % BADGE_PALETTE.length];
}
