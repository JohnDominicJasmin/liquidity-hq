'use client';
// Searchable multi-select dropdown for picking coins - replaces a full-width wall of
// 50 chip buttons with a compact trigger + popover. Uses position:fixed with computed
// coordinates (same technique as Tip.tsx) so the panel isn't clipped when this sits
// inside a scrollable container like SettingsModal's body.
import { useState, useRef, useCallback, useEffect } from 'react';
import { CoinId, COINS } from '@/lib/marketStore';
import { useLabels } from '@/lib/labels';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
}

export default function CoinMultiSelect({ value, onChange }: Props) {
  const { t } = useLabels();
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState('');
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef    = useRef<HTMLDivElement>(null);
  const searchRef   = useRef<HTMLInputElement>(null);

  const positionPanel = useCallback(() => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setCoords({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 260) });
  }, []);

  const openPanel = useCallback(() => {
    positionPanel();
    setOpen(true);
    setTimeout(() => searchRef.current?.focus(), 30);
  }, [positionPanel]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
      setSearch('');
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); setSearch(''); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', positionPanel);
    window.addEventListener('scroll', positionPanel, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', positionPanel);
      window.removeEventListener('scroll', positionPanel, true);
    };
  }, [open, positionPanel]);

  const toggleCoin = (c: CoinId) => {
    onChange(value.includes(c) ? value.filter(x => x !== c) : [...value, c]);
  };

  const filtered = COINS.filter(c => c.toUpperCase().includes(search.toUpperCase()));

  const summary = value.length === 0
    ? t('COIN_SELECT_PLACEHOLDER')
    : value.length <= 3
    ? value.map(c => c.toUpperCase()).join(', ')
    : `${value.slice(0, 3).map(c => c.toUpperCase()).join(', ')} +${value.length - 3} more`;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`cms-trigger${open ? ' open' : ''}`}
        onClick={() => (open ? setOpen(false) : openPanel())}
      >
        <span className="cms-trigger-txt">{summary}</span>
        <span className="cms-trigger-right">
          {value.length > 0 && <span className="cms-count">{value.length}</span>}
          <span className="cms-chevron">{open ? '▴' : '▾'}</span>
        </span>
      </button>

      {open && (
        <div
          ref={panelRef}
          className="cms-panel"
          style={{ top: coords.top, left: coords.left, width: coords.width }}
        >
          <input
            ref={searchRef}
            className="cms-search"
            placeholder={t('COIN_SELECT_SEARCH_PLACEHOLDER')}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="cms-list">
            {filtered.length === 0 ? (
              <div className="cms-empty">{t('COIN_SELECT_NO_MATCH', { search })}</div>
            ) : filtered.map(c => {
              const checked = value.includes(c);
              return (
                <label key={c} className={`cms-row${checked ? ' checked' : ''}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggleCoin(c)} />
                  <span>{c.toUpperCase()}</span>
                  {checked && <span className="cms-check">✓</span>}
                </label>
              );
            })}
          </div>
          {value.length > 0 && (
            <button type="button" className="cms-clear" onClick={() => onChange([])}>
              {t('COIN_SELECT_CLEAR_ALL', { count: value.length })}
            </button>
          )}
        </div>
      )}
    </>
  );
}
