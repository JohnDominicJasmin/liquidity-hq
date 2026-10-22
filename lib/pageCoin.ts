/* Which coin the current page shows, for the chat (#1631 E). PURE apart from the window event.
 *
 * Arena announces its coin and GrokChat (mounted once, in AppShell) follows it. An event alone can be missed: on a hard load Arena's effect
 * can run before GrokChat has attached its listener, and the chat then opened on the shared selected coin instead of the page's (QA's
 * review of #1665). So the last announcement is also kept here, and the chat reads it when it mounts. */

export const PAGE_COIN_EVENT = 'page-coin';

let current: string | null = null;

/** Announce the page's coin (null on leaving the page). */
export function announcePageCoin(coin: string | null): void {
  current = coin;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PAGE_COIN_EVENT, { detail: { coin } }));
}

/** The last coin announced, for a listener that attaches late. */
export function currentPageCoin(): string | null {
  return current;
}
