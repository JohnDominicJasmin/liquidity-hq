/**
 * WHERE THE BROWSER SUITE POINTS, and why this is a function rather than two lines
 * inline in `playwright.config.ts`.
 *
 * `E2E_BASE_URL` decides two things at once: the `baseURL` every `page.goto('/x')`
 * resolves against, AND whether `webServer` runs at all. Get it wrong and the suite
 * either builds nothing and tests a real host, or builds the right commit and points
 * nowhere. The second is the dangerous one, because the build succeeding makes the run
 * look healthy.
 *
 * ── THE DEFECT THIS EXISTS TO PREVENT (found by Dev Team reviewing #1802) ────────────
 *
 * The config read it as:
 *
 *     const BASE_URL = process.env.E2E_BASE_URL?.replace(/\/$/, '');
 *     baseURL: BASE_URL ?? `http://localhost:${PORT}`
 *
 * `?.` and `??` short-circuit on null and undefined ONLY. An EMPTY STRING is neither,
 * and a `workflow_dispatch` input declared `default: ''` arrives as an empty string
 * rather than as an absent variable. Measured, with unset as the control:
 *
 *     unset    BASE_URL=undefined  baseURL="http://localhost:3100"  webServer runs
 *     ''       BASE_URL=""         baseURL=""                       webServer runs
 *     '   '    BASE_URL="   "      baseURL="   "                    webServer SKIPPED
 *
 * So `''` builds the candidate's own commit and then aims every navigation at an empty
 * base. And `'   '` - a stray space in a free-text dispatch field - is WORSE than Dev
 * predicted when they asked for `.trim()`: it makes `IS_REMOTE` true, so nothing is
 * built AND the target is whitespace. Both read as the product being broken.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────────────
 *
 * Unset, empty and whitespace-only all mean the same thing: BUILD LOCALLY. Only a
 * non-blank value means "test that host". A trailing slash is dropped so
 * `https://host/` and `https://host` cannot behave differently.
 */

/** The deployed target, or `undefined` meaning "build and serve locally". */
export function resolveBaseUrl(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed.replace(/\/$/, '') : undefined;
}
