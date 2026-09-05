import type { LabelKey } from '@/lib/labelKeys';

/* The label keys the health grade can resolve to. Six, not five: grade F is
   reached both by measuring and finding nothing worth trading, and by having
   no data to measure at all. Same letter, different meaning, and the
   accessible name is the only place a user is told which.

   This vocabulary lives here rather than in marketStore because marketStore
   cannot be imported by a unit test - `npm test` is bare `node --test` with
   no TS loader, and marketStore's extensionless imports do not resolve under
   it. Putting the mapping in a dependency-free module is what makes the
   no-data branch testable at all rather than only reasoned about. */
export type HealthLabelKey =
  | 'COIN_HEALTH_GRADE_A' | 'COIN_HEALTH_GRADE_B' | 'COIN_HEALTH_GRADE_C'
  | 'COIN_HEALTH_GRADE_D' | 'COIN_HEALTH_GRADE_F' | 'COIN_HEALTH_NO_DATA';

/** `hasData: false` is the not-measured case, which is grade F for a different
 *  reason than a measured F. See the type's note above. */
export function healthLabelKey(
  grade: 'A' | 'B' | 'C' | 'D' | 'F',
  hasData: boolean,
): HealthLabelKey {
  if (!hasData) return 'COIN_HEALTH_NO_DATA';
  return `COIN_HEALTH_GRADE_${grade}`;
}

/* Accessible name for the coin health-grade badge (#874).
 *
 * WHY THIS EXISTS AT ALL, since "a span with text F" looks like it should
 * already be announced: it is not. Measured on /dashboard in Chrome, the
 * badge was absent from the accessibility tree entirely - the coin rail
 * exposed icon, symbol, price, change and blurb per coin, and nothing for
 * the grade. Three variants were tried live against the real page:
 *
 *   role="img" + aria-label   ->  img "Health grade D, Weak signal"   named
 *   aria-label, no role       ->  generic "Health grade C, ..."       named
 *   role="text", content only ->  text, NO NAME                       unnamed
 *
 * The third is the diagnosis: the element's text content never becomes its
 * accessible name here, so no role change alone fixes it - a name has to be
 * supplied. Both of the first two worked in Chrome, and this uses role="img"
 * because `aria-label` on a bare generic is prohibited by ARIA 1.2 and is
 * honoured inconsistently across assistive tech; giving it a role that
 * supports naming is what makes the label legal rather than lucky.
 *
 * WHY A LABEL AND VISIBLE CONTENT BOTH EXIST, for whoever reads this next
 * and wonders whether one is redundant: accessible name resolves
 * aria-labelledby, then aria-label, then content. `aria-label` wins over the
 * content, so the letter is announced as "Health grade D, Weak signal"
 * rather than "D" - and never both. The visible letter is for sighted users,
 * the label is the same information spelled out. #846 produced three false
 * findings from getting that precedence backwards, so it is written down.
 *
 * The letter alone would be a poor name even once exposed. "F" tells a
 * screen reader user nothing; the grade's meaning is the point.
 */
export function healthGradeA11y(
  grade: 'A' | 'B' | 'C' | 'D' | 'F',
  labelKey: HealthLabelKey,
  t: (key: LabelKey, vars?: Record<string, string | number>) => string,
): { role: 'img'; 'aria-label': string } {
  return {
    role: 'img',
    'aria-label': t('COIN_HEALTH_GRADE_ARIA', { grade, label: t(labelKey) }),
  };
}
