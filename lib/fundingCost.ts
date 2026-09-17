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
