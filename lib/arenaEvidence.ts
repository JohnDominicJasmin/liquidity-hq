/* Arena's evidence grid — the eight signals and, crucially, which of them are
 * allowed to carry colour (#413, frame 1a).
 *
 * WHY THIS IS A LIBRARY AND NOT JSX.
 *
 * The design encodes the colour rule as DATA, not as styling. Each row in the
 * prototype carries a `fire` field:
 *
 *     { label: 'Funding 8h', value: '+0.0132%', note: 'crowded long', fire: 'red'   }
 *     { label: 'OI 1h',      value: '+2.31%',   note: 'new positions', fire: null   }
 *
 * Eight rows, exactly two firing, and the frame's own header says so:
 * "2 FIRING · 6 NEUTRAL". README:47 states the rule in prose - green and red
 * appear ONLY where a signal is firing - and adds that the prototypes ship a
 * `signalColorOnly` prop, default true, so you can see the difference.
 *
 * The trap this file exists to close: SIX OF THE EIGHT VALUES ARE POSITIVE
 * NUMBERS. Rendering `+2.31%` in green and `-0.34%` in red is the reflex, it
 * looks richer, and it is wrong. Worse, it is invisible to a colour audit -
 * --green and --red are legal tokens, so a fully-coloured grid passes a
 * conformance check cleanly. That is the same shape as the /disclaimer miss:
 * correct colours, wrong page.
 *
 * So `fire` is decided here, once, in code that can be tested, rather than at
 * eight call sites in a component where the next person adds a ninth row and
 * colours it because the value happened to be negative.
 *
 * VALUES ARE OURS, SHAPE IS THEIRS. The owner's rule for the whole redesign:
 *
 *   "i know we cannot display all data in design but we can fill it with other
 *    data or numbers"
 *
 * So the eight rows, their order and their firing rule are binding; the mock
 * figures (115,284.50, +0.0132%) are not. Seven of the eight map onto fields
 * this codebase already carries. None of them are invented here - a signal with
 * no data returns null and renders as an em dash, the same way the rest of the
 * app treats a missing feed.
 */

import type { CoinData } from './marketStore';

export type Fire = 'green' | 'red' | null;

export interface EvidenceRow {
  /** Micro-label, rendered uppercase at 10px mono. */
  label: string;
  /** Formatted value, or null when the feed has not supplied one. */
  value: string | null;
  /** Right-aligned note in --txt3. */
  note: string | null;
  /** null means render in --txt, NOT in a signed colour. See the header. */
  fire: Fire;
}

/* Thresholds. Each is the point at which the signal is saying something rather
 * than sitting in its normal range - which is what "firing" means here.
 *
 * These are deliberately not tuned to make two rows fire so the grid matches
 * the prototype's screenshot. The prototype shows ONE market at ONE moment;
 * copying its 2-of-8 outcome as a target would be fitting the code to a mock. */
export const FIRING = {
  /** 8h funding. 0.01% is the venue-neutral baseline; 3x that is crowded. */
  fundingAbs:   0.0003,
  /** Taker buy share. Outside 40-60% one side is clearly the aggressor. */
  takerLow:     0.40,
  takerHigh:    0.60,
  /** Price vs VWAP, as a fraction. Half a percent is a real stretch intraday. */
  vwapAbs:      0.005,
  /** Perp-vs-spot basis. */
  basisAbs:     0.002,
  /** Net liquidation imbalance as a share of the window's total. */
  liqSkew:      0.65,
} as const;

