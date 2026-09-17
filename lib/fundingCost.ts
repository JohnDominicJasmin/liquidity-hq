// Pure calculation for the Funding Cost calculator, extracted from
// components/FundingCostCalc.tsx so QA's unit tests can import it directly -
// a .tsx file with JSX can't be `import`ed by `node --test`. No behavior
// change from the extraction.

export interface FundingCostResult {
  totalCost:    number;
  costPerDay:   number;
  costPerWeek:  number;
  annualRate:   number;
  payments:     number;
  breakeven:    number;
}

export function calcFundingCost(posSize: number, fundingRate: number, hours: number): FundingCostResult | null {
  if (posSize <= 0 || fundingRate === 0 || hours <= 0) return null;
  const payments   = hours / 8;
  const rate       = fundingRate / 100;
  const totalCost  = posSize * rate * payments;
  const costPerDay = posSize * rate * 3;
  const costPerWeek = posSize * rate * 21;
  const annualRate = rate * 3 * 365 * 100;
  const breakeven  = Math.abs(totalCost);
  return { totalCost, costPerDay, costPerWeek, annualRate, payments, breakeven };
}

// #1309 item 15: longs pay shorts when the rate is positive, and shorts pay
// longs when it's negative - a short in a positive-rate market receives, not
// pays. Extracted from components/FundingCostCalc.tsx so QA can test all
// four side x sign cases directly; no behavior change.
export function isFundingPaying(side: 'long' | 'short', rate: number): boolean {
  return side === 'long' ? rate > 0 : rate < 0;
}

// The calculator only warns on an unsustainably high rate the user is
// actually PAYING - a high rate the user is receiving is a windfall, not a
// warning. Threshold matches the calculator's own copy (CALC_FUNDING_WARN_HIGH_RATE).
export function isHighFundingRateWarning(annualRate: number, isPaying: boolean): boolean {
  return Math.abs(annualRate) > 50 && isPaying;
}
