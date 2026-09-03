'use client';
import { useEffect, useState } from 'react';
import { getSparkline24h, ensureSparkline24h } from '@/lib/sparklineData';
import Sparkline from './Sparkline';

const REFRESH_MS = 5 * 60_000;

/* `bars` renders the canvas's histogram instead of the default polyline
   (#656). Dashboard 2a.dc.html:167 draws the rail's sparkline as eight 2px
   columns at height 12 in --txt4, not a line.
   An opt-in variant rather than a change to Sparkline: the polyline is also
   used by MarketsTerminal, and QA's finding that "the element does not
   exist" came from measuring for sub-4px children - an SVG polyline has
   none, so the sparkline read as absent when it was only a different form.
   Nothing was missing; the two implementations simply disagree. */
export default function Sparkline24h({ coin, width = 40, height = 14, bars = false, barCount = 8 }: {
  coin: string; width?: number; height?: number; bars?: boolean; barCount?: number;
}) {
  const [points, setPoints] = useState<number[]>(() => getSparkline24h(coin));

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const pts = await ensureSparkline24h(coin);
      if (alive && pts.length) setPoints(pts);
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, [coin]);

  if (bars) {
    /* Sample the series down to barCount columns and scale each against the
       window's own range, so a flat coin shows short bars rather than noise
       amplified to full height. No data yields nothing rather than a row of
       equal stubs, which would read as "flat" instead of "unknown". */
    /* data-spark says which state this is from outside the component. Both
       branches below are <div>s, so a probe for <svg> reports "absent" whether
       the bars drew or not - QA measured svgPresent: false and correctly said
       they could not tell the two apart. They can now: data-spark="empty" is
       the no-data path, data-spark="bars" plus 8 children is a live render.
       Second time a measurement could not see this element (the first looked
       for sub-4px children, which a polyline has none of). The component was
       right both times and unmeasurable both times, so the fix is a handle
       rather than a behaviour change. */
    if (points.length === 0) return <div data-spark="empty" style={{ width, height }} aria-hidden="true" />;
    const step = points.length / barCount;
    const sampled = Array.from({ length: barCount }, (_, i) => points[Math.min(points.length - 1, Math.floor(i * step))]);
    const lo = Math.min(...sampled), hi = Math.max(...sampled);
    const span = hi - lo || 1;
    return (
      <div
        data-spark="bars"
        style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height, width }}
        aria-hidden="true"
      >
        {sampled.map((v, i) => (
          <div
            key={i}
            style={{
              width: 2,
              height: Math.max(2, Math.round(((v - lo) / span) * height)),
              background: 'var(--txt4)',
            }}
          />
        ))}
      </div>
    );
  }

  return <Sparkline points={points} width={width} height={height} />;
}
