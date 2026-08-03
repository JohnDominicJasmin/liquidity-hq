import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

// Next 16 removed `next lint`, and `next build` no longer runs linting at all,
// so nothing in this repo was linted until this file existed. Lint now runs
// through the ESLint CLI (`npm run lint`), which is what CI calls.
const eslintConfig = defineConfig([
  ...nextVitals,

  {
    // The repo carries eslint-disable comments for @typescript-eslint rules
    // (left over from a config that no longer exists). Those rules are not
    // enabled here, so ESLint reports each disable as unused - 36 warnings of
    // pure noise about a decision made in this file. Turned off rather than
    // stripping the comments, because they become live again the day
    // eslint-config-next/typescript is added.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },

  {
    // ── Pre-existing backlog, deliberately non-blocking ────────────────────
    // eslint-plugin-react-hooks v6 ships the React Compiler rule set, which
    // flags patterns this app has used since before the rules existed. The
    // first run reported 117 of these across 67 files.
    //
    // Since then the classes that were fixable have been fixed - every
    // react-hooks/purity warning is gone (they were mostly frozen clocks:
    // relative timestamps that never advanced), plus use-memo, and the
    // exhaustive-deps cases that were hiding stale closures. The count is now
    // ~100, and what remains splits roughly into:
    //
    //   ~73  set-state-in-effect  - mostly SSR hydration guards (localStorage
    //                               and matchMedia do not exist on the server,
    //                               so the real value has to land after mount)
    //                               and fetch-then-setState. Clearing these
    //                               means useSyncExternalStore or a data layer,
    //                               not an edit.
    //   ~15  refs                 - deliberate, commented ref-writes in the
    //                               chart and EMA-strategy engines that exist
    //                               to stop refetch loops.
    //    ~6  immutability         - hoisting order inside long providers.
    //
    // Demoted to warnings, NOT because they are wrong - most are fair - but
    // because clearing them means restructuring live, revenue-path code, and
    // that is its own project rather than a step in switching CI on. Warnings
    // print on every run, so the count stays visible instead of vanishing.
    //
    // What this DOES gate today: every @next/next rule and the React
    // correctness rules, all at error. So new violations of those fail CI.
    //
    // Do not add rules to this block to make a red build green. Fix the code,
    // or if a violation is genuinely intentional, disable it inline at the
    // site with a comment saying why (see app/auth/callback/page.tsx).
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/use-memo': 'warn',
    },
  },

  globalIgnores([
    // Defaults from eslint-config-next, which have to be repeated once we set
    // globalIgnores ourselves.
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Not ours / not application source.
    'node_modules/**',
    'public/**',
    'supabase/**',
  ]),
]);

export default eslintConfig;
