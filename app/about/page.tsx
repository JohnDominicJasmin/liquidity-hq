'use client';
import { useLabels } from '@/lib/labels';

export default function About() {
  const { t } = useLabels();

  return (
    <div>
      <div style={{ padding: '1rem 0 0.5rem' }}>
        <div style={{ fontSize: 'var(--fs-section)', fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>{t('ABOUT_PAGE_TITLE')}</div>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginBottom: 14 }}>{t('ABOUT_PAGE_SUBTITLE')}</div>
      </div>

      <div className="card">
        <div className="lbl">{t('ABOUT_WHAT_THIS_IS_LABEL')}</div>
        <div style={{ fontSize: 'var(--fs-label)', color: 'var(--txt2)', lineHeight: 1.7 }}>
          {t('ABOUT_WHAT_THIS_IS_BODY')}
        </div>
      </div>

      <div className="card">
        <div className="lbl">{t('ABOUT_DATA_SOURCES_LABEL')}</div>
        {[
          [t('ABOUT_DATA_SOURCE_PRICES_LABEL'), t('ABOUT_DATA_SOURCE_PRICES_VALUE')],
          [t('ABOUT_DATA_SOURCE_ALTCOINS_LABEL'), t('ABOUT_DATA_SOURCE_ALTCOINS_VALUE')],
          [t('ABOUT_DATA_SOURCE_FUNDING_OI_LABEL'), t('ABOUT_DATA_SOURCE_FUNDING_OI_VALUE')],
          [t('ABOUT_DATA_SOURCE_LONG_SHORT_LABEL'), t('ABOUT_DATA_SOURCE_LONG_SHORT_VALUE')],
          [t('ABOUT_DATA_SOURCE_FEAR_GREED_LABEL'), t('ABOUT_DATA_SOURCE_FEAR_GREED_VALUE')],
          [t('ABOUT_DATA_SOURCE_BTC_DOMINANCE_LABEL'), t('ABOUT_DATA_SOURCE_BTC_DOMINANCE_VALUE')],
          [t('ABOUT_DATA_SOURCE_BREAKING_NEWS_LABEL'), t('ABOUT_DATA_SOURCE_BREAKING_NEWS_VALUE')],
          [t('ABOUT_DATA_SOURCE_CRYPTO_NEWS_LABEL'), t('ABOUT_DATA_SOURCE_CRYPTO_NEWS_VALUE')],
          [t('ABOUT_DATA_SOURCE_ECON_CALENDAR_LABEL'), t('ABOUT_DATA_SOURCE_ECON_CALENDAR_VALUE')],
          [t('ABOUT_DATA_SOURCE_AI_SIGNAL_LABEL'), t('ABOUT_DATA_SOURCE_AI_SIGNAL_VALUE')],
        ].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '0.5px solid var(--bdr)', fontSize: 'var(--fs-caption)' }}>
            <span style={{ color: 'var(--txt3)' }}>{k}</span>
            <span style={{ color: 'var(--txt2)', textAlign: 'right', maxWidth: '60%' }}>{v}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="lbl">{t('ABOUT_HOW_TO_USE_LABEL')}</div>
        <div style={{ fontSize: 'var(--fs-label)', color: 'var(--txt2)', lineHeight: 1.8 }}>
          1. <strong style={{ color: 'var(--txt)' }}>{t('ABOUT_STEP1_BOLD')}</strong> - {t('ABOUT_STEP1_TEXT')}<br />
          2. <strong style={{ color: 'var(--txt)' }}>{t('ABOUT_STEP2_BOLD')}</strong> - {t('ABOUT_STEP2_TEXT')}<br />
          3. <strong style={{ color: 'var(--txt)' }}>{t('ABOUT_STEP3_BOLD')}</strong> - {t('ABOUT_STEP3_TEXT')}<br />
          4. <strong style={{ color: 'var(--txt)' }}>{t('ABOUT_STEP4_BOLD')}</strong> - {t('ABOUT_STEP4_TEXT')}<br />
          5. <strong style={{ color: 'var(--txt)' }}>{t('ABOUT_STEP5_BOLD')}</strong> - {t('ABOUT_STEP5_TEXT')}<br />
          6. <strong style={{ color: 'var(--txt)' }}>{t('ABOUT_STEP6_BOLD')}</strong> {t('ABOUT_STEP6_TEXT')}
        </div>
      </div>

      <div className="card">
        <div className="lbl">{t('ABOUT_REMINDER_LABEL')}</div>
        <div className="pbox">
          <div className="pt">{t('ABOUT_REMINDER_TITLE')}</div>
          <div className="pb">{t('ABOUT_REMINDER_BODY')}</div>
        </div>
      </div>
    </div>
  );
}
