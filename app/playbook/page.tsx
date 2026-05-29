'use client';
import { useState } from 'react';
import { SECRETS, Secret } from '@/lib/secrets';

type Cat = 'all' | 'hunt' | 'time' | 'trap' | 'psych';

const CAT_LABELS: Record<string, string> = { hunt: 'Hunt', time: 'Timing', trap: 'Trap', psych: 'Psychology' };
const CAT_CLS: Record<string, string> = { hunt: 'cat-hunt', time: 'cat-time', trap: 'cat-trap', psych: 'cat-psych' };

export default function LiquidityBible() {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<Cat>('all');

  const filtered = SECRETS.filter(s => {
    const mc = cat === 'all' || s.cat === cat;
    const mq = !query || s.name.toLowerCase().includes(query.toLowerCase()) || s.text.toLowerCase().includes(query.toLowerCase()) || String(s.n).includes(query);
    return mc && mq;
  });

  return (
    <div>
      <div style={{ padding: '1rem 0 0.5rem' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#e8e8e8', marginBottom: 2 }}>Liquidity Bible</div>
        <div style={{ fontSize: 12, color: '#606060', marginBottom: 14 }}>{SECRETS.length} secrets — the complete predator rulebook</div>
      </div>

      <input
        className="bible-search"
        placeholder="Search secrets..."
        value={query}
        onChange={e => setQuery(e.target.value)}
      />

      <div className="cat-filter">
        {(['all', 'hunt', 'time', 'trap', 'psych'] as Cat[]).map(c => (
          <button key={c} className={`cf${cat === c ? ' on' : ''}`} onClick={() => setCat(c)}>
            {c === 'all' ? 'All' : CAT_LABELS[c]}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty">No secrets match that search.</div>
      ) : (
        filtered.map(s => (
          <div key={s.n} className="secret">
            <div className="s-num">
              <span className={`cat-badge ${CAT_CLS[s.cat]}`}>{CAT_LABELS[s.cat]}</span>
              SECRET #{s.n}
            </div>
            <div className="s-name">{s.name}</div>
            <div className="s-text">{s.text}</div>
          </div>
        ))
      )}
    </div>
  );
}
