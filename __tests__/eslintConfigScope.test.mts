import test from 'node:test';
import assert from 'node:assert/strict';

/* #184. A config object that names a plugin-namespaced rule without either
 * declaring that plugin OR restricting `files` applies to EVERY file ESLint
 * visits — and on any file the plugin is not registered for, ESLint treats it
 * as a configuration error:
 *
 *   A configuration object specifies rule "react-hooks/set-state-in-effect",
 *   but could not find plugin "react-hooks".
 *
 * It exits 2, so `npm run lint` fails and the build job with it.
 *
 * Nothing had ever triggered it because every file in the repo happened to be
 * .ts or .tsx. QA hit it on a PR that was `dev` plus one `.cjs` file — CI red
 * on a branch that changed no code.
 *
 * This asserts the INVARIANT rather than the one object that was wrong, because
 * the next block someone appends will be written by copying a neighbour, and
 * the neighbour that was wrong looked exactly like the ones that were right.
 */
test('every namespaced rule is scoped to files the plugin covers', async () => {
  const config = (await import('../eslint.config.mjs')).default as Array<Record<string, unknown>>;

  assert.ok(Array.isArray(config) && config.length > 0, 'eslint config did not load as an array');

  const offenders: string[] = [];

  for (const [i, block] of config.entries()) {
    const rules = block?.rules as Record<string, unknown> | undefined;
    if (!rules) continue;

    /* Namespaced = "plugin/rule". Core rules have no slash and are always in
       scope, so they need neither a plugins key nor a files restriction.

       SCOPED PLUGIN NAMES CONTAIN A SLASH. `@next/next/no-html-link-for-pages`
       belongs to the plugin `@next/next`, not `@next` - splitting on the first
       slash reports a block that correctly declares its plugin. That was this
       test's first result, and the config was right. */
    const nsOf = (rule: string) => {
      const parts = rule.split('/');
      return rule.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    };
    const namespaces = new Set(
      Object.keys(rules).filter(k => k.includes('/')).map(nsOf),
    );
    if (namespaces.size === 0) continue;

    const declared = new Set(Object.keys((block?.plugins as object) ?? {}));
    const hasFiles = Array.isArray(block?.files) && (block.files as unknown[]).length > 0;
    if (hasFiles) continue;   // scoped: whatever registers the plugin also matches

    for (const ns of namespaces) {
      if (!declared.has(ns)) {
        offenders.push(`config[${i}] uses "${ns}/*" rules with neither a plugins entry nor a files restriction`);
      }
    }
  }

  assert.deepEqual(offenders, [],
    'These blocks apply to every file ESLint visits, including ones the plugin is ' +
    'not registered for, where ESLint exits 2 rather than skipping the rule:\n' +
    offenders.join('\n'));
});
