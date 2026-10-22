const fs = require('fs');
const f = 'qa/alias-hooks.mjs';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(f, 'utf8');
const crlf = s.includes(CR + LF);
s = s.split(CR + LF).join(LF);
const a = 'export async function resolve(specifier, context, next) {';
if (s.split(a).length !== 2) throw new Error('anchor');
s = s.replace(a, 'async function resolveInner(specifier, context, next) {');
s += `
/* JSON WITHOUT AN IMPORT ATTRIBUTE. Next's bundler accepts \`import labels from '@/lib/labelDefaults.en.json'\`; Node
 * refuses it (ERR_IMPORT_ATTRIBUTE_MISSING) unless the import carries \`with { type: 'json' }\`. Three source files import
 * that JSON bare (lib/aiUsage.ts among them), so anything importing them was unreachable from a test. This is the sixth
 * kind of forgiveness, decided on purpose: bounded to \`.json\` files INSIDE this repo and never node_modules, so a
 * package's own JSON stays exactly as Node treats it. __tests__/aliasHookScope.test.mts fails if the set of bare JSON
 * imports in the source changes. */
export async function resolve(specifier, context, next) {
  const r = await resolveInner(specifier, context, next);
  if (r && typeof r.url === 'string' && r.url.endsWith('.json') && r.url.startsWith(ROOT)
      && !r.url.includes('/node_modules/') && context.importAttributes?.type !== 'json') {
    return { ...r, importAttributes: { ...(r.importAttributes ?? {}), type: 'json' } };
  }
  return r;
}
`;
if (crlf) s = s.split(LF).join(CR + LF);
fs.writeFileSync(f, s);
console.log('hook patched, CRLF kept:', crlf);
