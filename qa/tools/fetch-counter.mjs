/* Counts OUTBOUND fetches by host, from inside the running server.
 *
 * #1409's assertions are all "N requests in -> ONE upstream call out". Counting
 * at the server is the only honest way to check that: the response body is
 * identical whether it came from the cache or from a fresh upstream call, so
 * inspecting the body answers a different question.
 *
 * Loaded with `node --import`, so it wraps global fetch before Next starts.
 * Counts go to a JSON file the harness reads, not to stdout - log lines
 * interleave, and a dropped line silently LOWERS a count, which would read as
 * "the cache worked". The failure mode of the instrument must not look like
 * the result we are hoping for.
 *
 * Reset is done by deleting the file; the counter recreates it. That avoids
 * restarting the server between steps, which would also clear the in-memory
 * cache under test and make every assertion trivially pass.
 */
import { writeFileSync } from 'node:fs';

const OUT = process.env.QA_FETCH_COUNTS ?? 'fetch-counts.json';
const counts = Object.create(null);
const original = globalThis.fetch;
let total = 0;

const flush = () => {
  try { writeFileSync(OUT, JSON.stringify({ total, hosts: counts })); } catch { /* never break the server */ }
};

globalThis.fetch = function countedFetch(input, init) {
  let host = 'unparsed';
  try {
    const url = typeof input === 'string' ? input : (input?.url ?? String(input));
    host = new URL(url).host;
  } catch { /* relative or odd input - keep 'unparsed' rather than guessing a host */ }
  counts[host] = (counts[host] ?? 0) + 1;
  total += 1;
  flush();
  return original.call(this, input, init);
};

/* Deliberately SILENT. An earlier version logged one line on load, and because
   NODE_OPTIONS applies to every node process, that line landed in npm's own
   internal output and broke `npx next start` with a module-not-found naming the
   log text as a path. The counter's liveness is proved by the control step in
   the harness, not by a banner. */
flush();
