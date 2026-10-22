const fs = require('fs');
const f = '__tests__/aliasHookScope.test.mts';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(f, 'utf8');
const crlf = s.includes(CR + LF);
s = s.split(CR + LF).join(LF) + fs.readFileSync(process.argv[2], 'utf8').split(CR + LF).join(LF);
if (crlf) s = s.split(LF).join(CR + LF);
fs.writeFileSync(f, s);
console.log('appended');
