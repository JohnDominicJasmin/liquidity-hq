import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* #2675 (#1651, QA run 44561991536): A PRO ACCOUNT MUST NEVER SEE A LOCKED "With Pro" CARD WHILE ITS PLAN IS STILL LOADING. `entitlementStatus` reads 'not_entitled' while a signed-in user's subscription row loads, so the cards locked on `!authLoading && entitlementStatus !== 'entitled'` flashed the upsell (0.3-0.8 s on first visit). Written rule (PR + PM): the plan is "resolving" while `authLoading || (signed in && entitlementsLoading)`; while resolving no card is locked (a skeleton shows); a card is locked only for a CONFIRMED plan: signed out, or signed in with entitlements loaded and not entitled; a Pro (entitled) account is never locked; the settings default-timeframe chips follow the same rule (not drawn locked, disabled without the lock icon, and a Pro-only saved value is not shown selected while resolving).
 * The REAL expressions are cut out of each component and run on the full truth table (authLoading x signed in x entitlementsLoading x status), so a future change that re-opens the flash goes red whichever component it is in.
 *   L1 DryPowder   L2 OnChainScore   L3 MultiTFAlignment   L4 Settings default timeframe   L5 the shared definition is identical everywhere and the sweep list stays covered */
const src = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const STATUS = ['entitled', 'not_entitled', 'unknown'] as const;
type In = { authLoading: boolean; user: object | null; entitlementsLoading: boolean; entitlementStatus: string };
const TABLE: In[] = []; for (const authLoading of [true, false]) for (const user of [null, {}]) for (const entitlementsLoading of [true, false]) for (const entitlementStatus of STATUS) TABLE.push({ authLoading, user, entitlementsLoading, entitlementStatus });
const evalExpr = (expr: string, v: Record<string, unknown>) => new Function(...Object.keys(v), `return (${expr});`)(...Object.values(v));
const planOf = (i: In) => i.authLoading || (!!i.user && i.entitlementsLoading);   /* the written definition */
const lockedWritten = (i: In) => !planOf(i) && i.entitlementStatus !== 'entitled';   /* the written rule for a card that locks on a not-entitled plan */
const must = (s: string, re: RegExp, what: string) => { const m = re.exec(s); assert.ok(m, `CONTROL: ${what} not found`); return m![1]; };

