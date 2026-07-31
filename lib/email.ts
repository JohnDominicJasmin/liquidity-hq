// Best-effort transactional email via Brevo (single-sender - no domain needed;
// the sender address is a Brevo-verified email like the owner's Gmail).
// Sending must NEVER block or fail an admin action: callers treat a false
// return as "couldn't notify", not an error. If the env vars are unset, this
// silently no-ops so the feature is simply inert until configured.
//
// Env: BREVO_API_KEY (server-only), BREVO_SENDER_EMAIL (the verified sender).

interface AdminAddedArgs {
  to: string;
  role: 'owner' | 'staff';
  invitedBy?: string | null;
}

interface SpikeAlertArgs {
  todayCalls: number;
  capCalls: number;
  pct: number;
}

interface WelcomeEmailArgs {
  to: string;
}

interface BanEmailArgs {
  to: string;
  reason?: string | null;
}

interface TrialEndingArgs {
  to: string;
  daysLeft: number;
}

import { reportHealth, healthError } from '@/lib/apiHealth';

/* Every sender in this file ends in `return res.ok` inside a try/catch that
   returns false - so a bounced welcome email, an expired Brevo key or a
   suspended account all look identical to the caller, which typically ignores
   the boolean anyway. Nothing anywhere recorded whether mail was going out.
   One source for the provider, not one per template: they share a key, a
   sender domain and a reputation, and they fail together.
   Deliverability is a separate question this cannot answer - Brevo accepting a
   message is not Gmail putting it in an inbox (see the freemail-sender note in
   the project docs). This only reports whether the API took it. */
async function brevoFetch(init: RequestInit): Promise<Response> {
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', init);
    reportHealth('brevo:smtp', 'delivery', res.ok, res.ok ? 'accepted' : `HTTP ${res.status}`);
    return res;
  } catch (e) {
    reportHealth('brevo:smtp', 'delivery', false, healthError(e));
    throw e;
  }
}

const APP_NAME = 'LiquidityHQ';

// Fixed recipient list for the AI-spend spike alert - the owner's own
// addresses, not a per-user setting, so no env var / admin UI for this list.
const SPIKE_ALERT_RECIPIENTS = ['johndominicbuilds@gmail.com', 'mikocabal27@gmail.com'];

function appUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'https://liquidity-hq.com';
  return `${base}${path}`;
}

function opsLoginUrl(): string {
  return appUrl('/ops');
}