const pct  = (n: number, dp = 2) => `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(dp)}%`;
const usdM = (n: number) => `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;

/** `−` is U+2212, matching the minus sign the prototype's figures use. */
export function signedPct(n: number, dp = 2): string { return pct(n, dp); }

export interface EvidenceInputs {
  coin: CoinData | null | undefined;
  /** Spot price for the same instrument, when we have one, for basis. */
  spotPrice?: number | null;
  /** Coinbase premium as a fraction, when a source supplies it. */
  cbPremium?: number | null;
  /** Open interest change over 1h, as a fraction. */
  oiChange1h?: number | null;
}

/**
 * The eight rows, in the frame's order.
 *
 * Always returns exactly 8 - a missing feed produces a row with a null value,
 * never a shorter grid. The layout is a fixed 4x2 and a hole in it should read
 * as "we do not have this right now", which is honest, rather than reflowing
 * the grid into something the design never specifies.
 */
export function buildEvidence(input: EvidenceInputs): EvidenceRow[] {
  const c = input.coin ?? null;

  /* 1. Funding 8h. Positive funding is longs PAYING shorts, so a high positive
        rate is a crowded long book - adverse, hence red rather than green.
        Same polarity the funding screen uses (README:131). */
  const fr = c?.fundingRate ?? null;
  const funding: EvidenceRow = {
    label: 'Funding 8h',
    value: fr === null ? null : pct(fr, 4),
    note:  fr === null ? null : fr > 0 ? 'crowded long' : fr < 0 ? 'crowded short' : 'balanced',
    fire:  fr !== null && Math.abs(fr) >= FIRING.fundingAbs ? (fr > 0 ? 'red' : 'green') : null,
  };

  /* 2. CVD 4h. cvdDivergence is already 'bullish' | 'bearish' | null in this
        codebase - the design's `fire` field and our existing model are the same
        idea, arrived at independently. Nothing to translate. */
  const div = c?.cvdDivergence ?? null;
  const cvd: EvidenceRow = {
    label: 'CVD 4h',
    value: div === 'bullish' ? 'Bull div' : div === 'bearish' ? 'Bear div' : c?.cvd == null ? null : 'In line',
    note:  div === 'bullish' ? 'smart buyers' : div === 'bearish' ? 'smart sellers' : c?.cvd == null ? null : 'no divergence',
    fire:  div === 'bullish' ? 'green' : div === 'bearish' ? 'red' : null,
  };

  /* 3. OI 1h. oiTrend already encodes strength, so "strong" is the firing case
        and "weak" is not - a drift in open interest is not a signal. */
  const trend = c?.oiTrend ?? null;
  const oiCh  = input.oiChange1h ?? null;
  const oi: EvidenceRow = {
    label: 'OI 1h',
    value: oiCh === null ? (trend ? trend.replace('_', ' ') : null) : pct(oiCh),
    note:  trend === null ? null
         : trend.endsWith('up') ? 'new positions' : 'positions closing',
    fire:  trend === 'strong_up' ? 'green' : trend === 'strong_down' ? 'red' : null,
  };

  /* 4. VWAP, as distance from it rather than the level itself - the frame's
        value is a percentage, not a price. */
  const vw = c?.vwap ?? null;
  const px = c?.price ?? null;
  const vwapDist = vw && px ? (px - vw) / vw : null;
  const vwap: EvidenceRow = {
    label: 'VWAP',
    value: vwapDist === null ? null : pct(vwapDist),
    note:  vwapDist === null ? null : vwapDist >= 0 ? 'above session' : 'below session',
    fire:  vwapDist !== null && Math.abs(vwapDist) >= FIRING.vwapAbs
             ? (vwapDist > 0 ? 'green' : 'red') : null,
  };

  /* 5. Coinbase premium. THE ONE ROW WE MAY NOT HAVE A SOURCE FOR. It renders
        as an em dash rather than being dropped or filled with a stand-in -
        the owner's rule allows substituting real data of the same kind, not
        inventing a figure. */
  const cb = input.cbPremium ?? null;
  const cbPrem: EvidenceRow = {
    label: 'CB prem',
    value: cb === null ? null : pct(cb, 3),
    note:  cb === null ? null : cb > 0 ? 'spot bid' : 'spot offered',
    fire:  null,
  };

  /* 6. Taker buy. Share of aggressive volume, so it is a 0-1 ratio and the
        neutral band sits around a half. */
  const tb = c?.takerBuyRatio ?? null;
  const taker: EvidenceRow = {
    label: 'Taker buy',
    value: tb === null ? null : `${Math.round(tb * 100)}%`,
    note:  tb === null ? null : tb >= 0.5 ? 'buyers lead' : 'sellers lead',
    fire:  tb === null ? null
         : tb >= FIRING.takerHigh ? 'green'
         : tb <= FIRING.takerLow  ? 'red' : null,
  };

  /* 7. Basis - perp against spot. Derived rather than stored. */
  const perp = c?.perpPrice ?? null;
  const spot = input.spotPrice ?? null;
  const basisVal = perp && spot ? (perp - spot) / spot : null;
  const basis: EvidenceRow = {
    label: 'Basis',
    value: basisVal === null ? null : pct(basisVal),
    note:  basisVal === null ? null : basisVal >= 0 ? 'perps rich' : 'perps cheap',
    fire:  basisVal !== null && Math.abs(basisVal) >= FIRING.basisAbs
             ? (basisVal > 0 ? 'red' : 'green') : null,
  };

  /* 8. Liquidations. The same liqLongUsd/liqShortUsd pair the owner approved
        for /disclaimer's risk row, and the same honesty applies: the window is
        15 minutes of Binance perps, so the note says which side, not "24h".
        Labelling it 24h because the prototype does would be inventing a number. */
  const lL = c?.liqLongUsd ?? null;
  const lS = c?.liqShortUsd ?? null;
  const total = lL !== null && lS !== null ? lL + lS : null;
  const longShare = total && total > 0 ? lL! / total : null;
  const liq: EvidenceRow = {
    /* The frame labels this row "Liq 24h". Ours is a 15-minute Binance perps
       window, so it says 15m. Copying the design's "24h" onto a 15m number is
       exactly the invented figure the owner's rule forbids - and it is the same
       correction already made on /disclaimer's risk row.
       Short label is not cosmetic either: the micro-label column is 78px in the
       frame, and "Liquidations" nearly fills it at 10px/.14em. */
    label: 'Liq 15m',
    value: total === null ? null : total === 0 ? 'None' : usdM(total),
    /* total === 0 is checked BEFORE longShare, because an empty window makes
       longShare null and would otherwise fall through to "no data" - which is
       a different and wrong statement. Nothing liquidated is a measurement. */
    note:  total === 0 ? 'quiet window'
         : longShare === null ? null
         : `${Math.round(longShare * 100)}% longs`,
    fire:  longShare === null || total === 0 ? null
         : longShare >= FIRING.liqSkew ? 'red'
         : longShare <= 1 - FIRING.liqSkew ? 'green' : null,
  };

  return [funding, cvd, oi, vwap, cbPrem, taker, basis, liq];
}

/** "2 FIRING · 6 NEUTRAL" — the frame's own header, computed rather than typed. */
export function firingCount(rows: EvidenceRow[]): { firing: number; neutral: number } {
  const firing = rows.filter(r => r.fire !== null).length;
  return { firing, neutral: rows.length - firing };
}

/**
 * The rows mobile shows.
 *
 * Frame 1a mobile lists only the firing signals and its header reads
 * "2 FIRING" where desktop reads "2 FIRING · 6 NEUTRAL" - a DIFFERENT label,
 * which is what makes this a deliberate filter rather than the frame running
 * out of height. README:21 warns that truncated row counts in the prototypes
 * are an artefact of fixed-height frames; the changed header is the evidence
 * that this one is not.
 *
 * Falls back to the full set when nothing is firing, because a heading that
 * says "0 FIRING" above an empty box is a worse answer than showing the data.
 */
export function mobileEvidence(rows: EvidenceRow[]): EvidenceRow[] {
  const firing = rows.filter(r => r.fire !== null);
  return firing.length > 0 ? firing : rows;
}
