/* Installs the `@/` resolve hook for `node --test`. See qa/alias-hooks.mjs for what it does
 * and why it exists.
 *
 * Used as:  node --import ./qa/alias-register.mjs --test __tests__/*.test.mts
 * Wired into package.json's `test` script, so `npm test` and the pre-push hook both get it
 * and a test importing an aliased module needs no special invocation.
 *
 * Harmless to every existing test: the hook only rewrites a specifier that starts with `@/`,
 * or a relative one that Node could not resolve on its own. Anything already working is
 * passed straight through to the default resolver. */
import { register } from 'node:module';

register('./alias-hooks.mjs', import.meta.url);