// Notification only - tells someone their email was granted admin access.
// No password, no action link required beyond the normal login URL.
export async function sendAdminAddedEmail(args: AdminAddedArgs): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  const from = process.env.BREVO_SENDER_EMAIL;
  if (!apiKey || !from) return false; // not configured -> skip quietly

  const loginUrl = opsLoginUrl();
  const subject = `You've been added to ${APP_NAME} Ops`;
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111;max-width:520px">
      <h2 style="margin:0 0 12px;font-size:18px">You've been added to ${APP_NAME} Ops</h2>
      <p style="margin:0 0 12px">
        Your email (<b>${args.to}</b>) was granted <b>${args.role}</b> access to the
        ${APP_NAME} operations console${args.invitedBy ? ` by ${args.invitedBy}` : ''}.
      </p>
      <p style="margin:0 0 12px">Sign in here: <a href="${loginUrl}">${loginUrl}</a></p>
      <p style="margin:16px 0 0;color:#666;font-size:13px">
        This is a notification only - it doesn't contain a password. If you weren't expecting this, you can ignore it.
      </p>
    </div>`;

  try {
    const res = await brevoFetch({
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: `${APP_NAME} Ops`, email: from },
        to: [{ email: args.to }],
        subject,
        htmlContent: html,
      }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Owner-only warning: today's xAI call volume crossed 80% of the global
// daily cap (app/api/ops/spike-alert/route.ts). Fixed recipient list, not
// per-user - see SPIKE_ALERT_RECIPIENTS above.
export interface HealthAlertArgs {
  down: Array<{ source: string; category: string; detail: string; failures: number; lastOkAt: string | null }>;
  recovered: string[];
}

/* Sent by lib/healthAlert on the hourly cron. Fixed owner recipient list, same
   as the spike alert - this is an operations notice, never a user-facing one. */
export async function sendHealthAlertEmail(args: HealthAlertArgs): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  const from = process.env.BREVO_SENDER_EMAIL;
  if (!apiKey || !from) return false;

  const opsUrl = opsLoginUrl();
  // Subject carries the actual state - an ops email that needs opening to find
  // out whether anything is wrong gets ignored within a week.
  const subject = args.down.length
    ? `${APP_NAME}: ${args.down.length} data source${args.down.length > 1 ? 's' : ''} down`
    : `${APP_NAME}: ${args.recovered.length} data source${args.recovered.length > 1 ? 's' : ''} recovered`;

  const fmtLastOk = (iso: string | null) => {
    if (!iso) return 'never succeeded';
    const hrs = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000);
    if (hrs < 1) return 'last ok under an hour ago';
    if (hrs < 48) return `last ok ${hrs}h ago`;
    return `last ok ${Math.floor(hrs / 24)}d ago`;
  };

  const downRows = args.down.map(d => `
    <tr>
      <td style="padding:6px 10px 6px 0;font-family:ui-monospace,monospace"><b>${d.source}</b></td>
      <td style="padding:6px 10px 6px 0;color:#666">${d.category}</td>
      <td style="padding:6px 0;color:#b91c1c">${d.detail} · ${d.failures} in a row · ${fmtLastOk(d.lastOkAt)}</td>
    </tr>`).join('');

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111;max-width:640px">
      ${args.down.length ? `
        <h2 style="margin:0 0 12px;font-size:18px">Data sources down</h2>
        <p style="margin:0 0 12px;color:#444">
          ${args.down.length === 1
            ? 'This has failed its last few checks in a row.'
            : 'These have failed their last few checks in a row.'}
          A source going quiet does not surface anywhere in the app - the page just shows a dash.
        </p>
        <table style="border-collapse:collapse;font-size:14px;margin:0 0 16px">${downRows}</table>
      ` : ''}
      ${args.recovered.length ? `
        <h2 style="margin:0 0 8px;font-size:16px">Recovered</h2>
        <p style="margin:0 0 16px;font-family:ui-monospace,monospace">${args.recovered.join(', ')}</p>
      ` : ''}
      <p style="margin:0 0 12px">Full list: <a href="${opsUrl}">${opsUrl}</a></p>
      <p style="margin:16px 0 0;color:#666;font-size:13px">
        One notice per source, repeated at most daily while it stays down.
        To stop hearing about a source you have decided to leave broken, add it to
        the <code>api_health_alert_suppress</code> list in app_config.
      </p>
    </div>`;

  try {
    const res = await brevoFetch({
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: `${APP_NAME} Ops`, email: from },
        to: SPIKE_ALERT_RECIPIENTS.map(email => ({ email })),
        subject,
        htmlContent: html,
      }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendSpikeAlertEmail(args: SpikeAlertArgs): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  const from = process.env.BREVO_SENDER_EMAIL;
  if (!apiKey || !from) return false;

  const opsUrl = opsLoginUrl();
  const subject = `${APP_NAME}: AI usage at ${args.pct}% of daily cap`;
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111;max-width:520px">
      <h2 style="margin:0 0 12px;font-size:18px">AI Usage Spike Warning</h2>
      <p style="margin:0 0 12px">
        Today's xAI calls: <b>${args.todayCalls}</b> / ${args.capCalls} (<b>${args.pct}%</b>).
        Getting close to the daily cap.
      </p>
      <p style="margin:0 0 12px">Check the breakdown: <a href="${opsUrl}">${opsUrl}</a></p>
    </div>`;

  try {
    const res = await brevoFetch({
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: `${APP_NAME} Ops`, email: from },
        to: SPIKE_ALERT_RECIPIENTS.map(email => ({ email })),
        subject,
        htmlContent: html,
      }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Fires once per account, right after the first real sign-in (see
// app/api/auth/welcome-email/route.ts for the dedup - this function itself
// has no idempotency, it just sends).
export async function sendWelcomeEmail(args: WelcomeEmailArgs): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  const from = process.env.BREVO_SENDER_EMAIL;
  if (!apiKey || !from) return false;

  const arenaUrl = appUrl('/arena');
  const subject = `Welcome to ${APP_NAME}`;
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111;max-width:520px">
      <h2 style="margin:0 0 12px;font-size:18px">Welcome to ${APP_NAME}</h2>
      <p style="margin:0 0 12px">
        Your account is ready. You've got <b>14 days of Pro</b> - full access to every
        signal, timeframe, and tool - before anything is gated.
      </p>
      <p style="margin:0 0 12px">Jump in: <a href="${arenaUrl}">${arenaUrl}</a></p>
      <p style="margin:16px 0 0;color:#666;font-size:13px">
        Questions or feedback - just reply to this email.
      </p>
    </div>`;

  try {
    const res = await brevoFetch({
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: APP_NAME, email: from },
        to: [{ email: args.to }],
        subject,
        htmlContent: html,
      }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Fires once per account near the end of the 14-day trial, from the
// cron-gated /api/trial-reminder route (which owns the dedup - this function
// just sends). The in-app TrialBanner already shows a countdown, but it only
// reaches someone who signs in; this is the one that catches the user who
// signed up, got busy, and would otherwise return weeks later to a silently
// downgraded account with no idea a trial ever ran.
//
// Names what they LOSE rather than what they'd buy: at this point they have
// been using the features for twelve days, so the concrete list is the pitch.
export async function sendTrialEndingEmail(args: TrialEndingArgs): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  const from = process.env.BREVO_SENDER_EMAIL;
  if (!apiKey || !from) return false;

  const upgradeUrl = appUrl('/upgrade');
  const when = args.daysLeft <= 1 ? 'tomorrow' : `in ${args.daysLeft} days`;
  const subject = `Your ${APP_NAME} Pro trial ends ${when}`;

  /* Only promise a purchase path when one actually exists. Until checkout is
     configured, /upgrade renders "Pro payments launching soon" - so a plain
     "Keep Pro" link would send the most interested user we have, on the day
     they are most willing to pay, to a page that cannot take their money. Same
     env check /upgrade and UpgradeGateModal already use, so the three agree by
     construction. The rest of the email still sends either way: its real job is
     warning that features are about to lock, which is true regardless. */
  const checkoutLive = !!(
    process.env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL &&
    process.env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL !== '#'
  );
  const cta = checkoutLive
    ? `<p style="margin:0 0 12px">Keep Pro: <a href="${upgradeUrl}">${upgradeUrl}</a></p>`
    : `<p style="margin:0 0 12px">Pro is not on sale yet, so there is nothing to buy today - the features above still lock ${when}, and we will email you as soon as there is a way to keep them.</p>`;
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111;max-width:520px">
      <h2 style="margin:0 0 12px;font-size:18px">Your Pro trial ends ${when}</h2>
      <p style="margin:0 0 12px">
        Your account stays open and free after that - but these go back to locked:
      </p>
      <ul style="margin:0 0 12px;padding-left:20px">
        <li>The 11 AI analysis tools</li>
        <li>Fast timeframes (1 minute, 5 minute, 15 minute)</li>
        <li>Backtesting</li>
        <li>Telegram and push alerts</li>
        <li>Price alerts</li>
      </ul>
      <p style="margin:0 0 12px">
        Your daily AI analysis and chat also drop back to the free allowance.
      </p>
      ${cta}
      <p style="margin:16px 0 0;color:#666;font-size:13px">
        Not for you? No action needed - nothing will be charged.
      </p>
    </div>`;

  try {
    const res = await brevoFetch({
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: APP_NAME, email: from },
        to: [{ email: args.to }],
        subject,
        htmlContent: html,
      }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Fires from the admin ban action (app/api/ops/users/[id]/route.ts) - no
// login link, since the account can no longer sign in.
export async function sendBanEmail(args: BanEmailArgs): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  const from = process.env.BREVO_SENDER_EMAIL;
  if (!apiKey || !from) return false;

  const subject = `Your ${APP_NAME} account has been suspended`;
  // Both are interpolated into an HTML body. The reason is free text an admin
  // types into /ops, and the address comes from the account record - neither is
  // markup, so neither should be able to act as markup in the recipient's mail
  // client.
  const esc = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const reason = args.reason?.trim() ? esc(args.reason.trim()) : '';
  const to = esc(args.to);
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111;max-width:520px">
      <h2 style="margin:0 0 12px;font-size:18px">Account suspended</h2>
      <p style="margin:0 0 12px">
        Your ${APP_NAME} account (<b>${to}</b>) has been suspended and can no
        longer sign in.
      </p>
      ${reason ? `<p style="margin:0 0 12px"><b>Reason:</b> ${reason}</p>` : ''}
      <p style="margin:0 0 12px">If you believe this is a mistake, reply to this email.</p>
    </div>`;

  try {
    const res = await brevoFetch({
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: APP_NAME, email: from },
        to: [{ email: args.to }],
        subject,
        htmlContent: html,
      }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
