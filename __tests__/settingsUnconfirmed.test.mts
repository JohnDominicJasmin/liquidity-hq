import test from 'node:test';
import assert from 'node:assert/strict';
import { loadUnconfirmed, saveUnconfirmed, dropLegacyUnconfirmedKey } from '../lib/settings.ts';

/* #1215: the unconfirmed-settings marker moved from one global localStorage
 * key to one key per account (`lhq_settings_unconfirmed_v1:<userId>`), so a
 * stale, still-unconfirmed field from a PREVIOUS account on a shared browser
 * can no longer leak into the NEXT account's merge - the exact regression
 * #1214 found and #1215 fixed forward. These are the two properties that
 * fix depends on, tested directly against the real exported functions - no
 * database, no server, a minimal in-memory localStorage polyfill only.
 */

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string): void { this.store.set(key, value); }
  removeItem(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
  key(index: number): string | null { return [...this.store.keys()][index] ?? null; }
  get length(): number { return this.store.size; }
}

// loadUnconfirmed guards on `typeof window === 'undefined'` (a real browser-
// only check, correct in production - this app never runs outside one) and
// returns {} unconditionally in plain Node otherwise. Node has no `window`
// by default, so a minimal stand-in is needed for this suite to exercise the
// real function at all, not a workaround for anything wrong in the source.
(globalThis as unknown as { window: unknown }).window = globalThis;

test('#1215 per-account restore', async (t) => {
  await t.test('account A keeps its own pending value when account B writes a different value to the SAME field', () => {
    (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
    saveUnconfirmed('userA', { account_size: 111 });
    saveUnconfirmed('userB', { account_size: 222 });

    assert.deepEqual(loadUnconfirmed('userA'), { account_size: 111 },
      'A\'s pending value must come back as A\'s own - B writing the same field must not leak into A\'s map');
    assert.deepEqual(loadUnconfirmed('userB'), { account_size: 222 },
      'B\'s pending value must be B\'s own too, independent of A');
  });

  await t.test('a legacy array-shaped marker under an account key degrades to {}, not a crash or a leaked array', () => {
    (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
    // Simulates the pre-#1215 shape (a Set of key NAMES, serialized as a JSON
    // array) somehow ending up where a per-account map is now expected.
    globalThis.localStorage.setItem('lhq_settings_unconfirmed_v1:userA', JSON.stringify(['account_size']));

    assert.deepEqual(loadUnconfirmed('userA'), {},
      'an array-shaped value must degrade to an empty map, not be cast/read as a map and not throw');
  });

  await t.test('dropLegacyUnconfirmedKey removes only the bare global key, never a per-account key', () => {
    (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
    globalThis.localStorage.setItem('lhq_settings_unconfirmed_v1', JSON.stringify(['stale_global_marker']));
    saveUnconfirmed('userA', { account_size: 333 });

    dropLegacyUnconfirmedKey();

    assert.equal(globalThis.localStorage.getItem('lhq_settings_unconfirmed_v1'), null,
      'the pre-#1202 global key must be gone');
    assert.deepEqual(loadUnconfirmed('userA'), { account_size: 333 },
      'a real per-account map must survive dropping the unrelated legacy global key');
  });

  await t.test('saving an empty map removes the per-account entry rather than storing "{}"', () => {
    (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
    saveUnconfirmed('userA', { account_size: 444 });
    assert.notEqual(globalThis.localStorage.getItem('lhq_settings_unconfirmed_v1:userA'), null);

    saveUnconfirmed('userA', {});
    assert.equal(globalThis.localStorage.getItem('lhq_settings_unconfirmed_v1:userA'), null,
      'an emptied map should remove the key, not persist an empty-object string forever');
  });
});
