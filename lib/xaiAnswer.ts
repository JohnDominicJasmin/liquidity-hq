/* Reading an xAI answer: the text and the sources it cited. PURE - no network, no React.
 *
 * Shared by /api/grok (Quick and Deep) and /api/grok-chat (#1631 A, E). Deep used to keep only the message text, so the web and X sources
 * its search tools returned were thrown away and no catalyst it named could be traced back to anything (#1631 A). */

/** The answer text out of either xAI shape: chat completions (choices[0].message.content) or the Responses API (the message output's text). */
export function answerText(data: unknown, isSearch: boolean): string {
  const d = data as { choices?: Array<{ message?: { content?: unknown } }>; output?: Array<{ type?: string; content?: Array<{ text?: unknown }> }> } | null;
  const t = isSearch
    ? d?.output?.find((o) => o?.type === 'message')?.content?.[0]?.text
    : d?.choices?.[0]?.message?.content;
  return typeof t === 'string' ? t : '';
}

/** #1651 item 1: the dates an X search may draw from, so an old post cannot pose as today's catalyst. xAI's x_search takes `from_date` and
 *  `to_date` as YYYY-MM-DD in UTC - posts from 00:00 on from_date up to, NOT including, to_date - and silently ignores any other format,
 *  a full date-time included (docs.x.ai/developers/tools/x-search, "Date Range"). So the window is built here, never by hand at a call
 *  site. `days` counts today: 2 is yesterday and today. web_search has no date parameter in the API, so only X can be bounded. */
export type SearchWindow = { from_date: string; to_date: string };

const DAY_MS = 86_400_000;

export function searchWindow(days: number, nowMs = Date.now()): SearchWindow {
  const today = Math.floor(nowMs / DAY_MS) * DAY_MS;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from_date: iso(today - (Math.max(1, Math.floor(days)) - 1) * DAY_MS), to_date: iso(today + DAY_MS) };
}

/** The search tools every Responses API call in the app offers: web, and X inside `window`. */
export function searchTools(window: SearchWindow) {
  return [{ type: 'web_search' }, { type: 'x_search', from_date: window.from_date, to_date: window.to_date }];
}

/** #1651 item 2: when an X post was made, read from its ID. A post ID is a Snowflake: the bits above the low 22 are milliseconds since X's
 *  epoch (2010-11-04 01:42:54.657 UTC). null when the ID cannot be one: not 15-19 digits (older sequential IDs are shorter, 2^63 is 19
 *  digits) or a time in the future. A model that invents a post usually invents its ID too, and an invented ID rarely decodes to a
 *  plausible time inside the window. */
const X_EPOCH_MS = BigInt(1288834974657);

export function xPostTimeMs(id: string, nowMs = Date.now()): number | null {
  if (!/^\d{15,19}$/.test(id)) return null;
  const ms = Number((BigInt(id) >> BigInt(22)) + X_EPOCH_MS);
  return ms <= nowMs + 5 * 60_000 ? ms : null;
}

/** x.com and twitter.com post links in the shapes xAI returns: /<handle>/status/<id>, /i/status/<id>, /i/web/status/<id>. */
const X_POST_URL = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:i\/(?:web\/)?|[A-Za-z0-9_]{1,15}\/)status(?:es)?\/(\d+)/i;

/** The web/X sources a search answer cited, deduplicated, at most 10, http(s) only. Two places carry them in the Responses API: each
 *  output_text block's `url_citation` annotations (tied to a span of the text) and the top-level `citations` list (every source the
 *  search used). Annotations come first because they are the ones the text actually points at.
 *
 *  #1651 item 2: an X post is kept only when its ID decodes to a time inside `window` (when given), and its link is rebuilt from the ID
 *  (x.com/i/status/<id>) rather than taken from the model, so the handle in a link cannot be made up. xAI applies the date window to its
 *  searches but not to thread fetches, so a post outside it can still be cited; this is where it is dropped. */
export function searchCitations(data: unknown, window?: SearchWindow, nowMs = Date.now()): string[] {
  const d = data as {
    output?: Array<{ type?: string; content?: Array<{ annotations?: Array<{ url?: unknown }> }> }>;
    citations?: unknown;
  } | null;
  const inline = (d?.output ?? []).flatMap((o) => (o?.content ?? []).flatMap((c) => (c?.annotations ?? []).map((a) => a?.url)));
  const listed = Array.isArray(d?.citations) ? (d.citations as unknown[]) : [];
  const fromMs = window ? Date.parse(`${window.from_date}T00:00:00Z`) : -Infinity;
  const toMs = window ? Date.parse(`${window.to_date}T00:00:00Z`) : Infinity;
  const urls: string[] = [];
  for (const u of [...inline, ...listed]) {
    if (typeof u !== 'string' || !/^https?:\/\//.test(u)) continue;
    const post = X_POST_URL.exec(u);
    if (!post) { urls.push(u); continue; }
    const at = xPostTimeMs(post[1], nowMs);
    if (at == null || at < fromMs || at >= toMs) continue;
    urls.push(`https://x.com/i/status/${post[1]}`);
  }
  return [...new Set(urls)].slice(0, 10);
}
