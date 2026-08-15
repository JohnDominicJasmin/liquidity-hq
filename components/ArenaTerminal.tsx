'use client';
import { useMemo, type ReactNode } from 'react';
import { useMarket, type CoinId } from '@/lib/marketStore';
import { useMobileLayout, LANDING_MOBILE_QUERY } from '@/lib/useViewport';
import { buildEvidence, firingCount, type EvidenceRow } from '@/lib/arenaEvidence';
import { evidencePaint, verdictPaint, clusterPaint, LEVEL_COLOUR, type VerdictDir } from '@/lib/arenaColour';
import { TF_ROW, tfState, tfClickIntent, gatedHint } from '@/lib/arenaTimeframes';

/* Arena in the Monochrome Terminal direction.
 *
 * SPEC:  design-handoff-dir/design_handoff_arena/specs/arena.md
 * FRAME: Arena 1a.dc.html · 1a   (desktop 1440, mobile 390x844)
 *
 * NOTHING HERE COMES FROM feature/terminal-arena. That branch was closed
 * unmerged: it built the rail at 304px, which is a direct-manipulation artifact
 * in a superseded frame - three sibling frames say 352 - and it predates the
 * extend rule, the no-duplication rule and the entitlement finding. This is a
 * fresh build against the spec.
 *
 * COLOUR AND GATING ARE NOT DECIDED HERE. lib/arenaColour.ts and
 * lib/arenaTimeframes.ts own them, with 25 tests between them, because QA's
 * coverage map found no automated check for either - criteria 12-18 and 20-23
 * both land in the group where a defect reaches dev unopposed. A component is
 * the wrong place for a rule that nothing can assert.
 *
 * ONE TREE. The spec is explicit that this is the screen where two trees cost
 * real resources: rendering both and hiding one means two KLineProChart
 * instances and two candle subscriptions. That already shipped once. Criterion
 * 24 tests by node count, criterion 25 counts chart instances.
 *
 * THE EVIDENCE LIST SHOWS 12, NOT THE FRAME'S 8. QA's ruling: the frame draws
 * the mock's data, and the owner's extend rule was written for exactly this
 * grid. Arena showing fewer signals than the marketing page would be backwards.
 * If 12 rows overflow the rail, THE PANEL GROWS TALLER - owner's call, given in
 * advance, so no build workaround is needed and none should be invented.
 */

interface Props {
  coin:       CoinId;
  tf:         string;
  onTfChange: (tf: string) => void;
  /** Opens UpgradeGateModal. A gated chip calls this and changes nothing else. */
  onUpgrade:  () => void;
  /** From the call site, never from inside a component - see §Pro surfaces. */
  entitled:   boolean;
  authLoading: boolean;
  verdict:    { label: string; dir: VerdictDir; confidence: number | null } | null;
  levels:     { entry: number | null; stop: number | null; target: number | null };
  /** The panels this screen keeps, passed in so their guards stay at the call site. */
  chart?:       ReactNode;
  confluence?:  ReactNode;
  multiTf?:     ReactNode;
  structure?:   ReactNode;
  emaSignal?:   ReactNode;
  absorption?:  ReactNode;
  heatmap?:     ReactNode;
  usageMeter?:  ReactNode;
  /** Rail, in spec order: UsageMeter -> clusters -> Why -> evidence -> history.
   *  All three are ABSENT on mobile, not hidden - the cluster ladder is what
   *  makes the heatmap's colour-only magnitude readable, so §Accessibility
   *  drops the heatmap at mobile rather than leave it unsupported. */
  clusters?:    { price: number; usd: number }[];
  why?:         string | null;
  history?:     { time: string; verdict: string; conf: number | null }[];
  hintBand?:    ReactNode;
  snapshot?:    ReactNode;
  coinIcon?:    ReactNode;
  tfBadge?:     ReactNode;
}

const DASH = '—';

const fmt = (n: number | null, dp = 0) =>
  n === null ? DASH : n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

/* Panel header — every body panel uses it. Height 30, rail headers 28. */
function PanelHead({ title, count, pro, rail }: { title: string; count?: string; pro?: boolean; rail?: boolean }) {
  return (
    <div className={rail ? 'at-rhead' : 'at-phead'}>
      <span className="at-ptitle">{title}</span>
      {pro && <span className="at-pro">PRO</span>}
      <span className="at-pspacer" />
      {count && <span className="at-pcount">{count}</span>}
    </div>
  );
}

/* Spec §Panel header: "every panel in the body uses it". The passed-in panels
   are production components that draw their own headers, so the pattern is
   applied HERE by wrapping them, and each component's own header is suppressed
   in CSS under [data-design="terminal"].
   Wrapping rather than restyling six internal structures: only three of the six
   even have a targetable header class, and reimplementing the other three would
   mean forking components that work. */
