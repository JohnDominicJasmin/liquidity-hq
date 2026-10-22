import { parseCssColor, compositeOver, contrastRatio } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/lib/readableOn.ts';

// Values copied from components/KLineProChart.tsx (the Bybit-fallback badge and the
// new "Couldn't draw" badge use IDENTICAL styling), and the chart ground documented
// there for #752: #000000 in both dark themes, #E8EAED in both light ones.
const PILL = 'rgba(30,30,30,0.72)';
const TEXT = 'rgba(255,255,255,0.65)';
const GROUNDS = { 'dark (both designs)': '#000000', 'light (both designs)': '#E8EAED' };

const pill = parseCssColor(PILL);
const text = parseCssColor(TEXT);
for (const [name, g] of Object.entries(GROUNDS)) {
  const ground = parseCssColor(g).rgb;
  const pillOnGround = compositeOver(pill.rgb, ground, pill.alpha);        // opaque result
  const textOnPill = compositeOver(text.rgb, pillOnGround, text.alpha);    // opaque result
  const ratio = contrastRatio(textOnPill, pillOnGround);
  console.log(`${name.padEnd(22)} ground ${g}  pill->${pillOnGround.map(Math.round)}  text->${textOnPill.map(Math.round)}  contrast ${ratio.toFixed(2)}:1  ${ratio >= 4.5 ? 'passes 4.5' : 'FAILS 4.5 (normal text)'}`);
}
// Sanity check the helper against a known pair, so a wrong-argument-order bug shows.
console.log('sanity: white on black =', contrastRatio([255,255,255],[0,0,0]).toFixed(2), '(expect 21.00)');
