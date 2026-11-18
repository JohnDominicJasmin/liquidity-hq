/* shared by nofail-sweep.spec.ts (signed out, read-only) and nofail-sweep-in.spec.ts (fixtures, staging/CI only) */
export const collect = () => {
  const WORD = /\b(unavailable|no data|not available|couldn['’]t|could not|failed|error|retry|try again|nan|undefined|null|n\/a)\b/i;
  const vis = (el: Element) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0'; };
  const hidden = (el: Element) => { for (let a: Element | null = el; a; a = a.parentElement) { if (a.getAttribute('aria-hidden') === 'true' || a.hasAttribute('inert') || (a as HTMLElement).hidden) return true; const cs = getComputedStyle(a); if (cs.display === 'none' || cs.visibility === 'hidden') return true; } return false; };
  const hits: Array<{ el: string; text: string; kind: string; ctx: string }> = []; const seen = new Set<string>();
  const name = (el: Element) => `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).split(/\s+/)[0].slice(0, 28)}`;
  const ctxOf = (el: Element) => { for (let a = el.parentElement, i = 0; a && i < 5; a = a.parentElement, i++) { const h = a.querySelector('h1,h2,h3,[class*="title"],[class*="label"],[class*="head"]'); const t = h && h !== el ? ((h as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 36) : ''; if (t) return t; } return ''; };
  const add = (el: Element, text: string, kind: string) => { const k = `${kind}|${text}|${name(el)}`; if (seen.has(k) || hits.length > 60) return; seen.add(k); hits.push({ el: name(el), text: text.slice(0, 70), kind, ctx: ctxOf(el) }); };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement; if (!p || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(p.tagName) || !vis(p) || hidden(p)) continue; const t = (n.textContent || '').replace(/\s+/g, ' ').trim(); if (!t) continue;
    if (/^(—|–|--|-|…|\.\.\.)$/.test(t)) add(p, t, 'placeholder'); else if (/^loading/i.test(t)) add(p, t, 'loading'); else if (WORD.test(t) && t.length < 140) add(p, t, 'word');
  }
  for (const el of Array.from(document.querySelectorAll('[aria-busy="true"], [role="progressbar"], .spinner, [class*="spinner"], [class*="skeleton"], [class*="shimmer"]'))) if (vis(el) && !hidden(el)) add(el, ((el as HTMLElement).innerText || el.getAttribute('aria-label') || '').slice(0, 40), 'spinner');
  return hits;
};
