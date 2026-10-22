/* Mutation check for __tests__/cancelSubscription.test.mts (#1396 / PR #1435), REVISED for fcdc62ce.
 * Each mutation reintroduces a defect; the named tests MUST go red. An anchor that does not occur EXACTLY
 * once is SKIPPED, never silently passed. The one `todo` (S6) is not counted red; baseline checks its count. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const LIB = 'lib/lemonsqueezyApi.ts';
const CANCEL = 'app/api/lemonsqueezy/cancel/route.ts';
const SUB = 'app/api/subscription/route.ts';
const PANEL = 'lib/subscriptionPanel.ts';
const PAGE = 'app/settings/page.tsx';
const TEST = '__tests__/cancelSubscription.test.mts';

const M = [
  { name: 'A1 a non-2xx is no longer refused', f: LIB, from: 'if (!res.ok) {', to: 'if (false) {', red: ['L9.', 'P8.'] },
  { name: 'A2 the "cancelled" status check is removed', f: LIB, from: "if (lsStatus !== 'cancelled') {", to: 'if (false) {', red: ['L7.', 'L7b.', 'L8.', 'P9.'] },
  { name: 'A3 an unreadable 2xx body counts as success', f: LIB, from: "return { ok: false, reason: 'ok_status_unparsable_body'", to: "return { ok: true, reason: 'ok_status_unparsable_body'", red: ['L8.', 'P9.'] },
  { name: 'A4 the id is not URL-encoded', f: LIB, from: '${encodeURIComponent(subscriptionId)}', to: '${subscriptionId}', red: ['L4.'] },
  { name: 'A5 GET instead of DELETE', f: LIB, from: "method: 'DELETE',", to: "method: 'GET',", red: ['L3.'] },
  { name: 'A6 the key is not sent', f: LIB, from: 'Authorization: `Bearer ${key}`,', to: "Authorization: 'Bearer none',", red: ['L3.'] },
  { name: 'A7 Bearer redaction removed', f: LIB, from: ".replace(/(Bearer\\s+)[A-Za-z0-9._-]+/gi, '$1[redacted]')", to: '', red: ['L11.', 'P8.'] },
  { name: 'A8 JWT redaction removed', f: LIB, from: ".replace(/\\beyJ[A-Za-z0-9._-]{10,}/g, '[redacted-jwt]')", to: '', red: ['L11.', 'L12.', 'L16.', 'P8.', 'P17.'] },
  { name: 'A9 no length cap on the captured body', f: LIB, from: '.slice(0, 600);', to: ';', red: ['L13.'] },
  { name: 'A10 the unset-key guard removed', f: LIB, from: 'if (!key) {', to: 'if (false) {', red: ['L1.'] },
  { name: 'A11 the empty-id guard removed', f: LIB, from: 'if (!subscriptionId) {', to: 'if (false) {', red: ['L2.'] },
  { name: 'A12 a non-string ends_at is passed on', f: LIB, from: "if (attrs && typeof attrs.ends_at === 'string') endsAt = attrs.ends_at;", to: 'if (attrs) endsAt = attrs.ends_at as string;', red: ['L6.'] },
  { name: 'A13 the outbound call carries no abort signal', f: LIB, from: 'signal: ctl.signal,', to: '', red: ['L17.'] },
  { name: 'A14 the timeout is 1 s, not 10 s', f: LIB, from: 'const LS_TIMEOUT_MS = 10_000;', to: 'const LS_TIMEOUT_MS = 1_000;', red: ['L17.'] },
  { name: 'A15 the success body is not kept for the capture', f: LIB, from: "return { ok: true, reason: 'cancelled', status: res.status, lsStatus, endsAt, bodyRedacted };", to: "return { ok: true, reason: 'cancelled', status: res.status, lsStatus, endsAt, bodyRedacted: '' };", red: ['L5.', 'L16.'] },
  { name: 'A16 the upstream body rides in `reason` again', f: LIB, from: 'reason: `ls_status_${res.status}`,', to: 'reason: `ls_status_${res.status}:${bodyRedacted}`,', red: ['L9.'] },
  { name: 'B1 the subscription id may come from the query string', f: CANCEL, from: "const subId = stored?.ls_subscription_id ?? '';", to: "const subId = new URL(req.url).searchParams.get('subscriptionId') ?? stored?.ls_subscription_id ?? '';", red: ['P4.'] },
  { name: 'B2 authentication is skipped', f: CANCEL, from: "if (!userId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });", to: 'if (false) return NextResponse.json({});', red: ['P1.', 'P2.'] },
  { name: 'B3 the unavailable guard is removed', f: CANCEL, from: 'if (!isLsApiConfigured()) {', to: 'if (false) {', red: ['P3.'] },
  { name: 'B4 the already-cancelled guard is removed', f: CANCEL, from: "if (stored?.ls_status === 'cancelled') {", to: 'if (false) {', red: ['P7.'] },
  { name: 'B5 the no-subscription guard is removed', f: CANCEL, from: 'if (!subId) {', to: 'if (false) {', red: ['P6.'] },
  { name: 'B6 the route writes the row on success', f: CANCEL, from: 'return NextResponse.json({ ok: true, endsAt: result.endsAt });', to: "await getSupabaseAdmin().from(T.user_subscriptions).update({ ls_status: 'cancelled' }).eq('user_id', userId); return NextResponse.json({ ok: true, endsAt: result.endsAt });", red: ['P11.'] },
  { name: 'B7 the client gets the upstream reason', f: CANCEL, from: "return NextResponse.json({ ok: false, error: 'Cancel failed' }, { status: 502 });", to: 'return NextResponse.json({ ok: false, error: result.reason }, { status: 502 });', red: ['P8.'] },
  { name: 'B8 a failed row read no longer stops the cancel path', f: CANCEL, from: 'if (error) {', to: 'if (false) {', red: ['P13.'] },
  { name: 'B9 the API key is written to the failure log', f: CANCEL, from: 'http=${result.status} body=${result.bodyRedacted}`', to: 'http=${result.status} body=${result.bodyRedacted} key=${process.env.LEMONSQUEEZY_API_KEY}`', red: ['P8.'] },
  { name: 'B10 the user id may come from the query string', f: CANCEL, from: ".eq('user_id', userId)", to: ".eq('user_id', new URL(req.url).searchParams.get('user_id') ?? userId)", red: ['P4.'] },
  { name: 'B11 the role guard is removed (the review\'s D1 returns)', f: CANCEL, from: "if (stored?.role !== 'pro') {", to: 'if (false) {', red: ['P5.', 'P15.', 'P16.'] },
  { name: 'B12 the success log line is removed', f: CANCEL, from: 'console.log(', to: 'void (', red: ['P17.'] },
  { name: 'B13 the API key is written to the SUCCESS log', f: CANCEL, from: "body=${result.bodyRedacted}`,\n  );", to: "body=${result.bodyRedacted} ${process.env.LEMONSQUEEZY_API_KEY}`,\n  );", red: ['P17.'] },
  { name: 'C1 canCancel ignores whether the server can call Lemon Squeezy', f: SUB, from: ' && isLsApiConfigured();', to: ';', red: ['G2.', 'P16.'] },
  { name: 'C2 canCancel ignores the role', f: SUB, from: "const canCancel = role === 'pro' && hasSubscription", to: 'const canCancel = hasSubscription', red: ['G2.', 'P16.'] },
  { name: 'C3 canCancel ignores an already-cancelled status', f: SUB, from: " && lsStatus !== 'cancelled'", to: '', red: ['G2.', 'P16.'] },
  { name: 'C4 the subscription id is returned to the browser', f: SUB, from: 'return NextResponse.json({ role, lsStatus, currentPeriodEnd, hasSubscription, canCancel });', to: 'return NextResponse.json({ role, lsStatus, currentPeriodEnd, hasSubscription, canCancel, subscriptionId: data?.ls_subscription_id });', red: ['G3.'] },
  { name: 'C5 the row is read for the wrong user', f: SUB, from: ".eq('user_id', userId)", to: ".eq('user_id', 'someone-else')", red: ['G2.', 'G4.'] },
  { name: 'C6 a failed read is answered 200', f: SUB, from: 'if (error) {', to: 'if (false) {', red: ['G5.'] },
  { name: 'C7 authentication is skipped', f: SUB, from: "if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });", to: 'if (false) return NextResponse.json({});', red: ['G1.'] },
  { name: 'S-A the panel checks no role: a free user is shown a plan again', f: PANEL, from: "if (sub.role !== 'pro') return { kind: 'hidden' };", to: '', red: ['S1.', 'S2.'] },
  { name: 'S-B a date equal to now counts as future', f: PANEL, from: 'return Number.isFinite(t) && t > nowMs ? iso : null;', to: 'return Number.isFinite(t) && t >= nowMs ? iso : null;', red: ['S1.', 'S3.'] },
  { name: 'S-C the cancelled view passes any date through', f: PANEL, from: 'untilDate: futureDateOrNull(sub.currentPeriodEnd, nowMs)', to: 'untilDate: sub.currentPeriodEnd', red: ['S1.'] },
  { name: 'S-D "managed" is never chosen', f: PANEL, from: "if (!sub.hasSubscription) return { kind: 'managed' };", to: '', red: ['S1.'] },
  { name: 'S-E Cancel is offered whether or not the server can call Lemon Squeezy', f: PANEL, from: "if (sub.canCancel) return { kind: 'cancellable' };", to: "return { kind: 'cancellable' };", red: ['S1.'] },
  { name: 'S-F the page stops calling the pure function', f: PAGE, from: ': subscriptionPanelView(sub);', to: ": ({ kind: 'active' } as SubPanelView);", red: ['S5.'] },
];

const revert = () => execFileSync('git', ['-C', ROOT, 'checkout', '--', LIB, CANCEL, SUB, PANEL, PAGE], { windowsHide: true });
const keyOf = (n) => n.split(' ')[0];
const run = () => {
  let out = '', code = 0;
  try { out = execFileSync('node', ['--import', './qa/alias-register.mjs', '--test', TEST], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 180_000 }); }
  catch (e) { out = (e.stdout ?? '') + (e.stderr ?? ''); code = e.status ?? 1; }
  const failed = [...new Set([...out.matchAll(/^\u2716 (.+?) \(/gm)].map((x) => keyOf(x[1])))].filter((k) => !k.includes('__tests__') && k !== 'failing');
  const todoN = Number((out.match(/^ℹ todo (\d+)/m) ?? [])[1]);
  return { code, failed, todoN, out };
};

revert();
const base = run();
const baseOk = base.code === 0 && base.failed.length === 0 && base.todoN === 1;
console.log(`BASELINE ${baseOk ? 'OK' : 'WRONG'}  exit ${base.code}  red: ${base.failed.join(', ') || '(none)'}  todo: ${base.todoN} (want 0 red, 1 todo)`);
if (!baseOk) process.exit(2);

let all = true;
for (const m of M) {
  const src = readFileSync(`${ROOT}/${m.f}`, 'utf8').split('\r\n').join('\n');
  const n = src.split(m.from).length - 1;
  if (n !== 1) { console.log(`SKIP    ${m.name}\n        anchor occurs ${n}x`); all = false; continue; }
  writeFileSync(`${ROOT}/${m.f}`, src.replace(m.from, () => m.to));
  const r = run();
  revert();
  const missing = m.red.filter((k) => !r.failed.includes(k));
  const good = r.code !== 0 && missing.length === 0;
  if (!good) all = false;
  console.log(`${good ? 'OK    ' : 'WRONG '}  ${m.name}\n        want red: ${m.red.join(', ')} | actually red: ${r.failed.length ? r.failed.join(', ') : '(none - suite stayed GREEN)'}${missing.length ? ` | NOT CAUGHT: ${missing.join(', ')}` : ''}`);
}
revert();
console.log(all ? '\nAll mutations behaved as designed.' : '\nA MUTATION DID NOT BEHAVE AS DESIGNED.');
