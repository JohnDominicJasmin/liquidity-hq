export interface FireEntry {
  label: string;
  ts: number;
}

const _fires: FireEntry[] = [];
const MAX = 50;

export function recordFires(items: string[]): void {
  const ts = Date.now();
  for (const label of items) _fires.unshift({ label, ts });
  if (_fires.length > MAX) _fires.length = MAX;
}

export function getRecentFires(): FireEntry[] {
  return _fires.slice(0, MAX);
}
