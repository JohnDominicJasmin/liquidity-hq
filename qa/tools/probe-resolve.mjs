// Plain Node resolution, NO hook registered. Which of these can Node not resolve on its own?
import { readFileSync } from 'node:fs';
const specs = readFileSync(process.argv[2], 'utf8').split(/\r?\n/).filter(Boolean);
const fails = [];
for (const s of specs) {
  try { import.meta.resolve(s); } catch (e) { fails.push([s, e.code ?? 'ERR']); }
}
console.log(JSON.stringify(fails));
