/* The `checks` markers that are read by something other than a human.
 *
 * ── WHY THIS IS ITS OWN FILE AND MUST STAY IMPORT-FREE ───────────────────────────────────────────
 *
 * This started in lib/grok.ts and broke the Deep canary's selfcheck job in CI, which is the only
 * reason the file exists. The canary runs under plain `node` with NO `npm ci` - deliberately, because
 * nothing it needs is in node_modules and installing would add a minute and a cache to go stale. But
 * lib/grok.ts imports getAuthToken from lib/supabase.ts, which imports @supabase/supabase-js, so the
 * moment the canary imported a VALUE from grok.ts its module graph reached node_modules and died at
 * import with ERR_MODULE_NOT_FOUND.
 *
 * It passed locally, because a dev machine has node_modules. The CI job is what caught it.
 *
 * Note why it had not bitten before: lib/arenaContext.ts imports grok.ts with `import type`, which is
 * erased, so grok.ts was never actually loaded at runtime. Adding one value import changed that.
 *
 * SO: THIS FILE MUST NEVER IMPORT ANYTHING. Not a type, not a sibling module. It is the one place the
 * canary and the server can share a literal without the canary inheriting the server's dependencies.
 * lib/grok.ts re-exports these so existing importers do not care where they live.
 */

/* The `checks` entry recording a verdict repaired by the restate pass (#1631, QA review of #2063).
 *
 * A CONSTANT RATHER THAN AN INLINE LITERAL, because it is no longer read only by humans. The Deep
 * canary distinguishes a clean read from one that only parsed on the second attempt, and this entry is
 * the ONLY signal available to it - the response carries no `restated` flag. Matching our own prose
 * from another file would be a second definition of one string: reword it there and the canary silently
 * stops noticing degraded reads while continuing to report OK, which is the exact class of failure it
 * exists to catch.
 *
 * WHY IT MATTERS THAT THIS IS DISTINGUISHABLE AT ALL: a restated read was billed TWICE (the Deep call
 * plus the repair) and the model did not answer in the required form. The user sees a normal verdict,
 * so nothing on screen says the contract is degrading. */
export const VERDICT_RESTATED_CHECK = 'verdict restated by a second pass: the answer did not state SIGNAL and CONFIDENCE in the required form';
