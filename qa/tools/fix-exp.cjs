const fs = require('fs');
const f = process.argv[2];
let s = fs.readFileSync(f, 'utf8');
const a = "red: ['L15b.', 'V1.', 'V2.'] }";
if (s.split(a).length !== 3) throw new Error('expected two occurrences, got ' + (s.split(a).length - 1));
s = s.split(a).join("red: ['L15b.', 'V1.'] }");
fs.writeFileSync(f, s);
console.log('fixed expectations for A21 and A22 (V2 checks agreement between the flag and the route, which share one function)');
