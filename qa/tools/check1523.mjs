import { selectAllRows } from './lib/selectAllRows.ts';
const run = async (n, opts) => {
  const calls = [];
  const table = Array.from({ length: n }, (_, i) => ({ i }));
  const q = () => {
    const b = {
      order() { return b; },
      range(from, to) { calls.push([from, to]); const end = Math.min(to + 1, from + 1000); return Promise.resolve({ data: table.slice(from, end), error: null }); },
    };
    return b;
  };
  let warns = 0; const w = console.warn; console.warn = () => { warns++; };
  const r = await selectAllRows('t', 'id', q, opts);
  console.warn = w;
  const uniq = new Set(r.data.map(x => x.i)).size;
  console.log(`n=${n} ${JSON.stringify(opts ?? {})} -> returned=${r.data.length} unique=${uniq} truncated=${r.truncated} warns=${warns} requests=${calls.length} last=${JSON.stringify(calls.at(-1))}`);
};
for (const n of [0, 999, 1000, 9999, 10000, 10001, 12000]) await run(n);
for (const n of [6, 7, 8]) await run(n, { pageSize: 3, maxRows: 7 });
