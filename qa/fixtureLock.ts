import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/* ONE HOLDER AT A TIME, ACROSS THE WORKERS OF ONE RUNNER (#1185 item 63). Making a directory is atomic, so it is the lock. A holder
 * that died leaves it behind; after `staleMs` it is taken over. It does not reach across machines: two jobs need two accounts, or one
 * of them must not write. */
export type Held = { dir: string; token: string };
export type LockOptions = { staleMs?: number; waitMs?: number; pollMs?: number };

export async function holdLock(dir: string, { staleMs = 600_000, waitMs = 1_200_000, pollMs = 500 }: LockOptions = {}): Promise<Held> {
  const token = randomUUID(); const until = Date.now() + waitMs;
  for (;;) {
    try { mkdirSync(dir); writeFileSync(join(dir, 'holder'), token); return { dir, token }; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    try { if (Date.now() - statSync(dir).mtimeMs > staleMs) { rmSync(dir, { recursive: true, force: true }); continue; } } catch { continue; /* released between the two calls */ }
    if (Date.now() >= until) throw new Error(`gave up waiting for ${dir} after ${waitMs} ms`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** Releases only what this holder still holds: a lock taken over as stale now belongs to someone else. */
export function releaseLock({ dir, token }: Held): void {
  let current = ''; try { current = readFileSync(join(dir, 'holder'), 'utf8'); } catch { return; }
  if (current === token) rmSync(dir, { recursive: true, force: true });
}
