/* THE CHAT MESSAGE RENDERER (security fix, 2026-11-14). Turns an AI answer into the small HTML subset the chat shows (links, bold, italic, headings, bullets, line breaks).
 *
 * The answer can carry text from web pages and posts, so the output is built so that NOTHING taken from the answer can become markup or an attribute:
 *   1. Links and bare URLs are found FIRST, on the raw text. A URL may contain no whitespace, must parse as http or https, and is rebuilt from the parsed URL
 *      (`new URL(...).href`), then escaped for an attribute. Each finished anchor is parked behind a placeholder, so no later pass can match inside it.
 *   2. Everything else is HTML-escaped (& < > " '), and only then are bold, italic, headings, bullets and line breaks applied.
 *   3. The parked anchors are put back last.
 * The old version escaped first and then built anchors with a regex that allowed spaces in the URL, so the bare-URL pass that followed could match inside the href it had just
 * written and break out of the attribute. A URL with a space in it is no longer a link at all; it stays as plain, escaped text. */

const NUL = String.fromCharCode(0);
const PLACEHOLDER = new RegExp(`${NUL}(\\d+)${NUL}`, 'g');

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The normalised href for a URL string, or null when it is not a plain http(s) URL. */
export function safeHref(u: string): string | null {
  if (/\s/.test(u) || u.length > 2048) return null;
  let parsed: URL;
  try { parsed = new URL(u); } catch { return null; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.username || parsed.password) return null;
  return parsed.href;
}

export function renderChatMarkdown(raw: string): string {
  const parked: string[] = [];
  const park = (html: string): string => { parked.push(html); return `${NUL}${parked.length - 1}${NUL}`; };
  const anchor = (href: string, label: string, sup?: boolean): string => {
    const a = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    return sup ? `<sup>${a}</sup>` : a;
  };

  let s = raw.split(NUL).join('');

  // Citations [[1]](url)
  s = s.replace(/\[\[([^\]\n]+)\]\]\((\S+?)\)/g, (whole, n: string, u: string) => {
    const href = safeHref(u);
    return href ? park(anchor(href, `[${escapeHtml(n)}]`, true)) : whole;
  });
  // Links [text](url): the URL has no whitespace, so it cannot run on into other text
  s = s.replace(/\[([^\]\n]+)\]\((\S+?)\)/g, (whole, t: string, u: string) => {
    const href = safeHref(u);
    return href ? park(anchor(href, escapeHtml(t))) : whole;
  });
  // Bare URLs
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s)]+)/g, (whole, p: string, u: string) => {
    const href = safeHref(u);
    return href ? `${p}${park(anchor(href, escapeHtml(u)))}` : whole;
  });

  s = escapeHtml(s);

  // Bold / italic
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  // Headings
  s = s.replace(/^#{1,3}\s+(.+)$/gm, '<strong>$1</strong>');
  // Bullets
  s = s.replace(/^[-•]\s+(.+)$/gm, '&bull; $1');
  // Numbered list
  s = s.replace(/^\d+\.\s+(.+)$/gm, (_, i) => `&emsp;${i}`);
  // Newlines
  s = s.replace(/\n{2,}/g, '<br/><br/>');
  s = s.replace(/\n/g, '<br/>');

  return s.replace(PLACEHOLDER, (_, i: string) => parked[Number(i)] ?? '');
}
