'use client';

export default function Sparkline({ points, width = 44, height = 16 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) {
    return <div style={{ width, height, flexShrink: 0 }} />;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const up = points[points.length - 1] >= points[0];
  const col = up ? 'var(--green)' : 'var(--red)';
  const step = width / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = i * step;
    const y = height - ((p - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ flexShrink: 0, display: 'block' }}>
      <polyline points={coords} fill="none" stroke={col} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
    </svg>
  );
}
