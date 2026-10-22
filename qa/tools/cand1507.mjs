import fs from 'node:fs';
const src = fs.readFileSync('contrast1507.mjs', 'utf8').split('const ctx =')[0];
eval(src + `
const card='#141517', page='#08090a';
for (const [n,c] of [['--bdr2 border',' #131618'.trim()],['--bdr border','#1f2225'],['candidate #1b1d20','#1b1d20'],['candidate #1f2225','#1f2225']]) {
  console.log(n, c, 'vs card dE00', de2000(c, card).toFixed(2), 'ratio', cr(c, card).toFixed(3), '| vs page dE00', de2000(c, page).toFixed(2), '| --txt on it', cr('#e8e9ea', c).toFixed(2), '--txt2 on it', cr('#8b8f94', c).toFixed(2));
}`);
