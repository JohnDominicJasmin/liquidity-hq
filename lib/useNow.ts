'use client';
import { useEffect, useState } from 'react';

/**
 * Wall-clock time as React state, re-read on an interval.
 *
 * Two separate problems this solves, and the second is the one that actually
 * bit us:
 *
 * 1. Calling `Date.now()` in a render body makes render impure - the same props
 *    can produce different output on two consecutive renders. That is what
 *    react-hooks/purity objects to, and it misbehaves under a renderer that is
 *    free to interrupt and restart a render.
 *
 * 2. It is usually a live bug regardless of lint. A "3m ago" computed during
 *    render only changes when something ELSE causes a re-render, so relative
 *    timestamps and freshness cutoffs sit frozen at whatever they were when the
 *    component last happened to render - sometimes for as long as the tab is
 *    open. Several of these were reading as "just now" indefinitely.
 *
 * Taking the clock as state fixes both: the value is stable within a render,
 * and it advances on a schedule.
 *
 * Choose the interval to match the granularity actually displayed - 1_000 for a
 * seconds countdown, 60_000 for "Nm ago" text. Don't tick faster than the text
 * can change; that is just re-renders nobody sees.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
