const fs = require('fs');
const f = process.argv[2];
let s = fs.readFileSync(f, 'utf8');
const rep = (from, to) => { if (s.split(from).length !== 2) throw new Error('anchor: ' + from.slice(0, 60)); s = s.replace(from, () => to); };
// 1. entries may be "file" or "file:project"; ONLY overrides the default list
rep("import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';", "import { appendFileSync, writeFileSync, mkdirSync, createWriteStream } from 'node:fs';");
rep("const WARN_GB = 2.5, ABORT_GB = 1.6;", "const ONLY = (process.env.ONLY ?? '').split(',').map((x) => x.trim()).filter(Boolean);\nif (ONLY.length) { FILES.length = 0; FILES.push(...ONLY); }\nconst WARN_GB = 2.5, ABORT_GB = 1.6;");
rep("  const f = FILES[i];", "  const [f, proj] = FILES[i].split(':');");
rep("  const logFile = `${OUT}/${String(i).padStart(2, '0')}-${f}.log`;", "  const logFile = `${OUT}/${String(i).padStart(2, '0')}-${f}${proj ? '-' + proj : ''}.log`;\n  const logStream = createWriteStream(logFile);");
rep("['playwright', 'test', `qa/e2e/${f}.spec.ts`, '--workers=1', '--reporter=list']", "['playwright', 'test', `qa/e2e/${f}.spec.ts`, '--workers=1', '--reporter=list', ...(proj ? [`--project=${proj}`] : [])]");
rep("  child.stdout.on('data', (d) => { out += d; });\n  child.stderr.on('data', (d) => { out += d; });", "  // stream to the file AS IT ARRIVES: a reap must not take the only copy of the output with it\n  child.stdout.on('data', (d) => { out += d; logStream.write(d); });\n  child.stderr.on('data', (d) => { out += d; logStream.write(d); });");
rep("  writeFileSync(logFile, out);\n", "  logStream.end();\n");
rep("say(`FILE_DONE ${f} exit=", "say(`FILE_DONE ${f}${proj ? ':' + proj : ''} exit=");
fs.writeFileSync(f, s);
console.log('patched v2');