function BodyPanel({ title, pro, count, children }: {
  title: string; pro?: boolean; count?: string; children?: ReactNode;
}) {
  if (!children) return null;
  return (
    <section className="at-panel at-bodypanel">
      <PanelHead title={title} pro={pro} count={count} />
      <div className="at-panelbody">{children}</div>
    </section>
  );
}

function EvidenceList({ rows, mobile }: { rows: EvidenceRow[]; mobile: boolean }) {
  return (
    <>
      {rows.map(r => {
        const paint = evidencePaint(r.fire, r.value !== null);
        return (
          /* data-fire so QA can assert the RENDERED colour matches what
             arenaColour returns for the same input, rather than reading rows
             by eye. Their check narrows from "judge the colour" to "compare
             two values", which fails loudly instead of quietly.
             `null` is written as the string "null" deliberately - an absent
             attribute would be indistinguishable from a row that forgot it. */
          <div key={r.label} className="at-ev" data-fire={String(r.fire)}>
            <span className="at-ev-mark" style={{ background: paint.marker }} />
            <span className="at-ev-label">{r.label}</span>
            <span className="at-ev-val" style={{ color: paint.value }}>{r.value ?? DASH}</span>
            {/* Note is ABSENT on mobile, not hidden - spec §Absent vs hidden. */}
            {!mobile && <span className="at-ev-note">{r.note ?? ''}</span>}
          </div>
        );
      })}
    </>
  );
}

function TimeframeRow({
  tf, onTfChange, onUpgrade, entitled, mobile,
}: { tf: string; onTfChange: (t: string) => void; onUpgrade: () => void; entitled: boolean; mobile: boolean }) {
  const hint = gatedHint(entitled);
  return (
    <div className="at-tfrow">
      {TF_ROW.map(t => {
        const state = tfState(t, tf, entitled);
        return (
          <button
            key={t}
            className={`at-tf at-tf-${state}`}
            aria-pressed={state === 'active'}
            onClick={() => (tfClickIntent(t, entitled) === 'upgrade' ? onUpgrade() : onTfChange(t))}
          >
            {/* The padlock carries the state. --txt2 and --txt3 are too close
                for colour alone to be a distinction - spec §Timeframe row. */}
            {state === 'gated' && (
              <svg width={mobile ? 8 : 9} height={mobile ? 10 : 11} viewBox="0 0 9 11" fill="none"
                   stroke="var(--txt3)" strokeWidth={1.2} aria-hidden="true">
                <rect x="1" y="4.5" width="7" height="6" />
                <path d="M2.75 4.5V3a1.75 1.75 0 0 1 3.5 0v1.5" />
              </svg>
            )}
            {t.toUpperCase()}
          </button>
        );
      })}
      {hint && <span className="at-tfhint">{hint}</span>}
    </div>
  );
}