test('L1. DryPowder: locked only for a confirmed plan; never while resolving; a Pro account never', () => {
  const s = src('components/DryPowder.tsx');
  const def = must(s, /const planResolving = (.+?);\n/, 'DryPowder planResolving'); const cond = must(s, /\) : (\(!planResolving && entitlementStatus !== 'entitled'\) \|\| state === 'locked') \? \(/, 'DryPowder locked condition');
  for (const i of TABLE) {
    const planResolving = evalExpr(def, i) as boolean; assert.equal(planResolving, planOf(i), `planResolving wrong for ${JSON.stringify(i)}`);
    const locked = evalExpr(cond, { ...i, planResolving, state: 'ready' }) as boolean; assert.equal(locked, lockedWritten(i), `DryPowder lock wrong for ${JSON.stringify(i)}`);
    if (i.entitlementStatus === 'entitled') assert.equal(locked, false, 'a Pro account is never locked');
    if (planResolving) assert.equal(locked, false, 'locked while the plan is resolving (the flash)');
  }
  assert.equal(evalExpr(cond, { planResolving: false, entitlementStatus: 'entitled', state: 'locked' }), true, 'a server-side locked state still locks');
});
test('L2. OnChainScore: while resolving a skeleton shows (never the locked card); then locked only when not entitled', () => {
  const s = src('components/OnChainScore.tsx'); const def = must(s, /const planResolving = (.+?);\n/, 'OnChainScore planResolving');
  const at = s.indexOf(') : planResolving ? ('); assert.ok(at > 0, 'CONTROL: the planResolving branch is gone'); const lockAt = s.indexOf(') : entitlementStatus !== \'entitled\' ? (', at); assert.ok(lockAt > at, 'the locked branch must come AFTER the planResolving branch (order decides which one shows)');
  assert.match(s.slice(at, lockAt), /SkeletonBar/, 'the resolving branch no longer shows a skeleton'); assert.equal(s.slice(at, lockAt).includes('LockedFeatureCard'), false, 'the resolving branch renders the locked card');
  for (const i of TABLE) assert.equal(evalExpr(def, i), planOf(i), `OnChainScore planResolving wrong for ${JSON.stringify(i)}`);
});
test('L3. MultiTFAlignment: a gated timeframe is locked only for a confirmed not-entitled plan', () => {
  const s = src('components/MultiTFAlignment.tsx'); const expr = must(s, /const locked = \(tf: string\) => (.+?);\n/, 'MultiTFAlignment locked');
  for (const i of TABLE) for (const gated of [true, false]) {
    const got = evalExpr(expr, { ...i, tf: '5m', isGatedTf: () => gated }) as boolean; const want = lockedWritten(i) && gated; assert.equal(got, want, `${JSON.stringify(i)} gated=${gated}`);
    if (i.entitlementStatus === 'entitled') assert.equal(got, false); if (!gated) assert.equal(got, false, 'an ungated timeframe is never locked');
  }
});
test('L4. Settings default timeframe: not locked, disabled without a lock, and a Pro-only saved value not shown selected, while the plan resolves', () => {
  const s = src('app/(main)/settings/page.tsx'); const def = must(s, /const planResolving = (.+?);\n/, 'settings planResolving');
  const locked = must(s, /const locked = (.+?);\n/, 'settings locked'); const disabled = must(s, /disabled=\{(locked \|\| \(planResolving && isGatedTf\(tf\)\))\}/, 'settings disabled'); const shown = must(s, /const shownTf = (.+?) return TFS\.map/, 'settings shownTf');
  for (const i of TABLE) for (const gated of [true, false]) {
    const planResolving = evalExpr(def, i) as boolean; assert.equal(planResolving, planOf(i)); const isGatedTf = () => gated;
    const lk = evalExpr(locked, { ...i, planResolving, isGatedTf, tf: '5m' }) as boolean; assert.equal(lk, lockedWritten(i) && gated, `locked: ${JSON.stringify(i)} gated=${gated}`);
    const dis = evalExpr(disabled, { locked: lk, planResolving, isGatedTf, tf: '5m' }) as boolean; assert.equal(dis, lk || (planResolving && gated), 'disabled'); if (planResolving && gated) { assert.equal(lk, false, 'not drawn locked while resolving'); assert.equal(dis, true, 'but not selectable either'); }
    const shownV = evalExpr(shown.replace(/;\s*$/, ''), { ...i, planResolving, isGatedTf, settings: { default_tf: '5m' }, FREE_FALLBACK_TF: '1h' }) as string | null;
    if (gated && planResolving) assert.equal(shownV, null, `a Pro-only saved value must not show selected while resolving: ${JSON.stringify(i)}`); if (gated && !planResolving && i.entitlementStatus === 'not_entitled') assert.equal(shownV, '1h', 'a confirmed Free account sees the fallback'); if (gated && !planResolving && i.entitlementStatus === 'entitled') assert.equal(shownV, '5m', 'a Pro account sees its saved value'); if (!gated) assert.equal(shownV, '5m');
  }
});
test('L5. the definition is the same everywhere, and the cards the PR swept stay on the rule', () => {
  for (const f of ['components/DryPowder.tsx', 'components/OnChainScore.tsx', 'app/(main)/settings/page.tsx']) assert.match(src(f), /const planResolving = authLoading \|\| \(!!user && entitlementsLoading\);/, `${f} defines planResolving differently`);
  assert.match(src('components/MultiTFAlignment.tsx'), /!authLoading && !\(!!user && entitlementsLoading\) && entitlementStatus !== 'entitled' && isGatedTf\(tf\)/);
  for (const f of ['components/DryPowder.tsx', 'components/OnChainScore.tsx', 'components/MultiTFAlignment.tsx', 'app/(main)/settings/page.tsx']) assert.match(src(f), /entitlementsLoading/, `${f} no longer reads entitlementsLoading`);
});
