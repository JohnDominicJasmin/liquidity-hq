'use client';
import { useLabels } from '@/lib/labels';
import EmailLinked from '@/components/EmailLinked';

/* The contact page (owner, 2026-10-07: /contact was a 404 and reviewers look for contact details). It reuses the About page's
   Contact card and its label keys, so it already exists in all five locales and says nothing the About page does not: the address
   and what it is for. No response-time promise, no phone, no chat: there are none. */
export default function Contact() {
  const { t } = useLabels();
  return (
    <div>
      <div style={{ padding: '1rem 0 0.5rem' }}>
        <h1 style={{ fontSize: 'var(--fs-section)', fontWeight: 700, color: 'var(--txt)', margin: '0 0 14px' }}>{t('ABOUT_CONTACT_LABEL')}</h1>
      </div>
      <div className="card">
        <div style={{ fontSize: 'var(--fs-label)', color: 'var(--txt2)', lineHeight: 1.7 }} data-testid="contact-body">
          <EmailLinked text={t('ABOUT_CONTACT_BODY')} />
        </div>
      </div>
    </div>
  );
}
