'use client';
import { useState } from 'react';
import { SECRETS, getDailySecret, Secret } from '@/lib/secrets';

export default function SOTD() {
  const [secret, setSecret] = useState<Secret>(getDailySecret);

  const newSecret = () => {
    const available = SECRETS.filter(s => s.n !== secret.n);
    setSecret(available[Math.floor(Math.random() * available.length)]);
  };

  return (
    <div className="sotd-wrap">
      <div className="sotd-label">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span className="sotd-static-badge" title="Reference content — a fixed library of trading concepts, not computed from current market data">
            📖 Playbook
          </span>
          <span suppressHydrationWarning className="sotd-num-inline">#{secret.n} of {SECRETS.length}</span>
        </span>
        <button className="sotd-refresh" onClick={newSecret}>new play</button>
      </div>
      <div suppressHydrationWarning className="sotd-name">{secret.name}</div>
      <div suppressHydrationWarning className="sotd-text">{secret.text}</div>
      <div className="sotd-footer">Educational reference, not a live signal. Tap &ldquo;new play&rdquo; for another — a different one also loads automatically each day.</div>
    </div>
  );
}
