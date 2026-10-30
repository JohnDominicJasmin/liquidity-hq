'use client';
import { useLabels } from '@/lib/labels';
import EmailLinked from '@/components/EmailLinked';

const SECTIONS = [
  { titleKey: 'TERMS_SECTION_ACCEPTANCE_TITLE', bodyKey: 'TERMS_SECTION_ACCEPTANCE_BODY' },
  { titleKey: 'TERMS_SECTION_ELIGIBILITY_TITLE', bodyKey: 'TERMS_SECTION_ELIGIBILITY_BODY' },
  { titleKey: 'TERMS_SECTION_NATURE_OF_SERVICE_TITLE', bodyKey: 'TERMS_SECTION_NATURE_OF_SERVICE_BODY' },
  { titleKey: 'TERMS_SECTION_USER_ACCOUNTS_TITLE', bodyKey: 'TERMS_SECTION_USER_ACCOUNTS_BODY' },
  /* #1630: what you pay and how you stop paying, between "your account" and "what you may not do".
     Until these existed, /refund redirected to /terms and the live Terms contained zero hits for
     subscri, billing, renew, cancel or refund - a customer clicking "Refund policy" landed on a page
     with no refund policy, measured on production 2026-10-23.

     THE FOUR AND THE CANCEL FLOW SHIPPED TOGETHER, in v2026.10.29, which is what this block used to
     hold them for. §Cancellation promises cancelling never forfeits paid time, §Refunds rests its
     whole stance on that same promise - "because cancelling always preserves the paid time you have
     already bought" - and the Whop cancel panel in /settings is the thing that keeps it.

     THE DEPENDENCY RUNS THE OTHER WAY NOW, and that is the part worth leaving behind: if that panel
     is ever removed or broken, these two sections become a promise the product does not keep (rule
     7), and they have to come out in the same change. */
  { titleKey: 'TERMS_SECTION_SUBSCRIPTIONS_TITLE', bodyKey: 'TERMS_SECTION_SUBSCRIPTIONS_BODY' },
  { titleKey: 'TERMS_SECTION_BILLING_TITLE', bodyKey: 'TERMS_SECTION_BILLING_BODY' },
  { titleKey: 'TERMS_SECTION_CANCELLATION_TITLE', bodyKey: 'TERMS_SECTION_CANCELLATION_BODY' },
  { titleKey: 'TERMS_SECTION_REFUNDS_TITLE', bodyKey: 'TERMS_SECTION_REFUNDS_BODY' },
  { titleKey: 'TERMS_SECTION_PROHIBITED_USES_TITLE', bodyKey: 'TERMS_SECTION_PROHIBITED_USES_BODY' },
  { titleKey: 'TERMS_SECTION_IP_TITLE', bodyKey: 'TERMS_SECTION_IP_BODY' },
  { titleKey: 'TERMS_SECTION_THIRD_PARTY_DATA_TITLE', bodyKey: 'TERMS_SECTION_THIRD_PARTY_DATA_BODY' },
  // Sits immediately before Limitation of Liability on purpose: the warranty
  // disclaimer says what is not promised, the liability cap says what is not
  // owed when it goes wrong. /disclaimer already covers this in substance
  // ("feeds can lag, drop, or briefly disagree with the exchange you actually
  // trade on"), but that page is a notice - this one is the contract.
  { titleKey: 'TERMS_SECTION_WARRANTY_TITLE', bodyKey: 'TERMS_SECTION_WARRANTY_BODY' },
  { titleKey: 'TERMS_SECTION_LIABILITY_TITLE', bodyKey: 'TERMS_SECTION_LIABILITY_BODY' },
  { titleKey: 'TERMS_SECTION_INDEMNIFICATION_TITLE', bodyKey: 'TERMS_SECTION_INDEMNIFICATION_BODY' },
  { titleKey: 'TERMS_SECTION_TERMINATION_TITLE', bodyKey: 'TERMS_SECTION_TERMINATION_BODY' },
  { titleKey: 'TERMS_SECTION_GOVERNING_LAW_TITLE', bodyKey: 'TERMS_SECTION_GOVERNING_LAW_BODY' },
  { titleKey: 'TERMS_SECTION_CONTACT_TITLE', bodyKey: 'TERMS_SECTION_CONTACT_BODY' },
] as const;

export default function TermsOfUse() {
  const { t } = useLabels();

  return (
    <div className="terms-term-wrap" style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 24px 80px' }}>

      <div style={{ marginBottom: 48 }}>
        <div style={{
          fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 14,
        }}>
          {t('TERMS_EYEBROW')}
        </div>
        <h1 style={{ fontSize: '2.625rem', fontWeight: 800, color: 'var(--txt)', margin: 0, lineHeight: 1.1 }}>
          {t('TERMS_PAGE_TITLE')}
        </h1>
        <p style={{ fontSize: 'var(--fs-label)', color: 'var(--txt3)', marginTop: 16, lineHeight: 1.7 }}>
          {t('TERMS_LAST_UPDATED')}
        </p>
      </div>

      <div style={{
        fontSize: 'var(--fs-data)', fontWeight: 700, color: 'var(--txt)', lineHeight: 1.6,
        padding: '20px 24px', marginBottom: 48,
        background: 'var(--bg2)', borderRadius: 12,
      }}>
        {t('TERMS_CALLOUT_BODY')}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: '40px 52px',
        marginBottom: 64,
      }}>
        {SECTIONS.map(s => (
          <div key={s.titleKey}>
            <div style={{ fontSize: 'var(--fs-card-title)', fontWeight: 700, color: 'var(--txt)', marginBottom: 10, lineHeight: 1.3 }}>
              {t(s.titleKey)}
            </div>
            <div style={{ fontSize: 'var(--fs-label)', color: 'var(--txt2)', lineHeight: 1.75 }}>
              {s.bodyKey === 'TERMS_SECTION_CONTACT_BODY' ? <EmailLinked text={t(s.bodyKey)} /> : t(s.bodyKey)}
            </div>
          </div>
        ))}
      </div>

      <div style={{
        borderTop: '1px solid var(--bdr)',
        paddingTop: 28,
        fontSize: 'var(--fs-caption)',
        color: 'var(--txt3)',
        lineHeight: 1.9,
      }}>
        <p>
          {t('TERMS_FOOTER_ACKNOWLEDGEMENT')}
        </p>
        <p style={{ marginTop: 12 }}>{t('TERMS_FOOTER_COPYRIGHT', { year: new Date().getFullYear() })}</p>
      </div>

    </div>
  );
}
