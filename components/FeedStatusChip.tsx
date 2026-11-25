'use client';
import { useEffect, useRef, useState } from 'react';
import { useLabels } from '@/lib/labels';
import { useMarket } from '@/lib/marketStore';
import { feedState, CONNECTING_GRACE_MS } from '@/lib/feedStatus';

/* SAYS WHEN THE PRICES ON SCREEN ARE NOT LIVE (#1651, PM): nothing on a healthy screen; otherwise "Backup feed" or "Delayed", with the
 * time of the last price change on the viewer's own clock. Passive status, like OfflineNotice: the live region is always mounted. */
export default function FeedStatusChip() {
  const { t } = useLabels();
  const { store } = useMarket();

  /* When a price last changed while this page was open. */
  const prices = Object.values(store.coins).map(c => c?.price ?? '').join('|');
  const [priceAt, setPriceAt] = useState<number | null>(null);
  const seen = useRef('');
  useEffect(() => {
    if (prices === seen.current) return;
    seen.current = prices;
    if (Object.values(store.coins).some(c => Number.isFinite(c?.price))) setPriceAt(Date.now());
  }, [prices, store.coins]);

  /* "Connecting" only counts once it has lasted: a normal first connect says nothing. */
  const connecting = store.wsStatus === 'Connecting...';
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (!connecting) { setWaited(false); return; }
    const timer = setTimeout(() => setWaited(true), CONNECTING_GRACE_MS);
    return () => clearTimeout(timer);
  }, [connecting]);

  const state = feedState(store.wsStatus, store.pricesFailed, connecting && waited ? CONNECTING_GRACE_MS : 0);

  return (
    <div role="status" className="feed-status-region" data-testid="feed-status-region">
      {state && (
        <div className="feed-status-chip" data-testid="feed-status" data-state={state}>
          {t(state === 'backup' ? 'FEED_STATUS_BACKUP' : 'FEED_STATUS_DELAYED')}
          {priceAt != null && <> · {t('FEED_STATUS_AS_OF', { time: new Date(priceAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) })}</>}
        </div>
      )}
    </div>
  );
}
