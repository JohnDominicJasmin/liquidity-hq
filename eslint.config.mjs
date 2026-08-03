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
    // flags patterns this app has used since before the rules existed: 117
    // errors across 67 files, ~75 of them react-hooks/set-state-in-effect.
    //
    // These are demoted to warnings, NOT because they are wrong - most are
    // fair - but because the alternative is a 67-file refactor of live,
    // revenue-path code performed solely to switch CI on. That is a worse
    // trade than shipping the lint gate now and paying the backlog down
    // deliberately. Warnings still print on every run, so the count stays
    // visible instead of vanishing.
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
