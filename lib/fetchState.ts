// #1342: shared shape for "not yet known" vs. "confirmed empty", replacing
// four ad-hoc `?? []` / `?? false` guards with one. Contract proposed by QA
// on #1345 before this file existed - built against that PR's tests, not
// the other way round.

export type FetchState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T };

// `result` is null for a read that hasn't resolved yet (not started, or
// still in flight - callers pass null until their fetch settles).
export function fetchStateFromResult<T>(
  result: { ok: true; data: T } | { ok: false; message: string } | null
): FetchState<T> {
  if (result === null) return { status: 'loading' };
  if (!result.ok) return { status: 'error', message: result.message };
  return { status: 'ready', data: result.data };
}

export function isConfirmedEmpty<T>(state: FetchState<T>): boolean {
  return state.status === 'ready' && Array.isArray(state.data) && state.data.length === 0;
}
