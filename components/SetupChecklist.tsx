'use client';
import { useEffect, useState, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useOnboarding } from './OnboardingProvider';
import { useAuth } from './AuthProvider';

const ITEMS = [
  { key: 'telegram'   as const, label: 'Connect Telegram alerts', href: '/alerts' },
  { key: 'priceAlert' as const, label: 'Set a price alert',       href: '/alerts' },
  { key: 'grok'       as const, label: 'Get an AI market analysis', href: '/arena'  },
  { key: 'coins'      as const, label: 'Explore the Arena',       href: '/arena'  },
];

const DISMISS_KEY = 'lhq_setup_dismissed';

export default function SetupChecklist() {
  const { user } = useAuth();
  const { state, loaded, allDone } = useOnboarding();
  // AUTH-1 fix: this used to force-expand to the full panel on any screen
  // >=640px wide, which is how it ended up covering real content (chart
  // price axis, form fields) on desktop — it defaulted to the biggest
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
    return (
      <div className="ob-checklist ob-checklist-mini" onClick={() => setCollapsed(false)}>
        <span className="ob-cl-mini-text">Setup {doneCount}/4</span>
        <div className="ob-cl-mini-track">
          <div className="ob-cl-mini-fill" style={{ width: `${(doneCount / 4) * 100}%` }} />
        </div>
        <button className="ob-cl-mini-close" onClick={dismissForGood} aria-label="Dismiss setup checklist">×</button>
      </div>
    );
  }

  return (
    <div className="ob-checklist">
      <div className="ob-cl-head">
        <span className="ob-cl-title">Quick Setup</span>
        <span className="ob-cl-count">{doneCount}/4 done</span>
        <button className="ob-cl-min" onClick={() => setCollapsed(true)} aria-label="Minimize">−</button>
        <button className="ob-cl-min" onClick={dismissForGood} aria-label="Dismiss setup checklist">×</button>
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
              <span className="ob-cl-lbl">{item.label}</span>
              {!done && <span className="ob-cl-arrow">→</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
