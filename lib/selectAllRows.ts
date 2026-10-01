/* Every row a Supabase read matches, not just the first 1000 (#1397).
 *
 * PostgREST answers at most db-max-rows per request (1000 on this project) and
 * clamps without an error: a plain `.select()` over 1,500 matching rows returns
 * 1,000 of them and says nothing. For a cron that walks a whole table - every
 * active price alert, every connected Telegram chat ID - the rows past that
 * point are never looked at. Their alerts never fire; their owners never get a
 * message.
 *
 * This reads in `.range()` pages of PAGE_ROWS, ordered by columns that are
 * unique together, so a page boundary never skips or repeats a row (without an
 * ORDER BY, Postgres makes no promise that two requests see rows in the same
 * order). It stops at the first short page. PAGE_ROWS must not exceed the
 * project's db-max-rows: a server cap below it would make every page look short
 * and end the read after one.
 *
 * MAX_ROWS is a sanity bound on one read, not a product limit - the same
 * 10,000 app/api/price-alerts GET uses. The read asks for one row past it, the
 * only way to tell "exactly MAX_ROWS" (every row read) from "more than
 * MAX_ROWS": a table of exactly 10,000 ends on an empty page and is not
 * truncated. Only more than MAX_ROWS sets `truncated` and logs a warning under
 * `label`, instead of cutting silently. At most MAX_ROWS rows are returned.
 *
 * Errors follow supabase-js: if any page fails, the result is `data: null` and
 * that page's error, never a partial list. A caller written for one plain read
 * keeps exactly the error handling it had.
 *
 * `query` is a factory, not a builder, because a PostgREST builder is changed
 * in place by `.order()` and `.range()` and can be awaited only once - every
 * page needs a fresh one. */

export const PAGE_ROWS = 1000;
export const MAX_ROWS = 10_000;

interface PageResponse<Row, Err> {
  data: Row[] | null;
  error: Err | null;
}

/* The two builder methods this needs, typed structurally so the helper does
   not import supabase-js and a test can pass a stub that records the calls. */
export interface RangeableQuery<Row, Err> {
  order(column: string, options?: { ascending?: boolean }): RangeableQuery<Row, Err>;
  range(from: number, to: number): PromiseLike<PageResponse<Row, Err>>;
}

export type AllRows<Row, Err> =
  | { data: Row[]; error: null; truncated: boolean }
  | { data: null; error: Err; truncated: false };

export async function selectAllRows<Row, Err>(
  label: string,
  orderBy: string | readonly string[],
  query: () => RangeableQuery<Row, Err>,
  { pageSize = PAGE_ROWS, maxRows = MAX_ROWS }: { pageSize?: number; maxRows?: number } = {},
): Promise<AllRows<Row, Err>> {
  const columns = typeof orderBy === 'string' ? [orderBy] : orderBy;
  const rows: Row[] = [];
  const readTo = maxRows + 1;
  for (let from = 0; from < readTo; from += pageSize) {
    const to = Math.min(from + pageSize, readTo) - 1;
    let q = query();
    for (const column of columns) q = q.order(column, { ascending: true });
    const { data, error } = await q.range(from, to);
    if (error) return { data: null, error, truncated: false };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < to - from + 1) break;
  }
  if (rows.length <= maxRows) return { data: rows, error: null, truncated: false };
  console.warn(`[${label}] read stopped at the ${maxRows}-row bound; rows past it were not read`);
  return { data: rows.slice(0, maxRows), error: null, truncated: true };
}
