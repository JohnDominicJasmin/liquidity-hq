const hex = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const L = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const x = L(a), y = L(b); return ((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2); };
const over = (fg, a, bg) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));

const rows = [
  // [label, fg, bg]
  ['TD settings push caption --red on .st-section --bg1', hex('#f0524d'), hex('#141517')],
  ['TD settings push caption --red-fg on --bg1 (alt)', hex('#ff8a85'), hex('#141517')],
  ['TL settings push caption --red on .st-section #fff', hex('#9d1a23'), hex('#ffffff')],
  ['TD onboarding alert --red on --bg #000', hex('#f0524d'), hex('#000000')],
  ['TL onboarding alert --red on --bg #E8EAED', hex('#9d1a23'), hex('#E8EAED')],
  ['TD focus ring --accent on row --bg1', hex('#d9a626'), hex('#141517')],
  ['TD focus ring --accent on hover row (white 4%)', hex('#d9a626'), over(hex('#ffffff'), 0.04, hex('#141517'))],
  ['TD focus ring --accent on selected row (rgba(26,122,255,.11))', hex('#d9a626'), over(hex('#1a7aff'), 0.11, hex('#141517'))],
  ['TL focus ring --accent on row --bg1', hex('#754e00'), hex('#ebe9e6')],
  ['TL focus ring --accent on hover row (black 3%)', hex('#754e00'), over(hex('#000000'), 0.03, hex('#ebe9e6'))],
  ['TL focus ring --accent on selected row (accent 7%)', hex('#754e00'), over(hex('#754e00'), 0.07, hex('#ebe9e6'))],
  ['TD selected coin text --purple(=accent) on selected row', hex('#d9a626'), over(hex('#1a7aff'), 0.11, hex('#141517'))],
];
for (const [l, f, b] of rows) console.log(ratio(f, b).padStart(6), ' ', l, ' bg=', b.join(','));
