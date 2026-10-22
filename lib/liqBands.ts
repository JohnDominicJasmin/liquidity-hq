/* The liquidation ladder's arithmetic, kept out of the component so it can be tested directly.
 *
 * It lived inside components/LiqTerminal.tsx and was unexported. Exporting it there would not have helped: the test loader
 * (qa/alias-register.mjs + node --test) cannot runtime-import a .tsx, so every existing test that needs a component reads it as
 * source text instead. A plain .ts module is the honest way to reach this - the test calls the function the screen calls.
 *
 * Nothing here knows about React, labels or the DOM. */

export const TIERS = [
  { lev: 125, dist: 0.0080, w: 0.02 },
  { lev: 100, dist: 0.0100, w: 0.04 },
  { lev: 75,  dist: 0.0133, w: 0.03 },
  { lev: 50,  dist: 0.0200, w: 0.07 },
  { lev: 40,  dist: 0.0250, w: 0.04 },
  { lev: 30,  dist: 0.0333, w: 0.06 },
  { lev: 25,  dist: 0.0400, w: 0.08 },
  { lev: 20,  dist: 0.0500, w: 0.10 },
  { lev: 15,  dist: 0.0667, w: 0.08 },
  { lev: 12,  dist: 0.0833, w: 0.06 },
  { lev: 10,  dist: 0.1000, w: 0.10 },
  { lev: 8,   dist: 0.1250, w: 0.05 },
  { lev: 6,   dist: 0.1667, w: 0.04 },
  { lev: 5,   dist: 0.2000, w: 0.07 },
  { lev: 4,   dist: 0.2500, w: 0.05 },
  { lev: 3,   dist: 0.3333, w: 0.06 },
  { lev: 2,   dist: 0.5000, w: 0.05 },
];

export interface Band {
  /* #1651: usdM is null when the long/short split is UNKNOWN. The price level is price x 1/leverage and stands on its own; the dollar
     figure is openInterest x that split, so without it there is no amount to show - and 50/50 was being substituted silently. */
  price: number; distPct: number; usdM: number | null;
  lev: string; side: 'long' | 'short'; barPct: number; isMagnet: boolean;
}

/* #1651 (owner's data rule): longR/shortR are NULL when nothing measured the split. They used to arrive as `?? 0.5`, so an unknown
   became a plausible 50/50 and was multiplied through every dollar figure and bar on screen. Unknown now stays unknown: the ladder keeps
   its price levels and leverages, the amounts read "-", no bar is drawn, and the long-vs-short bias is not claimed at all. */
export function computeBands(price: number, oi: number, longR: number | null, shortR: number | null, maxDist: number) {
  const oiM = oi / 1e6;
  const active = TIERS.filter(t => t.dist <= maxDist);

  const longs: Band[] = active.map(t => ({
    price: price * (1 - t.dist), distPct: t.dist * 100,
    usdM: longR === null ? null : oiM * longR * t.w, lev: `${t.lev}x`,
    side: 'long' as const, barPct: 0, isMagnet: false,
  }));
  const shorts: Band[] = active.map(t => ({
    price: price * (1 + t.dist), distPct: t.dist * 100,
    usdM: shortR === null ? null : oiM * shortR * t.w, lev: `${t.lev}x`,
    side: 'short' as const, barPct: 0, isMagnet: false,
  }));

  const amounts = [...longs, ...shorts].map(b => b.usdM).filter((v): v is number => v !== null);
  const maxUSD = Math.max(...amounts, 1);
  [...longs, ...shorts].forEach(b => { b.barPct = b.usdM === null ? 0 : (b.usdM / maxUSD) * 100; });

  /* The magnet is the biggest band. With no amounts there is no biggest, so nothing is marked rather than the first row being crowned. */
  const byUsd = (a: Band, b: Band) => (b.usdM ?? 0) - (a.usdM ?? 0);
  const magL = longs.length  && longs[0].usdM  !== null ? [...longs].sort(byUsd)[0]  : null;
  const magS = shorts.length && shorts[0].usdM !== null ? [...shorts].sort(byUsd)[0] : null;
  if (magL) magL.isMagnet = true;
  if (magS) magS.isMagnet = true;

  return {
    longs, shortsDisplay: [...shorts].reverse(),
    magnetLong: magL, magnetShort: magS,
    totalLongM: longR === null ? null : longs.reduce((s, b) => s + (b.usdM ?? 0), 0),
    totalShortM: shortR === null ? null : shorts.reduce((s, b) => s + (b.usdM ?? 0), 0),
    tierCount: active.length,
  };
}
