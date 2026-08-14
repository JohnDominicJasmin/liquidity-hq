'use client';
import { useMemo } from 'react';
import { useMarket, type CoinId } from '@/lib/marketStore';
import { useOI1h } from '@/lib/useOI1h';
import { getSessionName } from '@/lib/session';
import { buildEvidence, firingCount, mobileEvidence, type EvidenceRow } from '@/lib/arenaEvidence';
import type { ChartTf } from '@/components/KLineProChart';
import { useIsMobileLayout } from '@/lib/useViewport';

/* Arena in the Monochrome Terminal direction — frame `1a` (#413).
 *
 * BUILT FROM THE FRAME, NOT THE README. Every number below was measured off the
 * rendered prototype at 1440x900, because the README and the frame disagree in
 * three places on this screen alone and the frame wins by standing rule:
 *
 *   LEAN BULLISH      frame 24px desktop / 22px mobile   README:103 says 34px
 *   right rail        frame 304px                        README:103 says 352px
 *   verdict band      frame is MAIN COLUMN, 1142 wide    README:103 says full-width
 *
 * QA scanned the source for every occurrence of the verdict type and found
 * eight, at eight different sizes, none of them 34 - so :103 is a transcription
 * error rather than a second opinion. README:17's own words: "Every value below
 * was measured in the prototypes."
 *
 * SHAPE IS BINDING, VALUES ARE OURS. The owner's rule for the redesign:
 *
 *   "i know we cannot display all data in design but we can fill it with other
 *    data or numbers"
 *
 * So the regions, their order, their geometry and the eight-row evidence grid
 * are the design's; 115,284.50 and +0.0132% are not. Seven of the eight signals
 * come from fields this app already carries. See lib/arenaEvidence.ts for which,
 * and for the colour rule, which is the part of this screen that is easy to get
 * wrong invisibly.
 *
 * MOBILE IS A SECOND LAYOUT, NOT A NARROWER ONE. README:191, and frame `1a`
 * mobile proves it: four verdict cells become three, eight evidence rows become
 * the firing ones, SET ALERT disappears, and the entire right rail is absent.
 * Those are different renders, so they are different JSX rather than one tree
 * with display:none - hiding a rail still mounts its data hooks.
 */

interface Props {
  coin:  CoinId;
  tf:    ChartTf;
  onTfChange: (tf: ChartTf) => void;
  /** Verdict copy from the existing read pipeline - this component does not compute one. */
  verdict:    { label: string; dir: 'bull' | 'bear' | 'neutral'; confidence: number | null } | null;
  entry:      { zoneLow: number | null; zoneHigh: number | null; stop: number | null; target: number | null; target2: number | null } | null;
  reasoning:  string | null;
  history:    { time: string; verdict: string; conf: number | null; outcome: string | null }[];
  clusters:   { price: number; usd: number }[];
  onRerun:    () => void;
  onSetAlert: () => void;
  rerunning?: boolean;
  /* THE CHART, PASSED IN RATHER THAN CONSTRUCTED HERE.
   *
   * Arena's chart carries the read result, the EMA overlay, draggable price
   * alerts, BTC gamma levels and the structure callback. A fresh
   * <KLineProChart coin tf /> next to it renders the same candles with none of
   * that - so building one here did not "reuse the chart", it shipped a poorer
   * copy of it and left the real one further down the page. Two charts, one
   * of them worse.
   *
   * The frame moves the chart; it does not replace it. So the page passes the
   * chart it already had and this component only decides where it sits. */
  chart?: React.ReactNode;
  /* THE EXISTING ARENA, RENDERED WHOLE BELOW THE NEW LAYOUT.
   *
   * The redesign moves and rewords UI; it does not delete it. This screen
   * currently carries the confluence score, the EMA signal, market structure,
   * multi-timeframe alignment, spot absorption, the liquidation heatmap, the
   * coin filters, the alert form, deep research and the usage meter - about a
   * hundred label keys' worth. Frame 1a shows none of them, because it shows
   * the READ tab: README:89 gives Arena five in-page tabs (Read, Order flow,
   * Liquidity, Correlation, History) and the frame is the first one.
   *
   * So the honest interim is to render the frame's Read layout and keep
   * everything else underneath it, visibly, rather than ship a redesign that
   * quietly drops half the product. Each panel moves up into its designed tab
   * as that tab is built, and this prop goes away when the last one has.
   *
   * Shipping without this would have looked finished and lost features - the
   * same failure as /disclaimer, in the other direction. */
  children?: React.ReactNode;
}

/* Frame toolbar order. The prototype shows 5m 15m 1H 1D 1W with 4H active,
   which is six labels for five slots - the active one is inserted rather than
   being one of the five. Kept as the app's own ChartTf set so the control still
   drives the chart it sits above. */
const TFS: ChartTf[] = ['5m', '15m', '1h', '4h', '1d'];

const fmt = (n: number | null, dp = 2) =>
  n === null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

const DASH = '—';

/** --green / --red only when the row is firing. Never on the value's sign. */
function fireColour(row: EvidenceRow): string {
  return row.fire === 'green' ? 'var(--green)' : row.fire === 'red' ? 'var(--red)' : 'var(--txt)';
}

