/* The size limits on the tables a signed-in user writes (#1632 H1 + M9). The DATABASE enforces them (migration 20261021e: CHECK constraints,
 * a per-account row cap, an active-alert cap), because a browser can write those tables directly. This file holds the same numbers for the
 * routes and inputs, so a real user meets a clear message before a database error, and maps the database's refusals to that message.
 * Change a number here and in the migration together. */

export const TEXT_LIMITS = {
  tradeNotes: 2000,
  hypothesisTitle: 300,
  hypothesis: 4000,
  criterion: 500,
  criteriaCount: 10,
  evidenceContent: 4000,
  evidenceSource: 2000,
  alertLabel: 200,
  /** The AI-written analysis fields on a hypothesis (written by the server, through the user's own client). */
  aiLong: 20000,
  aiShort: 64,
  aiNextCheck: 4000,
} as const;

/** At most this many ACTIVE price alerts per account. */
export const ACTIVE_ALERT_CAP = 50;

export interface LimitRefusal { status: 400; error: string; message: string }

/** A database refusal from one of the limits above, as a 400 the UI can show; null for any other error. */
export function limitRefusal(err: { code?: string; hint?: string | null; message?: string } | null | undefined): LimitRefusal | null {
  if (!err) return null;
  if (err.hint === 'LHQ_ALERT_CAP') return { status: 400, error: 'ALERT_LIMIT', message: `You can have up to ${ACTIVE_ALERT_CAP} active price alerts. Delete one to add another.` };
  if (err.hint === 'LHQ_ROW_CAP') return { status: 400, error: 'ROW_LIMIT', message: 'This account has reached the limit for this list. Delete some entries to add more.' };
  if (err.code === '23514') return { status: 400, error: 'TOO_LONG', message: 'That text is too long.' };
  return null;
}

/** Cut text to a limit (for server-written fields, which should never be refused for length). */
export function clip(s: string | null | undefined, max: number): string | null {
  if (s == null) return null;
  return s.length > max ? s.slice(0, max) : s;
}
