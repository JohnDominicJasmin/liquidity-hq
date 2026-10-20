'use client';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { getWhopCheckoutUrl, getWhopEmbed, isProBuyable, isWhopCheckoutConfiguredAnnual, isWhopCheckoutConfiguredFortnightly, type CheckoutPlan } from '@/lib/checkout';
import LoadingState from '@/components/LoadingState';
import { EntitlementUnknownCard } from '@/components/UpgradeGateModal';
import { useLabels } from '@/lib/labels';
import { FREE_PLAN_FEATURES, PRO_PLAN_FEATURES } from '@/lib/planFeatures';

/* #1606: the embedded Whop checkout. Loaded only when a plan is picked (client only), so the Whop SDK is not part of this page's first load. */
const WhopCheckoutEmbed = lazy(() => import('@/components/WhopCheckoutEmbed'));
/** Stands in for the address while the sentence label is split around it, so the address can be rendered bold. */
const EMAIL_TOKEN = '\u0000EMAIL\u0000';

/* #1567 Phase 2: a plan is buyable when it has a Whop checkout URL (owner, 2026-10-17: Whop only, no MoonPay and no BoomFi button).
   Lemon Squeezy rejected the store and the BoomFi buttons are gone from this page. With no URL set - prod today - the page shows
   "Pro payments launching soon" and zero buttons. Setting the URLs does NOT unlock a paying account: that waits for a real recorded
   Whop payload, so the URLs stay unset on prod until then. */
// isProBuyable is "the Whop monthly URL is set", the same answer /api/version reports as proBuyable.
const CHECKOUT_CONFIGURED = isProBuyable();
const CHECKOUT_ANNUAL_CONFIGURED = isWhopCheckoutConfiguredAnnual();
// #1400: the two-weekly plan is additive, like annual - it renders only where the
// monthly link is set too, and never substitutes for it.
const CHECKOUT_FORTNIGHTLY_CONFIGURED = isWhopCheckoutConfiguredFortnightly();

/* The row under the plan buttons. "Instant access" (UPGRADE_TRUST_INSTANT_ACCESS)
   is left out, owner's decision 2026-09-30 (#861): a Whop payment does not
   unlock the account by itself (the unlock waits for a real recorded payload, #1567), so the line
   would be untrue for the only way there is to pay. It comes back when a payment
   method that unlocks automatically exists. The label key stays.
   "Cancel anytime" (UPGRADE_TRUST_CANCEL_ANYTIME) is left out for the same
   reason, owner's decision 2026-09-30 (#861): a Whop subscriber cannot cancel
   from here yet, and copy says only what the product does today. It comes back
   when that cancel exists. The label key stays. */
const TRUST_LABELS = ['UPGRADE_TRUST_SECURE_CHECKOUT'] as const;

// Both plan lists now live in lib/planFeatures.ts (FREE_PLAN_FEATURES /
// PRO_PLAN_FEATURES), shared with the landing page so the two surfaces can't
// drift again (#1152). The gate-sync notes and the reasons certain rows are
// deliberately absent (backtest, priority support) moved there with the lists.
// Numbers still come from lib/limits.ts.

/* The price badge inside the two-weekly and annual buttons (#861, owner
   2026-09-30: "fix it"). At 390 wide the badge used to break in the middle,
   "$20" on one line and "/2 weeks" on the next. Now it never breaks: the button
   lays out as a wrapping row, so on a narrow screen the badge drops whole onto
   its own line, centred under the label, and on a wide one it sits beside it. */
