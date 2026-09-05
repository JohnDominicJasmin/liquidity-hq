/*
 * Startup environment check - issue #78, "Group 4".
 *
 * WHY A STARTUP CHECK RATHER THAN A TEST. A test only catches configuration
 * drift when somebody runs it, and the E2E suite runs on exactly one event
 * (a PR into `main`). Every misconfiguration this file looks for was introduced
 * by editing a Render dashboard, which no test observes and no commit records.
 * The check has to run where the wrong value actually takes effect: at boot,
 * in the process that read it.
 *
 * WHAT IT LOOKS FOR. Not "is every variable present" - that produces noise
 * nobody reads. Each rule below is a failure that has ALREADY happened on this
 * project, and each one was silent at the time:
 *
 *   1. NEXT_PUBLIC_APP_ENV set to something that is neither 'dev' nor 'prod'.
 *      lib/tables.ts treats it as a SWITCH, not a label: anything that is not
 *      exactly 'dev' selects the PRODUCTION table names. The qa service was
 *      created with 'qa' once and silently pointed at live production tables.
 *   2. A non-production environment pointing at the production Supabase.
 *      This is the one unrecoverable failure - prod Supabase is on the free
 *      plan and has NO BACKUPS - so it is the only rule here that refuses to
 *      start rather than logging.
 *   3. NEXT_PUBLIC_SENTRY_DSN set outside production. All environments shared
 *      one GlitchTip project, the non-prod ones spent the monthly quota, and
 *      production reported nothing at all: every envelope came back 429.
 *   4. CRON_SECRET on an environment that does not own its own Telegram bot.
 *      Setting it unlocks all ten cron-guarded routes; on a host holding
 *      ANOTHER environment's bot token that includes re-pointing that bot's
 *      webhook at itself, silently stealing every alert. See
 *      docs/INFRASTRUCTURE.md 4c.
 *
 * SAFETY PROPERTY OF THE CHECK ITSELF. It must never be able to take
 * production down. The only rule that throws requires APP_ENV to be something
 * other than 'prod', so production cannot reach it however wrong this file is.
 * Everything else logs and returns.
 */

// Project refs, not secrets - these appear in every NEXT_PUBLIC_SUPABASE_URL,
// so they ship in the browser bundle and hiding them achieves nothing. Named so
// the comparison below reads as intent rather than as a magic string.
//
// docs/INFRASTRUCTURE.md 4 NO LONGER LISTS THEM (trimmed 2026-09-05, public
// repo): what was worth not publishing is a doc telling a reader which ref is
// production, next to the note that production has no backups. This constant is
// the opposite case and stays - it is the check that stops a non-prod service
// pointing at the prod database, which CONTRIBUTING calls a hard rule. Deleting
// it to tidy the string away would remove the guard and keep the exposure.
const PROD_SUPABASE_REF = 'qdpwhnvmhqgzijuwopso';

export interface EnvFinding {
  level: 'fatal' | 'error' | 'warn';
  key: string;
  message: string;
}

/**
 * Pure, so it is testable without mutating process.env in a test runner.
 *
 * Takes a plain string map rather than NodeJS.ProcessEnv: that type requires
 * NODE_ENV, which forces every caller to build a fuller object than this reads.
 * Only string lookups happen below, and process.env satisfies this.
 */
