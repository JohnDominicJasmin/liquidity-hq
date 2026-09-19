/* THE PRODUCTION GUARD (#1364, tracker #1259).
 *
 * The failure this exists to prevent, named by the project manager: someone points
 * the mutating suite at production because it seemed like the obvious next step. A
 * list in a comment is a rule nobody enforces, so this is enforced twice:
 *
 *   1. playwright.config.ts refuses to LOAD when E2E_BASE_URL is the production host
 *      unless E2E_ALLOW_PRODUCTION=1 is set, and refuses outright if billed AI calls
 *      are also enabled.
 *   2. Once allowed, `testMatch` is the allowlist below, so any other spec - named on
 *      the command line or not - is "No tests found", not "ran".
 *
 * And the allowlist cannot rot: __tests__/prodReadonlyGuard.test.mts fails if an
 * allowlisted spec now contains a write verb, a dev-only seam or a billed-AI gate, and
 * fails if any spec file in qa/e2e/ is in NEITHER list, so a new spec has to be
 * classified by whoever adds it.
 *
 * WHAT "READ-ONLY" MEANS HERE. The specs on the allowlist write nothing ON PURPOSE.
 * A signed-in visit still makes the APP write to that account's own rows (TimezoneSync
 * PATCHes `timezone`; the alerts page seeds default mutes on a first visit). The owner
 * approved a dedicated read-only production test account, and those writes touch only
 * it. Recorded on #1259.
 *
 * WHAT IT DOES NOT DO: it does not make the account exist (the owner creates it), and it
 * does not run anything. Classification is by test code, not by proof: each spec still
 * needs one read-through when the account exists.
 *
 * Standalone on purpose - no imports - so both Playwright's config loader and
 * `node --test` can load it. */

export const PRODUCTION_HOSTS = [
  'liquidity-hq.com',
  'www.liquidity-hq.com',
  'liquidity-hq-prod.onrender.com',
];

/** True when `baseUrl` addresses production. Unparseable input is treated as NOT
 *  production only if it is empty; a non-empty URL that cannot be parsed is refused
 *  as if it were, because guessing "safe" on garbage is the wrong direction. */
export function isProductionTarget(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return true;
  }
  return PRODUCTION_HOSTS.includes(host) || host.endsWith('.liquidity-hq.com');
}

/** Throws unless a production run has been asked for explicitly. */
export function assertProductionRunAllowed(env: Record<string, string | undefined>): void {
  if (env.E2E_ALLOW_PRODUCTION !== '1') {
    throw new Error(
      'REFUSING TO LOAD: E2E_BASE_URL is the production host (' + (env.E2E_BASE_URL ?? '?') + ') and ' +
      'E2E_ALLOW_PRODUCTION=1 is not set. Only the read-only allowlist in qa/prod-readonly.ts may run ' +
      'against production, and only on purpose. See #1259 / #1364.',
    );
  }
  if (env.E2E_ALLOW_BILLED_CALLS === '1') {
    throw new Error(
      'REFUSING TO LOAD: E2E_ALLOW_BILLED_CALLS=1 with a production target. Billed AI calls never run against production.',
    );
  }
}

export type Needs = 'none' | 'pro' | 'free';

/** Specs that may run against production. `needs` is the account tier the spec signs in as
 *  (fixture A is Pro, B is free); 'none' is anonymous. */
