import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import noBareHexColour from './eslint-rules/no-bare-hex-colour.mjs';

const local = { rules: { 'no-bare-hex-colour': noBareHexColour } };

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
    /* SCOPED TO THE FILES THE PLUGIN IS REGISTERED FOR (#184).

       Without this `files` key the object applies to EVERY file ESLint visits.
       `react-hooks` is only registered by eslint-config-next for js/jsx/ts/tsx,
       so on anything else these rules reference a plugin that is not in scope -
       and ESLint treats that as a configuration ERROR, not a skipped rule:

         A configuration object specifies rule "react-hooks/set-state-in-effect",
         but could not find plugin "react-hooks".

       It exits 2, so `npm run lint` fails and takes the build job with it.

       Nothing had ever triggered it because every file in the repo happened to
       be .ts or .tsx. The first .cjs anyone adds turns the lint gate red on a
       branch that changed no code - which is how QA found it, on a PR that was
       `dev` plus one new file.

       The block below this one already does exactly this, with both `plugins`
       and `files`. This one was the outlier. */
    files: ['**/*.{js,jsx,ts,tsx,mjs}'],

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

  {
    // ── No bare hex as a TEXT colour (issue #110) ──────────────────────────
    // WARN, not error, and deliberately so: ~56 sites already violate this and
    // making it an error fails the build immediately, so the four gates in
    // CONTRIBUTING.md §7 stop being passable. As a warning it ships today and
    // every NEW violation prints in CI from the first run - which is the whole
    // point. Flip to 'error' once the backlog is burned down; that is issue
    // #110 step 3 and blocks nothing.
    //
    // Scope is text colour only. See eslint-rules/no-bare-hex-colour.mjs for
    // why background/border/fill/stroke are out.
    plugins: { local },
    rules: { 'local/no-bare-hex-colour': 'warn' },
  },

  {
    // Genuine exceptions, allow-listed rather than argued with each time.
    files: [
      // Chart library config object, not DOM styling - these colours are passed
      // to KLineCharts, which has no access to CSS variables.
      'components/KLineProChart.tsx',
      // Renders when the root layout has already failed, so it cannot rely on
      // CSS variables existing. It carries its own #0d0d0d background and its
      // text is 7.66:1 against it - verified 2026-08-08.
      'app/global-error.tsx',
      // Native shell config. No CSS, no variables.
      'capacitor.config.ts',
      // THE IMPORTANT ONE. session.ts returns foreground/background PAIRS
      // ({ color: '#f0c070', bg: '#3d2e00' }) tuned for dark, and consumers
      // apply both together. Tokenising the foreground was tried during the
      // issue #53 sweep and dropped .session-pill to 2.30:1, because the light
      // token is dark and the paired background stays dark; re-measured
      // 2026-08-08 as var(--amber) on #3d2e00 = 1.90:1.
      //
      // Left warning, this rule would have told someone to make exactly that
      // change - it would have caused the defect it exists to prevent. The
      // colours here are correct; the failure mode is a CONSUMER applying the
      // foreground without its background, which is a different bug and lives
      // in the [data-theme="light"] block in globals.css.
      'lib/session.ts',
    ],
    rules: { 'local/no-bare-hex-colour': 'off' },
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
    /* The design handoff, vendored so BOTH sessions read the same frames
       rather than one of them working from the README's summary of them.

       It carries the design tool's own runtime (support.js, ~1,200 lines),
       which lints as two errors - a ReactDOM.render call and an assignment to
       `module`. Both are correct complaints about someone else's bundle and
       neither is actionable here: editing a vendored file to satisfy our lint
       would make it diverge from the tool that generated it. Ignored rather
       than fixed, and ignored rather than deleted, because the prototypes need
       it to render at all. */
    'Codebase access granted/**',
    'design-handoff-dir/**',
    // Playwright's generated HTML report and per-test artefacts. Both are
    // gitignored, so CI's fresh checkout never sees them - but locally, one
    // `npm run test:e2e` leaves a bundled copy of Playwright's own report UI on
    // disk, and the next `npm run lint` fails inside it with
    // `React Hook "T.useState" is called in function "te"`. That is a lint
    // error in vendored, minified third-party code that no one can act on.
    'qa/e2e-report/**',
    'test-results/**',
  ]),
]);

export default eslintConfig;
