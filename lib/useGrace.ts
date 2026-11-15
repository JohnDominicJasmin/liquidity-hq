'use client';
import { useEffect, useState } from 'react';

/** True once `ms` have passed since the component mounted. A panel that waits on a reading uses it to turn "still coming" into
 *  "not available" instead of showing a skeleton for ever (OWNER-RULES 21). */
export function useGraceElapsed(ms = 15_000): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setOver(true), ms);
    return () => clearTimeout(id);
  }, [ms]);
  return over;
}
