import { readFileSync, writeFileSync } from 'node:fs';
const p = 'qa/e2e/contrast.spec.ts';
let s = readFileSync(p, 'utf8');
const eol = s.includes('\r\n') ? '\r\n' : '\n';
s = s.replace(/\r\n/g, '\n');
const cut = (from, to, repl) => {
  const a = s.indexOf(from), b = s.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('marker missing: ' + from.slice(0, 50));
  s = s.slice(0, a) + repl + s.slice(b + to.length);
};

cut(" * Terminal is the default, so terminal is what a visitor gets and what this\n",
    " * one - a ratio without a design is the ambiguity this whole comment exists to\n * remove.\n",
    " * Terminal is the only design there is (#1111 deleted `?design=current`), so terminal is\n" +
    " * what a visitor gets and what this sweep holds. There is no second design to measure\n" +
    " * and no `QA_CONTRAST_DESIGN` switch: it was removed with the design, because setting it\n" +
    " * to `current` would now measure terminal under a `current` label against the `current`\n" +
    " * baseline. The `current` lists in `_shared.ts` are retired and unreachable; they stay\n" +
    " * only until someone deletes them. Say which design a contrast number came from when\n" +
    " * reporting one - a ratio without a design is the ambiguity this whole comment exists to\n" +
    " * remove.\n");

cut("const DESIGN_UNDER_TEST: 'current' | 'terminal' =\n",
    "'terminal';\n",
    "const DESIGN_UNDER_TEST = 'terminal' as const;\n");

cut("/** Seed the theme and the design, and prove both applied before measuring. */\n",
    "  }, DESIGN_UNDER_TEST);\n",
    "/** Seed the theme. The design needs no seeding: `data-design=\"terminal\"` is static on <html> (#1111). */\n" +
    "async function themedPage(browser: Browser, theme: 'dark' | 'light'): Promise<{ page: Page; close: () => Promise<void> }> {\n" +
    "  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });\n");

writeFileSync(p, s.replace(/\n/g, eol));
console.log('ok');