export const PROD_READONLY_SPECS: ReadonlyArray<{ spec: string; needs: Needs; note?: string }> = [
  // ── anonymous ──
  { spec: 'a11y', needs: 'none', note: 'route sweep: spends the per-IP rate limit, one worker' },
  { spec: 'arena-legacy-signals', needs: 'none' },
  { spec: 'arena-panel-overlap', needs: 'none' },
  { spec: 'arena-structure', needs: 'none' },
  { spec: 'cache-effective', needs: 'none', note: 'repeats data-route calls: spends upstream quota' },
  { spec: 'cache-policy', needs: 'none', note: 'repeats data-route calls: spends upstream quota' },
  { spec: 'chart-backfill', needs: 'none' },
  { spec: 'checkout-config-agrees', needs: 'none', note: 'asserts /api/version flags: production differs from dev, expect a triage pass' },
  { spec: 'clock', needs: 'none' },
  { spec: 'contrast', needs: 'none', note: 'sweeps every route in both themes: heavy' },
  { spec: 'econ-calendar', needs: 'none', note: 'calls a data route: spends upstream quota' },
  { spec: 'entitled-macro-cards', needs: 'none' },
  { spec: 'entitlement-survives-redesign', needs: 'none', note: '58 tests: heavy' },
  { spec: 'fab-visibility', needs: 'none' },
  { spec: 'hidden-routes', needs: 'none' },
  { spec: 'i18n', needs: 'none' },
  { spec: 'klines-route', needs: 'none', note: 'calls a data route: spends upstream quota' },
  { spec: 'layout', needs: 'none', note: 'route sweep' },
  { spec: 'market-scenarios', needs: 'none' },
  { spec: 'mobile-input-zoom', needs: 'none' },
  { spec: 'news-feed-fixture', needs: 'none' },
  { spec: 'no-duplicate-controls', needs: 'none', note: 'route sweep' },
  { spec: 'no-selling-hidden-features', needs: 'none' },
  { spec: 'one-socket-per-screen', needs: 'none', note: 'route sweep' },
  { spec: 'perf', needs: 'none', note: 'performance budgets against the live site: not routine' },
  { spec: 'reconnect', needs: 'none' },
  { spec: 'reconnect-cdp', needs: 'none' },
  { spec: 'reconnect-deterministic', needs: 'none' },
  { spec: 'responsive', needs: 'none', note: 'route sweep' },
  { spec: 'rtl-exemptions', needs: 'none' },
  { spec: 'security', needs: 'none', note: 'unauthenticated probes of API routes: expects 401/403' },
  { spec: 'seo', needs: 'none', note: 'route sweep' },
  { spec: 'signal-freshness', needs: 'none' },
  { spec: 'smoke', needs: 'none', note: 'route sweep' },
  { spec: 'support-contact-address', needs: 'none', note: 'label rows exist on prod (verified 2026-09-19)' },
  { spec: 'terminal-default', needs: 'none' },
  { spec: 'upgrade-expired-session', needs: 'none' },
  { spec: 'version-configured', needs: 'none', note: 'asserts /api/version flags: production differs from dev, expect a triage pass' },
  // ── signed in, Pro ──
  { spec: 'a11y-auth', needs: 'pro' },
  { spec: 'alerts-mute-load-timeout-state', needs: 'pro', note: 'the alerts page may seed default mutes on a first visit: that account\'s own rows' },
  { spec: 'arena-authloading-lock-icon', needs: 'pro' },
  { spec: 'arena-read-card', needs: 'pro' },
  { spec: 'econ-staleness', needs: 'pro' },
  { spec: 'grok-header-meta', needs: 'pro' },
  { spec: 'perp-spot', needs: 'pro' },
  { spec: 'perps-unknown-disclosure', needs: 'pro' },
  { spec: 'plan-badge-mobile', needs: 'pro' },
  { spec: 'plan-badge-no-flash', needs: 'pro' },
  { spec: 'real-yield', needs: 'pro' },
  { spec: 'score-perps-coupling', needs: 'pro' },
  { spec: 'text-under-control', needs: 'pro' },
  { spec: 'tf-gating', needs: 'pro' },
  { spec: 'tnav-russian-768', needs: 'pro', note: 'Russian test is test.fail() while #1255 stands' },
  // ── signed in, free ──
  { spec: 'plan-badge-trial-flip', needs: 'free' },
];

/** Every other spec, and why it is kept off production. A spec must appear in exactly one
 *  of the two lists; the unit test enforces it. */
