// Pure calculation for the Position Sizer calculator, extracted from
// components/PositionSizer.tsx so QA's unit tests can import it directly -
// a .tsx file with JSX can't be `import`ed by `node --test`. No behavior
// change from the extraction.

export interface PositionSizeResult {
  riskUSD:      number;
  posUSD:       number;
  posUnits:     number;
  leverage:     number;
  stopDist:     number;
  stopPct:      number;
  isLong:       boolean;
  rrRatio:      number | null;
  potentialPnL: number | null;
  tpOnWrongSide: boolean;
}

export function calcPositionSize(acc: number, riskPct: number, entry: number, stop: number, tp: number | null): PositionSizeResult | null {
  if (acc <= 0 || riskPct <= 0 || entry <= 0 || stop <= 0 || entry === stop) return null;
  const riskUSD  = acc * (riskPct / 100);
  const stopDist = Math.abs(entry - stop);
  const stopPct  = (stopDist / entry) * 100;
  const posUnits = riskUSD / stopDist;
  const posUSD   = posUnits * entry;
  const leverage = posUSD / acc;
  const isLong   = entry > stop;

  let rrRatio: number | null = null;
  let potentialPnL: number | null = null;
  let tpOnWrongSide = false;
  if (tp && tp > 0 && tp !== entry) {
    // A TP is only a profit target if it sits beyond entry in the trade's
    // own direction (above entry when long, below when short). #1309 item 15
    // found this scored ANY tp!==entry as reward via Math.abs(tp - entry),
    // so a TP on the stop side of entry still produced a positive R:R and a
    // "potential profit" figure for what is actually a loss.
    if (isLong ? tp > entry : tp < entry) {
      const tpDist = Math.abs(tp - entry);
      rrRatio      = tpDist / stopDist;
      potentialPnL = riskUSD * rrRatio;
    } else {
      tpOnWrongSide = true;
    }
  }

  return { riskUSD, posUSD, posUnits, leverage, stopDist, stopPct, isLong, rrRatio, potentialPnL, tpOnWrongSide };
}