export function checkEnv(env: Record<string, string | undefined> = process.env): EnvFinding[] {
  const findings: EnvFinding[] = [];
  const appEnv = env.NEXT_PUBLIC_APP_ENV;
  const appUrl = env.NEXT_PUBLIC_APP_URL ?? '';
  const isProd = appEnv === 'prod';

  // ── 1. The switch, not a label ──────────────────────────────────────────
  if (!appEnv) {
    findings.push({
      level: 'error', key: 'NEXT_PUBLIC_APP_ENV',
      message: 'unset - lib/tables.ts will select PRODUCTION table names (lhq_). '
             + "Set it to 'dev' on every non-production service.",
    });
  } else if (appEnv !== 'dev' && appEnv !== 'prod') {
    findings.push({
      level: 'error', key: 'NEXT_PUBLIC_APP_ENV',
      message: `is "${appEnv}", which is neither 'dev' nor 'prod'. This is a SWITCH, not a label: `
             + "anything that is not exactly 'dev' selects PRODUCTION tables (lhq_). "
             + "Use 'dev' and set NEXT_PUBLIC_SENTRY_ENV if you need to name the environment.",
    });
  }

  // ── 2. Non-prod pointing at the production database ─────────────────────
  // The only fatal. Test data written into prod is not recoverable here:
  // prod Supabase is free-tier with no backups.
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  if (!isProd && supabaseUrl.includes(PROD_SUPABASE_REF)) {
    findings.push({
      level: 'fatal', key: 'NEXT_PUBLIC_SUPABASE_URL',
      message: `points at the PRODUCTION Supabase project (${PROD_SUPABASE_REF}) while `
             + `NEXT_PUBLIC_APP_ENV is "${appEnv ?? 'unset'}". Refusing to start. `
             + 'Prod Supabase has no backups, so writes from a test environment are not recoverable.',
    });
  }

  // ── 3. APP_ENV=prod on something that is not production ─────────────────
  // The inverse of rule 1 and the more dangerous direction: 'prod' passes the
  // validity check above while making lib/tables.ts select the LIVE tables. A
  // test environment set this way reads and writes production data and looks
  // completely healthy doing it.
  //
  // NOT fatal, deliberately. The only signal available in-process is the URL,
  // and if prod's NEXT_PUBLIC_APP_URL is ever a value this pattern does not
  // recognise, a fatal here would refuse to start PRODUCTION. A false error in
  // the log is recoverable; refusing to boot prod is not. Both known prod
  // hostnames are matched for the same reason.
  if (isProd && appUrl && !/liquidity-hq\.com|liquidity-hq\.onrender\.com/.test(appUrl)) {
    findings.push({
      level: 'error', key: 'NEXT_PUBLIC_APP_ENV',
      message: `is 'prod' on ${appUrl}, which is not a production host. lib/tables.ts will select `
             + 'the LIVE tables (lhq_), so this environment is reading and writing production data. '
             + "Non-production services must use 'dev'.",
    });
  }

  // ── 4. Error-reporting quota ────────────────────────────────────────────
  // Only when the DSN would actually be live. lib/monitoring.ts already
  // suppresses it whenever APP_ENV === 'dev' and says so in the log, so
  // repeating that here fired on every local boot and on qa and staging - an
  // error-level line that is always present teaches people to skip the block.
  if (!isProd && appEnv !== 'dev' && env.NEXT_PUBLIC_SENTRY_DSN) {
    findings.push({
      level: 'warn', key: 'NEXT_PUBLIC_SENTRY_DSN',
      message: 'is set on an environment where lib/monitoring.ts will NOT suppress it. All '
             + 'environments share one GlitchTip project on the free tier; non-prod traffic has '
             + 'exhausted the monthly quota before, which made production report nothing (every '
             + 'envelope 429). Prod only.',
    });
  }

  // ── 5. Cron secret on a host that borrows another environment's bot ─────
  // The rule is ownership, not environment. A host that owns its bot can only
  // ever re-point its own webhook - a no-op. A host holding SOMEONE ELSE'S
  // token can re-point that bot at itself and silently swallow every alert.
  //
  // dev owns @Liquidity_hq_dev_bot; staging got its own bot on 2026-08-08.
  // Both therefore qualify. qa does not - it still holds dev's token - which is
  // why CRON_SECRET was removed from it the same day.
  //
  // Keyed off the URL because that is the only signal available in-process.
  // The trailing `\.` matters: without it, `liquidity-hq-staging` would also
  // match a prefix check against `liquidity-hq-stagingsomething`, and more to
  // the point `liquidity-hq-qa.` must never match either alternative here.
  //
  // WHEN THIS NEEDS EDITING AGAIN: the moment any environment is given its own
  // bot, or has one taken away. There is no way to detect bot ownership from
  // inside the process, so this list is the fact - keep it next to the reason.
  //
  // localhost is excluded. Every developer's .env.local carries CRON_SECRET so
  // cron routes can be exercised, and Telegram will not register a webhook
  // against a non-public URL anyway, so the hijack this rule guards is not
  // reachable from there. Flagging it printed an ERROR on every local boot,
  // which is how a check stops being read.
  const isLocal = /localhost|127\.0\.0\.1|\[::1\]/.test(appUrl);
  if (env.CRON_SECRET && !isProd && !isLocal) {
    const ownsItsBot = /liquidity-hq-(dev|staging)\./.test(appUrl);
    if (!ownsItsBot) {
      findings.push({
        level: 'error', key: 'CRON_SECRET',
        message: `is set on a non-production host (${appUrl || 'unknown URL'}) that does not own its own `
               + 'Telegram bot. It unlocks all ten cron-guarded routes, including '
               + '/api/telegram/setup-webhook, which can re-point the shared bot at this host and '
               + 'silently swallow every alert. See docs/INFRASTRUCTURE.md 4c.',
      });
    }
  }

  // ── Presence checks, last, because a missing one is loud on its own ─────
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const) {
    if (!env[key]) {
      findings.push({
        level: 'error', key,
        message: 'is unset. Server routes return empty results rather than failing, '
               + 'so this reads as "no data" rather than as a misconfiguration.',
      });
    }
  }

  return findings;
}

/**
 * Log the findings and throw on a fatal one.
 *
 * Deliberately console rather than the monitoring client: this runs before
 * anything is guaranteed to be initialised, and the failure being reported may
 * be that error reporting itself is misconfigured.
 */
export function reportEnv(findings: EnvFinding[]): void {
  if (findings.length === 0) {
    console.log('[env] ok');
    return;
  }
  for (const f of findings) {
    const line = `[env] ${f.level.toUpperCase()} ${f.key}: ${f.message}`;
    if (f.level === 'warn') console.warn(line);
    else console.error(line);
  }
  const fatal = findings.find(f => f.level === 'fatal');
  if (fatal) {
    throw new Error(`[env] refusing to start - ${fatal.key}: ${fatal.message}`);
  }
}
