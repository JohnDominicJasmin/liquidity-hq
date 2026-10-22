import { readFileSync, writeFileSync } from 'node:fs';
const p = 'qa/e2e/terminal-default.spec.ts';
let s = readFileSync(p, 'utf8');
const eol = s.includes('\r\n') ? '\r\n' : '\n';
s = s.replace(/\r\n/g, '\n');

const A = "  test('?design=current on / is a working escape hatch, and survives a reload'";
const B = "  test('no flash: data-design is set before the first paint, not after hydration'";
const ia = s.indexOf(A), ib = s.indexOf(B);
if (ia < 0 || ib < 0 || ib < ia) throw new Error('markers not found');

const replacement = `  test('the attribute is in the raw server HTML, not only set by script afterwards', async ({ request }) => {
    /* NEW WITH #1111. data-design used to be resolved from ?design= and localStorage by an
       inline script and by DesignModeProvider, so the served HTML never carried it. It is now
       a static attribute on <html>. \`request\` fetches the document WITHOUT running any of
       the page's JavaScript, so this is the one check that cannot be satisfied by a script
       that still sets it after load: if someone puts a script back, or moves the attribute
       into an effect, the raw HTML loses it and this fails while every browser-based check
       above still passes. */
    for (const route of ['/', '/about', '/arena', '/dashboard']) {
      const res = await request.get(route);
      expect(res.status(), \`\${route} answered \${res.status()}\`).toBe(200);
      const html = await res.text();
      const htmlTag = html.match(/<html\b[^>]*>/i)?.[0] ?? '';
      expect(htmlTag, \`no <html> tag found in the raw response for \${route}\`).not.toBe('');
      expect(htmlTag, \`the raw <html> tag for \${route} carries no data-design="terminal": \${htmlTag}\`).toMatch(/\sdata-design="terminal"/);
    }
  });

  test('?design=current, ?design=terminal and a stored lhq-design-mode=current change nothing and write nothing', async ({ browser }) => {
    /* #1111's own "How to test" item 1. The three inputs that used to select or persist a
       design are all ignored now. For each: the attribute is terminal, on \`/\` and on an app
       route, and localStorage is exactly as it started. A stale stored value is never read
       and, deliberately, never cleaned up - so it must still be there afterwards, which also
       proves nothing rewrote it. */
    const cases: Array<{ name: string; url: string; stored: string | null }> = [
      { name: '?design=current', url: '/?design=current', stored: null },
      { name: '?design=terminal', url: '/?design=terminal', stored: null },
      { name: 'stored current', url: '/', stored: 'current' },
      { name: 'stored current AND ?design=current', url: '/?design=current', stored: 'current' },
    ];
    for (const c of cases) {
      const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      try {
        if (c.stored) await ctx.addInitScript((v) => { try { localStorage.setItem('lhq-design-mode', v); } catch { /* private mode */ } }, c.stored);
        const page = await ctx.newPage();
        await page.goto(c.url);
        expect(await designAttr(page), \`\${c.name}: / must be terminal\`).toBe('terminal');
        // Time for any effect that used to persist a preference to have run.
        await page.waitForTimeout(1500);
        await page.goto('/dashboard');
        expect(await designAttr(page), \`\${c.name}: /dashboard must be terminal\`).toBe('terminal');
        const stored = await page.evaluate(() => { try { return localStorage.getItem('lhq-design-mode'); } catch { return null; } });
        expect(stored, \`\${c.name}: localStorage['lhq-design-mode'] is \${JSON.stringify(stored)}, expected \${JSON.stringify(c.stored)} - the app wrote (or removed) a design preference that no longer exists\`).toBe(c.stored);
      } finally {
        await ctx.close();
      }
    }
  });

`;
s = s.slice(0, ia) + replacement + s.slice(ib);

// The third switch test: "the opt-out crosses the boundary too" - delete it.
const C = "  test('the opt-out crosses the boundary too'";
const ic = s.indexOf(C);
if (ic < 0) throw new Error('opt-out test not found');
const end = s.indexOf('\n  });\n', ic);
if (end < 0) throw new Error('opt-out end not found');
s = s.slice(0, ic).replace(/\n+$/, '\n') + s.slice(end + '\n  });\n'.length);

// The no-flash test's comment and message name the deleted script.
s = s.replace("the bootstrap\n     * script ran before any content was painted.", "the attribute\n     * was already there before any content was painted.");
s = s.replace("'set by the React effect instead of the beforeInteractive script, so / will flash the '", "'being set late (by script or an effect) instead of being static in the server HTML, so / will flash the '");
writeFileSync(p, s.replace(/\n/g, eol));
console.log('ok', eol === '\r\n' ? 'CRLF' : 'LF');
