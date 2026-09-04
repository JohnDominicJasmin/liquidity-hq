import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import Script from 'next/script';
import './globals.css';
import AppShell from '@/components/AppShell';
import DesignModeProvider from '@/components/DesignModeProvider';

// Self-hosted, previously next/font/google.
//
// next/font/google downloads the font files from fonts.gstatic.com AT BUILD
// TIME, which quietly made every build - including CI and every Render deploy -
// dependent on Google being reachable. It bit twice on 2026-08-04, both times
// failing the whole build with "Failed to fetch `Figtree` from Google Fonts"
// and both times passing on a retry. A deploy that fails for reasons unrelated
// to the code is worth removing outright, and CI has no retry.
//
// The files in app/fonts are the exact latin-subset woff2s next/font/google was
// fetching (Figtree v9 variable 300-900, IBM Plex Mono v20 at 400/500/600/700),
// pulled from the same gstatic URLs its CSS resolves to. Both families are
// OFL-licensed, so redistribution here is permitted. Only the latin subset is
// included, matching the previous `subsets: ['latin']`.
//
// display: 'swap' matches next/font/google's default, so first-paint behaviour
// is unchanged.
const figtree = localFont({
  src: [{ path: './fonts/figtree-latin-var.woff2', weight: '300 900', style: 'normal' }],
  variable: '--font-sans',
  display: 'swap',
});

/* IBM Plex Sans, for the Monochrome Terminal redesign (#413).
 *
 * NOT wired to --font-sans. It exposes --font-sans-terminal, and
 * [data-design="terminal"] in globals.css points --font-sans at it. Nothing
 * sets that attribute yet, so every screen still renders in Figtree and this
 * file costs one preloaded woff2 until the first screen opts in.
 *
 * Swapping --font-sans directly would restyle all 31 screens in one commit,
 * which is the same objection that put the colour tokens behind an attribute.
 *
 * ONE VARIABLE FILE, not four statics like the mono above. Google Fonts serves
 * IBM Plex Sans v23 as a variable face - all four requested weights resolve to
 * the same URL - so 400-700 comes from 45KB instead of four files. Pulled from
 * the gstatic URL its CSS resolves to, latin subset, matching the process
 * recorded above for the mono files. OFL, so redistribution here is permitted.
 * Owner approved the download on #413. */
const plexSans = localFont({
  src: [{ path: './fonts/plex-sans-latin-var.woff2', weight: '400 700', style: 'normal' }],
  variable: '--font-sans-terminal',
  display: 'swap',
});

