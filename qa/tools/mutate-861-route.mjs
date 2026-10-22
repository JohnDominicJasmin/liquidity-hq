/* Mutation check for __tests__/boomfiWebhookRoute.test.mts, and the flattened-key cases added to
 * __tests__/boomfiWebhookVerify.test.mts (#861, Dev head 9feedebf). One test file per run. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const RT = 'app/api/boomfi/webhook/route.ts';
const CF = 'lib/configured.ts';
const MG = 'supabase/migrations/20260930a_boomfi_billing.sql';
const BF = 'lib/boomfi.ts';
const T_ROUTE = '__tests__/boomfiWebhookRoute.test.mts';
const T_VERIFY = '__tests__/boomfiWebhookVerify.test.mts';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);

const FINAL = "  return NextResponse.json({ received: true, recorded: true, ignored: 'entitlement_not_implemented' });\n}";

const M = [
  { t: T_ROUTE, name: 'RT1 the signature gate is removed', f: RT,
    from: "  if (!verdict.ok) {\n    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });\n  }\n", to: '', red: ['R5.', 'R6.'] },
  { t: T_ROUTE, name: 'RT2 the 401 says which check failed', f: RT,
    from: "return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });", to: "return NextResponse.json({ error: verdict.reason }, { status: 401 });", red: ['R5.'] },
  { t: T_ROUTE, name: 'RT3 a JSON array is accepted as an event', f: RT,
    from: "if (typeof body !== 'object' || body === null || Array.isArray(body)) {", to: "if (typeof body !== 'object' || body === null) {", red: ['R7.'] },
  { t: T_ROUTE, name: 'RT4 a mismatched organisation gets the same answer as a matching one', f: RT,
    from: "ignored: 'org_mismatch' });", to: "ignored: 'entitlement_not_implemented' });", red: ['R8.', 'R9.'] },
  { t: T_ROUTE, name: 'RT5 the organisation check never fires', f: RT,
    from: 'if (!boomfiOrgMatches(event, ORG_ID)) {', to: 'if (false) {', red: ['R8.', 'R9.'] },
  { t: T_ROUTE, name: 'RT6 the mismatch is answered but not reported', f: RT,
    from: "    apiError('boomfi/webhook', new Error(", to: "    void (new Error(", red: ['R8.'] },
  { t: T_ROUTE, name: 'RT7 the replay key is a hash of the PARSED body, not the raw bytes', f: RT,
    from: ".update(rawBody).digest('hex');", to: ".update(JSON.stringify(event)).digest('hex');", red: ['R1.'] },
  { t: T_ROUTE, name: 'RT8 a duplicate is treated as a failure (500 on every repeat)', f: RT,
    from: "if (recordErr && recordErr.code !== '23505') return apiError('boomfi/webhook', recordErr);", to: "if (recordErr) return apiError('boomfi/webhook', recordErr);", red: ['R2.', 'R9b.'] },
  { t: T_ROUTE, name: 'RT9 a database failure is swallowed and answered "replay"', f: RT,
    from: "  if (recordErr && recordErr.code !== '23505') return apiError('boomfi/webhook', recordErr);\n", to: '', red: ['R10.', 'R11.'] },
  { t: T_ROUTE, name: 'RT10 a repeat is answered as freshly recorded', f: RT,
    from: "  if (!firstSeen) return NextResponse.json({ received: true, ignored: 'replay' });\n", to: '', red: ['R2.'] },
  { t: T_ROUTE, name: 'RT11 the route GRANTS: it writes the subscriptions table', f: RT,
    from: FINAL, to: "  await sb.from(T.user_subscriptions).upsert({ user_id: text(event.customer_ident), role: 'pro' });\n" + FINAL, red: ['R13.', 'R14.'] },
  { t: T_ROUTE, name: 'RT12 a non-string field is coerced into its column', f: RT,
    from: "(typeof v === 'string' && v.length > 0 ? v : null);", to: '(v == null ? null : String(v));', red: ['R4.'] },
  { t: T_ROUTE, name: 'RT13 the database error text is sent to the caller', f: RT,
    from: "return apiError('boomfi/webhook', recordErr);", to: 'return NextResponse.json({ error: recordErr.message }, { status: 500 });', red: ['R10.'] },
  { t: T_ROUTE, name: 'RT14 a failed write is acknowledged with a 200', f: RT,
    from: "return apiError('boomfi/webhook', recordErr);", to: 'return NextResponse.json({ received: true });', red: ['R10.', 'R11.'] },
  { t: T_ROUTE, name: 'RT15 the mismatch report carries the whole body (payer email included)', f: RT,
    from: "      `BOOMFI_ORG_ID=${ORG_ID ? 'set' : 'UNSET'}`,", to: "      `BOOMFI_ORG_ID=${ORG_ID ? 'set' : 'UNSET'} ` + JSON.stringify(event),", red: ['R8.'] },
  { t: T_ROUTE, name: 'RT16 the signature is read from the wrong header', f: RT,
    from: "req.headers.get('x-boomfi-signature')", to: "req.headers.get('x-signature')", red: ['R1.'] },
  { t: T_ROUTE, name: 'RT17 the body column is not the delivery', f: RT,
    from: '      body: event,\n', to: '      body: { event: eventName },\n', red: ['R1.'] },
  { t: T_ROUTE, name: 'RT18 a GET handler is added', f: RT,
    from: FINAL, to: FINAL + "\nexport async function GET() { return NextResponse.json({ ok: true }); }", red: ['R15.'] },
  { t: T_ROUTE, name: 'RT19 the body is parsed by the framework and re-serialised before verification', f: RT,
    from: 'const rawBody = await req.text();', to: 'const rawBody = JSON.stringify(await req.json());', red: ['R1.', 'R14.'] },
  { t: T_ROUTE, name: 'RT20 the report stops quoting the org id that arrived', f: RT,
    from: "org_id=${text(event.org_id) ?? '(absent)'} ", to: '', red: ['R8.'] },
  { t: T_ROUTE, name: 'RT21 the UNSET wording is lost from the report', f: RT,
    from: "`BOOMFI_ORG_ID=${ORG_ID ? 'set' : 'UNSET'}`", to: '`BOOMFI_ORG_ID=set`', red: ['R9.'] },
  { t: T_ROUTE, name: 'CF1 /api/version says the webhook is configured with only the key set', f: CF,
    from: 'boomfiWebhook: set(env.BOOMFI_WEBHOOK_PUBLIC_KEY) && set(env.BOOMFI_ORG_ID),', to: 'boomfiWebhook: set(env.BOOMFI_WEBHOOK_PUBLIC_KEY),', red: ['V1.'] },
  { t: T_ROUTE, name: 'MG1 payload_hash is not a primary key (repeats would be stored twice)', f: MG,
    from: 'create table if not exists lhq_boomfi_webhook_events (\n  payload_hash    text        primary key,', to: 'create table if not exists lhq_boomfi_webhook_events (\n  payload_hash    text,', red: ['G1.'] },
  { t: T_ROUTE, name: 'MG2 row level security is not enabled on the live table', f: MG,
    from: '\nalter table lhq_boomfi_webhook_events enable row level security;\n', to: '\n', red: ['G2.'] },
  { t: T_ROUTE, name: 'MG3 the grants are not revoked on the live table', f: MG,
    from: '\nrevoke all on lhq_boomfi_webhook_events from anon, authenticated;\n', to: '\n', red: ['G2.'] },
  { t: T_ROUTE, name: 'MG4 a new subscriptions column is NOT NULL with a default', f: MG,
    from: "  add column if not exists billing_provider       text,   -- 'boomfi'", to: "  add column if not exists billing_provider       text not null default 'boomfi',   -- 'boomfi'", red: ['G3.'] },
  { t: T_ROUTE, name: 'MG5 a dev statement is live (running the file on prod would create a dev table)', f: MG,
    from: '-- create table if not exists lhq_dev_boomfi_webhook_events (', to: 'create table if not exists lhq_dev_boomfi_webhook_events (', red: ['G4.'] },
  { t: T_ROUTE, name: 'MG6 the dev block drifts from the live block', f: MG,
    from: '--   body            jsonb       not null,', to: '--   body            jsonb,', red: ['G5.'] },
  { t: T_ROUTE, name: 'MG7 a column the route inserts is renamed in the live table', f: MG,
    from: "  resource_status text,                             -- the body's `status`", to: "  status          text,                             -- the body's `status`", red: ['G1.'] },
  { t: T_ROUTE, name: 'MG8 a drop is added to the live block', f: MG,
    from: '\n-- DEV: the same objects under the lhq_dev_ prefix', to: '\ndrop table if exists lhq_ls_webhook_events;\n\n-- DEV: the same objects under the lhq_dev_ prefix', red: ['G3.'] },
  { t: T_ROUTE, name: 'MG9 a read policy is added to the events table', f: MG,
    from: '\nrevoke all on lhq_boomfi_webhook_events from anon, authenticated;\n', to: '\nrevoke all on lhq_boomfi_webhook_events from anon, authenticated;\ncreate policy "read" on lhq_boomfi_webhook_events for select using (true);\n', red: ['G2.'] },
  // ── the key repair (lib/boomfi.ts) ──
  { t: T_VERIFY, name: 'K1 the flattened-PEM repair is removed', f: BF,
    from: '  if (!m) return unescaped;\n', to: '  return unescaped;\n', red: ['B2b.'] },
  { t: T_VERIFY, name: 'K2 the repair re-wraps without stripping the old whitespace', f: BF,
    from: "m[2].replace(/\\s+/g, '').match(", to: 'm[2].match(', red: ['B2b.'] },
  { t: T_VERIFY, name: 'K3 bare Base64 is wrapped into a PEM and accepted', f: BF,
    from: '  if (!m) return unescaped;\n', to: "  if (!m) return unescaped && /^[A-Za-z0-9+/=]+$/.test(unescaped) ? `-----BEGIN PUBLIC KEY-----\\n${unescaped}\\n-----END PUBLIC KEY-----` : unescaped;\n", red: ['B2c.'] },
];

const FILES = [RT, CF, MG, BF];
const revert = () => execFileSync('git', ['-C', ROOT, 'checkout', '--', ...FILES], { windowsHide: true });
const run = (t) => {
  let out = '', code = 0;
  try { out = execFileSync('node', ['--import', './qa/alias-register.mjs', '--test', t], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { out = (e.stdout ?? '') + (e.stderr ?? ''); code = e.status ?? 1; }
  const failed = [...new Set([...out.matchAll(/^\s*\u2716 (\S+)/gm)].map((x) => x[1]))].filter((k) => /^[A-Z]\d+[a-z]?\.$/.test(k));
  const fileLevel = /^\u2716 __tests__/m.test(out) && failed.length === 0;
  return { code, failed, fileLevel };
};

revert();
for (const t of [T_ROUTE, T_VERIFY]) {
  const b = run(t);
  console.log(`BASELINE ${t} exit ${b.code} red: ${b.failed.join(', ') || '(none)'}`);
  if (b.code !== 0) process.exit(2);
}
const ONLY = (process.env.ONLY ?? '').split(',').filter(Boolean);
let ok = 0, total = 0;
for (const m of M) {
  if (ONLY.length && !ONLY.includes(m.name.split(' ')[0])) continue;
  total++;
  const src = readFileSync(`${ROOT}/${m.f}`, 'utf8').split(CR + LF).join(LF);
  const n = src.split(m.from).length - 1;
  if (n !== 1) { console.log(`SKIP    ${m.name}\n        anchor occurs ${n}x`); continue; }
  const at = src.indexOf(m.from);
  writeFileSync(`${ROOT}/${m.f}`, src.slice(0, at) + m.to + src.slice(at + m.from.length));
  const r = run(m.t);
  revert();
  const missing = m.red.filter((k) => !r.failed.includes(k));
  const good = r.code !== 0 && missing.length === 0;
  if (good) ok++;
  console.log(`${good ? 'OK    ' : 'WRONG '}  ${m.name}\n        want red: ${m.red.join(', ')} | actually red: ${r.failed.join(', ') || (r.fileLevel ? '(the FILE failed to load - not a test going red)' : '(none - suite stayed GREEN)')}${missing.length ? ` | NOT CAUGHT: ${missing.join(', ')}` : ''}`);
}
revert();
console.log(execFileSync('git', ['-C', ROOT, 'status', '--short', '--', ...FILES], { encoding: 'utf8' }) || 'source files clean after run');
console.log(`${ok}/${total} behaved as designed.`);
