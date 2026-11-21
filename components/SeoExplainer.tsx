'use client';
import { useLabels } from '@/lib/labels';
import { EXPLAINERS, type ExplainerTopic } from '@/lib/seoExplainers';

/* The explainer under a data page (SEO strategic item 1, PM 2026-11-20). A client component still renders on the server, with the English defaults, so the text is in the HTML a crawler reads; a visitor in another language sees the translated rows once they load. The FAQ is visible text, not collapsed, to match its FAQPage structured data (lib/seoExplainers.ts). */
export default function SeoExplainer({ topic }: { topic: ExplainerTopic }) {
  const { t } = useLabels();
  const e = EXPLAINERS[topic];
  return (
    <section aria-labelledby={`seo-${topic}-title`} data-testid={`seo-explainer-${topic}`}
      style={{ maxWidth: 820, margin: '32px auto 40px', padding: '0 16px', color: 'var(--txt2)', fontSize: 'var(--fs-body)', lineHeight: 1.65 }}>
      <h2 id={`seo-${topic}-title`} style={{ fontSize: 'var(--fs-section)', fontWeight: 700, color: 'var(--txt)', margin: '0 0 10px' }}>{t(e.title)}</h2>
      {e.paras.map(k => <p key={k} style={{ margin: '0 0 12px' }}>{t(k)}</p>)}
      <h3 style={{ fontSize: 'var(--fs-card-title)', fontWeight: 700, color: 'var(--txt)', margin: '20px 0 8px' }}>{t('SEO_FAQ_TITLE')}</h3>
      {e.faq.map(({ q, a }) => (
        <div key={q} style={{ margin: '0 0 12px' }}>
          <h4 style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--txt)', margin: '0 0 2px' }}>{t(q)}</h4>
          <p style={{ margin: 0 }}>{t(a)}</p>
        </div>
      ))}
    </section>
  );
}
