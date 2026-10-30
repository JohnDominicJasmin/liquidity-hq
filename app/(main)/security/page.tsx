'use client';
import Link from 'next/link';
import { useLabels } from '@/lib/labels';
import EmailLinked from '@/components/EmailLinked';
import {
  LEGAL_NAME_CONFIRMED,
  TRADER_COUNTRY,
  TRADER_LEGAL_NAME,
} from '@/lib/traderIdentity';

/* #1810 items 4, 6 and 9 on one page: the trust page, the trader identity a
   buyer is entitled to see before paying, and where customer data is kept.
 *
 * /refund's layout, because this is a legal-register page and that is the
 * shape the other three already have.
 *
 * THE PROCESSOR LIST IS NOT REPEATED HERE. It is in the Privacy Policy with
 * what each provider is used for, and two copies of a provider list is how
 * they come to disagree - the same reasoning as the single retention constant
 * in app/api/liq-events/purge/route.ts. This page links to it instead.
 *
 * THE DATA REGION IS MEASURED, NOT RECALLED. `list_projects` on 2026-10-30
 * reports liquidity-hq-prod in ap-northeast-2 (Seoul) and liquidity-hq-dev in
 * ap-northeast-1 (Tokyo). Customer data is in the PROD project, so Seoul is
 * what this page says. The #1810 research comment said Tokyo for both, which
 * is true of dev and false of the one that holds customers. */

const SECTIONS = [
  { titleKey: 'SECURITY_SECTION_WHERE_TITLE', bodyKey: 'SECURITY_SECTION_WHERE_BODY' },
  { titleKey: 'SECURITY_SECTION_PROTECTION_TITLE', bodyKey: 'SECURITY_SECTION_PROTECTION_BODY' },
  { titleKey: 'SECURITY_SECTION_PROCESSORS_TITLE', bodyKey: 'SECURITY_SECTION_PROCESSORS_BODY' },
  { titleKey: 'SECURITY_SECTION_FUNDS_TITLE', bodyKey: 'SECURITY_SECTION_FUNDS_BODY' },
  { titleKey: 'SECURITY_SECTION_ACCOUNT_TITLE', bodyKey: 'SECURITY_SECTION_ACCOUNT_BODY' },
  { titleKey: 'SECURITY_SECTION_REPORT_TITLE', bodyKey: 'SECURITY_SECTION_REPORT_BODY' },
] as const;

export default function SecurityPage() {
  const { t } = useLabels();

  return (
    <div className="terms-term-wrap" style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 24px 80px' }}>

      <div style={{ marginBottom: 48 }}>
        <div style={{
          fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 14,
        }}>
          {t('SECURITY_EYEBROW')}
        </div>
        <h1 style={{ fontSize: '2.625rem', fontWeight: 800, color: 'var(--txt)', margin: 0, lineHeight: 1.1 }}>
          {t('SECURITY_PAGE_TITLE')}
        </h1>
        <p style={{ fontSize: 'var(--fs-label)', color: 'var(--txt3)', marginTop: 16, lineHeight: 1.7 }}>
          {t('SECURITY_LAST_UPDATED')}
        </p>
      </div>

      <div style={{
        fontSize: 'var(--fs-data)', fontWeight: 700, color: 'var(--txt)', lineHeight: 1.6,
        padding: '20px 24px', marginBottom: 48,
        background: 'var(--bg2)', borderRadius: 12,
      }}>
        {t('SECURITY_CALLOUT_BODY')}
      </div>

      {/* The trader identity stands on its own above the grid rather than
          sitting as one cell in it: it is the thing an EU or UK buyer is
          looking for, and the thing this page exists to make findable. */}
      <div style={{ marginBottom: 48 }}>
        <h2 style={{ fontSize: 'var(--fs-card-title)', fontWeight: 700, color: 'var(--txt)', marginBottom: 10, lineHeight: 1.3 }}>
          {t('SECURITY_SECTION_OPERATOR_TITLE')}
        </h2>
        <div style={{ fontSize: 'var(--fs-label)', color: 'var(--txt2)', lineHeight: 1.75 }}>
          <EmailLinked text={t('SECURITY_SECTION_OPERATOR_BODY', { name: TRADER_LEGAL_NAME, country: TRADER_COUNTRY })} />
        </div>
        {/* Visible on purpose while the name is unconfirmed. A placeholder that
            looks like a name is how a wrong legal name ships; one that announces
            itself cannot be approved by accident. Goes away when
            LEGAL_NAME_CONFIRMED flips - see lib/traderIdentity.ts. */}
        {!LEGAL_NAME_CONFIRMED && (
          <p style={{
            fontSize: 'var(--fs-caption)', color: 'var(--amber)', lineHeight: 1.7,
            margin: '10px 0 0', border: '0.5px solid var(--bdr)', borderRadius: 8, padding: '10px 14px',
          }}>
            {t('SECURITY_NAME_PENDING_NOTE')}
          </p>
        )}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: '40px 52px',
        marginBottom: 64,
      }}>
        {SECTIONS.map(s => (
          <div key={s.titleKey}>
            <h2 style={{ fontSize: 'var(--fs-card-title)', fontWeight: 700, color: 'var(--txt)', margin: '0 0 10px', lineHeight: 1.3 }}>
              {t(s.titleKey)}
            </h2>
            <div style={{ fontSize: 'var(--fs-label)', color: 'var(--txt2)', lineHeight: 1.75 }}>
              <EmailLinked text={t(s.bodyKey, { country: TRADER_COUNTRY })} />
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
        display: 'flex',
        gap: 20,
        flexWrap: 'wrap',
      }}>
        <Link href="/privacy" style={{ color: 'var(--txt3)', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', minHeight: 24 }}>
          Privacy Policy
        </Link>
        <Link href="/terms" style={{ color: 'var(--txt3)', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', minHeight: 24 }}>
          Terms of Use
        </Link>
        <Link href="/refund" style={{ color: 'var(--txt3)', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', minHeight: 24 }}>
          Refund Policy
        </Link>
      </div>

    </div>
  );
}
