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
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
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
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
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
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
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
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111;max-width:520px">
      <h2 style="margin:0 0 12px;font-size:18px">Account suspended</h2>
      <p style="margin:0 0 12px">
        Your ${APP_NAME} account (<b>${args.to}</b>) has been suspended and can no
        longer sign in.
      </p>
      <p style="margin:0 0 12px">If you believe this is a mistake, reply to this email.</p>
    </div>`;

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
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
