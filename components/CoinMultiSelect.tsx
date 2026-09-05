'use client';
// Searchable multi-select dropdown for picking coins - replaces a full-width wall of
// 50 chip buttons with a compact trigger + popover. Uses position:fixed with computed
// coordinates (same technique as Tip.tsx) so the panel isn't clipped when this sits
// inside a scrollable container like SettingsModal's body.
import { useState, useRef, useCallback, useEffect, useId } from 'react';
import { CoinId, COINS } from '@/lib/marketStore';
import { useLabels } from '@/lib/labels';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  /** How many selected coins the closed trigger previews before "+N more". Default 3. */
  previewCount?: number;
  /** SINGLE-SELECT MODE (#746). Picking a coin replaces the selection and
   *  closes the panel; there is no clear-all and the rows read as a choice
   *  rather than a set.
   *
   *  A flag on this component rather than a second one. The popover, its
   *  fixed-position maths, the outside-click and Escape handling and the
   *  search filter are the whole component; only the row's semantics differ.
   *  Two popovers would drift - one would gain a keyboard fix the other did
   *  not - and this codebase already carries that lesson from two navs that
   *  had to be re-merged in #714.
   *
   *  `value` stays string[] so every existing caller is untouched; a
   *  single-select consumer passes [current] and receives [picked]. */
  single?: boolean;
}

