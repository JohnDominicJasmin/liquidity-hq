const hex = h => { h = h.replace('#',''); return [0,2,4].map(i => parseInt(h.slice(i,i+2),16)); };
const lin = c => { c/=255; return c <= 0.03928 ? c/12.92 : ((c+0.055)/1.055)**2.4; };
const L = ([r,g,b]) => 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);
const cr = (a,b) => { const [x,y] = [L(a),L(b)].sort((p,q)=>q-p); return ((x+0.05)/(y+0.05)).toFixed(2); };
const over = ([r,g,b,a],[R,G,B]) => [r*a+R*(1-a), g*a+G*(1-a), b*a+B*(1-a)];
const T = {
  dark:  { bg1:'#141517', bg2:'#111416', txt2:'#8b8f94', txt3:'#7c828a', txt4:'#3a3f45', bdr:'#1f2225', bdr3:'#16191b' },
  light: { bg1:'#ebe9e6', bg2:'#e3e1dd', txt2:'#585c61', txt3:'#5e6267', txt4:'#aeaaa4', bdr:'#d5d2cd', bdr3:'#e2dfda' },
};
for (const [th, t] of Object.entries(T)) {
  for (const bg of ['bg1','bg2']) {
    const B = hex(t[bg]);
    const row = ['txt2','txt3','txt4','bdr','bdr3'].map(k => `${k} ${cr(hex(t[k]),B)}`).join('  ');
    console.log(`${th} on ${bg}: ${row}`);
  }
}
// chart badges: white@a text on rgba(30,30,30,a) pill, over a ground
for (const [ta, pa] of [[0.65,0.72],[0.80,0.88]]) {
  for (const [name, g] of [['white','#ffffff'],['light bg1','#ebe9e6'],['dark bg1','#141517'],['black','#000000']]) {
    const pill = over([30,30,30,pa], hex(g));
    const txt = over([255,255,255,ta], pill);
    console.log(`badge ${ta}/${pa} over ${name}: ${cr(txt,pill)}`);
  }
}
