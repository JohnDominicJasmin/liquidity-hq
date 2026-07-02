// Lightweight in-session price trail for sparklines — module-level ring buffers,
// not persisted, not touching the realtime data pipeline. Populated by a single
// effect per list (see CoinSidebar/WatchlistFeed) so this stays cheap.
const buffers = new Map<string, number[]>();
const MAX_POINTS = 30;

export function recordPrice(id: string, price: number | undefined | null) {
  if (price == null) return;
  const buf = buffers.get(id) ?? [];
  if (buf[buf.length - 1] === price) return;
  buf.push(price);
  if (buf.length > MAX_POINTS) buf.shift();
  buffers.set(id, buf);
}

export function getSparkline(id: string): number[] {
  return buffers.get(id) ?? [];
}
