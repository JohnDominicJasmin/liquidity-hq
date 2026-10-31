'use client';
import { useLabels } from '@/lib/labels';
import EmailLinked from '@/components/EmailLinked';

/* #1810 items 5 and 7. The European Accessibility Act has applied since June
   2025 and this product sells into the EU; before this page there were zero
   occurrences of the word "accessibility" anywhere in the shipped label file.
 *
 * THE LIMITATIONS SECTION IS NOT AN OVERSIGHT AND MUST NOT BE EDITED OUT. An
 * accessibility statement with no known shortcomings is not a strong statement,
 * it is an unbelievable one - naming them is what the EAA expects and what
 * makes the rest of the page worth reading. Most claims in
 * A11Y_SECTION_DONE_BODY were checked against shipped code before they were
 * written (focus indicators and the dialog focus trap shipped in v2026.09.17,
 * the accessible name on the coin health grade in v2026.09.06b, and
 * app/globals.css carries prefers-reduced-motion rules); the skip-link gap in
 * A11Y_SECTION_LIMITS_BODY was found the same way, by grepping for one and
 * finding none.
 *
 * ONE WAS NOT, AND IT IS RECORDED RATHER THAN QUIETLY DELETED. The line read
   "Controls are sized for touch." Nobody measured a control. QA then measured
   the footer links and found every row under 24px, failing WCAG SC 2.5.8 - so
   the page asserted in the first person something the same release contradicts.
   The sentence is gone and the shortfall is named in the limits instead.
 *
 * The footer itself is NOT fixed here. It is systemic across every page and is
   tracked on #1185; a CSS change touching every page is the larger risk in a
   held release. This makes the PAGE truthful, which is the part that was
   publishing a false claim. The grep that would have caught it is the same one
   used for the skip link - the difference is that nobody ran it for this
   sentence, because a claim that sounds like a design value does not read like
   a measurable one.
 *
 * Shape is /refund's, like the other legal-register pages. */

const SECTIONS = [
  { titleKey: 'A11Y_SECTION_SCOPE_TITLE', bodyKey: 'A11Y_SECTION_SCOPE_BODY' },
  { titleKey: 'A11Y_SECTION_AIM_TITLE', bodyKey: 'A11Y_SECTION_AIM_BODY' },
  { titleKey: 'A11Y_SECTION_DONE_TITLE', bodyKey: 'A11Y_SECTION_DONE_BODY' },
  { titleKey: 'A11Y_SECTION_LIMITS_TITLE', bodyKey: 'A11Y_SECTION_LIMITS_BODY' },
  { titleKey: 'A11Y_SECTION_HELP_TITLE', bodyKey: 'A11Y_SECTION_HELP_BODY' },
] as const;

export default function AccessibilityPage() {
  const { t } = useLabels();

  return (
    <div className="terms-term-wrap" style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 24px 80px' }}>

      <div style={{ marginBottom: 48 }}>
        <div style={{
          fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 14,
        }}>
          {t('A11Y_EYEBROW')}
        </div>
        <h1 style={{ fontSize: '2.625rem', fontWeight: 800, color: 'var(--txt)', margin: 0, lineHeight: 1.1 }}>
          {t('A11Y_PAGE_TITLE')}
        </h1>
        <p style={{ fontSize: 'var(--fs-label)', color: 'var(--txt3)', marginTop: 16, lineHeight: 1.7 }}>
          {t('A11Y_LAST_UPDATED')}
        </p>
      </div>

      <div style={{
        fontSize: 'var(--fs-data)', fontWeight: 700, color: 'var(--txt)', lineHeight: 1.6,
        padding: '20px 24px', marginBottom: 48,
        background: 'var(--bg2)', borderRadius: 12,
      }}>
        {t('A11Y_CALLOUT_BODY')}
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
              <EmailLinked text={t(s.bodyKey)} />
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}
