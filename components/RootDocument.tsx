import localFont from 'next/font/local';
import Script from 'next/script';
import type { Viewport } from 'next';
import '../app/globals.css';
import AppShell from './AppShell';
import StructuredData from './StructuredData';
import { organizationGraph } from '@/lib/structuredData';

/* THE ONE <html>/<body> FOR THE WHOLE APP, shared by both root layouts (#1740 item 2).
 *
 * There are two root layouts now - app/(main)/layout.tsx and app/(intl)/[locale]/layout.tsx - because
 * `<html lang>` has to differ between them and only a ROOT layout renders <html>. Everything below is
 * identical for both, so it lives here rather than in two copies that drift: the fonts, data-theme,
 * data-design, both suppressHydrationWarning sites, the three beforeInteractive scripts, the
 * organization graph and AppShell.
 *
 * `lang` is the ONLY thing a caller varies. If a second attribute ever needs to differ, add a prop -
 * do not fork the file. */

// Self-hosted, previously next/font/google.
//
// next/font/google downloads the font files from fonts.gstatic.com AT BUILD TIME, which quietly made
// every build - including CI and every Render deploy - dependent on Google being reachable. It bit twice
// on 2026-08-04, both times failing the whole build with "Failed to fetch `Figtree` from Google Fonts"
// and both times passing on a retry. A deploy that fails for reasons unrelated to the code is worth
// removing outright, and CI has no retry.
//
// The files in app/fonts are the exact latin-subset woff2s next/font/google was fetching (Figtree v9
// variable 300-900, IBM Plex Mono v20 at 400/500/600/700), pulled from the same gstatic URLs its CSS
// resolves to. Both families are OFL-licensed, so redistribution here is permitted. Only the latin
// subset is included, matching the previous `subsets: ['latin']`.
//
// display: 'swap' matches next/font/google's default, so first-paint behaviour is unchanged.
const figtree = localFont({
  src: [{ path: '../app/fonts/figtree-latin-var.woff2', weight: '300 900', style: 'normal' }],
  variable: '--font-sans',
  display: 'swap',
});

/* IBM Plex Sans, for the Monochrome Terminal redesign (#413).
 *
 * NOT wired to --font-sans. It exposes --font-sans-terminal, and [data-design="terminal"] in
 * globals.css points --font-sans at it.
 *
 * ONE VARIABLE FILE, not four statics like the mono below. Google Fonts serves IBM Plex Sans v23 as a
 * variable face - all four requested weights resolve to the same URL - so 400-700 comes from 45KB
 * instead of four files. OFL, so redistribution here is permitted. Owner approved the download on #413. */
const plexSans = localFont({
  src: [{ path: '../app/fonts/plex-sans-latin-var.woff2', weight: '400 700', style: 'normal' }],
  variable: '--font-sans-terminal',
  display: 'swap',
});

