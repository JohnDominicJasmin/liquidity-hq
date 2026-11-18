/* QA's richer fake database for the Telegram controls cells (#2567): everything in qa/telegramWorld.mjs plus what that world cannot do and the controls need:
 *   - PATCH honours the filters and answers the changed rows when the request asks for them (select=...), as PostgREST does: /pause and the plan-ended claim read that answer
 *   - the `or=(a.is.null,b.lt."x")` filter of the plan-ended claim, `not.is.null`, `in`, `eq`, `neq`, `lt`, `gt`, `gte`, `lte`
 *   - a GET with limit
 *   - a table can be made to fail (w.failTable[name] = 'GET' | 'PATCH' | 'ANY'), and a missing column can be simulated (w.missingColumns = { table: [col...] }): a select or update naming it answers 400 like PostgREST
 * Nothing leaves the machine: it wraps the fetch that installFakeFetch installs. Secrets are throwaway literals. */
import { makeWorld, installFakeFetch } from './telegramWorld.mjs';

export { makeWorld };

const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

function cmp(op, x, val) {
  if (op === 'eq') return String(x) === val;
  if (op === 'neq') return String(x) !== val;
  if (op === 'is') return val === 'null' ? x == null : val === 'true' ? x === true : x === false;
  if (op === 'in') return val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')).includes(String(x));
  if (x == null) return false;
  if (op === 'gte') return String(x) >= val;
  if (op === 'lte') return String(x) <= val;
  if (op === 'gt') return String(x) > val;
  if (op === 'lt') return String(x) < val;
  return true;
}
function leaf(row, col, expr) {                      // expr like "is.null", "lt.\"2026-..\"", "not.is.null", "eq.true"
  let neg = false, e = expr;
  if (e.startsWith('not.')) { neg = true; e = e.slice(4); }
  const dot = e.indexOf('.'); const op = e.slice(0, dot); const val = e.slice(dot + 1).replace(/^"|"$/g, '');
  const r = cmp(op, row[col], val);
  return neg ? !r : r;
}
function splitTop(s) { const out = []; let d = 0, q = false, cur = ''; for (const ch of s) { if (ch === '"') q = !q; if (!q && ch === '(') d++; if (!q && ch === ')') d--; if (!q && d === 0 && ch === ',') { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; }
export function filterRows(rows, params) {
  let out = rows;
  for (const [k, v] of params.entries()) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    if (k === 'or') {
      const parts = splitTop(v.replace(/^\(|\)$/g, ''));
      out = out.filter((r) => parts.some((p) => { const d = p.indexOf('.'); return leaf(r, p.slice(0, d), p.slice(d + 1)); }));
      continue;
    }
    out = out.filter((r) => leaf(r, k, v));
  }
  return out;
}

export function installControlsWorld(w) {
  installFakeFetch(w);
  const inner = globalThis.fetch;
  w.patches = []; w.failTable = w.failTable ?? {}; w.missingColumns = w.missingColumns ?? {};
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url ?? input); const u = new URL(url); const method = (init?.method ?? 'GET').toUpperCase();
    if (u.host === 'stub.supabase.test' && u.pathname.startsWith('/rest/v1/') && !u.pathname.startsWith('/rest/v1/rpc/')) {
      const table = u.pathname.replace('/rest/v1/', '');
      const f = w.failTable[table]; if (f && (f === 'ANY' || f === method)) return json({ message: 'stand-in: table failing' }, 500);
      const miss = (w.missingColumns[table] ?? []);
      if (miss.length) {
        const named = [...(u.searchParams.get('select') ?? '').split(','), ...(init?.body && method === 'PATCH' ? Object.keys(JSON.parse(init.body)) : []), ...[...u.searchParams.keys()], ...(u.searchParams.get('or') ?? '').split(/[,()]/).map((s) => s.split('.')[0])].map((s) => s.trim());
        const bad = miss.find((c) => named.includes(c));
        if (bad) return json({ code: '42703', message: `column ${table}.${bad} does not exist`, details: null, hint: null }, 400);
      }
      const rows = w.tables[table] ?? (w.tables[table] = []);
      const wantsRows = u.searchParams.has('select') && /return=representation/.test(String(init?.headers?.Prefer ?? init?.headers?.prefer ?? new Headers(init?.headers).get('prefer') ?? ''));
      const accept = String(new Headers(init?.headers).get('accept') ?? '');
      if (method === 'GET') {
        let out = filterRows(rows, u.searchParams); const lim = u.searchParams.get('limit'); if (lim) out = out.slice(0, Number(lim));
        w.log.push(`GET stub.supabase.test/rest/v1/${table}`);
        if (accept.includes('vnd.pgrst.object')) return out.length === 1 ? json(out[0]) : json({ code: 'PGRST116', message: 'no rows', details: '', hint: '' }, 406);
        return json(out);
      }
      if (method === 'PATCH') {
        const body = JSON.parse(init.body); const hit = filterRows(rows, u.searchParams);
        w.writes.push({ method, table, query: u.search, body }); w.patches.push({ table, query: u.search, body, hit: hit.length });
        for (const r of hit) Object.assign(r, body);
        return wantsRows ? json(hit) : new Response(null, { status: 204 });
      }
    }
    return inner(input, init);
  };
}
