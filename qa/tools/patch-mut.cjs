const fs = require('fs');
let s = fs.readFileSync('mutate-1432.mjs', 'utf8');
const rep = (from, to) => { if (s.split(from).length !== 2) throw new Error('anchor not unique: ' + from.slice(0, 60)); s = s.replace(from, () => to); };
rep(`const SAME = "if (storedSubId && storedSubId === incomingSubId) {";`, `const SAME = "if (storedSubId === incomingSubId) {";\nconst IDLESS = "if (!storedSubId) {";`);
rep(`todoN === 3;`, `todoN === 0;`);
rep(`(want 0 red, 3 todo)`, `(want 0 red, 0 todo)`);
rep(`red: ['C3.', 'R7.'] },`, `red: ['C3.', 'C11.', 'R7.'] },`);
rep(`];\n\nconst revert`, `  { name: 'L15 the id-less rule removed (a first purchase on an id-less pro row is reported and dropped again)', f: LIB, from: IDLESS, to: 'if (false) {', red: ['C9.', 'C10.', 'R12.'] },
  { name: 'L16 the id-less rule over-applies (everything applies)', f: LIB, from: IDLESS, to: 'if (true) {', red: ['C1.', 'C10.', 'R1.', 'R13.', 'R14.'] },
  { name: 'Ro8 route: the read error is ignored again (fails open)', f: ROUTE, from: 'if (readErr) {', to: 'if (false) {', red: ['R11.'] },
  { name: 'Ro9 route: a failed read answers 500', f: ROUTE, from: "return NextResponse.json({ received: true, ignored: 'stored_read_failed' });", to: "return NextResponse.json({ error: 'x' }, { status: 500 });", red: ['R11.'] },
  { name: 'Ro10 route: a failed read is reported but still falls through to the write', f: ROUTE, from: "return NextResponse.json({ received: true, ignored: 'stored_read_failed' });", to: '/* fallthrough */', red: ['R11.'] },
  { name: 'Ro11 route: a failed read is not reported', f: ROUTE, from: 'stored-subscription read failed before the identity decision', to: 'x before the identity decision', red: ['R11.'] },
];\n\nconst revert`);
fs.writeFileSync('mutate-1432.mjs', s);
console.log('patched');
