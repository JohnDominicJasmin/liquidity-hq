// Pure calculation for the Risk/Reward calculator, extracted from
// components/RiskRewardCalc.tsx so QA's unit tests can import it directly -
// a .tsx file with JSX can't be `import`ed by `node --test`. No behavior
// change from the extraction.

export interface RRResult {
  isLong:       boolean;
  slDist:       number;
  slPct:        number;
  tpDist:       number;
  tpPct:        number;
  rr:           number;
  ev:           number;
  breakevenWR:  number;
  tpOnWrongSide: boolean;
}

export function calcRiskReward(entry: number, sl: number, tp: number, wr: number): RRResult | null {
  if (entry <= 0 || sl <= 0 || tp <= 0 || sl === entry || tp === entry) return null;
  const isLong = entry > sl;
  // #1309 item 15: a TP is only a real profit target when it sits beyond
  // entry in the trade's own direction. This used Math.abs(tp - entry)
  // unconditionally, so a TP placed on the STOP side of entry (a loss, not
  // a target) still produced a positive tpDist and was scored as reward -
  // a positive R:R and expected value for what is actually a losing setup.
  const tpOnWrongSide = isLong ? tp <= entry : tp >= entry;
  const slDist = Math.abs(entry - sl);
  const tpDist = Math.abs(tp - entry);
  const slPct  = (slDist / entry) * 100;
  const tpPct  = (tpDist / entry) * 100;
  const rr     = tpDist / slDist;
  const w      = wr / 100;
  const ev     = w * tpDist - (1 - w) * slDist;
  const breakevenWR = (1 / (1 + rr)) * 100;
  return { isLong, slDist, slPct, tpDist, tpPct, rr, ev, breakevenWR, tpOnWrongSide };
}
