'use client';
import { useEffect, useState } from 'react';

/** True once `ms` have passed since the component mounted, or since `resetKey` last changed when one is given (a coin switch starts a new wait instead of showing the failure at once). A panel that waits on a reading uses it to turn "still coming" into
 *  "not available" instead of showing a skeleton for ever (OWNER-RULES 21). */
export function useGraceElapsed(ms = 15_000, resetKey?: unknown): boolean {
  const [doneFor, setDoneFor] = useState<{ key: unknown } | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setDoneFor({ key: resetKey }), ms);
    return () => clearTimeout(id);
  }, [ms, resetKey]);
  return doneFor !== null && Object.is(doneFor.key, resetKey);
}
