/* THE WHOLE ENGLISH LABEL TABLE, LOADED ON DEMAND (#1185 slow-3G, option B, DRAFT).
 *
 * `import()` puts lib/labelDefaults.en.json in its own chunk, so a page that renders from the critical subset (lib/labelCriticalRoutes.ts) does not download it with its first-load JavaScript. The promise is
 * cached for the life of the page and carries React's `status` / `value` fields once settled, so `use(loadFullEnglish())` reads it without suspending the second time. A failed chunk load (a flaky network)
 * is retried twice (0.4 s, 1.5 s later); if it still fails in the browser, the page is reloaded ONCE (a failed chunk is usually a stale deploy or a dropped connection, and a reload is the clean slate; a sessionStorage flag stops a loop) while the labels stay on their loading state; only if the reload fails too does it settle to the critical subset, because showing something beats an error screen. (QA, 2026-11-22: on a signed-in route that last resort prints every key outside the subset as its raw name, which the owner's rule forbids, so it is the LAST resort, after a retry and a reload.)
 *
 * Merged-over-defaults behaviour is unchanged: a fetched locale's table is layered over this one, so a key a translation lacks still shows English. */
export type LabelTable = Record<string, string>;
type Tracked = Promise<LabelTable> & { status?: 'pending' | 'fulfilled'; value?: LabelTable };

let cached: Tracked | null = null;
const RELOADED = 'lhq_labels_chunk_reload_v1';

async function importFull(): Promise<LabelTable> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const v = (await import('./labelDefaults.en.json')).default as unknown as LabelTable;
      try { sessionStorage.removeItem(RELOADED); } catch { /* storage blocked */ }
      return v;
    } catch (e) { last = e; if (i < 2) await new Promise(r => setTimeout(r, i === 0 ? 400 : 1500)); }
  }
  throw last;
}

export function loadFullEnglish(): Promise<LabelTable> {
  if (cached) return cached;
  const p: Tracked = importFull().then(
    v => { p.status = 'fulfilled'; p.value = v; return v; },
    async () => {
      /* `cached` KEEPS POINTING AT THIS PROMISE. It was reset to null here, and once the subset fallback settled nothing put it back, so every render of `use(loadFullEnglish())` started a NEW three-attempt import: QA measured 72 whole-table requests in 40 s and a shell-only page on /markets with the chunk blocked (run 44952022583, P6). One promise per page means at most 3 requests, one reload, and 3 more, then the subset for good. */
      /* One reload, only in the browser, only once per tab session: the labels stay on their loading state while it happens. */
      if (typeof window !== 'undefined') {
        let first = false;
        try { first = !sessionStorage.getItem(RELOADED); if (first) sessionStorage.setItem(RELOADED, '1'); } catch { /* storage blocked: no reload loop risk, skip the reload */ }
        if (first) { window.location.reload(); return new Promise<LabelTable>(() => { /* the page is going away */ }); }
      }
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