export default function ArenaTerminal({
  coin, tf, onTfChange, onUpgrade, entitled, authLoading, verdict, levels,
  chart, confluence, multiTf, structure, emaSignal, absorption, heatmap,
  usageMeter, hintBand, snapshot, tfBadge, coinIcon, clusters, why, history,
}: Props) {
  const mobile = useMobileLayout(LANDING_MOBILE_QUERY);
  const { store } = useMarket();
  const c = store.coins[coin];

  const rows = useMemo(() => buildEvidence({
    coin: c,
    spotPrice: c?.price ?? null,
    cbPremium: null,      // no source wired - em dash, always. Never a zero.
  }), [c]);

  const spot = c?.price ?? null;
  const { firing, neutral } = firingCount(rows);
  const vColour = verdictPaint(verdict?.dir ?? null);

  const verdictBlock = (
    <div className="at-verdict">
      <div className="at-vmain">
        <span className="at-micro">Read · {coin.toUpperCase()} perp · {tf.toUpperCase()}</span>
        <span className="at-vlabel" style={{ color: vColour }}>{verdict?.label ?? 'NO READ'}</span>
        {/* No read -> confidence row ABSENT, panel keeps its height. */}
        {verdict?.confidence != null && (
          <span className="at-vconf">
            <span className="at-vtrack">
              <span className="at-vfill" style={{ width: `${verdict.confidence}%`, background: vColour }} />
            </span>
            <span className="at-vnum">{verdict.confidence}</span>
            <span className="at-micro">CONF</span>
          </span>
        )}
      </div>
      {/* Prices, not signals - always --txt, em dash when absent. */}
      <div className="at-vlevels">
        {([['Entry', levels.entry], ['Stop', levels.stop], ['Target', levels.target]] as const).map(([l, v]) => (
          <div key={l} className="at-vlevel">
            <span className="at-micro">{l}</span>
            <span className="at-vlevelval" style={{ color: LEVEL_COLOUR }}>{fmt(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const evidencePanel = (
    <section className="at-panel">
      <PanelHead title="Evidence" count={`${firing} FIRING · ${neutral} NEUTRAL`} rail={!mobile} />
      <EvidenceList rows={rows} mobile={mobile} />
    </section>
  );

  /* ── MOBILE ────────────────────────────────────────────────────────────
     Separate tree. The rail, the heatmap, the snapshot band's five cells and
     the ticker do not EXIST here - criterion 24 counts nodes. */
  if (mobile) {
    return (
      <div className="at-root" data-layout="mobile">
        <div className="at-msym">{coin.toUpperCase()}</div>
        {tfBadge}
        {verdictBlock}
        <TimeframeRow tf={tf} onTfChange={onTfChange} onUpgrade={onUpgrade} entitled={entitled} mobile />
        <div className="at-mchart">{chart}</div>
        <BodyPanel title="Confluence" pro>{confluence}</BodyPanel>
        <BodyPanel title="Multi-timeframe">{multiTf}</BodyPanel>
        <BodyPanel title="Market structure">{structure}</BodyPanel>
        <BodyPanel title="EMA conditions">{emaSignal}</BodyPanel>
        <BodyPanel title="Absorption" pro>{absorption}</BodyPanel>
        {evidencePanel}
      </div>
    );
  }

  /* ── DESKTOP ───────────────────────────────────────────────────────────── */
  return (
    <div className="at-root" data-layout="desktop">
      {hintBand}
      {/* Region 4, 88 tall: 330 coin cell (32x32 mark) | five stat cells |
          230 badge cell. The stat cells are absent at mobile, where the badge
          becomes its own block instead. */}
      <div className="at-snapband">
        <div className="at-coincell">{coinIcon}<span className="at-coinsym">{coin.toUpperCase()}</span></div>
        <div className="at-snapcells">{snapshot}</div>
        <div className="at-badgecell">{tfBadge}</div>
      </div>
      {verdictBlock}
      <TimeframeRow tf={tf} onTfChange={onTfChange} onUpgrade={onUpgrade} entitled={entitled} mobile={false} />

      <div className="at-body">
        <div className="at-main">
          <div className="at-chart">{chart}</div>
          <BodyPanel title="Confluence" pro>{confluence}</BodyPanel>
          <div className="at-pair">
            <BodyPanel title="Multi-timeframe">{multiTf}</BodyPanel>
            <BodyPanel title="Market structure">{structure}</BodyPanel>
          </div>
          {/* AbsorptionDetector is ABSENT for free users, so EMASignal takes
              the full width. Deliberately asymmetric with Confluence, which
              shows a locked card instead - spec §Pro surfaces. That asymmetry
              is production's behaviour and must survive. */}
          <div className="at-pair">
            <BodyPanel title="EMA conditions">{emaSignal}</BodyPanel>
            {/* Absent for free users, so EMA takes the row - the null child
                makes BodyPanel render nothing rather than an empty header. */}
            <BodyPanel title="Absorption" pro>{absorption}</BodyPanel>
          </div>
          <BodyPanel title="Liquidation heatmap">{heatmap}</BodyPanel>
        </div>

        <aside className="at-rail">
          {usageMeter}

          {/* Cluster bars take SIDE, not size - below spot is long
              liquidations, above is short. Scaling colour by size would make a
              big cluster read as a strong signal. */}
          <section className="at-panel">
            <PanelHead title="Liquidation clusters" count={clusters?.length ? `${clusters.length}` : undefined} rail />
            {clusters?.length
              ? clusters.map(cl => {
                  const max = Math.max(...clusters.map(x => x.usd), 1);
                  return (
                    <div key={cl.price} className="at-cl">
                      <span className="at-cl-px">{(cl.price / 1000).toFixed(1)}k</span>
                      <span className="at-cl-bar">
                        <span
                          className="at-cl-fill"
                          style={{ width: `${(cl.usd / max) * 100}%`, background: clusterPaint(cl.price, spot ?? 0) }}
                        />
                      </span>
                      <span className="at-cl-usd">${Math.round(cl.usd / 1e6)}M</span>
                    </div>
                  );
                })
              : <div className="at-empty">No clusters in range</div>}
          </section>

          <section className="at-panel">
            <PanelHead title="Why" rail />
            <p className="at-why">{why ?? 'No read has been generated for this instrument yet.'}</p>
          </section>

          {evidencePanel}

          <section className="at-panel">
            <PanelHead title="Session history" count={history?.length ? `${history.length}` : undefined} rail />
            {history?.length
              ? history.map((h, i) => (
                  <div key={`${h.time}-${i}`} className="at-hrow">
                    <span className="at-h-time">{h.time}</span>
                    <span className="at-h-verdict">{h.verdict}</span>
                    <span className="at-h-conf">{h.conf ?? DASH}</span>
                  </div>
                ))
              : <div className="at-empty">Nothing this session</div>}
          </section>

          {/* Flex spacer, per the spec's rail order. */}
          <div className="at-rail-spacer" />
        </aside>
      </div>

      {/* authLoading is read so the call site's guard shape stays visible here;
          the panels themselves arrive already-guarded as props. */}
      <span hidden data-entitled={entitled ? '1' : '0'} data-auth-loading={authLoading ? '1' : '0'} />
    </div>
  );
}
