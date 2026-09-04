/* Which label keys the database is overriding, and what the code would have said
 * (#675).
 *
 * THE BUG THIS MAKES VISIBLE, which it does not fix. A row in `lhq_labels`
 * silently wins over the shipped default in `lib/labelDefaults.en.json`. So a
 * label fix can be written, reviewed, merged, deployed and verified on staging
 * — and still not appear in production, because production's database holds an
 * older value for that key and nothing anywhere says so.
 *
 * That is what #675 is: `DASH_EDGE_CB_LABEL` shipped as "BTC CB prem" and prod
 * shows "CB Premium". The fix for that one row is a single UPDATE by someone
 * with the dashboard. **This is the part that stops the next one being
 * invisible.**
 *
 * Nothing here writes. It is a read and a comparison, and it is deliberately
 * pure so it can be tested without a database — the same split as
 * lib/lemonsqueezy.ts, and for the same reason: the interesting decision should
 * not need credentials to exercise.
 */

export type OverrideKind = 'overridden' | 'orphan' | 'defaultOnly';

export interface LabelOverride {
  key: string;
  /** What the database says. `null` for a key that exists only in code. */
  dbValue: string | null;
  /** What the code ships. `null` for a row whose key is not in the defaults. */
  codeDefault: string | null;
  kind: OverrideKind;
}

/** Compare the stored labels against the shipped defaults.
 *
 *  Three findings, and they are different problems rather than three severities
 *  of one:
 *
 *  - **`overridden`** — both exist and differ. This is #675's shape: a deploy
 *    that appears to do nothing. The most important of the three, and the only
 *    one anybody has been bitten by so far.
 *  - **`orphan`** — a row whose key no longer exists in code. Harmless to
 *    render and a real signal: it usually means a key was renamed and the old
 *    row was left behind, so the rename is one stale row away from being
 *    reverted by whoever restores a backup.
 *  - **`defaultOnly`** — shipped but never stored. **Normal, not a finding.**
 *    Most keys are in this state; the app falls back to the default and that is
 *    the design. Included so a caller can count it and so "the table is empty"
 *    can be told apart from "the query returned nothing".
 *
 *  A key present in both with the SAME value is not reported at all: the
 *  database agreeing with the code is the state everything else is measured
 *  against.
 *
 *  Sorted by key so two runs of the same data produce the same list — an ops
 *  page that reshuffles between refreshes is one nobody can diff by eye. */
export function diffLabels(
  dbRows: ReadonlyArray<{ key: string; value: string }>,
  defaults: Readonly<Record<string, string>>,
): LabelOverride[] {
  const out: LabelOverride[] = [];
  const seen = new Set<string>();

  for (const row of dbRows) {
    if (typeof row?.key !== 'string') continue;
    seen.add(row.key);
    const codeDefault = Object.prototype.hasOwnProperty.call(defaults, row.key)
      ? defaults[row.key]
      : null;
    if (codeDefault === null) {
      out.push({ key: row.key, dbValue: row.value, codeDefault: null, kind: 'orphan' });
    } else if (codeDefault !== row.value) {
      out.push({ key: row.key, dbValue: row.value, codeDefault, kind: 'overridden' });
    }
    // Equal values are the healthy case and are not reported.
  }

  for (const key of Object.keys(defaults)) {
    if (!seen.has(key)) {
      out.push({ key, dbValue: null, codeDefault: defaults[key], kind: 'defaultOnly' });
    }
  }

  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** Counts for a summary line. `overridden` is the number that matters — it is
 *  the count of deploys that would silently do nothing. */
export function summarise(rows: ReadonlyArray<LabelOverride>): Record<OverrideKind, number> {
  const counts: Record<OverrideKind, number> = { overridden: 0, orphan: 0, defaultOnly: 0 };
  for (const r of rows) counts[r.kind]++;
  return counts;
}
