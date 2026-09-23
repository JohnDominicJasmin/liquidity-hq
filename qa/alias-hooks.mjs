/* The resolve hook that makes `@/...` reachable from `node --test`.
 *
 * Registered by qa/alias-register.mjs, which is what the test script imports. Split in two
 * because `--import` RUNS a module, it does not install loader hooks - a file exporting
 * `resolve` is only picked up automatically by the deprecated `--loader` flag, so
 * registration has to be explicit.
 *
 * THE GAP THIS CLOSES. `tsconfig.json` maps `@/*` to the repo root and Next resolves it at
 * build time, but `node --test` has no idea - so ANY module importing `@/lib/...` was
 * unreachable from a unit test. Checked before writing this: not one test in `__tests__/`
 * covers a module using the alias, while `lib/` is full of them (admin-auth, aiCallLog,
 * aiUsage, confluence, email, marketSnapshot...). That is not a coincidence, it is the
 * shape of a testing gap: the modules were untestable, so they went untested, and nobody
 * ever had to decide not to test them.
 *
 * The alternative was asking app code to use relative imports for QA's convenience, which
 * trades one file's convention for a rule the next author has no reason to follow.
 *
 * TWO JOBS, and the second is the one that bites. TypeScript source imports without a file
 * extension (`@/lib/tables`, and relative `./foo` inside those files too); Node needs the
 * real filename. So this maps the alias AND probes the extensions Node's TypeScript support
 * can load. Probing is done on the resolved path only - it never invents a module that is
 * not on disk, it just finds the one that is.
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = pathToFileURL(path.join(import.meta.dirname, '..') + path.sep).href;
const CANDIDATES = ['.ts', '.tsx', '.mts', '.js', '.mjs', '/index.ts', '/index.tsx', '/index.js'];

/** The URL with an extension Node can actually load, or null when nothing matches. */
function withExtension(url) {
  const asPath = fileURLToPath(url);
  if (existsSync(asPath) && path.extname(asPath)) return url;
  for (const ext of CANDIDATES) {
    if (existsSync(asPath + ext)) return pathToFileURL(asPath + ext).href;
  }
  return null;
}

export function resolve(specifier, context, next) {
  // `@/lib/x` -> <repo>/lib/x, matching tsconfig's `"@/*": ["./*"]`.
  if (specifier.startsWith('@/')) {
    const mapped = new URL(specifier.slice(2), ROOT).href;
    return next(withExtension(mapped) ?? mapped, context);
  }
  /* A relative import from inside a file we just resolved is extensionless too, and its
     parent is a .ts file, so Node cannot guess either. Only touched when the bare
     specifier does not already resolve - a package import is left entirely alone. */
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL && !path.extname(specifier)) {
    const mapped = new URL(specifier, context.parentURL).href;
    const found = withExtension(mapped);
    if (found) return next(found, context);
  }
  return next(specifier, context);
}