const plexMono = localFont({
  src: [
    { path: '../app/fonts/plex-mono-latin-400.woff2', weight: '400', style: 'normal' },
    { path: '../app/fonts/plex-mono-latin-500.woff2', weight: '500', style: 'normal' },
    { path: '../app/fonts/plex-mono-latin-600.woff2', weight: '600', style: 'normal' },
    { path: '../app/fonts/plex-mono-latin-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-mono',
  display: 'swap',
});

/* Shared by both root layouts. A root layout's viewport does not inherit from anywhere, so without this
   the second root would silently lose themeColor. */
export const rootViewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Matches the app's real body background (app/globals.css) - was #0d0d0d, a stale value from before
  // the icon redesign that public/manifest.json also had and got corrected there but was missed here.
  themeColor: '#06070a',
};

/* Every root layout needs this. Without it, relative URLs in openGraph.images resolve against whatever
   host issued the request - in production that silently defaulted to localhost:3000 - so every shared
   link's preview image breaks. OG_IMAGES and the [locale] page's `alternates.canonical` are both
   relative, so the intl root needs it exactly as much as the main one. */
export const ROOT_METADATA_BASE = new URL('https://liquidity-hq.com');

export default function RootDocument({ lang, children }: { lang: string; children: React.ReactNode }) {
  /* data-design is a static attribute on <html> (#1111). It used to be resolved from ?design= and
     localStorage by an inline script and by DesignModeProvider; with the current-design markup deleted
     from every page, the only thing that switch could still do was strip the terminal tokens off
     terminal markup. So it is gone, `?design=` no longer does anything, and a stale `lhq-design-mode`
     value in someone's storage is simply never read. */
  return (
    <html lang={lang} data-theme="dark" data-design="terminal" className={`${figtree.variable} ${plexSans.variable} ${plexMono.variable}`} suppressHydrationWarning>
      {/* No manual apple-touch-icon <link> here - app/apple-icon.png's file convention already
          generates the correct tag automatically. */}
      {/* suppressHydrationWarning on <body>, and it is the CLASS on this line that makes it necessary.
          consent-pending is in the server markup and the beforeInteractive script below removes it
          before React hydrates - deliberately, that is the whole point of #337. So a returning visitor
          hydrates against a <body> whose class React did not write, and React reports it. Nothing is
          broken; React leaves the DOM alone for an attribute mismatch, so the FAB correctly stays
          visible. The warning fired on EVERY page load for everyone who has answered the consent bar,
          and a console error that is wrong every time trains you to scroll past the one that is real.
          Scope is one level deep, so a genuine mismatch inside the tree still reports. */}
      <body className="consent-pending" suppressHydrationWarning>
        {/* #1740 item 4: the publisher, on every page, so a crawler can tie the whole site to one
            entity. Page-specific graphs (FAQPage, Product, BreadcrumbList) are added by the layout of
            the page they describe, not here. */}
        <StructuredData graph={organizationGraph()} />
        {/* A SIGNED-IN VISITOR LEAVES THE LANDING PAGE BEFORE HYDRATION, NOT ~13s AFTER IT
            (#1309 item 12 follow-up). The redirect used to live in a useEffect in
            components/LandingContent.tsx and could not run until React hydrated, and the `user` it
            waited on could not resolve until AuthProvider's getSession settled after that. Measured on
            production: the document finished in ~750ms and the signed-in visitor was still reading
            marketing copy at 13,350ms.

            The 90-SECOND MARGIN IS SUPABASE'S OWN: auth-js treats a session as expired when
            `expires_at * 1000 - Date.now() < EXPIRY_MARGIN_MS`, which is 3 x 30s = 90,000. Using the
            same test means this never redirects on a token the SDK would itself refuse and refresh.
            The stored value is plain JSON (no base64 on localStorage), so `expires_at` is readable
            without the SDK. No redirect loop is possible: /arena renders signed-out with features
            locked rather than bouncing back. CRAWLERS ARE UNAFFECTED - no localStorage token means no
            redirect - which is what protects #1740.

            ONLY THE THREE LANDING ROUTES. /about, /faq and the rest have no such redirect and must not
            gain one. */}
        <Script id="landing-signed-in-redirect" strategy="beforeInteractive">
          {`(function(){try{var p=location.pathname.replace(/\\/+$/,'')||'/';if(p!=='/'&&p!=='/ko'&&p!=='/zh')return;var ls=window.localStorage;for(var i=0;i<ls.length;i++){var k=ls.key(i);if(!k||k.slice(0,3)!=='sb-'||k.indexOf('-auth-token')<0)continue;var s=JSON.parse(ls.getItem(k)||'null');var e=s&&s.expires_at;if(typeof e==='number'&&e*1000-Date.now()>90000){location.replace('/arena');return;}}}catch(e){}})();`}
        </Script>
        {/* CONSENT DECIDED BEFORE HYDRATION (#337), with the #326 net behind it.
            body.consent-pending hides the Ask AI FAB outright and was removed only by a useEffect in
            CookieConsent - so the button waited on React, and QA measured a first-time mobile visitor
            going ~2s with no button. This reads the stored consent answer before hydration, so a
            returning visitor gets the class cleared in the same tick as first paint. A genuine
            first-time visitor still waits, and SHOULD: the banner is about to appear and the FAB would
            be shoved by it. The 3s timeout stays as the #326 net for the case it was written for -
            the class never being cleared at all because React did not run. Deliberately NOT React:
            the failure being guarded against is React not running. */}
        <Script id="consent-pending-failsafe" strategy="beforeInteractive">
          {`(function(){var b=document.body;function go(){try{var v=localStorage.getItem('lhq_analytics_consent_v1');if(v==='granted'||v==='denied'){b.classList.remove('consent-pending');}}catch(e){}try{setTimeout(function(){try{b.classList.remove('consent-pending');}catch(e){}},3000);}catch(e){}}try{go();}catch(e){}})();`}
        </Script>
        {/* beforeInteractive - injected into the initial server HTML and runs before hydration, so
            data-theme is correct before first paint (no flash of the wrong theme). Mirrors
            lib/theme.ts's getStoredTheme(): explicit localStorage choice wins, otherwise follow the
            device's prefers-color-scheme. */}
        <Script id="theme-init" strategy="beforeInteractive">
          {`(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`}
        </Script>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
