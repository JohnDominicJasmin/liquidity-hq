'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useOnboarding } from './OnboardingProvider';
import { useAuth } from './AuthProvider';

const ITEMS = [
  { key: 'telegram'   as const, label: 'Connect Telegram alerts', icon: '🔔', href: '/alerts' },
  { key: 'priceAlert' as const, label: 'Set a price alert',       icon: '🎯', href: '/alerts' },
  { key: 'grok'       as const, label: 'Run a Grok analysis',     icon: '🤖', href: '/arena'  },
  { key: 'coins'      as const, label: 'Explore the Arena',       icon: '🪙', href: '/arena'  },
];

export default function SetupChecklist() {
  const { user } = useAuth();
  const { state, loaded, allDone } = useOnboarding();
  const [collapsed, setCollapsed] = useState(false);
  const router = useRouter();

  // Hidden until: logged in, data loaded, tour seen, and not all done yet
  if (!user || !loaded || !state.tourSeen || allDone) return null;

  const doneCount = ITEMS.filter(i => state[i.key]).length;

  if (collapsed) {
    return (
      <div className="ob-checklist ob-checklist-mini" onClick={() => setCollapsed(false)}>
        <span className="ob-cl-mini-text">Setup {doneCount}/4</span>
        <div className="ob-cl-mini-track">
          <div className="ob-cl-mini-fill" style={{ width: `${(doneCount / 4) * 100}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div className="ob-checklist">
      <div className="ob-cl-head">
        <span className="ob-cl-title">Quick Setup</span>
        <span className="ob-cl-count">{doneCount}/4 done</span>
        <button className="ob-cl-min" onClick={() => setCollapsed(true)} aria-label="Minimize">−</button>
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
              tabIndex={done ? undefined : 0}
              onKeyDown={e => !done && e.key === 'Enter' && router.push(item.href)}
            >
              <span className="ob-cl-chk">{done ? '✓' : '○'}</span>
              <span className="ob-cl-ico">{item.icon}</span>
              <span className="ob-cl-lbl">{item.label}</span>
              {!done && <span className="ob-cl-arrow">→</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
