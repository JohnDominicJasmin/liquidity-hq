/* Which Lemon Squeezy events does the handler ACT ON, derived from the code rather than from a doc?
 * The sets are module-private, so they are read from source (weaker than an import, said so).
 * Usage: node handled-events.mjs <path to lib/lemonsqueezy.ts> */
import { readFileSync } from 'node:fs';

const src = readFileSync(process.argv[2], 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

function setOf(name) {
  const m = src.match(new RegExp(name + '\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)'));
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null;
}

const groups = ['SUBSCRIPTION_EVENTS', 'ENDS_ACCESS', 'RECORD_ONLY', 'IGNORED_INVOICE_EVENTS'];
const parsed = Object.fromEntries(groups.map((g) => [g, setOf(g)]));

// A parse that found nothing must not read as "handles nothing".
for (const g of ['SUBSCRIPTION_EVENTS', 'ENDS_ACCESS', 'RECORD_ONLY']) {
  if (!parsed[g] || !parsed[g].length) { console.log(`PARSE FAILED for ${g} - refusing to report`); process.exit(2); }
}

let acts = [];
for (const g of groups) {
  console.log('  ' + g.padEnd(24) + (parsed[g] ? parsed[g].join(', ') : '(not present in this version)'));
  if (g !== 'IGNORED_INVOICE_EVENTS' && parsed[g]) acts.push(...parsed[g]);
}
const subscribed = ['subscription_created', 'subscription_updated', 'subscription_cancelled', 'subscription_expired', 'subscription_payment_success'];

console.log(`\nEVENTS THE HANDLER ACTS ON (${acts.length}): ${acts.join(', ')}`);
console.log(`SUBSCRIBED ON qa, per PM (${subscribed.length}): ${subscribed.join(', ')}`);
const missing = acts.filter((e) => !subscribed.includes(e));
console.log(`ACTED ON BUT NOT SUBSCRIBED (${missing.length}): ${missing.join(', ') || '(none)'}`);
console.log(`SUBSCRIBED BUT NOT ACTED ON: ${subscribed.filter((e) => !acts.includes(e)).join(', ') || '(none)'}`);
