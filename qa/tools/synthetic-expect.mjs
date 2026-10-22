/* Independent expectation for the synthetic-ledger SQL check: same generator as the SQL, computed in JS. */
const A = 'A', D = 'D';
const rows = [];
for (let g = 0; g < 1500; g++) {
  rows.push({
    g,
    user: g % 3 === 0 ? A : D,
    type: g % 7 === 0 ? 'chat_search' : g % 11 === 0 ? null : 'briefing',
    cost: g % 5 === 0 ? null : 0.008,
  });
}
const agg = (pred) => {
  const r = rows.filter(pred);
  const cost = r.filter((x) => x.cost !== null).reduce((s, x) => s + x.cost, 0);
  const nulls = r.filter((x) => x.cost === null);
  return {
    n: r.length,
    cost: Math.round(cost * 1e6) / 1e6,
    null_search: nulls.filter((x) => x.type === 'chat_search').length,
    null_other: nulls.filter((x) => x.type !== 'chat_search').length,
  };
};
console.log('all rows, since g>=0     :', JSON.stringify(agg(() => true)));
console.log('all rows, since g>=750   :', JSON.stringify(agg((x) => x.g >= 750)));
console.log('user A,   since g>=0     :', JSON.stringify(agg((x) => x.user === A)));
console.log('user A,   since g>=750   :', JSON.stringify(agg((x) => x.user === A && x.g >= 750)));
console.log('user A,   since g>=1499  :', JSON.stringify(agg((x) => x.user === A && x.g >= 1499)));
console.log('all rows, since g>=1500  :', JSON.stringify(agg((x) => x.g >= 1500)));