function EvidenceCell({ row }: { row: EvidenceRow }) {
  return (
    <div className="atv-eq">
      <span className="atv-elabel">{row.label}</span>
      <span className="atv-eval" style={{ color: fireColour(row) }}>{row.value ?? DASH}</span>
      <span className="atv-enote">{row.note ?? ''}</span>
    </div>
  );
}

export default function ArenaTerminal({
  coin, tf, onTfChange, verdict, entry, reasoning, history, clusters,
  onRerun, onSetAlert, rerunning, children, chart,
}: Props) {
  /* One tree, not two hidden behind display:none - a hidden subtree still
     mounts, which is how Arena ended up with two live charts. */
  const isMobile = useIsMobileLayout();

  const { store } = useMarket();
  const c   = store.coins[coin];
  const oi  = useOI1h(coin);

  /* `price` is the spot mark and `perpPrice` the perp, so basis is derivable
     without a second feed. Memoised because eight rows of formatting on every
     tick of a live price is the kind of thing that shows up as jank later. */
  const rows = useMemo(() => buildEvidence({
    coin: c,
    spotPrice:  c?.price ?? null,
    oiChange1h: oi.pct === null ? null : oi.pct / 100,
    cbPremium:  null,          // no source wired - renders as an em dash, never a stand-in
  }), [c, oi.pct]);

  const { firing, neutral } = firingCount(rows);
  const mRows = mobileEvidence(rows);

  const dirColour = verdict?.dir === 'bull' ? 'var(--green)'
                  : verdict?.dir === 'bear' ? 'var(--red)' : 'var(--txt)';
  const conf = verdict?.confidence ?? null;

  const zone = entry && entry.zoneLow !== null
    ? `${fmt(entry.zoneLow, 0)}`
    : DASH;
  const zoneSub = entry && entry.zoneHigh !== null ? `– ${fmt(entry.zoneHigh, 0)}` : '';

  return (
    <div className="atv">

      {/* ── DESKTOP ───────────────────────────────────────────────────────
          Verdict band is the MAIN COLUMN only (measured 1142 of 1440), so it
          and the right rail are siblings inside one grid rather than the band
          spanning the full width above them. */}
      {!isMobile && <div className="atv-desk">

        <div className="atv-main">

          {/* Verdict band — 99 tall. 330px left cell, four 120px cells, 150px actions. */}
          <div className="atv-band">
            <div className="atv-bverdict">
              <div className="atv-micro">Read · {coin} perp · {tf.toUpperCase()}</div>
              <div className="atv-verdict" style={{ color: dirColour }}>
                {verdict?.label ?? 'NO READ YET'}
              </div>
              <div className="atv-confrow">
                <span className="atv-confbar">
                  <span
                    className="atv-conffill"
                    style={{ width: `${conf ?? 0}%`, background: dirColour }}
                  />
                </span>
                <span className="atv-confnum">{conf ?? DASH}</span>
                <span className="atv-micro">CONF</span>
              </div>
            </div>

            <div className="atv-bcells">
              <div className="atv-bcell">
                <span className="atv-micro">Last</span>
                <span className="atv-bval">{fmt(c?.price ?? null)}</span>
                <span className="atv-bsub" style={{ color: (c?.change ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {c?.change == null ? DASH : `${c.change >= 0 ? '+' : '−'}${Math.abs(c.change).toFixed(2)}%`}
                </span>
              </div>
              <div className="atv-bcell">
                <span className="atv-micro">Entry zone</span>
                <span className="atv-bval">{zone}</span>
                <span className="atv-bsub">{zoneSub}</span>
              </div>
              <div className="atv-bcell">
                <span className="atv-micro">Stop</span>
                <span className="atv-bval">{fmt(entry?.stop ?? null, 0)}</span>
                <span className="atv-bsub">
                  {entry?.stop != null && c?.price
                    ? `${(((entry.stop - c.price) / c.price) * 100).toFixed(2)}%`
                    : ''}
                </span>
              </div>
              <div className="atv-bcell">
                <span className="atv-micro">Targets</span>
                <span className="atv-bval">{fmt(entry?.target ?? null, 0)}</span>
                <span className="atv-bsub">
                  {entry?.target2 != null ? `then ${fmt(entry.target2, 0)}` : ''}
                </span>
              </div>
            </div>

            <div className="atv-bactions">
              <button className="atv-rerun" onClick={onRerun} disabled={rerunning}>
                {rerunning ? 'RUNNING…' : 'RE-RUN READ'}
              </button>
              <button className="atv-setalert" onClick={onSetAlert}>SET ALERT</button>
            </div>
          </div>

          {/* Timeframe toolbar — active is amber-filled with #08090a text. */}
          <div className="atv-toolbar">
            {TFS.map(t => (
              <button
                key={t}
                className={`atv-tf${t === tf ? ' on' : ''}`}
                onClick={() => onTfChange(t)}
                aria-pressed={t === tf}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="atv-chart">
            {chart}
          </div>

          {/* Evidence — 4 x 2, header counts rather than hardcodes. */}
          <div className="atv-evidence">
            <div className="atv-ehead">
              <span className="atv-ehl">Evidence</span>
              <span className="atv-micro">{firing} FIRING · {neutral} NEUTRAL</span>
            </div>
            <div className="atv-egrid">
              {rows.map(r => <EvidenceCell key={r.label} row={r} />)}
            </div>
          </div>
        </div>

        {/* Right rail — 304px measured. Absent on mobile entirely. */}
        <aside className="atv-rail">
          <div className="atv-rhead">Liquidation clusters</div>
          <div className="atv-clusters">
            {clusters.length === 0
              ? <div className="atv-empty">No clusters in range</div>
              : clusters.map(cl => (
                  <div key={cl.price} className="atv-cluster">
                    <span className="atv-cpx">{(cl.price / 1000).toFixed(1)}k</span>
                    <span className="atv-cbar">
                      <span
                        className="atv-cbarfill"
                        style={{ width: `${Math.min(100, (cl.usd / Math.max(...clusters.map(x => x.usd))) * 100)}%` }}
                      />
                    </span>
                    <span className="atv-cusd">${Math.round(cl.usd / 1e6)}M</span>
                  </div>
                ))}
          </div>

          <div className="atv-rhead">Reasoning</div>
          <p className="atv-reasoning">{reasoning ?? 'No read has been generated for this instrument yet.'}</p>

          <div className="atv-rhead">Session history</div>
          <div className="atv-history">
            {history.length === 0
              ? <div className="atv-empty">Nothing this session</div>
              : history.map((h, i) => (
                  <div key={`${h.time}-${i}`} className="atv-hrow">
                    <span className="atv-htime">{h.time}</span>
                    <span className="atv-hverdict">{h.verdict}</span>
                    <span className="atv-hconf">{h.conf ?? DASH}</span>
                    <span className="atv-houtcome">{h.outcome ?? ''}</span>
                  </div>
                ))}
          </div>
        </aside>
      </div>}

      {/* ── MOBILE ────────────────────────────────────────────────────────
          Separate tree, per README:191. Price moves up into the instrument row,
          so the band drops `Last` and shows three cells; evidence shows only
          what is firing; there is no SET ALERT and no rail. */}
      {isMobile && <div className="atv-mob">
        <div className="atv-minstrument">
          <span className="atv-msym">{coin}</span>
          <span className="atv-micro">PERP · {tf.toUpperCase()}</span>
          <span className="atv-mpx">{fmt(c?.price ?? null)}</span>
          <span
            className="atv-mchg"
            style={{ color: (c?.change ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}
          >
            {c?.change == null ? DASH : `${c.change >= 0 ? '+' : '−'}${Math.abs(c.change).toFixed(2)}%`}
          </span>
        </div>

        <div className="atv-micro atv-mreadlabel">Read</div>
        <div className="atv-mverdict" style={{ color: dirColour }}>
          {verdict?.label ?? 'NO READ YET'}
        </div>
        <div className="atv-confrow">
          <span className="atv-confbar">
            <span className="atv-conffill" style={{ width: `${conf ?? 0}%`, background: dirColour }} />
          </span>
          <span className="atv-confnum">{conf ?? DASH}</span>
          <span className="atv-micro">CONF</span>
        </div>

        <div className="atv-mcells">
          <div className="atv-mcell"><span className="atv-micro9">ENTRY</span><span className="atv-mval">{zone}</span></div>
          <div className="atv-mcell"><span className="atv-micro9">STOP</span><span className="atv-mval">{fmt(entry?.stop ?? null, 0)}</span></div>
          <div className="atv-mcell"><span className="atv-micro9">TARGET</span><span className="atv-mval">{fmt(entry?.target ?? null, 0)}</span></div>
        </div>

        <div className="atv-mchart">
          {chart}
        </div>

        <div className="atv-ehead">
          <span className="atv-ehl">Evidence</span>
          <span className="atv-micro">{firing} FIRING</span>
        </div>
        <div className="atv-mevidence">
          {mRows.map(r => <EvidenceCell key={r.label} row={r} />)}
        </div>

        <button className="atv-mrerun" onClick={onRerun} disabled={rerunning}>
          {rerunning ? 'RUNNING…' : 'RE-RUN READ'}
        </button>
      </div>}

      {/* Everything the frame's READ tab does not show, kept and visible.
          README:89 puts these behind Arena's other four in-page tabs; until
          those are built they live here rather than being dropped. The rule
          from the owner is explicit: move UI or reword it, never remove it. */}
      {children ? (
        <section className="atv-carry" aria-label="Additional Arena panels">
          <div className="atv-carry-head">
            <span className="atv-ehl">Also on this screen</span>
            <span className="atv-micro">pending relocation into Order flow · Liquidity · Correlation · History</span>
          </div>
          {children}
        </section>
      ) : null}

      {/* Session name is in the shell's header on mobile and the nav's session
          pill on desktop; rendered here only so the value has one owner. */}
      <span hidden data-session={getSessionName(new Date())} />
    </div>
  );
}
