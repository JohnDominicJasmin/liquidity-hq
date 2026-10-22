/* Which label keys does production serve that staging does not, and the reverse; and how many shared keys differ in value. */
const get = async (host, l) => (await fetch(`https://${host}/api/labels?locale=${l}`, { signal: AbortSignal.timeout(60_000) })).json();
for (const l of ['en', 'ko', 'zh']) {
  const p = await get('liquidity-hq.com', l), s = await get('liquidity-hq-staging.onrender.com', l);
  const onlyP = Object.keys(p).filter((k) => !(k in s)), onlyS = Object.keys(s).filter((k) => !(k in p));
  const shared = Object.keys(p).filter((k) => k in s);
  const diff = shared.filter((k) => p[k] !== s[k]);
  console.log(`${l}: prod ${Object.keys(p).length}, staging ${Object.keys(s).length}; only on prod: ${JSON.stringify(onlyP)}; only on staging: ${JSON.stringify(onlyS)}; shared keys with a DIFFERENT value: ${diff.length}${diff.length ? ' e.g. ' + JSON.stringify(diff.slice(0, 6)) : ''}`);
}
