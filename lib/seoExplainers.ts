import type { LabelKey } from '@/lib/labelKeys';
import DEFAULT_EN_LABELS from '@/lib/labelDefaults.en.json';

/* A SERVER-RENDERED EXPLAINER AND ITS FAQ (SEO strategic item 1, PM 2026-11-20). The block is plain text through labels with English defaults, so the server HTML a crawler reads carries the English copy and a visitor in another language gets the translated rows once they exist. The FAQPage JSON-LD is built here from the SAME English defaults, so the structured data and the visible text cannot disagree. Facts only about what the page shows; no claim of accuracy. */
export type ExplainerTopic = 'liq' | 'funding' | 'scanner' | 'calc' | 'hours' | 'econ' | 'markets' | 'news';
type Faq = { q: LabelKey; a: LabelKey };
export const EXPLAINERS: Record<ExplainerTopic, { title: LabelKey; paras: LabelKey[]; faq: Faq[] }> = {
  liq: {
    title: 'SEO_LIQ_TITLE', paras: ['SEO_LIQ_P1', 'SEO_LIQ_P2'],
    faq: [{ q: 'SEO_LIQ_Q1', a: 'SEO_LIQ_A1' }, { q: 'SEO_LIQ_Q2', a: 'SEO_LIQ_A2' }, { q: 'SEO_LIQ_Q3', a: 'SEO_LIQ_A3' }, { q: 'SEO_LIQ_Q4', a: 'SEO_LIQ_A4' }],
  },
  funding: {
    title: 'SEO_FUNDING_TITLE', paras: ['SEO_FUNDING_P1', 'SEO_FUNDING_P2'],
    faq: [{ q: 'SEO_FUNDING_Q1', a: 'SEO_FUNDING_A1' }, { q: 'SEO_FUNDING_Q2', a: 'SEO_FUNDING_A2' }, { q: 'SEO_FUNDING_Q3', a: 'SEO_FUNDING_A3' }, { q: 'SEO_FUNDING_Q4', a: 'SEO_FUNDING_A4' }],
  },
  scanner: {
    title: 'SEO_SCANNER_TITLE', paras: ['SEO_SCANNER_P1', 'SEO_SCANNER_P2'],
    faq: [{ q: 'SEO_SCANNER_Q1', a: 'SEO_SCANNER_A1' }, { q: 'SEO_SCANNER_Q2', a: 'SEO_SCANNER_A2' }, { q: 'SEO_SCANNER_Q3', a: 'SEO_SCANNER_A3' }, { q: 'SEO_SCANNER_Q4', a: 'SEO_SCANNER_A4' }],
  },
  calc: {
    title: 'SEO_CALC_TITLE', paras: ['SEO_CALC_P1', 'SEO_CALC_P2'],
    faq: [{ q: 'SEO_CALC_Q1', a: 'SEO_CALC_A1' }, { q: 'SEO_CALC_Q2', a: 'SEO_CALC_A2' }, { q: 'SEO_CALC_Q3', a: 'SEO_CALC_A3' }, { q: 'SEO_CALC_Q4', a: 'SEO_CALC_A4' }],
  },
  hours: {
    title: 'SEO_HOURS_TITLE', paras: ['SEO_HOURS_P1', 'SEO_HOURS_P2'],
    faq: [{ q: 'SEO_HOURS_Q1', a: 'SEO_HOURS_A1' }, { q: 'SEO_HOURS_Q2', a: 'SEO_HOURS_A2' }, { q: 'SEO_HOURS_Q3', a: 'SEO_HOURS_A3' }, { q: 'SEO_HOURS_Q4', a: 'SEO_HOURS_A4' }],
  },
  econ: {
    title: 'SEO_ECON_TITLE', paras: ['SEO_ECON_P1', 'SEO_ECON_P2'],
    faq: [{ q: 'SEO_ECON_Q1', a: 'SEO_ECON_A1' }, { q: 'SEO_ECON_Q2', a: 'SEO_ECON_A2' }, { q: 'SEO_ECON_Q3', a: 'SEO_ECON_A3' }, { q: 'SEO_ECON_Q4', a: 'SEO_ECON_A4' }],
  },
  markets: {
    title: 'SEO_MARKETS_TITLE', paras: ['SEO_MARKETS_P1', 'SEO_MARKETS_P2'],
    faq: [{ q: 'SEO_MARKETS_Q1', a: 'SEO_MARKETS_A1' }, { q: 'SEO_MARKETS_Q2', a: 'SEO_MARKETS_A2' }, { q: 'SEO_MARKETS_Q3', a: 'SEO_MARKETS_A3' }, { q: 'SEO_MARKETS_Q4', a: 'SEO_MARKETS_A4' }],
  },
  news: {
    title: 'SEO_NEWS_TITLE', paras: ['SEO_NEWS_P1', 'SEO_NEWS_P2'],
    faq: [{ q: 'SEO_NEWS_Q1', a: 'SEO_NEWS_A1' }, { q: 'SEO_NEWS_Q2', a: 'SEO_NEWS_A2' }, { q: 'SEO_NEWS_Q3', a: 'SEO_NEWS_A3' }, { q: 'SEO_NEWS_Q4', a: 'SEO_NEWS_A4' }],
  },
};

const en = DEFAULT_EN_LABELS as Record<string, string>;

/** FAQPage structured data for a topic, from the English defaults. `<` is escaped so the string is safe inside a script tag. */
export function faqJsonLd(topic: ExplainerTopic): string {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: EXPLAINERS[topic].faq.map(({ q, a }) => ({
      '@type': 'Question', name: en[q],
      acceptedAnswer: { '@type': 'Answer', text: en[a] },
    })),
  };
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
