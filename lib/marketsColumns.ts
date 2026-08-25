/* Markets' columns, and which of them are showing (#413, frame 3a).
 *
 * MEASURED FROM THE FRAME, not README:109, which is wrong about this screen in
 * four separate ways:
 *
 *   rows        frame pitch is 35px          README says "Rows are 33px"
 *   columns     README gives SEVEN grid values for "six visible columns" -
 *               110px 1fr 96px 120px 96px 1.3fr 120px. The seventh is the
 *               per-row action, which it never mentions
 *   search      the frame has a SEARCH COIN field. README does not mention it
 *   row action  the frame has OPEN ARENA -> on every row. Not mentioned either
 *
 * A spec written from the prose would assert a table with no search box and no
 * row action, which is exactly how /disclaimer's structure entry went wrong.
 *
 * WHY THIS IS A LIBRARY. README:195 lists "Markets' visible-column set and
 * filter chip" as new view state the redesign introduces. State that decides
 * what a user can see is worth testing without a DOM - the same reasoning that
 * put the design flag and the evidence grid in lib/.
 */

export type ColumnKey =
  | 'coin' | 'price' | 'change24h' | 'funding8h' | 'oi1h' | 'signal'
  | 'change7d' | 'volume' | 'takerRatio' | 'sparkline' | 'grade' | 'oiChange';

export interface Column {
  key:   ColumnKey;
  /** Header text. Sentence case in the frame - "24h %", not "24H %". */
  label: string;
  /** Grid track, measured from the frame's own layout. */
  track: string;
  /** Right-aligned numerics; the coin and signal columns are left. */
  align: 'left' | 'right';
  /** false = available in the column picker but not shown by default. */
  visible: boolean;
}

/* The six the frame shows, in its order, then the six README:109 names as
 * "hidden by default". Order matters: it is the reading order of the design
 * and the picker should offer the hidden ones in a stable sequence. */
export const COLUMNS: Column[] = [
  { key: 'coin',       label: 'Coin',       track: '110px', align: 'left',  visible: true  },
  { key: 'price',      label: 'Price',      track: '1fr',   align: 'left',  visible: true  },
  { key: 'change24h',  label: '24h %',      track: '96px',  align: 'right', visible: true  },
  { key: 'funding8h',  label: 'Funding 8h', track: '120px', align: 'right', visible: true  },
  { key: 'oi1h',       label: 'OI 1h',      track: '96px',  align: 'right', visible: true  },
  { key: 'signal',     label: 'Signal',     track: '1.3fr', align: 'left',  visible: true  },

  { key: 'change7d',   label: '7d %',       track: '96px',  align: 'right', visible: false },
  { key: 'volume',     label: 'Volume',     track: '110px', align: 'right', visible: false },
  { key: 'takerRatio', label: 'Taker ratio',track: '100px', align: 'right', visible: false },
  { key: 'sparkline',  label: 'Trend',      track: '90px',  align: 'left',  visible: false },
  { key: 'grade',      label: 'Grade',      track: '80px',  align: 'right', visible: false },
  { key: 'oiChange',   label: 'OI change',  track: '100px', align: 'right', visible: false },
];

/** The per-row action column. Present in the frame, absent from README:109. */
export const ACTION_TRACK = '120px';

export const DEFAULT_VISIBLE: ColumnKey[] = COLUMNS.filter(c => c.visible).map(c => c.key);

/** Row pitch, measured. README says 33; the frame is 35. Frame wins. */
export const ROW_HEIGHT = 35;

/* Filter chips, in the frame's order. `all` is the default. */
export const FILTERS = ['all', 'watchlist', 'majors', 'firing', 'gainers'] as const;
export type Filter = typeof FILTERS[number];

/**
 * Build the CSS grid template for a set of visible columns.
 *
 * Always appends the action track, because every row carries OPEN ARENA -> in
 * the frame and a grid whose template is one track short silently overflows the
 * last cell rather than erroring.
 */
export function gridTemplate(visible: ColumnKey[]): string {
  const tracks = visible
    .map(k => COLUMNS.find(c => c.key === k)?.track)
    .filter((t): t is string => Boolean(t));
  return [...tracks, ACTION_TRACK].join(' ');
}

/**
 * Toggle a column, refusing to hide the last one.
 *
 * `coin` is never hideable: a table of prices with no instrument names is not a
 * degraded view, it is an unreadable one. The picker should not offer it and
 * this refuses it even if the picker does.
 */
export function toggleColumn(visible: ColumnKey[], key: ColumnKey): ColumnKey[] {
  if (key === 'coin') return visible;
  if (!visible.includes(key)) {
    /* Re-inserted in COLUMNS order, not appended - otherwise re-showing a
       column you just hid moves it to the end and the table quietly reorders
       itself under the user. */
    const order = COLUMNS.map(c => c.key);
    return [...visible, key].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }
  if (visible.length <= 1) return visible;
  return visible.filter(k => k !== key);
}

/** Columns the picker offers, i.e. everything except the one that must stay. */
export function pickableColumns(): Column[] {
  return COLUMNS.filter(c => c.key !== 'coin');
}
