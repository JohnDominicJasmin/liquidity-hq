const fs = require('fs');
const f = process.argv[2];
const lines = fs.readFileSync(f, 'utf8').split('\n');
const i = lines.findIndex((l) => l.includes("(pr.title ?? '') + ' ' + (pr.body ?? '')"));
if (i < 0) throw new Error('line not found');
lines[i] = "  for (const m of ((pr.title ?? '') + ' ' + (pr.body ?? '')).matchAll(/#([0-9]{3,4})/g)) refs.add(Number(m[1]));";
fs.writeFileSync(f, lines.join('\n'));
console.log('line', i + 1, '->', lines[i]);
