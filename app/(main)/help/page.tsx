'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useLabels } from '@/lib/labels';
import EmailLinked from '@/components/EmailLinked';
import type { LabelKey } from '@/lib/labelKeys';

/* #1810 item 3. /learn is a glossary and /playbook is strategy; neither answers
   "how do I use this feature", which is what this page is for.
 *
 * STRUCTURE COPIED FROM /faq on purpose - the same accordion, the same typed
 * { id, qKey, aKey } array - because the two pages answer adjacent questions
 * and a reader moving between them should not meet a second design. /faq keeps
 * plans, billing and "what is this"; this page keeps "where is it and how do I
 * use it". HELP_INTRO points at both /faq and /learn so the split is visible
 * rather than something a reader has to work out.
 *
 * EVERY ANSWER IS GROUNDED IN SHIPPED BEHAVIOUR, not in how a feature ought to
 * work. They were written from the existing FAQ answers, the /about steps and
 * the live Settings copy, which is also why there is no section for anything
 * switched off or not built. */

interface HelpItem { id: string; qKey: LabelKey; aKey: LabelKey }
interface HelpCategory { titleKey: LabelKey; items: HelpItem[] }

const CATEGORIES: HelpCategory[] = [
  {
    titleKey: 'HELP_CAT_GETTING_STARTED',
    items: [
      { id: 'start',      qKey: 'HELP_Q_START_Q',      aKey: 'HELP_Q_START_A' },
      { id: 'trial',      qKey: 'HELP_Q_TRIAL_Q',      aKey: 'HELP_Q_TRIAL_A' },
      { id: 'first-look', qKey: 'HELP_Q_FIRST_LOOK_Q', aKey: 'HELP_Q_FIRST_LOOK_A' },
    ],
  },
  {
    titleKey: 'HELP_CAT_SIGNALS',
    items: [
      { id: 'read-marker',    qKey: 'HELP_Q_READ_MARKER_Q',    aKey: 'HELP_Q_READ_MARKER_A' },
      { id: 'confluence',     qKey: 'HELP_Q_CONFLUENCE_Q',     aKey: 'HELP_Q_CONFLUENCE_A' },
      { id: 'own-indicators', qKey: 'HELP_Q_OWN_INDICATORS_Q', aKey: 'HELP_Q_OWN_INDICATORS_A' },
    ],
  },
  {
    titleKey: 'HELP_CAT_ALERTS',
    items: [
      { id: 'set-alerts',    qKey: 'HELP_Q_SET_ALERTS_Q',    aKey: 'HELP_Q_SET_ALERTS_A' },
      { id: 'telegram',      qKey: 'HELP_Q_TELEGRAM_Q',      aKey: 'HELP_Q_TELEGRAM_A' },
      { id: 'mute',          qKey: 'HELP_Q_MUTE_Q',          aKey: 'HELP_Q_MUTE_A' },
      /* The 90-day retention statement, and the ONLY place it is written.
         Owner's decision 2026-10-29: the product must SAY the limit rather than
         apply it silently, because a subscriber finding their history truncated
         with no notice is a support problem we created. One place, so the
         number is one edit if it changes. */
      { id: 'alert-history', qKey: 'HELP_Q_ALERT_HISTORY_Q', aKey: 'HELP_Q_ALERT_HISTORY_A' },
    ],
  },
  {
    titleKey: 'HELP_CAT_ARENA',
    items: [
      { id: 'arena-what', qKey: 'HELP_Q_ARENA_WHAT_Q', aKey: 'HELP_Q_ARENA_WHAT_A' },
      { id: 'ai-limit',   qKey: 'HELP_Q_AI_LIMIT_Q',   aKey: 'HELP_Q_AI_LIMIT_A' },
    ],
  },
  {
    titleKey: 'HELP_CAT_TOOLS',
    items: [
      { id: 'journal', qKey: 'HELP_Q_JOURNAL_Q', aKey: 'HELP_Q_JOURNAL_A' },
      { id: 'sizing',  qKey: 'HELP_Q_SIZING_Q',  aKey: 'HELP_Q_SIZING_A' },
    ],
  },
  {
    titleKey: 'HELP_CAT_ACCOUNT',
    items: [
      { id: 'password', qKey: 'HELP_Q_PASSWORD_Q', aKey: 'HELP_Q_PASSWORD_A' },
      { id: 'language', qKey: 'HELP_Q_LANGUAGE_Q', aKey: 'HELP_Q_LANGUAGE_A' },
      { id: 'theme',    qKey: 'HELP_Q_THEME_Q',    aKey: 'HELP_Q_THEME_A' },
    ],
  },
];

export default function HelpPage() {
  const { t } = useLabels();
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="faq-term-wrap" style={{ maxWidth: 860, margin: '0 auto', padding: '48px 24px 80px' }}>

      <div style={{ marginBottom: 40 }}>
        <div style={{
          fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 14,
        }}>
          {t('HELP_EYEBROW')}
        </div>
        <h1 style={{ fontSize: '2.625rem', fontWeight: 800, color: 'var(--txt)', margin: 0, lineHeight: 1.1 }}>
          {t('HELP_PAGE_TITLE')}
        </h1>
        <p style={{ fontSize: 'var(--fs-label)', color: 'var(--txt3)', marginTop: 16, lineHeight: 1.7 }}>
          {t('HELP_INTRO')}
        </p>
        <p style={{ fontSize: 'var(--fs-label)', marginTop: 10, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          {/* inline-flex + minHeight 24: standalone links, so SC 2.5.8's inline
              exception does not apply to them. */}
          {/* A literal, like components/PlatformFooter.tsx: FAQ is the same three
              letters in every locale we offer, and a translated one would be wrong. */}
          <Link href="/faq" style={{ color: 'var(--accent)', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', minHeight: 24 }}>
            FAQ
          </Link>
          <Link href="/learn" style={{ color: 'var(--accent)', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', minHeight: 24 }}>
            {t('NAV_GLOSSARY')}
          </Link>
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
                    {/* aria-hidden (#968): aria-expanded already says open or
                        closed, so the chevron would only add a stray glyph to
                        every announced name. */}
                    <span aria-hidden="true" style={{
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

      <div style={{
        border: '0.5px solid var(--bdr)', borderRadius: 12,
        background: 'var(--bg2)', padding: '20px 24px',
      }}>
        <div className="lbl">{t('HELP_STUCK_LABEL')}</div>
        <div style={{ fontSize: 'var(--fs-label)', color: 'var(--txt2)', lineHeight: 1.7 }}>
          <EmailLinked text={t('HELP_STUCK_BODY')} />
        </div>
      </div>

    </div>
  );
}
