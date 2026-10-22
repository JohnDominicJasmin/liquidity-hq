// WCAG contrast + CIEDE2000 between toast surface and what sits under it, per context.
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const L = (h) => { const [r, g, b] = hex(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const cr = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function lab(h) {
  const [r, g, b] = hex(h).map(lin);
  let X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
function de2000(a, b) {
  const [L1, a1, b1] = lab(a), [L2, a2, b2] = lab(b);
  const rad = Math.PI / 180, C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G), a2p = a2 * (1 + G), C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (x, y) => { if (x === 0 && y === 0) return 0; const v = Math.atan2(y, x) / rad; return v < 0 ? v + 360 : v; };
  const h1p = h(a1p, b1), h2p = h(a2p, b2);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = h2p - h1p; if (C1p * C2p === 0) dhp = 0; else if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p; if (C1p * C2p !== 0) { if (Math.abs(h1p - h2p) > 180) hbp += h1p + h2p < 360 ? 360 : -360; hbp /= 2; }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const SL = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2), SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T;
  const RT = -2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hbp - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH));
}
const ctx = {
  'terminal dark (default)': { card: '#141517', page: '#08090a', bg1: '#141517', bg2: '#111416', txt: '#e8e9ea', txt2: '#8b8f94' },
  'terminal light': { card: '#ffffff', page: '#f7f6f3', bg1: '#ebe9e6', bg2: '#e3e1dd', txt: '#15181b', txt2: '#585c61' },
  'current dark': { card: '#06070a', page: '#030405', bg1: '#06070a', bg2: '#0a0c10', txt: '#e8eaf0', txt2: '#7a7e94' },
  'current light': { card: '#ffffff', page: '#e8eaed', bg1: '#ffffff', bg2: '#f2f3f5', txt: '#111318', txt2: '#44475a' },
};
for (const [name, c] of Object.entries(ctx)) {
  console.log(`\n${name}`);
  for (const [k, toast] of [['before --bg1', c.bg1], ['after  --bg2', c.bg2]]) {
    console.log(`  ${k} ${toast}: vs card ${c.card} ratio ${cr(toast, c.card).toFixed(3)} dE00 ${de2000(toast, c.card).toFixed(2)} | vs page ${c.page} ratio ${cr(toast, c.page).toFixed(3)} dE00 ${de2000(toast, c.page).toFixed(2)} | txt ${cr(c.txt, toast).toFixed(2)} txt2(saving) ${cr(c.txt2, toast).toFixed(2)} | L* ${lab(toast)[0].toFixed(1)} card L* ${lab(c.card)[0].toFixed(1)}`);
  }
}
