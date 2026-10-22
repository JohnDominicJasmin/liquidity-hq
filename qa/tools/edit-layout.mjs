import { readFileSync, writeFileSync } from 'node:fs';
const p = 'qa/e2e/layout.spec.ts';
let s = readFileSync(p, 'utf8');
const eol = s.includes('\r\n') ? '\r\n' : '\n';
s = s.replace(/\r\n/g, '\n');
const cut = (from, to, repl) => {
  const a = s.indexOf(from), b = s.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('marker missing: ' + from.slice(0, 50));
  s = s.slice(0, a) + repl + s.slice(b + to.length);
};

cut("/** The design this run measures. Terminal is the default after #748; the spec\n",
    "  process.env.QA_LAYOUT_DESIGN === 'current' ? 'current' : 'terminal';\n",
    "/** The design this run measures. Terminal is the only design after #1111 removed\n" +
    " *  `?design=current`, so there is no `QA_LAYOUT_DESIGN` switch any more: setting it to\n" +
    " *  `current` would have measured terminal against the `current` list. The `current` list\n" +
    " *  in KNOWN_OBSCURED_BY_DESIGN is retired and unreachable; it stays only until someone\n" +
    " *  deletes it. */\n" +
    "const LAYOUT_DESIGN = 'terminal' as const;\n");

cut("    /* PIN THE DESIGN (#844). Seeded before navigation so the `design-init`\n",
    "    }, LAYOUT_DESIGN);\n",
    "    /* THE DESIGN IS NOT SEEDED ANY MORE. It was pinned here (#844) by writing a stored\n" +
    "     * preference, because the app's default could move under the baseline. #1111 made\n" +
    "     * `data-design=\"terminal\"` a static attribute on <html>, so there is nothing to pin and\n" +
    "     * nothing that could move. */\n");

writeFileSync(p, s.replace(/\n/g, eol));
console.log('ok');
