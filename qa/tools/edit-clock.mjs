import { readFileSync, writeFileSync } from 'node:fs';
const p = 'qa/e2e/clock.spec.ts';
let s = readFileSync(p, 'utf8');
const eol = s.includes('\r\n') ? '\r\n' : '\n';
s = s.replace(/\r\n/g, '\n');
const rep = (from, to) => {
  if (s.split(from).length !== 2) throw new Error('expected exactly one match: ' + from.slice(0, 60));
  s = s.replace(from, () => to);
};
rep("/** A page with the clock pinned, fixtures served, the banner dismissed, and the\n *  design pinned rather than inherited. */\nasync function pinnedTo(browser: Browser, iso: string, timezoneId?: string, design: 'current' | 'terminal' = 'terminal') {",
    "/** A page with the clock pinned, fixtures served and the banner dismissed. The design is\n *  not pinned any more: `data-design=\"terminal\"` is static on <html> (#1111). */\nasync function pinnedTo(browser: Browser, iso: string, timezoneId?: string) {");
rep("  /* Seeded, not passed as `?design=`, so the preference is in place before the\n   * `design-init` script in app/layout.tsx reads it - the same route the query\n   * param takes, one step earlier, and with no first frame on the default. */\n  await ctx.addInitScript((d) => {\n    try { localStorage.setItem('lhq-design-mode', d); } catch { /* private mode */ }\n  }, design);\n", "");
rep("    const { page, close } = await pinnedTo(browser, iso, undefined, design);", "    const { page, close } = await pinnedTo(browser, iso, undefined);");
writeFileSync(p, s.replace(/\n/g, eol));
console.log('ok');
