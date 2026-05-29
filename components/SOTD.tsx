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
        <span>Play of the Day</span>
        <button className="sotd-refresh" onClick={newSecret}>new play</button>
      </div>
      <div className="sotd-num">PLAY #{secret.n} of {SECRETS.length}</div>
      <div className="sotd-name">{secret.name}</div>
      <div className="sotd-text">{secret.text}</div>
      <div className="sotd-footer">Tap &ldquo;new play&rdquo; to get another. Every day a different play loads automatically.</div>
    </div>
  );
}
