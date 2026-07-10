import type { NextConfig } from "next";

// Supabase host for connect-src (NEXT_PUBLIC_ vars are available at config eval time)
const supabaseHost = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
  .replace(/^https?:\/\//, '')
  .replace(/\/$/, '');

// Content Security Policy
// - script-src 'unsafe-inline': required for Next.js hydration inline scripts
// - script-src 'unsafe-eval': required for GSAP and motion in dev + some Next.js internals
// - style-src 'unsafe-inline': required — app uses extensive inline style props
// - connect-src 'self': covers same-origin API routes and HMR WebSocket in dev
// - img-src https:: coin logos and chart images may come from any HTTPS origin
// - font-src 'self': next/font/google downloads fonts at build time → served from self
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  [
    "connect-src 'self'",
    supabaseHost ? `https://${supabaseHost} wss://${supabaseHost}` : "",
    // Binance spot (port 9443 and default 443)
    "wss://stream.binance.com wss://stream.binance.com:9443",
    // Binance futures
    "wss://fstream.binance.com",
    // Bybit (primary + fallback)
    "wss://stream.bybit.com wss://stream.bytick.com",
  ].filter(Boolean).join(" "),
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  // HSTS — 2 years, include subdomains, submit to preload list
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Clickjacking — deny all framing (also covered by CSP frame-ancestors)
  { key: "X-Frame-Options", value: "DENY" },
  // MIME sniffing — browsers must respect declared content-type
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Referrer — send origin only on cross-origin requests
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Feature/Permissions policy — disable unused browser APIs
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