const plexMono = localFont({
  src: [
    { path: './fonts/plex-mono-latin-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/plex-mono-latin-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/plex-mono-latin-600.woff2', weight: '600', style: 'normal' },
    { path: './fonts/plex-mono-latin-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  // Without this, relative URLs in openGraph.images (below) resolve against
  // whatever host issued the request - in production that silently defaulted
  // to localhost:3000 (visible as a build warning), so every shared link's
  // preview image has been broken since launch. Also needed for sitemap.ts's
  // canonical entry URLs.
  metadataBase: new URL('https://liquidity-hq.com'),
  title: {
    default: 'LiquidityHQ',
    template: '%s - LiquidityHQ',
  },
  description: 'Real-time crypto trading intelligence - whale trades, funding rates, squeeze alerts, and AI analysis.',
  manifest: '/manifest.json',
  openGraph: {
    type: 'website',
    siteName: 'LiquidityHQ',
    title: 'LiquidityHQ - Crypto Trading Intelligence',
    description: 'Real-time crypto trading intelligence - whale trades, funding rates, squeeze alerts, and AI analysis.',
    images: [{ url: '/icons/icon-512.jpg', width: 512, height: 512, alt: 'LiquidityHQ' }],
  },
  twitter: {
    card: 'summary',
    title: 'LiquidityHQ',
    description: 'Real-time crypto trading intelligence - whale trades, funding rates, squeeze alerts, and AI analysis.',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'LiquidityHQ',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Matches the app's real body background (app/globals.css) - was
  // #0d0d0d, a stale value from before the icon redesign that public/
  // manifest.json also had and got corrected there but was missed here.
  themeColor: '#06070a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${figtree.variable} ${plexSans.variable} ${plexMono.variable}`} suppressHydrationWarning>
      {/* data-design before the first paint (#719).
       *
       * A RAW <script>, NOT <Script strategy="beforeInteractive">, and that
       * distinction is the whole fix. next/script routes even
       * beforeInteractive through Next's own loader: the served HTML carries
       * it as a JSON payload (`[{"children":"…","id":"design-init"}]`) that
       * runs during the hydration bootstrap. Measured - at
       * readyState === 'interactive' the attribute was still absent. A plain
       * inline script in <head> is executed synchronously by the browser
       * before it paints anything, which is what this needs.
       *
       * Why it needs it at all: DesignModeProvider sets this attribute in a
       * useEffect. That was fine while terminal was opt-in - someone who typed
       * ?design=terminal tolerates one frame of the old palette. It stops
       * being fine now that `/` is terminal for EVERY visitor: the landing
       * page would paint the current design's light ground and then swap to
       * terminal's near-black, on the first frame a prospective user sees.
       *
       * The precedence MUST match resolveDesignMode in lib/designMode.ts.
       * It is duplicated because this runs before any module is loaded, which
       * is the point. It is kept in step by __tests__/designMode.test.mts,
       * which extracts this exact string and runs both against every
       * combination of inputs rather than trusting this comment.
       *
       * #748 removed the interpolated route list. Terminal is the default on
       * every route now, so there is no list to mirror and no pathname to
       * read - the script is the param, the stored value, then terminal. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){try{var q=new URLSearchParams(window.location.search).get('design');var s=null;try{s=localStorage.getItem('lhq-design-mode');}catch(e){}var m=q==='terminal'?'terminal':q==='current'?'current':s==='terminal'?'terminal':s==='current'?'current':'terminal';if(m==='terminal'){document.documentElement.setAttribute('data-design','terminal');}else{document.documentElement.removeAttribute('data-design');}}catch(e){}})();`,
        }}
      />
      {/* No manual apple-touch-icon <link> here - app/apple-icon.png's file
          convention already generates the correct tag automatically. The old
          hardcoded one pointed at /icons/icon-192.jpg, which the icon
          redesign deleted; keeping it would have shipped a broken link
          alongside the correct auto-generated one. */}
      {/* consent-pending is set here, in the server markup, and removed by
          components/CookieConsent.tsx once it has read the stored consent
          state. It holds the Ask AI FAB back for those first few frames.
          Without it the FAB painted immediately, then the consent bar mounted
          and displaced it - which is how it got reported as "the FAB
          disappears". See body.consent-pending in globals.css. */}
      {/* suppressHydrationWarning, for the same reason <html> above has it, and
          it is the class on THIS line that makes it necessary.

          consent-pending is in the server markup, and the beforeInteractive
          script below removes it before React hydrates - deliberately, that is
          the whole point of #337. So a returning visitor hydrates against a
          <body> whose class React did not write, and React reports it:

            + Client   className="consent-pending"
            - Server   className=""

          "Server" there is the DOM as React FOUND it, not what the server sent.
          The server did send consent-pending; the script had already taken it
          off by the time React looked. Nothing is broken - React leaves the DOM
          alone for an attribute mismatch, so the FAB correctly stays visible.

          Suppressing it is not hiding the problem, it is the problem going
          away: the warning fired on EVERY page load for every visitor who has
          answered the consent bar, which is everyone after their first visit.
          A console error that is wrong every time is worse than no error - it
          trains you to scroll past the one that is real.

          Scope is exactly right by accident of the API: suppressHydrationWarning
          is one level deep, so this silences <body>'s own attributes and nothing
          inside it. A genuine mismatch in the tree still reports. */}
      <body className="consent-pending" suppressHydrationWarning>
        {/* beforeInteractive - injected into the initial server HTML and
            runs before hydration, so data-theme is correct before first
            paint (no flash of the wrong theme). Mirrors lib/theme.ts's
            getStoredTheme(): explicit localStorage choice wins, otherwise
            follow the device's prefers-color-scheme. */}
        {/* CONSENT DECIDED BEFORE HYDRATION (#337), with the #326 net behind it.

            body.consent-pending hides the Ask AI FAB outright. It is set in
            this server markup and was removed only by a useEffect in
            CookieConsent - so the button waited on React, and QA measured a
            first-time mobile visitor going ~2s with no button while a cold
            instance hydrated.

            A useEffect cannot run before hydration, so the button could not be
            made to appear sooner from inside React. This reads the stored
            consent answer HERE instead, before hydration: a returning visitor -
            anyone who has already accepted or declined - gets the class cleared
            in the same tick as first paint, and never waits at all.

            A genuine first-time visitor still waits, and SHOULD: the banner is
            about to appear and the FAB would be shoved by it, which is how this
            got reported as "the FAB disappears" in the first place.

            The 3s timeout stays as the net from #326. It now covers only the
            case it was written for - the class never being cleared at all
            because React did not run - rather than being the primary mechanism
            on mobile, which is what QA measured it silently becoming.

            SAFETY NET for consent-pending (#326).
            body.consent-pending hides the Ask AI FAB outright
            (visibility:hidden), it is set in this server markup, and the ONLY
            thing that removes it is a useEffect in components/CookieConsent.tsx.
            So anything that stops that component mounting - blocked script,
            failed or delayed hydration, an aggressive shields setting - leaves
            the FAB permanently invisible, with no error and nothing to see in
            the console. The button is fine; it is waiting for a signal that
            never arrives.
            This clears it after 3s regardless. Deliberately NOT React: the
            failure being guarded against is React not running. The normal path
            still wins - CookieConsent removes it within a frame or two - and
            this only ever fires when that did not happen. */}
        <Script id="consent-pending-failsafe" strategy="beforeInteractive">
          {`(function(){var b=document.body;function go(){try{var v=localStorage.getItem('lhq_analytics_consent_v1');if(v==='granted'||v==='denied'){b.classList.remove('consent-pending');}}catch(e){}try{setTimeout(function(){try{b.classList.remove('consent-pending');}catch(e){}},3000);}catch(e){}}try{go();}catch(e){}})();`}
        </Script>
        <Script id="theme-init" strategy="beforeInteractive">
          {`(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`}
        </Script>
        <DesignModeProvider>
          <AppShell>{children}</AppShell>
        </DesignModeProvider>
      </body>
    </html>
  );
}
