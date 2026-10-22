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

/** The web/X sources a search answer cited, deduplicated, at most 10, http(s) only. Two places carry them in the Responses API: each
 *  output_text block's `url_citation` annotations (tied to a span of the text) and the top-level `citations` list (every source the
 *  search used). Annotations come first because they are the ones the text actually points at. */
export function searchCitations(data: unknown): string[] {
  const d = data as {
    output?: Array<{ type?: string; content?: Array<{ annotations?: Array<{ url?: unknown }> }> }>;
    citations?: unknown;
  } | null;
  const inline = (d?.output ?? []).flatMap((o) => (o?.content ?? []).flatMap((c) => (c?.annotations ?? []).map((a) => a?.url)));
  const listed = Array.isArray(d?.citations) ? (d.citations as unknown[]) : [];
  const urls = [...inline, ...listed].filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u));
  return [...new Set(urls)].slice(0, 10);
}
