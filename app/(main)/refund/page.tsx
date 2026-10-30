'use client';
import { useLabels } from '@/lib/labels';
import EmailLinked from '@/components/EmailLinked';

const SECTIONS = [
  { titleKey: 'REFUND_SECTION_NO_REFUNDS_TITLE', bodyKey: 'REFUND_SECTION_NO_REFUNDS_BODY' },
  { titleKey: 'REFUND_SECTION_CANCELLATION_TITLE', bodyKey: 'REFUND_SECTION_CANCELLATION_BODY' },
  /* #1810 item 8. The Terms already carry a catch-all - "where the law in your
     country gives you that right, it applies" - which is honest and is the
     right instrument for every country we checked EXCEPT the EU, where the law
     requires the seller to INFORM the buyer of the right rather than merely
     honour it. So this is EU-specific on purpose and should stay that way; the
     other six jurisdictions the owner asked about do not each need a section.
     It sits on this page, next to the rest of the money wording, because the
     owner's cannot-versus-will-not question is still open and one page is one
     edit.

     THE LAWYER CAVEAT WAS REMOVED BY THE OWNER, 2026-10-30, FIRST-HAND. This
     comment used to say the body shipped "with a LAWYER REVIEW STILL
     OUTSTANDING - that caveat is part of the owner's decision and is written
     into the body itself so it cannot be dropped by someone editing around
     it." It was true when written and the protection worked: the clause
     survived in the text until the person whose decision it was removed it.

     He cut exactly ", and it has not yet been reviewed by a lawyer" and kept
     the rest, so the body still says "This is our own plain-English summary of
     the rule" - the honest part stays. What went is the clause that invites
     doubt about every legal page on the site and that a payment provider
     reads. A lawyer has still not reviewed this; that fact simply no longer
     appears in the copy.

     So DO NOT restore it believing it was lost in an edit. It was removed on
     purpose, by the only person who could. */
  { titleKey: 'REFUND_SECTION_EU_WITHDRAWAL_TITLE', bodyKey: 'REFUND_SECTION_EU_WITHDRAWAL_BODY' },
  { titleKey: 'REFUND_SECTION_FREE_TRIAL_TITLE', bodyKey: 'REFUND_SECTION_FREE_TRIAL_BODY' },
  { titleKey: 'REFUND_SECTION_BILLING_ERRORS_TITLE', bodyKey: 'REFUND_SECTION_BILLING_ERRORS_BODY' },
  { titleKey: 'REFUND_SECTION_CHARGEBACKS_TITLE', bodyKey: 'REFUND_SECTION_CHARGEBACKS_BODY' },
  { titleKey: 'REFUND_SECTION_CONTACT_TITLE', bodyKey: 'REFUND_SECTION_CONTACT_BODY' },
] as const;

export default function RefundPolicy() {
  const { t } = useLabels();

  return (
    <div className="refund-term-wrap" style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 24px 80px' }}>

      <div style={{ marginBottom: 48 }}>
        <div style={{
          fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 14,
        }}>
          {t('REFUND_EYEBROW')}
        </div>
        <h1 style={{ fontSize: '2.625rem', fontWeight: 800, color: 'var(--txt)', margin: 0, lineHeight: 1.1 }}>
          {t('REFUND_PAGE_TITLE')}
        </h1>
        <p style={{ fontSize: 'var(--fs-label)', color: 'var(--txt3)', marginTop: 16, lineHeight: 1.7 }}>
          {t('REFUND_LAST_UPDATED')}
        </p>
      </div>

      <div style={{
        fontSize: 'var(--fs-data)', fontWeight: 700, color: 'var(--txt)', lineHeight: 1.6,
        padding: '20px 24px', marginBottom: 48,
        background: 'var(--bg2)', borderRadius: 12,
      }}>
        {t('REFUND_CALLOUT_BODY')}
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
            {/* EmailLinked, as on /about: the support address appears inside
                the EU withdrawal body, and a legal page that prints an address
                a reader has to retype by hand is a dead end. Sections without
                one are returned unchanged. */}
            <div style={{ fontSize: 'var(--fs-label)', color: 'var(--txt2)', lineHeight: 1.75 }}>
              <EmailLinked text={t(s.bodyKey)} />
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
          {t('REFUND_FOOTER_ACKNOWLEDGEMENT')}
        </p>
        <p style={{ marginTop: 12 }}>{t('REFUND_FOOTER_COPYRIGHT', { year: new Date().getFullYear() })}</p>
      </div>

    </div>
  );
}