export default function CoinMultiSelect({ value, onChange, previewCount = 3, single = false }: Props) {
  const { t } = useLabels();
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState('');
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef    = useRef<HTMLDivElement>(null);
  const searchRef   = useRef<HTMLInputElement>(null);
  // Checked coins sort to the top, but only re-sorted when the panel opens -
  // not on every toggle, or the list would reshuffle under the cursor while
  // checking off several coins in a row.
  const orderRef    = useRef<CoinId[]>(COINS);
  const listRef     = useRef<HTMLDivElement>(null);
  /** Stable id so aria-controls on the trigger points at the list. */
  const listId = useId();

  /* ARROW KEYS MOVE FOCUS, THEY DO NOT SELECT (#746 review).
     Reaching coin 44 was 43 tabs. Native radio groups do support arrows, but
     they SELECT as they move - and in single mode selecting closes the panel,
     so a keyboard user would be ejected on the first ArrowDown. So the arrows
     are handled here and preventDefault'd, and Enter or Space on the focused
     row is what commits. */
  const onListKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const items = Array.from(listRef.current?.querySelectorAll<HTMLInputElement>('input') ?? []);
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLInputElement);
    const next =
      e.key === 'Home' ? 0 :
      e.key === 'End'  ? items.length - 1 :
      e.key === 'ArrowDown' ? (at < 0 ? 0 : Math.min(at + 1, items.length - 1))
                            : (at < 0 ? items.length - 1 : Math.max(at - 1, 0));
    items[next]?.focus();
  }, []);

  const positionPanel = useCallback(() => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setCoords({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 260) });
  }, []);

  const openPanel = useCallback(() => {
    orderRef.current = [...COINS].sort((a, b) => {
      const aChecked = value.includes(a);
      const bChecked = value.includes(b);
      return aChecked === bChecked ? 0 : aChecked ? -1 : 1;
    });
    positionPanel();
    setOpen(true);
    setTimeout(() => searchRef.current?.focus(), 30);
  }, [positionPanel, value]);

  /* CLOSE RETURNS FOCUS TO THE TRIGGER (WCAG 2.4.3, #746 review).
     Escape used to drop the user on <body> - the focus-IN half was already
     correct (openPanel focuses the search box), so this finishes a pattern
     rather than starting one. `restore` is false for an outside click, where
     the user has already chosen where to put focus and yanking it back is the
     rude version of helpful. */
  const closePanel = useCallback((restore = true) => {
    setOpen(false);
    setSearch('');
    if (restore) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      closePanel(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePanel();
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
  }, [open, positionPanel, closePanel]);

  const toggleCoin = (c: CoinId) => {
    if (single) {
      /* Replace and close. Re-picking the current coin closes without firing
         onChange, so a consumer that resets state on change - GrokChat starts
         a new conversation - does not throw work away on a no-op click. */
      if (!value.includes(c)) onChange([c]);
      closePanel();
      return;
    }
    onChange(value.includes(c) ? value.filter(x => x !== c) : [...value, c]);
  };

  const filtered = orderRef.current.filter(c => c.toUpperCase().includes(search.toUpperCase()));

  const summary = single
    ? (value[0]?.toUpperCase() ?? t('COIN_SELECT_PLACEHOLDER'))
    : value.length === 0
    ? t('COIN_SELECT_PLACEHOLDER')
    : value.length <= previewCount
    ? value.map(c => c.toUpperCase()).join(', ')
    : `${value.slice(0, previewCount).map(c => c.toUpperCase()).join(', ')} +${value.length - previewCount} more`;

  return (
    <>
      {/* COMBOBOX SEMANTICS (WCAG 4.1.2, #746 review). Without these a screen
          reader announces "SUI, button" - nothing says it opens a list, and
          nothing says whether it is open. The chevron below carries that state
          to sighted users only. */}
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        className={`cms-trigger${open ? ' open' : ''}`}
        onClick={() => (open ? closePanel() : openPanel())}
      >
        <span className="cms-trigger-txt">{summary}</span>
        <span className="cms-trigger-right">
          {!single && value.length > 0 && <span className="cms-count">{value.length}</span>}
          <span className="cms-chevron">{open ? '▴' : '▾'}</span>
        </span>
      </button>

      {open && (
        <div
          ref={panelRef}
          className="cms-panel"
          style={{ top: coords.top, left: coords.left, width: coords.width }}
        >
          {/* aria-label as well as placeholder (WCAG 3.3.2). A placeholder is
              not an accessible name: it disappears on the first keystroke and
              several screen readers never announce it. */}
          <input
            ref={searchRef}
            className="cms-search"
            aria-label={t('COIN_SELECT_SEARCH_PLACEHOLDER')}
            placeholder={t('COIN_SELECT_SEARCH_PLACEHOLDER')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={onListKey}
          />
          {/* THE LISTBOX THE TRIGGER PROMISES (#746 review).
              aria-haspopup="listbox" and aria-controls pointed at a plain div.
              A combobox that promises option semantics and delivers none is
              worse than one that promises nothing: the screen reader tells the
              user to expect count, position and selected state, and a div
              supplies none of it.
              aria-multiselectable rather than a second component - the same
              popover serves both modes and the difference is exactly this
              attribute plus the row's control type. */}
          <div
            className="cms-list"
            id={listId}
            ref={listRef}
            role="listbox"
            aria-multiselectable={!single}
            onKeyDown={onListKey}
          >
            {filtered.length === 0 ? (
              <div className="cms-empty">{t('COIN_SELECT_NO_MATCH', { search })}</div>
            ) : filtered.map(c => {
              const checked = value.includes(c);
              return (
                /* role="option" with aria-selected, so the count and the
                   selected state the trigger advertises are actually there.
                   The native input stays: it carries checked state for free
                   and it is what the arrow keys move focus between. */
                <label
                  key={c}
                  role="option"
                  aria-selected={checked}
                  className={`cms-row${checked ? ' checked' : ''}`}
                >
                  <input
                    type={single ? 'radio' : 'checkbox'}
                    name={single ? 'cms-single' : undefined}
                    checked={checked}
                    onChange={() => toggleCoin(c)}
                  />
                  <span>{c.toUpperCase()}</span>
                  {checked && <span className="cms-check">✓</span>}
                </label>
              );
            })}
          </div>
          {!single && value.length > 0 && (
            <button type="button" className="cms-clear" onClick={() => onChange([])}>
              {t('COIN_SELECT_CLEAR_ALL', { count: value.length })}
            </button>
          )}
        </div>
      )}
    </>
  );
}
