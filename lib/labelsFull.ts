/* THE WHOLE ENGLISH LABEL TABLE, LOADED ON DEMAND (#1185 slow-3G, option B, DRAFT).
 *
 * `import()` puts lib/labelDefaults.en.json in its own chunk, so a page that renders from the critical subset (lib/labelCriticalRoutes.ts) does not download it with its first-load JavaScript. The promise is
 * cached for the life of the page and carries React's `status` / `value` fields once settled, so `use(loadFullEnglish())` reads it without suspending the second time. A failed chunk load (a flaky network)
 * clears the cache so the next call retries, and settles to the critical subset for now: some English text rather than an error screen.
 *
 * Merged-over-defaults behaviour is unchanged: a fetched locale's table is layered over this one, so a key a translation lacks still shows English. */
export type LabelTable = Record<string, string>;
type Tracked = Promise<LabelTable> & { status?: 'pending' | 'fulfilled'; value?: LabelTable };

let cached: Tracked | null = null;

export function loadFullEnglish(): Promise<LabelTable> {
  if (cached) return cached;
  const p: Tracked = import('./labelDefaults.en.json').then(
    m => { const v = m.default as unknown as LabelTable; p.status = 'fulfilled'; p.value = v; return v; },
    async () => {
      cached = null;
      const v = (await import('./labelDefaults.critical.json')).default as unknown as LabelTable;
      p.status = 'fulfilled'; p.value = v;
      return v;
    },
  );
  p.status = 'pending';
  cached = p;
  return p;
}

/** The whole table if it has already loaded in this page, else null. Never starts a load. */
export function fullEnglishIfLoaded(): LabelTable | null {
  return cached && cached.status === 'fulfilled' && cached.value ? cached.value : null;
}
