import { readFileSync, writeFileSync } from 'node:fs';
const p = 'qa/e2e/grok-header-meta.spec.ts';
let s = readFileSync(p, 'utf8');
const eol = s.includes('\r\n') ? '\r\n' : '\n';
s = s.replace(/\r\n/g, '\n');
const rep = (from, to) => {
  if (s.split(from).length !== 2) throw new Error('expected exactly one match: ' + from.slice(0, 60));
  s = s.replace(from, () => to);
};

rep("const DESIGN_THEME_PAIRS: ReadonlyArray<{ design: 'current' | 'terminal'; theme: 'dark' | 'light' }> = [\n  { design: 'current', theme: 'dark' },\n  { design: 'current', theme: 'light' },\n  { design: 'terminal', theme: 'dark' },",
    "/* The two `current` pairs were removed with the design itself (#1111). After that change a\n * stored `lhq-design-mode=current` is ignored, so they would have measured terminal twice\n * under a `current` label. The names keep the `terminal/` prefix so history stays readable. */\nconst DESIGN_THEME_PAIRS: ReadonlyArray<{ design: 'terminal'; theme: 'dark' | 'light' }> = [\n  { design: 'terminal', theme: 'dark' },");
rep("/** Seeds design/theme/consent the same way contrast.spec.ts and a11y.spec.ts\n *  do - before hydration, via localStorage, so the page never renders a frame\n *  we are not measuring and the cookie banner never inflates the header's\n *  neighbourhood. */",
    "/** Seeds theme/consent the same way contrast.spec.ts and a11y.spec.ts do - before\n *  hydration, via localStorage, so the page never renders a frame we are not measuring\n *  and the cookie banner never inflates the header's neighbourhood. The design needs no\n *  seed: `data-design=\"terminal\"` is static on <html> (#1111). */");
rep("  browser: Browser,\n  design: 'current' | 'terminal',\n  theme: 'dark' | 'light',\n", "  browser: Browser,\n  theme: 'dark' | 'light',\n");
rep("  await ctx.addInitScript((d) => {\n    try { localStorage.setItem('lhq-design-mode', d); } catch { /* private mode */ }\n  }, design);\n", "");
s = s.split("openArenaChat(browser, design, theme)").join("openArenaChat(browser, theme)");
rep("        if (design === 'terminal') expect(applied.design).toBe('terminal');\n", "        expect(applied.design).toBe('terminal');\n");
writeFileSync(p, s.replace(/\n/g, eol));
console.log('ok');
