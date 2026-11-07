import OPS_LABEL_DEFAULTS from '@/lib/labelDefaults.ops.en.json' with { type: 'json' };
import OpsGate from './_gate';

/* A SERVER component on purpose, and the gate itself lives in ./_gate.tsx (#1632 item 15).
 *
 * The admin console's copy used to ship in lib/labelDefaults.en.json, which LabelsProvider - a
 * client component on every page - imports whole. So every visitor's JS carried all 195 `OPS_*`
 * strings, the AI model name and the margin formula among them. They now live in
 * lib/labelDefaults.ops.en.json, and this file is the only page-side code that imports it.
 *
 * Importing it HERE keeps it out of every client bundle: a server component's imports never reach
 * the browser, only the props it passes do. And it passes only the sign-in and gate strings
 * (`OPS_LOGIN_*`, `OPS_LAYOUT_*`), because those must render before anyone is known to be an admin,
 * and nothing in them is sensitive. The rest of the console's copy is served by the admin-only
 * /api/ops/labels, which the gate calls once the visitor has proven they are an admin.
 *
 * `with { type: 'json' }` is not decoration: __tests__/aliasHookScope.test.mts pins the exact set
 * of bare JSON imports, and the attribute is what Node needs to import this file from a test. */
const PRE_AUTH_PREFIXES = ['OPS_LOGIN_', 'OPS_LAYOUT_'];

const PRE_AUTH_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(OPS_LABEL_DEFAULTS as Record<string, string>)
    .filter(([key]) => PRE_AUTH_PREFIXES.some((p) => key.startsWith(p))),
);

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return <OpsGate preAuthLabels={PRE_AUTH_LABELS}>{children}</OpsGate>;
}
