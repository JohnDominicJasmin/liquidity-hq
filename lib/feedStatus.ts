/* WHAT THE PRICE FEED CHIP SAYS (#1651, PM): nothing while the feed is live; "Backup feed" while prices come from the slower backup;
 * "Delayed" when the live feed has been connecting for more than ten seconds, or both feeds failed. */

/** How long "connecting" may last before the screen says the figures are delayed. */
export const CONNECTING_GRACE_MS = 10_000;

export type FeedState = 'backup' | 'delayed' | null;

/**
 * @param wsStatus       the store's status: 'Connecting...', 'Live', 'Live · backup feed', or 'Idle' on a page with no market feed
 * @param pricesFailed   the last price read failed and nothing replaced it
 * @param connectingFor  how long the status has been 'Connecting...', in ms
 */
export function feedState(wsStatus: string, pricesFailed: boolean, connectingFor: number): FeedState {
  if (wsStatus === 'Idle') return null;
  if (pricesFailed) return 'delayed';
  if (wsStatus === 'Live · backup feed') return 'backup';
  if (wsStatus === 'Connecting...' && connectingFor >= CONNECTING_GRACE_MS) return 'delayed';
  return null;
}
