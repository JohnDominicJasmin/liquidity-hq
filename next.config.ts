import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

// Supabase host for connect-src (NEXT_PUBLIC_ vars are available at config eval time)
const supabaseHost = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
  .replace(/^https?:\/\//, '')
  .replace(/\/$/, '');

// PostHog host (defaults to US cloud if not overridden)
const posthogHost = (process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com')
  .replace(/\/$/, '');

// Sentry ingest host, parsed from the DSN (https://<key>@o<org>.ingest.<region>.sentry.io/<project>)
// so connect-src doesn't need updating by hand when the DSN is set.
const sentryHost = (process.env.NEXT_PUBLIC_SENTRY_DSN ?? '').match(/@([^/]+)/)?.[1] ?? '';

// Whop Elements (the embedded checkout on /upgrade, #1606). These are the origins @whop/elements 1.9.0 reports for contentSecurityPolicy({ wallets: false,
// bankConnections: false }): the hosted frame and SDK on cdn.whop.com and the API on api.whop.com (sandbox-api.whop.com for the Whop SANDBOX, which qa
// uses, found from the configured checkout link's host). Wallet buttons (Apple Pay, Google Pay, PayPal) and bank linking are not used, so their many
// provider origins are NOT allowed. Regenerate with the package's contentSecurityPolicy() when it is upgraded.
const whopSandbox = [process.env.NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY, process.env.NEXT_PUBLIC_WHOP_CHECKOUT_ANNUAL, process.env.NEXT_PUBLIC_WHOP_CHECKOUT_FORTNIGHTLY]
  .some((u) => /^https:\/\/sandbox\.whop\.com\//.test((u ?? '').trim()));
const whopApi = whopSandbox ? 'https://sandbox-api.whop.com' : 'https://api.whop.com';

// Content Security Policy
// - script-src 'unsafe-inline': required for Next.js hydration inline scripts
// - script-src 'unsafe-eval': required for GSAP and motion in dev + some Next.js internals
// - style-src 'unsafe-inline': required - app uses extensive inline style props
// - connect-src 'self': covers same-origin API routes and HMR WebSocket in dev
// - img-src https:: coin logos and chart images may come from any HTTPS origin
// - font-src 'self': next/font/google downloads fonts at build time → served from self
//   font-src also includes fonts.gstatic.com as defensive fallback for any CDN font loads
const csp = [
  "default-src 'self'",
  // https://challenges.cloudflare.com: Cloudflare Turnstile (CAPTCHA on the
  // magic-link sign-in form, app/login/page.tsx) - loads its widget script
  // from here and renders inside an iframe from the same origin.
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://us-assets.i.posthog.com https://challenges.cloudflare.com https://cdn.whop.com`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  [
    "connect-src 'self'",
    supabaseHost ? `https://${supabaseHost} wss://${supabaseHost}` : "",
    // Binance WebSocket streams (spot + futures)
    "wss://stream.binance.com wss://stream.binance.com:9443",
    "wss://fstream.binance.com",
    // Bybit WebSocket (primary + fallback)
    "wss://stream.bybit.com wss://stream.bytick.com",
    // Binance REST APIs - called client-side by MarketProvider
    "https://api.binance.com https://fapi.binance.com",
    // Bybit REST API - called client-side by MarketProvider
    "https://api.bybit.com",
    // Deribit - options GEX / put-call ratio
    "https://www.deribit.com",
    // External data feeds
    "https://api.alternative.me",   // Fear & Greed Index
    "https://stablecoins.llama.fi", // Stablecoin supply (DefiLlama)
    // PostHog analytics
    posthogHost,
    "https://us-assets.i.posthog.com https://us.posthog.com",
    sentryHost ? `https://${sentryHost}` : "",
    // Cloudflare Turnstile - widget verification calls
    "https://challenges.cloudflare.com",
    // Whop Elements: the API the embedded checkout talks to
    whopApi,
  ].filter(Boolean).join(" "),
  // Cloudflare Turnstile renders its challenge inside an iframe from this
  // origin - otherwise identical to 'none' (no other framing allowed).
  // https://cdn.whop.com: the embedded Whop checkout renders in a frame from here
  "frame-src https://challenges.cloudflare.com https://cdn.whop.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  // HSTS - 2 years, include subdomains, submit to preload list
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Clickjacking - deny all framing (also covered by CSP frame-ancestors)
  { key: "X-Frame-Options", value: "DENY" },
  // MIME sniffing - browsers must respect declared content-type
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Referrer - send origin only on cross-origin requests
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Feature/Permissions policy - disable unused browser APIs
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  // CSP
  { key: "Content-Security-Policy", value: csp },
];

// Release tag for GlitchTip. Render sets RENDER_GIT_COMMIT during the build; it
// is not NEXT_PUBLIC_-prefixed, so without this it reaches the server runtime and
// never the browser bundle - which would tag server errors and leave client
// errors unversioned. Half-tagged is worse than untagged: it looks like it works.
//
// Empty string rather than undefined when absent (local builds, CI) so
// lib/monitoring.ts's `|| undefined` turns it into "no release" rather than the
// literal string "undefined" appearing as a release name in the dashboard.
const release = process.env.RENDER_GIT_COMMIT ?? '';

const nextConfig: NextConfig = {
  /* EXPERIMENTAL, and the only thing it enables is app/global-not-found.tsx (#1740 item 2).
   *
   * This app has two root layouts, so there is no single layout left to compose a global 404 from
   * and app/not-found.tsx cannot be reached for an unmatched URL - see app/global-not-found.tsx.
   * `globalNotFound` is the documented hook for exactly that case and it is the only route to a
   * branded 404 here.
   *
   * IF A FUTURE NEXT DROPS OR RENAMES THIS FLAG the build FAILS, exit 1 - measured by planting a
   * bogus key here and building. The mechanism is the TYPE CHECK, not Next's own config validation:
   * Next only WARNS ("Unrecognized key(s) in object ... at experimental"), while tsc errors with
   * TS2353 "does not exist in type 'ExperimentalConfig'" and the build reports "Failed to type
   * check". `npx tsc --noEmit` catches it independently, since tsconfig's TypeScript glob covers
   * this file. So the loud failure depends on this config staying TypeScript and on the gate not
   * being muted - do NOT add `typescript: { ignoreBuildErrors: true }`, and do not rename this file
   * to .js, or a future rename of the flag degrades to a warning nobody reads and the 404 silently
   * reverts to Next's built-in page. The fix, when it happens, is deleting these two lines.
   *
   * ONE MEASURED ODDITY, recorded so nobody relies on it: in Next 16.3.8 app/global-not-found.tsx
   * is honoured even with this flag ABSENT. Flag on and flag off produce a byte-identical 404;
   * removing the FILE is what brings Next's built-in page back. The flag is kept anyway, precisely
   * because the flagless path is undocumented - if a later version starts enforcing the gate, the
   * flag is what turns that into a build failure instead of a silent downgrade. */
  experimental: {
    globalNotFound: true,
  },

  // Remove X-Powered-By: Next.js header (don't leak stack info)
  poweredByHeader: false,

  // Image Optimization OFF: /_next/image answers 404 before it reads a parameter (next-server.js checks `unoptimized` first). The critical and
  // high advisories against this Next version live in that endpoint (Image Optimization RCE, image-optimizer SSRF; Dependabot, #1632), and
  // the app does not use it: no next/image, no next/og, plain <img> only. Revisit together with the Next upgrade (16.4.2 batch).
  images: { unoptimized: true },

  // Values here are ALWAYS inlined into the bundle regardless of prefix - that is
  // the documented behaviour of this key, and the reason it works for a variable
  // Render does not prefix for us.
  env: {
    NEXT_PUBLIC_RELEASE: release,
  },

  async headers() {
    return [
      {
        // Apply to all routes
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },

  async redirects() {
    return [
      // /prices was a plain coin/price/24h-change list - Markets shows the
      // same price + change columns plus grade/volume/signal, so it was cut
      // as a redundant duplicate page. Old links/bookmarks land on Markets.
      { source: "/prices", destination: "/markets", permanent: true },
      // THE /refund REDIRECT WAS REMOVED HERE ON 2026-10-31, and this note replaces it rather than leaving a gap.
      //
      // It read: "The Refund Policy is withdrawn until payments go live (owner, 2026-10-08) ... A payment processor expects a
      // refund policy BEFORE real charges, so this MUST be undone before payments go live." The withdrawal named its own end
      // condition and the condition fired: payments went live 2026-10-28, and this entry was still here on 2026-10-31, so
      // production took real money for three days while /refund answered 307 to /terms - with "Refund Policy" links rendering
      // on /upgrade above the checkout buttons and on /security the whole time.
      //
      // Lifting it executes the owner's instruction rather than overriding it. The 307 was deliberate so nothing cached it as
      // permanent, which is what makes removal clean.
      //
      // WHAT WAS ACTUALLY LEFT TO UNDO, because the old note overstated it: the page, its REFUND_* labels and the
      // lib/navRoutes.ts entry were all back already. Only this redirect, the footer link and the sitemap entry remained.
    ];
  },
};

// No org/project/authToken set - source-map upload stays off until that's
// configured; this just wires the Turbopack-safe request/error instrumentation
// (see instrumentation.ts, instrumentation-client.ts). Sentry SDK docs note
// build-time (webpack-plugin) instrumentation no-ops under Turbopack anyway,
// which is what `npm run build` uses on Next 16 (Turbopack default) - the
// instrumentation files are the real integration point, not this wrapper.
export default withSentryConfig(nextConfig, {
  silent: true,
});