const PRICE_BADGE: React.CSSProperties = { fontSize: 'var(--fs-caption)', fontWeight: 600, background: 'rgba(0,0,0,0.18)', borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' };
const PRICE_BUTTON_LAYOUT: React.CSSProperties = { display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', columnGap: 8, rowGap: 6 };

/* The three billing buttons share one shape (Danivy's recommendation, #861): the same width, the same
   height, the label on the left and the badge on the right, so the three prices can be compared at a
   glance. Only the recommended one (monthly) is filled; the other two are outlined. */
const PLAN_BUTTON_SHAPE: React.CSSProperties = { width: '100%', minHeight: 76, boxSizing: 'border-box', flexDirection: 'column', flexWrap: 'nowrap', alignItems: 'flex-start', justifyContent: 'center', rowGap: 6, textAlign: 'left', position: 'relative' };
/* One look for all three, and a SELECTED state that is the same for each (owner, 2026-10-06: "selecting these 3
   items must have border design like this"). Unselected: a plain 1px subtle border. Selected: the accent border at
   2px (1px + an inset 1px, so nothing shifts) over a light accent fill. The Recommended tag marks monthly; it does
   not fill it. outlineOffset keeps the keyboard focus ring clear of the border, so the ring never reads as "selected". */
const PLAN_BUTTON_OUTLINED: React.CSSProperties = { color: 'var(--txt)', background: 'transparent', border: '1px solid var(--bdr3)', outlineOffset: 4 };
const PLAN_BUTTON_SELECTED: React.CSSProperties = { color: 'var(--txt)', background: 'var(--accent-bg)', border: '1px solid var(--accent)', boxShadow: 'inset 0 0 0 1px var(--accent)', outlineOffset: 4 };
const PLAN_RECOMMENDED_TAG: React.CSSProperties = { position: 'absolute', top: -10, right: 14, fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', background: 'var(--accent-solid)', color: 'var(--on-accent)', border: '1px solid var(--bg)', padding: '2px 10px', borderRadius: 'var(--radius-data)', whiteSpace: 'nowrap' };
const BILLING_CHOICES_COLUMN: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 440 };

export default function UpgradePage() {
  const { user, loading, isPro, entitlementsLoading, entitlementStatus, retryEntitlements } = useAuth();
  const router = useRouter();
  /* WHICH plan is redirecting, not just whether one is (#1423). A single boolean
     drove every button's label, so clicking one plan made all three read
     "Redirecting to checkout…". Holding the plan lets only the clicked button
     change label while all three still disable, so a second plan cannot be
     clicked mid-navigation. */
  const [redirecting, setRedirecting] = useState<null | CheckoutPlan>(null);
  const isRedirecting = redirecting !== null;
  /* #861: paying is two steps. A plan button no longer navigates - it picks the
     plan, and a panel then asks HOW to pay. One payment method exists today, and
     the panel still shows, so the page does not change shape for the buyer on
     the day a second method is added. */
  const [selectedPlan, setSelectedPlan] = useState<null | CheckoutPlan>(null);
  /* #1606: the embedded checkout could not load (Whop's script blocked, network down): the panel shows the hosted link instead. */
  const [embedFailed, setEmbedFailed] = useState(false);
  /* #1606 follow-up: at phone width the embedded checkout gets the full width (owner, "this look squeezed"). Our page gutter, our box padding and Whop's own band and
     card used to stack to a ~262 px form at 390 px; now only a 12 px gutter is left around it. Desktop is unchanged. */
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 480px)');
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  /* #1606: where Whop sent the buyer back from the embedded checkout. `status` is read BEFORE anything is said (a declined or abandoned off-site step
     lands here too). Pro is granted by the webhook only, so even 'succeeded' says only that the payment arrived. */
  const [returnStatusRaw, setReturnStatus] = useState<null | 'succeeded' | 'failed' | 'canceled'>(null);
  /* #1614: "Payment received" is the one line that claims something good, so it also needs the payment id Whop adds to the return (pay_...). A bare
     /upgrade?status=succeeded, typed or crafted by anyone, shows nothing. It is still only a line: Pro comes from the webhook, never from this. */
  const [returnHasPaymentId, setReturnHasPaymentId] = useState(false);
  const returnStatus = returnStatusRaw === 'succeeded' && !returnHasPaymentId ? null : returnStatusRaw;
  const planChoiceStyle = (plan: CheckoutPlan): React.CSSProperties => (selectedPlan === plan ? PLAN_BUTTON_SELECTED : PLAN_BUTTON_OUTLINED);
  /** The plan button that opened the panel, so closing it can return focus there. */
  const panelOpener = useRef<HTMLElement | null>(null);
  /* "Upgrade to Pro" on the Pro card reveals the billing choices (Danivy's flow, #861). It only shows
     them: nothing is chosen, charged or navigated until a plan button is pressed. */
  const [plansOpen, setPlansOpen] = useState(false);
  const billingChoicesRef = useRef<HTMLDivElement | null>(null);
  const { t } = useLabels();
  useEffect(() => {
    if (plansOpen) billingChoicesRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [plansOpen]);

  useEffect(() => {
    if (loading) return;
    // Pro users already have everything this page sells - send them
    // onward. Logged-out visitors see the pricing itself (no redirect);
    // login is only required at the actual "Get Pro" click, in
    // handleCheckout below - a pricing page that bounces anonymous
    // visitors before they've seen a price is pure conversion friction.
    if (isPro) { router.replace('/arena'); return; }
    // `loading` has to be here, not just read. The effect bails out while auth
    // is still resolving, and without loading in the list it never re-runs when
    // that resolves - it only re-runs if isPro itself changes. A Pro user whose
    // role landed before the loading flag cleared would hit the early return
    // once and then never be redirected, sitting on a pricing page for a plan
    // they already pay for.
  }, [isPro, loading, router]);

  /* Coming BACK from the payment page. The browser can restore this page from
     its back/forward cache with its state intact, which would leave
     `redirecting` set and every button disabled with no way to clear it but a
     reload. A restored page is one the buyer returned to, so nothing is
     redirecting any more. */
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) setRedirecting(null); };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  /* Step 1. An account is still required before paying: the payment is matched
     to it afterwards by the account id bound to the link, so a payer with no
     account has nothing to unlock. */
  function choosePlan(plan: CheckoutPlan) {
    if (!user) { router.push('/login?signup=1&next=/upgrade'); return; }
    if (document.activeElement instanceof HTMLElement) panelOpener.current = document.activeElement;
    setEmbedFailed(false);
    setReturnStatus(null);
    setSelectedPlan(plan);
  }

  /* Closing the panel (#861, owner 2026-09-30): an X, and Escape from anywhere
     on the page. Focus goes back to the plan button that opened it, so a
     keyboard user is not dropped at the top of the page. Not while redirecting:
     the payment page is already loading. */
  const closePanel = useCallback(() => {
    setSelectedPlan(null);
    const opener = panelOpener.current;
    panelOpener.current = null;
    if (opener?.isConnected) opener.focus();
  }, []);
  useEffect(() => {
    if (!selectedPlan || isRedirecting) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePanel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedPlan, isRedirecting, closePanel]);

  const handleCheckout = () => choosePlan('monthly');
  const handleCheckoutAnnual = () => choosePlan('annual');
  const handleCheckoutFortnightly = () => choosePlan('fortnightly');

  /* Coming back from the embedded checkout (#1606): Whop adds `payment` and `status` to the return URL. Anything other than the three documented values is
     ignored. The query is deliberately NOT stripped afterwards: history.replaceState here makes Next's router re-render the route and this state is lost
     (measured: the banner vanished), so a reload shows the line again, which is harmless (a Pro account is sent on to /arena anyway). */
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('status');
    if (s === 'succeeded' || s === 'failed' || s === 'canceled') setReturnStatus(s);
    setReturnHasPaymentId(/^pay_[A-Za-z0-9]+$/.test(new URLSearchParams(window.location.search).get('payment') ?? ''));
  }, []);
  /* After a payment that went through, the webhook unlocks Pro a moment later. Ask for the plan again every few seconds for about two minutes; the
     existing effect above sends the account to /arena the moment it reads Pro. Nothing is claimed in the meantime. */
  useEffect(() => {
    if (returnStatus !== 'succeeded' || !user) return;
    let n = 0;
    const id = window.setInterval(() => { if (++n > 20) { window.clearInterval(id); return; } retryEntitlements(); }, 6000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnStatus, user?.id]);

  /* Step 2. The link is read for the plan that was picked, never another one. */
  /* #1606: the signed-in account's email goes to Whop filled and locked, so the payment is matched to THIS account. Signed out: no email, the plain link. */
  const accountEmail = user?.email ?? null;
  const whopUrl = selectedPlan ? getWhopCheckoutUrl(selectedPlan, accountEmail) : null;
  /* The embedded checkout needs the plan's `plan_` id and whether it is the Whop sandbox, both read from the configured link. null = show the link. */
  const embed = selectedPlan ? getWhopEmbed(selectedPlan) : null;
  const embedReturnUrl = typeof window === 'undefined' ? '' : `${window.location.origin}/upgrade`;
  function payWithWhop() {
    if (!selectedPlan || !whopUrl) return;
    setRedirecting(selectedPlan);
    window.location.href = whopUrl;
  }

  /* One button per plan, styled like the monthly one. Shown wherever its link is
     set (the price and period are labels, so a price change is a row, not a
     deploy). */
  const fortnightlyButton = CHECKOUT_FORTNIGHTLY_CONFIGURED && (
    <button
      data-testid="checkout-cta-fortnightly"
      onClick={handleCheckoutFortnightly}
      disabled={isRedirecting}
      aria-pressed={selectedPlan === 'fortnightly'}
      style={{ fontSize: 'var(--fs-data)', fontWeight: 700, padding: '14px 20px', borderRadius: 12, cursor: isRedirecting ? 'default' : 'pointer', opacity: redirecting === 'fortnightly' ? 0.7 : 1, transition: 'transform 0.15s', ...PRICE_BUTTON_LAYOUT, ...PLAN_BUTTON_SHAPE, ...planChoiceStyle('fortnightly') }}
      onMouseEnter={e => { if (!isRedirecting) (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; }}
    >
      {redirecting === 'fortnightly' ? t('UPGRADE_CHECKOUT_BUTTON_REDIRECTING') : (
        <><span>{t('UPGRADE_FORTNIGHTLY_CHECKOUT_BUTTON_CTA')}</span><span style={PRICE_BADGE}>{t('UPGRADE_PRICE_FORTNIGHTLY')}{t('UPGRADE_PRICE_SUFFIX_FORTNIGHTLY')}</span></>
      )}
    </button>
  );

  const embedded = !!(embed && accountEmail && !embedFailed);
  const embedPhone = embedded && narrow;
  const methodPanel = selectedPlan && (
    <div
      data-testid="checkout-method-panel"
      data-plan={selectedPlan}
      role="group"
      aria-labelledby="checkout-method-title"
      style={embedPhone
        // Phone, embedded: no side padding, no frame. The page's side space here is 16 px (main) + 24 px (page body) = 40 px; the negative margin takes it down to 12 px; the lines inside keep their own 12 px.
        ? { position: 'relative', width: 'calc(100% + 56px)', marginInline: -28, borderRadius: 0, padding: '12px 0', background: 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }
        : { position: 'relative', width: '100%', maxWidth: embedded ? 520 : 440, borderRadius: 16, padding: '20px 24px', background: 'var(--bg1)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}
    >
      {/* 32x32 hit area, above SC 2.5.8's 24px minimum; the glyph stays small. */}
      <button
        type="button"
        data-testid="checkout-method-close"
        onClick={closePanel}
        disabled={isRedirecting}
        aria-label={t('UPGRADE_METHOD_PANEL_CLOSE_ARIA')}
        title={t('UPGRADE_METHOD_PANEL_CLOSE_ARIA')}
        style={{ position: 'absolute', top: 8, right: 8, width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--fs-body)', lineHeight: 1, color: 'var(--txt3)', background: 'transparent', border: 'none', borderRadius: 8, cursor: isRedirecting ? 'default' : 'pointer' }}
      >
        ✕
      </button>
      {/* Side padding keeps a long title clear of the X. */}
      <div id="checkout-method-title" style={{ fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--txt)', padding: '0 40px', textAlign: 'center' }}>
        {t('UPGRADE_WHOP_PANEL_TITLE')}
      </div>
      {/* One method, so the panel is the same height for every plan: the notes below are constant (the BoomFi-only "billed weekly" note and
          the ghost grid that held its height are gone, #1567). */}
      {/* Signed in: which email checkout uses and what it is for (#1606; Whop's own page cannot show our text, so it is said here, above the button).
          Signed out: the plain reminder, there is no address to show. */}
      {accountEmail ? (
        // One sentence, the email bold (owner, #1606). The label carries {email}; it is split on a token so the address can be bold without HTML in a label.
        <p data-testid="checkout-method-whop-email-note" data-prefilled="1" style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', margin: 0, lineHeight: 1.6, textAlign: 'center', overflowWrap: 'anywhere', padding: embedPhone ? '0 12px' : 0 }}>
          {(() => {
            const parts = t('UPGRADE_WHOP_EMAIL_SENTENCE', { email: EMAIL_TOKEN }).split(EMAIL_TOKEN);
            return <>{parts[0]}<strong data-testid="checkout-method-whop-email-line" style={{ color: 'var(--txt)', fontWeight: 700 }}>{accountEmail}</strong>{parts.slice(1).join('')}</>;
          })()}
        </p>
      ) : (
        <p data-testid="checkout-method-whop-email-note" style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', margin: 0, lineHeight: 1.6, textAlign: 'center' }}>
          {t('UPGRADE_WHOP_EMAIL_NOTE')}
        </p>
      )}
      {embed && accountEmail && !embedFailed ? (
        <>
          <Suspense fallback={<p style={{ margin: 0, padding: '24px 0', textAlign: 'center', fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('UPGRADE_WHOP_EMBED_LOADING')}</p>}>
            <WhopCheckoutEmbed planId={embed.planId} email={accountEmail} environment={embed.environment} returnUrl={embedReturnUrl} onFailed={() => setEmbedFailed(true)} compact={narrow} />
          </Suspense>
          {/* Near the Join button (owner, #1606): the payment is made in the element above, so it is not "finish on Whop" here. */}
          <p data-testid="checkout-method-whop-final-note" style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', margin: 0, lineHeight: 1.6, textAlign: 'center', padding: embedPhone ? '0 12px' : 0 }}>
            {t('UPGRADE_WHOP_FINAL_NOTE')}
          </p>
        </>
      ) : (
        <>
          {embedFailed && (
            <p data-testid="checkout-method-whop-embed-fallback" style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', margin: 0, lineHeight: 1.6, textAlign: 'center' }}>{t('UPGRADE_WHOP_EMBED_FALLBACK')}</p>
          )}
      {whopUrl && (
        <button
          data-testid="checkout-method-whop"
          onClick={payWithWhop}
          disabled={isRedirecting}
          style={{ fontSize: 'var(--fs-data)', fontWeight: 700, color: 'var(--on-accent)', background: 'var(--accent-solid)', padding: '14px 32px', borderRadius: 12, border: 'none', cursor: isRedirecting ? 'default' : 'pointer', opacity: isRedirecting ? 0.7 : 1 }}
        >
          {isRedirecting ? t('UPGRADE_CHECKOUT_BUTTON_REDIRECTING') : t('UPGRADE_WHOP_CTA')}
        </button>
      )}
      {/* The hosted link (the embedded checkout could not load, or this plan's link has no plan id): where payment happens and that sales are final. No cancel, refund, card or crypto claim: copy says only what the product does today. */}
      <p data-testid="checkout-method-whop-checkout-note" style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', margin: 0, lineHeight: 1.6, textAlign: 'center' }}>
        {t('UPGRADE_WHOP_CHECKOUT_NOTE')}
      </p>
        </>
      )}
    </div>
  );

  /* #1309 item 12: this used to wait only for sign-in. `isPro` is false until the subscription read settles,
     so a Pro account saw the checkout buttons for as long as that took (payments are not live, so nobody
     could be charged twice today - fix before they open). A signed-in visitor now waits for the plan; if it
     could not be read at all, the page says so and offers a retry rather than selling Pro to someone who may
     already have it. Signed-out visitors are unaffected: entitlementsLoading settles false for them. */
  if (loading || (user && entitlementsLoading) || isPro) {
    return <LoadingState message={isPro ? t('UPGRADE_LOADING_REDIRECTING') : t('UPGRADE_LOADING')} fullPage />;
  }
  if (user && entitlementStatus === 'unknown') {
    return (
      <div className="upgrade-term-wrap" style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--txt)', padding: '56px 24px' }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          <EntitlementUnknownCard title={t('UPGRADE_HERO_TITLE')} onRetry={retryEntitlements} />
        </div>
      </div>
    );
  }

  return (
    <div className="upgrade-term-wrap" style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--txt)', fontFamily: 'inherit' }}>

      {/* Nav */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'var(--bg)', borderBottom: '0.5px solid var(--bdr)', padding: '0 24px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* minHeight for WCAG 2.2 SC 2.5.8 - a standalone back link, not one
            inside a sentence, so the inline exception does not apply. Was 44x20. */}
        <Link href="/arena" style={{ fontSize: 'var(--fs-label)', color: 'var(--txt3)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, minHeight: 24 }}>
          {t('UPGRADE_BACK_LABEL')}
        </Link>
        <span style={{ fontSize: 'var(--fs-card-title)', fontWeight: 800, letterSpacing: '-.02em', color: 'var(--txt)' }}>
          LiquidityHQ
        </span>
        <div style={{ width: 48 }} />
      </nav>

      {/* Page body */}
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '56px 24px 80px' }}>

        {/* #1606: where Whop sent the buyer back from the embedded checkout. Says only what is known: the payment arrived (Pro follows from the webhook),
            or it did not go through. Never "you are Pro". */}
        {returnStatus && (
          <div role="status" data-testid="upgrade-return-banner" data-status={returnStatus} style={{ maxWidth: 520, margin: '0 auto 28px', padding: '14px 18px', borderRadius: 12, border: `1px solid ${returnStatus === 'succeeded' ? 'var(--accent)' : 'var(--bdr3)'}`, background: returnStatus === 'succeeded' ? 'var(--accent-bg)' : 'var(--bg1)', color: 'var(--txt)', fontSize: 'var(--fs-label)', lineHeight: 1.5, textAlign: 'center' }}>
            {returnStatus === 'succeeded' ? t('UPGRADE_RETURN_PENDING') : returnStatus === 'failed' ? t('UPGRADE_RETURN_FAILED') : t('UPGRADE_RETURN_CANCELED')}
          </div>
        )}

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--accent)', background: 'var(--accent-bg)', border: '0.5px solid var(--accent-bdr)', borderRadius: 20, padding: '4px 14px', marginBottom: 20 }}>
            {t('UPGRADE_EYEBROW')}
          </div>
          <h1 style={{ fontSize: 'clamp(1.75rem, 5vw, 2.75rem)', fontWeight: 900, letterSpacing: '-.03em', margin: '0 0 14px', lineHeight: 1.1 }}>
            {t('UPGRADE_HERO_TITLE')}
          </h1>
          <p style={{ fontSize: 'var(--fs-body)', color: 'var(--txt2)', margin: 0, lineHeight: 1.65, maxWidth: 440, marginInline: 'auto' }}>
            {t('UPGRADE_HERO_SUBTITLE')}
          </p>
        </div>

        {/* Plan cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 36 }}>

          {/* Free card */}
          <div style={{ borderRadius: 16, padding: '24px 28px', border: '0.5px solid var(--bdr)', background: 'var(--bg1)' }}>
            {/* #1309 item 22: "Current plan" is only true for a signed-in visitor on Free; a signed-out visitor has no plan, so the
                caption is left empty (a non-breaking space, so the cards keep their height). */}
            <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 6 }}>{user ? t('UPGRADE_FREE_CARD_EYEBROW') : ' '}</div>
            <div style={{ fontSize: 'var(--fs-label)', fontWeight: 800, color: 'var(--txt)', marginBottom: 2 }}>{t('UPGRADE_FREE_CARD_NAME')}</div>
            <div style={{ fontSize: '2rem', fontWeight: 900, letterSpacing: '-.04em', marginBottom: 20 }}>$0<span style={{ fontSize: 'var(--fs-body)', fontWeight: 400, color: 'var(--txt3)' }}>{t('UPGRADE_PRICE_SUFFIX_MONTHLY')}</span></div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
              {FREE_PLAN_FEATURES.map(({ id, labelKey, vars, included }) => (
                /* #1152: excluded rows (no Telegram/price alerts) now render here
                   too, as the landing page already did - so an upgrade screen
                   finally states what Free does NOT include, muted with a ✗. */
                <li key={id} style={{ fontSize: 'var(--fs-label)', color: included ? 'var(--txt2)' : 'var(--txt3)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  {included ? (
                    /* #705: var(--green), not #22c55e. That literal is Tailwind's green-500 and
    is in NEITHER palette - not the current design's --green (#4ade80 dark,
    #046B4E light) nor terminal's (#3fb950 / #14702c) - so it tracked no theme
    and measured 1.88:1 on terminal light's --bg1. Dark passed at 7.4, which is
    why it survived: the failure only existed in the theme nobody defaulted to.
    --green is declared in all four scopes, so this is one token everywhere.
    Measured, ground stated:

        terminal light  --green #14702c on --bg1 #ebe9e6   5.12   was 1.88
        terminal dark   --green #3fb950 on --bg1 #141517   7.19   was 8.29
        current light   --green #046B4E on #E8EAED         5.41   was 1.89
        current dark    --green #4ade80 on #06070a        11.56   was 8.84

    THE CURRENT DESIGN'S LIGHT THEME WAS ALSO FAILING, at 1.89. #705 measured
    terminal only, so that half was never counted - the literal tracked no
    theme, and both light themes land it on a light ground. Dark passed in both
    designs, which is why seven checkmarks sat at under 2:1 without anyone
    noticing. */
                    <span style={{ color: 'var(--green)', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>✓</span>
                  ) : (
                    <span style={{ color: 'var(--txt4)', fontWeight: 700, flexShrink: 0, marginTop: 1 }} aria-hidden="true">✗</span>
                  )}
                  {t(labelKey, vars)}
                </li>
              ))}
            </ul>
          </div>

          {/* Pro card */}
          <div style={{ borderRadius: 16, padding: '24px 28px', border: '0.5px solid var(--accent-bdr)', background: 'linear-gradient(160deg, var(--accent-bg) 0%, var(--bg1) 60%)', position: 'relative' }}>
            <div style={{ position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', background: 'var(--accent-solid)', color: 'var(--on-accent)', padding: '3px 14px', borderRadius: 20, whiteSpace: 'nowrap' }}>
              {t('UPGRADE_PRO_CARD_BADGE')}
            </div>
            <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 6 }}>{t('UPGRADE_PRO_CARD_EYEBROW')}</div>
            <div style={{ fontSize: 'var(--fs-label)', fontWeight: 800, color: 'var(--txt)', marginBottom: 2 }}>{t('UPGRADE_PRO_CARD_NAME')}</div>
            <div style={{ fontSize: '2rem', fontWeight: 900, letterSpacing: '-.04em', marginBottom: 20 }}>{t('UPGRADE_PRICE_MONTHLY')}<span style={{ fontSize: 'var(--fs-body)', fontWeight: 400, color: 'var(--txt3)' }}>{t('UPGRADE_PRICE_SUFFIX_MONTHLY')}</span></div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
              {PRO_PLAN_FEATURES.map(({ id, labelKey, vars }) => (
                <li key={id} style={{ fontSize: 'var(--fs-label)', color: 'var(--txt2)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ color: 'var(--accent)', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>✓</span> {t(labelKey, vars)}
                </li>
              ))}
            </ul>
            {/* Danivy's flow (#861): the cards first, the billing choices on request. Only where there is
                something to buy: in the "launching soon" state this is not rendered, so that page keeps
                zero buttons. It reveals, it does not navigate or charge. */}
            {CHECKOUT_CONFIGURED && (
              <button
                type="button"
                data-testid="upgrade-reveal-plans"
                aria-expanded={plansOpen}
                aria-controls="billing-choices"
                onClick={() => setPlansOpen(true)}
                disabled={plansOpen}
                style={{ width: '100%', minHeight: 48, marginTop: 20, fontSize: 'var(--fs-data)', fontWeight: 700, color: 'var(--on-accent)', background: 'var(--accent-solid)', padding: '12px 20px', borderRadius: 12, border: 'none', cursor: plansOpen ? 'default' : 'pointer', opacity: plansOpen ? 0.6 : 1 }}
              >
                {t('UPGRADE_GATE_CTA')}
              </button>
            )}
          </div>
        </div>

        {/* CTA */}
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          {CHECKOUT_CONFIGURED && CHECKOUT_ANNUAL_CONFIGURED ? (
            /* State 1: both plans available — show monthly + annual side by side */
            plansOpen && <>
              <div id="billing-choices" ref={billingChoicesRef} style={BILLING_CHOICES_COLUMN}>
                {fortnightlyButton}
                <button
                  data-testid="checkout-cta-monthly"
                  onClick={handleCheckout}
                  disabled={isRedirecting}
                  aria-pressed={selectedPlan === 'monthly'}
                  style={{ fontSize: 'var(--fs-data)', fontWeight: 700, padding: '14px 20px', borderRadius: 12, cursor: isRedirecting ? 'default' : 'pointer', opacity: redirecting === 'monthly' ? 0.7 : 1, transition: 'opacity .15s, transform .15s', transform: 'translateY(0)', ...PRICE_BUTTON_LAYOUT, ...PLAN_BUTTON_SHAPE, ...planChoiceStyle('monthly') }}
                  onMouseEnter={e => { if (!isRedirecting) (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; }}
                >
                  {redirecting === 'monthly' ? t('UPGRADE_CHECKOUT_BUTTON_REDIRECTING') : (
                    <><span style={PLAN_RECOMMENDED_TAG}>{t('UPGRADE_PRO_CARD_BADGE')}</span><span>{t('UPGRADE_MONTHLY_CHECKOUT_BUTTON_CTA')}</span><span style={PRICE_BADGE}>{t('UPGRADE_PRICE_MONTHLY')}{t('UPGRADE_PRICE_SUFFIX_MONTHLY')}</span></>
                  )}
                </button>
                <button
                  data-testid="checkout-cta-annual"
                  onClick={handleCheckoutAnnual}
                  disabled={isRedirecting}
                  aria-pressed={selectedPlan === 'annual'}
                  style={{ fontSize: 'var(--fs-data)', fontWeight: 700, padding: '14px 20px', borderRadius: 12, cursor: isRedirecting ? 'default' : 'pointer', opacity: redirecting === 'annual' ? 0.7 : 1, transition: 'opacity .15s, transform .15s', transform: 'translateY(0)', position: 'relative', ...PRICE_BUTTON_LAYOUT, ...PLAN_BUTTON_SHAPE, ...planChoiceStyle('annual') }}
                  onMouseEnter={e => { if (!isRedirecting) (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; }}
                >
                  {redirecting === 'annual' ? t('UPGRADE_CHECKOUT_BUTTON_REDIRECTING') : (
                    <><span>{t('UPGRADE_ANNUAL_CHECKOUT_BUTTON_CTA')}</span><span style={PRICE_BADGE}>{t('UPGRADE_PRICE_ANNUAL')}{t('UPGRADE_PRICE_SUFFIX_ANNUAL')} · {t('UPGRADE_ANNUAL_SAVE_BADGE')}</span></>
                  )}
                </button>
              </div>
              {methodPanel}
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
                {/* No UPGRADE_TRUST_BILLED_ANNUALLY here (#1423): this row sits under all
                    three plans, but monthly and fortnightly are not billed annually, so a
                    shared "Billed annually" told two of three buyers the wrong cadence on
                    the page where they pick it. The monthly-only state below already omits
                    it; this now matches. */}
                {TRUST_LABELS.map(label => (
                  <span key={label} style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ color: 'var(--green)', fontSize: '0.6875rem' }}>✓</span> {t(label)}
                  </span>
                ))}
              </div>
            </>
          ) : CHECKOUT_CONFIGURED ? (
            /* State 2: monthly only — pixel-identical to today unless the two-weekly link is also set */
            plansOpen && <>
              <div id="billing-choices" ref={billingChoicesRef} style={BILLING_CHOICES_COLUMN}>
              {fortnightlyButton}
              <button
                data-testid="checkout-cta-monthly"
                onClick={handleCheckout}
                disabled={isRedirecting}
                aria-pressed={selectedPlan === 'monthly'}
                style={{ fontSize: 'var(--fs-data)', fontWeight: 700, padding: '14px 20px', borderRadius: 12, cursor: isRedirecting ? 'default' : 'pointer', opacity: redirecting === 'monthly' ? 0.7 : 1, transition: 'opacity .15s, transform .15s', transform: 'translateY(0)', display: 'inline-flex', ...PLAN_BUTTON_SHAPE, minHeight: 52, alignItems: 'center', justifyContent: 'center', ...planChoiceStyle('monthly') }}
                onMouseEnter={e => { if (!isRedirecting) (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; }}
              >
                {redirecting === 'monthly' ? t('UPGRADE_CHECKOUT_BUTTON_REDIRECTING') : t('UPGRADE_CHECKOUT_BUTTON_CTA')}
              </button>
              </div>
              {methodPanel}
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
                {TRUST_LABELS.map(label => (
                  <span key={label} style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ color: 'var(--green)', fontSize: '0.6875rem' }}>✓</span> {t(label)}
                  </span>
                ))}
              </div>
            </>
          ) : (
            /* State 3: neither configured — existing coming-soon block */
            <div style={{ borderRadius: 14, padding: '28px 36px', border: '0.5px solid var(--accent-bdr)', background: 'var(--accent-bg)', maxWidth: 400, width: '100%' }}>
              
              <div style={{ fontSize: 'var(--fs-data)', fontWeight: 700, color: 'var(--txt)', marginBottom: 8 }}>
                {t('UPGRADE_COMING_SOON_TITLE')}
              </div>
              <p style={{ fontSize: 'var(--fs-label)', color: 'var(--txt2)', lineHeight: 1.65, margin: '0 0 16px' }}>
                {user ? (
                  <>{t('UPGRADE_COMING_SOON_SIGNED_IN_PRE')}{' '}
                  <span style={{ color: 'var(--accent)' }}>{user.email}</span>{' '}
                  {t('UPGRADE_COMING_SOON_SIGNED_IN_POST')}</>
                ) : (
                  <>{t('UPGRADE_COMING_SOON_SIGNED_OUT_PRE')}{' '}
                  <Link href="/login?signup=1&next=/upgrade" style={{ color: 'var(--accent)' }}>{t('UPGRADE_COMING_SOON_SIGNUP_LINK')}</Link>{' '}
                  {t('UPGRADE_COMING_SOON_SIGNED_OUT_POST')}</>
                )}
              </p>
              {/* inline-flex + minHeight, not padding: this is a standalone
                  link rather than one inside a sentence, so WCAG 2.2 SC 2.5.8's
                  inline exception does not cover it and it needs the real 24px.
                  Measured 81x15 before. */}
              <Link
                href="/arena"
                style={{
                  fontSize: 'var(--fs-label)', color: 'var(--txt3)', textDecoration: 'underline',
                  display: 'inline-flex', alignItems: 'center', minHeight: 24,
                }}
              >
                {t('UPGRADE_BACK_TO_ARENA_LINK')}
              </Link>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
