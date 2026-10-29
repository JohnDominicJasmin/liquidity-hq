/**
 * RESOLVING `app/...` PATHS WHEN ROUTE GROUPS CAN APPEAR ANYWHERE.
 *
 * WHY THIS EXISTS. 35 test files read app source by exact path - `code('app/not-found.tsx')`,
 * `read('app/arena/page.tsx')` - and #1740's route-group move puts those files under
 * `app/(main)/` and `app/(intl)/[locale]/`. Swapping each literal for its `(main)` equivalent
 * is the obvious fix and it is WRONG, for a reason that only shows up in the sequencing:
 *
 *   a test pinned to `app/(main)/arena/page.tsx` is RED on today's `dev`, where that file does
 *   not exist yet, and a test pinned to `app/arena/page.tsx` is RED on the branch.
 *
 * QA's tests merge into `dev` on their own PR; the restructure merges on its own. There is no
 * ordering of those two merges in which hard-coded literals are green on both sides, so the
 * tests have to resolve the path at run time instead of asserting where it lives.
 *
 * THE SECOND REASON, which outlasts this change: a parenthesised segment is invisible in the
 * URL, so `app/(main)/arena/page.tsx` and `app/arena/page.tsx` are the SAME ROUTE. A test that
 * hard-codes either one is asserting on a filesystem detail it does not care about. Dev Team's
 * note on #1740 is the sharp version - a walk that assumes `app/<dir>/page.tsx` "will silently
 * stop covering the tree the next time a group is added, which is a worse failure than today's
 * loud one." A silent under-count in a CONTROL assertion is the worst outcome available here.
 *
 * ── THE CORE IS PURE, AND THAT IS DELIBERATE ────────────────────────────────────────────────
 *
 * `resolveIn(files, logical)` takes a LIST of paths rather than touching the disk, so it can be
 * verified against two trees at once - `git ls-tree -r --name-only origin/dev` and the same for
 * the restructure branch - without a worktree. (A worktree here is not free: removing one has
 * followed the `node_modules` junction in this checkout before and emptied it.) The filesystem
 * wrapper below is the thin part.
 */

import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

/** A route group: a path segment wrapped in parens. Invisible in the URL. */
export const isGroupSegment = (name: string): boolean => /^\(.+\)$/.test(name);

/**
 * Resolve `logical` against `files`, allowing any number of group segments at any depth.
 *
 * `app/arena/page.tsx` matches `app/arena/page.tsx`, `app/(main)/arena/page.tsx` and
 * `app/(main)/(sub)/arena/page.tsx`. Returns every match, because MORE THAN ONE IS A DEFECT
 * worth failing on rather than silently taking the first - two files serving one route is a
 * real Next.js error and a test that picks one would hide it.
 */
export function resolveAllIn(files: readonly string[], logical: string): string[] {
  const want = logical.split('/').filter(Boolean);
  return files.filter((f) => {
    const got = f.split('/').filter(Boolean);
    let i = 0;
    for (const seg of got) {
      if (isGroupSegment(seg)) continue; // invisible in the URL, so invisible here
      if (i >= want.length || seg !== want[i]) return false;
      i++;
    }
    return i === want.length;
  });
}

/** The single match, or throw naming what was looked for and what was found. */
export function resolveIn(files: readonly string[], logical: string): string {
  const hits = resolveAllIn(files, logical);
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) {
    throw new Error(
      `appPath: nothing serves "${logical}". Looked for it directly and through any route-group ` +
        `segments. If the file was deleted or renamed, this test needs re-deriving rather than re-pointing.`,
    );
  }
  throw new Error(
    `appPath: "${logical}" is served by ${hits.length} files: ${hits.join(', ')}. Two files cannot ` +
      `serve one route - this is a real conflict, not a test problem.`,
  );
}

/** Every file under `app/`, repo-relative, POSIX separators. */
export function appFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const next = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        walk(next);
      } else out.push(next);
    }
  };
  if (existsSync(path.join(ROOT, 'app'))) walk('app');
  return out;
}

/**
 * The repo-relative path of the file serving `logical`, wherever route groups put it.
 *
 * Use this INSTEAD of a literal in any assertion about app source:
 *     const src = code(appPath('app/not-found.tsx'));
 */
export function appPath(...logical: string[]): string {
  return resolveIn(appFiles(), logical.join('/'));
}

/**
 * The same path, prefixed `../` for use from a file in `__tests__/`.
 *
 *     readFileSync(new URL(appRel('app/alerts/page.tsx'), import.meta.url), 'utf8')
 *
 * THE SUITE READS APP SOURCE IN THREE FORMS and only two of them are affected by route
 * groups. Measured over all of `__tests__/*.mts` (counts span the whole suite and overlap,
 * so they are NOT subsets of the 35 failing files):
 *
 *   A. segmented arguments - `join(ROOT, 'app', 'upgrade', 'page.tsx')`, or a varargs
 *      helper `read('app', 'arena', 'page.tsx')`. 15 files. No `app/` substring exists
 *      anywhere, which is why a literal grep cannot see them. Use the varargs `appPath`.
 *   B. `'../app/...'` inside `new URL(...)`. 25 files. Use `appRel`.
 *   C. a module specifier - `await import('../app/api/.../route.ts')`. 14 files, and
 *      **NONE of them need anything.** Every Form C target is an API route, and all 84
 *      API handlers stayed at `app/api/...` with zero under a group on the #1740 branch -
 *      verified by resolving all 14 against that tree's file list, 0 moved. A dynamic
 *      import also wants a specifier rather than a path, so if an app PAGE is ever
 *      imported this way it needs its own helper; today none is.
 */
export function appRel(...logical: string[]): string {
  return `../${appPath(...logical)}`;
}

/** Like `appPath`, but `null` when nothing serves it - for "does this route exist?" checks. */
export function appPathOrNull(logical: string): string | null {
  const hits = resolveAllIn(appFiles(), logical);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Every route directory under `app/`, as its URL path, with group segments stripped.
 * `app/(main)/arena/page.tsx` → `/arena`; `app/(main)/page.tsx` → `/`.
 *
 * For the directory WALKS - the ones whose CONTROL assertions fired on #1740 because they
 * assumed `app/<dir>/page.tsx`. Walk this instead of `readdirSync('app')`.
 */
export function appRoutes(kind: 'page' | 'route' = 'page'): string[] {
  return routesIn(appFiles(), kind);
}

/** The pure core of `appRoutes`, over a supplied file list. Verifiable against two trees at once. */
export function routesIn(files: readonly string[], kind: 'page' | 'route' = 'page'): string[] {
  const leaf = new RegExp(`/${kind}\\.(tsx|ts|jsx|js)$`);
  return files
    .filter((f) => leaf.test(f))
    .map((f) =>
      '/' +
      f
        .split('/')
        .slice(1, -1) // drop "app" and the filename
        .filter((s) => !isGroupSegment(s))
        .join('/'),
    )
    .map((u) => (u === '/' ? '/' : u.replace(/\/$/, '')))
    .sort();
}
