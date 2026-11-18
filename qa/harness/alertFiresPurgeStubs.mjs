/* Stand-in for lib/supabase-admin used by qa/harness/alertFiresPurge.test.mts: an in-memory lhq_alert_fires. delete().lt(col, iso) removes rows whose column is strictly less than iso (ISO strings compare as time) and reports the count. Every call is recorded; nothing leaves the machine. */
const h = () => (globalThis.__purge ??= { rows: [], calls: [], mode: 'ok' });
export const getSupabaseAdmin = () => ({
  from: (table) => ({
    delete: (opts) => ({
      lt: async (col, val) => {
        const s = h();
        s.calls.push({ table, opts, col, val });
        if (s.mode === 'error') return { error: { message: 'boom secret-row-data' }, count: null };
        if (s.mode === 'throw') throw new Error('network down');
        const before = s.rows.length;
        s.rows = s.rows.filter((r) => !(String(r[col]) < String(val)));
        return { error: null, count: before - s.rows.length };
      },
    }),
    select: () => { h().calls.push({ table, select: true }); throw new Error('purge must not select'); },
  }),
});
