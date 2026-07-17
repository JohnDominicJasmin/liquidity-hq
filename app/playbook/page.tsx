'use client';
import { useState, useEffect } from 'react';
import { SECRETS, Secret } from '@/lib/secrets';

type Cat = 'all' | 'hunt' | 'time' | 'trap' | 'psych' | 'fav';

const CAT_LABELS: Record<string, string> = { hunt: 'Hunt', time: 'Timing', trap: 'Trap', psych: 'Psychology' };
const CAT_CLS: Record<string, string>    = { hunt: 'cat-hunt', time: 'cat-time', trap: 'cat-trap', psych: 'cat-psych' };

export default function LiquidityPlaybook() {
  const [query, setQuery]   = useState('');
  const [cat, setCat]       = useState<Cat>('all');
  const [favs, setFavs]     = useState<number[]>([]);

  useEffect(() => {
    try { setFavs(JSON.parse(localStorage.getItem('pb-favs') ?? '[]')); } catch { /* ignore */ }
  }, []);

  const toggleFav = (n: number) => {
    setFavs(prev => {
      const next = prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n];
      try { localStorage.setItem('pb-favs', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const filtered = SECRETS.filter(s => {
    const mc = cat === 'all' || (cat === 'fav' ? favs.includes(s.n) : s.cat === cat);
    const mq = !query || s.name.toLowerCase().includes(query.toLowerCase()) || s.text.toLowerCase().includes(query.toLowerCase()) || String(s.n).includes(query);
    return mc && mq;
  });

  return (
    <div>
      <div style={{ padding: '1rem 0 0.5rem' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>Liquidity Playbook</div>
        <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 14 }}>{SECRETS.length} plays - the complete predator playbook</div>
      </div>

      <input
        className="bible-search"
        placeholder="Search plays..."
        value={query}
        onChange={e => setQuery(e.target.value)}
      />

      <div className="cat-filter">
        {(['all', 'hunt', 'time', 'trap', 'psych', 'fav'] as Cat[]).map(c => (
          <button
            key={c}
            className={`cf cf-${c}${cat === c ? ' on' : ''}`}
            onClick={() => setCat(c)}
          >
            {c === 'all' ? 'All' : c === 'fav' ? `★ Saved${favs.length ? ` (${favs.length})` : ''}` : CAT_LABELS[c]}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty">{cat === 'fav' ? 'No saved plays yet - tap ★ on any play to pin it.' : 'No plays match that search.'}</div>
      ) : (
        filtered.map(s => {
          const isFav = favs.includes(s.n);
          return (
            <div key={s.n} className="secret">
              <div className="s-num">
                PLAY #{s.n}
                <span className="s-num-right">
                  <span className={`cat-badge ${CAT_CLS[s.cat]}`}>{CAT_LABELS[s.cat]}</span>
                  <button
                    className={`pb-star${isFav ? ' on' : ''}`}
                    onClick={() => toggleFav(s.n)}
                    title={isFav ? 'Remove from saved' : 'Save play'}
                  >★</button>
                </span>
              </div>
              <div className="s-name">{s.name}</div>
              <div className="s-text">{s.text}</div>
            </div>
          );
        })
      )}
    </div>
  );
}
