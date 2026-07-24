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
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://us-assets.i.posthog.com https://challenges.cloudflare.com`,
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
  ].filter(Boolean).join(" "),
  // Cloudflare Turnstile renders its challenge inside an iframe from this
  // origin - otherwise identical to 'none' (no other framing allowed).
  "frame-src https://challenges.cloudflare.com",
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

const nextConfig: NextConfig = {
  // Remove X-Powered-By: Next.js header (don't leak stack info)
  poweredByHeader: false,

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
