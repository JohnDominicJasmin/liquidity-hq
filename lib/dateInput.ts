/* A calendar date as a form sends it (YYYY-MM-DD). A string that is not a real date reached the database column and came back as a 500 (PM audit B12). */
export function isDateOnly(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
