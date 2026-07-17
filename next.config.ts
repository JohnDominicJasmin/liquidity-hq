import type { NextConfig } from "next";

// Supabase host for connect-src (NEXT_PUBLIC_ vars are available at config eval time)
const supabaseHost = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
  .replace(/^https?:\/\//, '')
  .replace(/\/$/, '');

// PostHog host (defaults to US cloud if not overridden)
const posthogHost = (process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com')
  .replace(/\/$/, '');

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
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://us-assets.i.posthog.com`,
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
  ].filter(Boolean).join(" "),
  "frame-src 'none'",
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
};

export default nextConfig;
