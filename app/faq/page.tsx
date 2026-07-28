'use client';
import { useState } from 'react';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';

interface FaqItem { id: string; qKey: LabelKey; aKey: LabelKey }
interface FaqCategory { titleKey: LabelKey; items: FaqItem[] }

const CATEGORIES: FaqCategory[] = [
  {
    titleKey: 'FAQ_CAT_ACCOUNT_BILLING',
    items: [
      { id: 'free-vs-pro', qKey: 'FAQ_Q_FREE_VS_PRO_Q', aKey: 'FAQ_Q_FREE_VS_PRO_A' },
      { id: 'pro-price',   qKey: 'FAQ_Q_PRO_PRICE_Q',   aKey: 'FAQ_Q_PRO_PRICE_A' },
      { id: 'free-trial',  qKey: 'FAQ_Q_FREE_TRIAL_Q',  aKey: 'FAQ_Q_FREE_TRIAL_A' },
      { id: 'cancel-plan', qKey: 'FAQ_Q_CANCEL_PLAN_Q', aKey: 'FAQ_Q_CANCEL_PLAN_A' },
    ],
  },
  {
    titleKey: 'FAQ_CAT_SIGNALS',
    items: [
      { id: 'buysell-signal',   qKey: 'FAQ_Q_BUYSELL_SIGNAL_Q',   aKey: 'FAQ_Q_BUYSELL_SIGNAL_A' },
      { id: 'confluence-score', qKey: 'FAQ_Q_CONFLUENCE_SCORE_Q', aKey: 'FAQ_Q_CONFLUENCE_SCORE_A' },
      { id: 'financial-advice', qKey: 'FAQ_Q_FINANCIAL_ADVICE_Q', aKey: 'FAQ_Q_FINANCIAL_ADVICE_A' },
      { id: 'ai-disagree',      qKey: 'FAQ_Q_AI_DISAGREE_Q',      aKey: 'FAQ_Q_AI_DISAGREE_A' },
    ],
  },
  {
    titleKey: 'FAQ_CAT_ALERTS',
    items: [
      { id: 'telegram-setup', qKey: 'FAQ_Q_TELEGRAM_SETUP_Q', aKey: 'FAQ_Q_TELEGRAM_SETUP_A' },
      { id: 'alert-mismatch', qKey: 'FAQ_Q_ALERT_MISMATCH_Q', aKey: 'FAQ_Q_ALERT_MISMATCH_A' },
      { id: 'mute-alerts',    qKey: 'FAQ_Q_MUTE_ALERTS_Q',    aKey: 'FAQ_Q_MUTE_ALERTS_A' },
      { id: 'alert-tf-cap',   qKey: 'FAQ_Q_ALERT_TF_CAP_Q',   aKey: 'FAQ_Q_ALERT_TF_CAP_A' },
    ],
  },
  {
    titleKey: 'FAQ_CAT_GENERAL',
    items: [
      { id: 'what-is-lhq',   qKey: 'FAQ_Q_WHAT_IS_LHQ_Q',   aKey: 'FAQ_Q_WHAT_IS_LHQ_A' },
      { id: 'data-sources',  qKey: 'FAQ_Q_DATA_SOURCES_Q',  aKey: 'FAQ_Q_DATA_SOURCES_A' },
      { id: 'custody',       qKey: 'FAQ_Q_CUSTODY_Q',       aKey: 'FAQ_Q_CUSTODY_A' },
      { id: 'who-for',       qKey: 'FAQ_Q_WHO_FOR_Q',       aKey: 'FAQ_Q_WHO_FOR_A' },
    ],
  },
];

export default function FaqPage() {
  const { t } = useLabels();
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '48px 24px 80px' }}>

      <div style={{ marginBottom: 40 }}>
        <div style={{
          fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 14,
        }}>
          {t('FAQ_EYEBROW')}
        </div>
        <h1 style={{ fontSize: '2.625rem', fontWeight: 800, color: 'var(--txt)', margin: 0, lineHeight: 1.1 }}>
          {t('FAQ_PAGE_TITLE')}
        </h1>
        <p style={{ fontSize: 'var(--fs-label)', color: 'var(--txt3)', marginTop: 16, lineHeight: 1.7 }}>
          {t('FAQ_INTRO')}
        </p>
      </div>

      {CATEGORIES.map(cat => (
        <div key={cat.titleKey} style={{ marginBottom: 40 }}>
          <h2 style={{
            fontSize: 'var(--fs-card-title)', fontWeight: 700, color: 'var(--txt)',
            margin: '0 0 16px', lineHeight: 1.3,
          }}>
            {t(cat.titleKey)}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {cat.items.map(item => {
              const open = openId === item.id;
              return (
                <div
                  key={item.id}
                  style={{
                    border: '0.5px solid var(--bdr)', borderRadius: 12,
                    background: 'var(--bg2)', overflow: 'hidden',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : item.id)}
                    aria-expanded={open}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 12, padding: '16px 20px', background: 'transparent', border: 'none',
                      cursor: 'pointer', textAlign: 'left',
                      fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--txt)',
                    }}
                  >
                    {t(item.qKey)}
                    <span style={{
                      flexShrink: 0, color: 'var(--txt3)', transition: 'transform 0.2s ease',
                      transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
                    }}>
                      ▾
                    </span>
                  </button>
                  {open && (
                    <p style={{
                      margin: 0, padding: '0 20px 18px', fontSize: 'var(--fs-label)',
                      color: 'var(--txt2)', lineHeight: 1.75,
                    }}>
                      {t(item.aKey)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

    </div>
  );
}
