'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { WhopElements, Checkout, CheckoutElement } from '@whop/elements-react';
import { loadWhop } from '@whop/elements';
import { useLabels } from '@/lib/labels';

/* The Whop checkout, embedded on /upgrade (#1606, owner 2026-10-21), built on Whop Elements (@whop/elements-react 1.9.0), not the legacy
 * @whop/checkout embed.
 *
 * THE ACCOUNT EMAIL IS FILLED AND LOCKED (`buyerEmail` + `lockBuyerEmail`): the unlock matches the payment to an account by that email
 * (app/api/whop/webhook), so the buyer must not be able to type another one. Whop's docs say a session that already holds its own buyer
 * email wins over the prefill, and the lock only holds while the field still shows that email; a buyer already signed in to Whop under a
 * different address is therefore NOT verified here (QA's #1606 test), and the recovery claim (#1607) stays the safety net.
 *
 * PRO IS GRANTED BY THE WEBHOOK ONLY. `onComplete` is deliberately not used to unlock anything (Whop says the same: fulfil from webhooks, and a
 * restored checkout fires it again). After paying, Whop sends the buyer to `returnUrl` with `payment` and `status` (succeeded, failed or
 * canceled); the /upgrade page reads `status` before it says anything, and says only that the payment arrived, never that Pro is on.
 *
 * IF THE ELEMENT CANNOT LOAD (the Whop script is blocked or the network is down) `onFailed` is called, and the page shows the hosted checkout link
 * (the same email filled and locked) so a buyer is never stuck. The SDK is only fetched when this component mounts, i.e. after a plan is picked.
 *
 * The element's own text and card form live in Whop's frame (cdn.whop.com) and are not ours to translate or restyle beyond `appearance`. */

export interface WhopCheckoutEmbedProps {
  planId: string;
  email: string;
  environment: 'production' | 'sandbox';
  /** Where Whop sends the buyer after paying (https, or http on localhost). `payment` and `status` are added to it. */
  returnUrl: string;
  /** Called once if the SDK or the element fails to load, so the page can show the hosted link instead. */
  onFailed: () => void;
  /** Phone width: take Whop's own inner padding off the element's layout parts so the form gets the room (owner, "this look squeezed"). Chosen at mount. */
  compact?: boolean;
}

/* WHAT THE SDK ALLOWS (measured on the real element, @whop/elements 1.9.0). `appearance.classes` restyles the documented `whop-*` parts and ACCEPTS padding:
 * with `padding: 0` on `whop-Checkout`, `whop-CheckoutLayout` and `whop-CheckoutCollection` the card-number field went from 258 px to 290 px wide in the same 366 px
 * container (zeroing more parts, the borders and backgrounds, gained only 8 px more and changes Whop's look, so it is not done). `appearance.variables` is not documented for
 * this element. Whop's own grey band and inset card are not a documented part, so they stay; what is removed here is OUR frame (see app/upgrade/page.tsx). */
const COMPACT_CLASSES = {
  'whop-Checkout': { padding: '0px' },
  'whop-CheckoutLayout': { padding: '0px' },
  'whop-CheckoutCollection': { padding: '0px' },
};

const LOAD_TIMEOUT_MS = 15_000;

export default function WhopCheckoutEmbed({ planId, email, environment, returnUrl, onFailed, compact = false }: WhopCheckoutEmbedProps) {
  const { t } = useLabels();
  // The SDK is loaded once per mount; a failed load is reported through onLoadError, never thrown into the page.
  const elements = useMemo(() => loadWhop(), []);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  /* A blocked frame or a stalled network can leave the element loading forever without the SDK ever reporting an error. If nothing has finished
     loading after LOAD_TIMEOUT_MS the page is told, so it shows the hosted link instead of a spinner. */
  const loadedRef = useRef(false);
  const failedRef = useRef(false);
  const fail = () => { if (failedRef.current) return; failedRef.current = true; onFailed(); };
  useEffect(() => {
    const id = window.setTimeout(() => { if (!loadedRef.current) fail(); }, LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const read = () => setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  return (
    <div data-testid="whop-checkout-embed" data-plan-id={planId} data-environment={environment} style={{ width: '100%', minHeight: 120 }}>
      <WhopElements
        elements={elements}
        environment={environment}
        appearance={{ theme: { appearance: theme }, ...(compact ? { classes: COMPACT_CLASSES } : {}) }}
        onLoadError={() => fail()}
      >
        <Checkout
          plan={planId}
          returnUrl={returnUrl}
          onLoadingChange={(loading) => { if (!loading) loadedRef.current = true; }}
          fallback={<p data-testid="whop-checkout-embed-loading" style={{ margin: 0, padding: '24px 0', textAlign: 'center', fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('UPGRADE_WHOP_EMBED_LOADING')}</p>}
        >
          <CheckoutElement buyerEmail={email} lockBuyerEmail />
        </Checkout>
      </WhopElements>
    </div>
  );
}