export const PROD_EXCLUDED: Readonly<Record<string, string>> = {
  '_record-proxy': 'a recorder of live upstream payloads, not a test',
  'ops-admit': 'needs admin fixtures',
  'plan-badge-same-user-auth-event': 'signs in as BOTH a Pro and a free account: needs two production accounts',
  'arena-alert-resilience': 'clicks Save on a price alert on purpose; safe only while a route stub matches, and a missed match would create a real alert',
  'checkout': 'clicks the checkout CTA on purpose; safe only while a route stub matches, and a missed match would create a real checkout session',
  'lemonsqueezy-real-purchase': 'a real purchase',
  'arena-quick-deep-stale-selection': 'real AI credits (billed), and PATCHes settings',
  'chart-indicator-draw-failure': 'depends on a QA seam that is dead on a production build; also PATCHes settings',
  'entitlement-unknown': 'depends on a QA seam that is dead on a production build',
  'strategy-panel-entitlement-unknown': 'depends on a QA seam that is dead on a production build; also PATCHes settings',
  'alert-prefs-load-failure': 'writes on purpose: resets alert preferences',
  'arena-ema-loading-caveat': 'writes on purpose: PATCHes strategy_selection to reset a starting state',
  'arena-failed-settings-read': 'writes on purpose: PATCHes strategy_selection',
  'arena-seed-effect-real-selection': 'writes on purpose: PATCHes strategy_selection',
  'arena-stale-result-labelling': 'writes on purpose: PATCHes strategy_selection',
  'arena-sticky-ready-background-refresh': 'writes on purpose: PATCHes settings',
  'audit-001-item-1-2': 'writes on purpose: PATCHes settings',
  'audit-001-item-23-24-25': 'writes on purpose: PATCHes settings',
  'bola': 'writes on purpose: cross-account requests that must be refused, against seeded row ids',
  'entitlements': 'writes on purpose: asserts and resets pinned entitlement state',
  'grokchat-selection-without-arena-visit': 'writes on purpose: PATCHes strategy_selection',
  'indicator-param-canvas': 'writes on purpose: PATCHes indicator params',
  'offline': 'writes on purpose: POSTs while offline',
  'onboarding-load-failure': 'writes on purpose: PATCHes onboarding state',
  'payments-webhook': 'writes on purpose: POSTs webhook payloads',
  'payments-write-path': 'writes on purpose: exercises the payment write path',
  'settings-reload-survives-failed-save': 'writes on purpose: saves settings',
  'signout-resilience': 'writes on purpose: PATCHes settings and signs out',
  'strategy-panel-preload-race': 'writes on purpose: PATCHes strategy_selection',
  'timezone-sync-settings-ready': 'writes on purpose: PATCHes timezone',
};

export interface SpecClass { writes: string[]; seam: boolean; billed: boolean; clean: boolean }

/** Classifies a spec by its CODE (comments stripped, so prose that mentions PATCH does not
 *  count). A first-pass heuristic: it can miss a write done by an unusual route, which is
 *  why an allowlisted spec still gets one read-through when the account exists. */
export function classifySpec(source: string): SpecClass {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const writes: string[] = [];
  if (/method:\s*['"](PATCH|POST|PUT|DELETE)['"]/.test(code)) writes.push('fetch with a write method');
  if (/\.(post|put|patch|delete)\(/.test(code.replace(/\.delete\(\)/g, '').replace(/Map|Set|localStorage/g, ''))) writes.push('request .post/.put/.patch/.delete');
  const seam = /__LHQ_QA_/.test(code);
  const billed = /BILLED_CALLS_READY|E2E_ALLOW_BILLED_CALLS/.test(code);
  return { writes, seam, billed, clean: writes.length === 0 && !seam && !billed };
}

/** Playwright `testMatch` for a production run: only the allowlist, on either path separator. */
export const PROD_READONLY_TEST_MATCH: RegExp[] = [
  new RegExp('(^|[\\\\/])(' + PROD_READONLY_SPECS.map(s => s.spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\.spec\\.ts$'),
];
