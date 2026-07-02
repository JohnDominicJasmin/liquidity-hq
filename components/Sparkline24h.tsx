'use client';
import { useEffect, useState } from 'react';
import { getSparkline24h, ensureSparkline24h } from '@/lib/sparklineData';
import Sparkline from './Sparkline';

const REFRESH_MS = 5 * 60_000;

export default function Sparkline24h({ coin, width = 40, height = 14 }: { coin: string; width?: number; height?: number }) {
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

  return <Sparkline points={points} width={width} height={height} />;
}
