'use client';
import { useState, useEffect } from 'react';
import { SECRETS, Secret } from '@/lib/secrets';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';

type Cat = 'all' | 'hunt' | 'time' | 'trap' | 'psych' | 'fav';

const CAT_LABEL_KEYS: Record<string, LabelKey> = {
  hunt: 'PLAYBOOK_CAT_HUNT', time: 'PLAYBOOK_CAT_TIME', trap: 'PLAYBOOK_CAT_TRAP', psych: 'PLAYBOOK_CAT_PSYCH',
};
const CAT_CLS: Record<string, string>    = { hunt: 'cat-hunt', time: 'cat-time', trap: 'cat-trap', psych: 'cat-psych' };

export default function LiquidityPlaybook() {
  const { t }                = useLabels();
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
        <div style={{ fontSize: 'var(--fs-section)', fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>{t('PLAYBOOK_PAGE_TITLE')}</div>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginBottom: 14 }}>{t('PLAYBOOK_SUBTITLE', { count: SECRETS.length })}</div>
      </div>

      <input
        className="bible-search"
        placeholder={t('PLAYBOOK_SEARCH_PLACEHOLDER')}
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
            {c === 'all' ? t('PLAYBOOK_CAT_ALL') : c === 'fav' ? (favs.length ? t('PLAYBOOK_CAT_FAV_COUNT', { count: favs.length }) : t('PLAYBOOK_CAT_FAV_EMPTY')) : t(CAT_LABEL_KEYS[c])}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty">{cat === 'fav' ? t('PLAYBOOK_NO_FAVS') : t('PLAYBOOK_NO_MATCHES')}</div>
      ) : (
        filtered.map(s => {
          const isFav = favs.includes(s.n);
          return (
            <div key={s.n} className="secret">
              <div className="s-num">
                {t('PLAYBOOK_PLAY_NUMBER', { n: s.n })}
                <span className="s-num-right">
                  <span className={`cat-badge ${CAT_CLS[s.cat]}`}>{t(CAT_LABEL_KEYS[s.cat])}</span>
                  <button
                    className={`pb-star${isFav ? ' on' : ''}`}
                    onClick={() => toggleFav(s.n)}
                    title={isFav ? t('PLAYBOOK_UNSAVE_TITLE') : t('PLAYBOOK_SAVE_TITLE')}
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
