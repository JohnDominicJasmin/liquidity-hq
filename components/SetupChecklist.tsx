'use client';
import { useEffect, useState, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useOnboarding } from './OnboardingProvider';
import { useAuth } from './AuthProvider';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';

const ITEMS = [
  { key: 'telegram'   as const, labelKey: 'SETUP_CL_TELEGRAM' as LabelKey,    href: '/alerts' },
  { key: 'priceAlert' as const, labelKey: 'SETUP_CL_PRICE_ALERT' as LabelKey, href: '/alerts' },
  { key: 'grok'       as const, labelKey: 'SETUP_CL_AI' as LabelKey,          href: '/arena'  },
  { key: 'coins'      as const, labelKey: 'SETUP_CL_ARENA' as LabelKey,       href: '/arena'  },
];

const DISMISS_KEY = 'lhq_setup_dismissed';

export default function SetupChecklist() {
  const { user } = useAuth();
  const { t } = useLabels();
  const { state, loaded, allDone } = useOnboarding();
  // AUTH-1 fix: this used to force-expand to the full panel on any screen
  // >=640px wide, which is how it ended up covering real content (chart
  // price axis, form fields) on desktop - it defaulted to the biggest
  // version of itself everywhere except phones. Now it always starts
  // collapsed to the small progress pill; the user opts into the full
  // panel by clicking it.
  const [collapsed, setCollapsed] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try { if (localStorage.getItem(DISMISS_KEY) === '1') setDismissed(true); } catch {}
  }, []);
  const router = useRouter();

  // Hidden until: logged in, data loaded, tour seen, not all done yet, and not dismissed
  if (!user || !loaded || !state.tourSeen || allDone || dismissed) return null;

  const doneCount = ITEMS.filter(i => state[i.key]).length;

  const dismissForGood = (e: MouseEvent) => {
    e.stopPropagation();
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch {}
    setDismissed(true);
  };

  if (collapsed) {
    const expand = () => setCollapsed(false);
    return (
      /* The expand control and the dismiss control are SIBLING <button>s.
         This pill used to be role="button" itself (#939) with the dismiss
         <button> inside it - an interactive element nested in another, which
         axe reports as nested-interactive (serious): a screen reader hears one
         control and cannot reach the second. The pill's own onClick stays only
         as a wider mouse target for its padding; the keyboard and screen
         reader path is the expand <button>. The button is reset to look like
         the plain row it replaced, and holds spans rather than divs because a
         button may only contain phrasing content. */
      <div className="ob-checklist ob-checklist-mini" onClick={expand}>
        <button
          type="button"
          onClick={expand}
          aria-expanded={false}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'none', border: 'none', padding: 0, margin: 0,
            font: 'inherit', color: 'inherit', cursor: 'pointer',
          }}
        >
          <span className="ob-cl-mini-text">{t('SETUP_CL_MINI', { done: doneCount })}</span>
          <span className="ob-cl-mini-track">
            <span className="ob-cl-mini-fill" style={{ display: 'block', width: `${(doneCount / 4) * 100}%` }} />
          </span>
        </button>
        <button className="ob-cl-mini-close" onClick={dismissForGood} aria-label={t('SETUP_CL_DISMISS')}>×</button>
      </div>
    );
  }

  return (
    <div className="ob-checklist">
      <div className="ob-cl-head">
        <span className="ob-cl-title">{t('SETUP_CL_TITLE')}</span>
        <span className="ob-cl-count">{t('SETUP_CL_COUNT', { done: doneCount })}</span>
        <button className="ob-cl-min" onClick={() => setCollapsed(true)} aria-label={t('SETUP_CL_MINIMIZE')}>−</button>
        <button className="ob-cl-min" onClick={dismissForGood} aria-label={t('SETUP_CL_DISMISS')}>×</button>
      </div>

      <div className="ob-cl-list">
        {ITEMS.map(item => {
          const done = state[item.key];
          return (
            <div
              key={item.key}
              className={`ob-cl-row${done ? ' done' : ''}`}
              onClick={() => !done && router.push(item.href)}
              role={done ? undefined : 'button'}
              tabIndex={done ? -1 : 0}
              onKeyDown={e => !done && e.key === 'Enter' && router.push(item.href)}
            >
              <span className="ob-cl-chk">{done ? '✓' : '○'}</span>
              <span className="ob-cl-lbl">{t(item.labelKey)}</span>
              {!done && <span className="ob-cl-arrow">→</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
