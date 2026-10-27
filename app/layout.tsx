import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import Script from 'next/script';
import './globals.css';
import AppShell from '@/components/AppShell';
import StructuredData from '@/components/StructuredData';
import { organizationGraph } from '@/lib/structuredData';

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
    /* #1740 item 3: was the bare 'LiquidityHQ' - 11 characters on the one page with the most to say
       for itself. This is the DEFAULT, so it titles '/' only; every other route sets its own and gets
       the template below. Kept under ~60 so a search result does not truncate it. */
    default: 'LiquidityHQ - Crypto Liquidity, Funding & Squeeze Analytics',
    template: '%s - LiquidityHQ',
  },
  description: 'Crypto market analytics - whale trades, funding rates, squeeze alerts, and AI analysis.',
  manifest: '/manifest.json',
  openGraph: {
    type: 'website',
    siteName: 'LiquidityHQ',
    /* #1740: the same string as the <title> default above. These three disagreed - <title> said
       'LiquidityHQ', openGraph said 'Crypto Market Analytics', twitter said 'LiquidityHQ' - so
       one page carried three names depending on who asked. appleWebApp.title stays the bare
       'LiquidityHQ' on purpose: that is the installed PWA's name on a home screen, not a page
       title, and it has a much shorter budget. */
    title: 'LiquidityHQ - Crypto Liquidity, Funding & Squeeze Analytics',
    description: 'Crypto market analytics - whale trades, funding rates, squeeze alerts, and AI analysis.',
    // #1633: this pointed at /icons/icon-512.jpg, which does not exist (404), so every shared link showed no picture. The file is a .png.
    // A real 1200x630 share image is a separate, owner-approved piece of work.
    images: [{ url: '/icons/icon-512.png', width: 512, height: 512, alt: 'LiquidityHQ' }],
  },
  twitter: {
    card: 'summary',
    title: 'LiquidityHQ - Crypto Liquidity, Funding & Squeeze Analytics',
    description: 'Crypto market analytics - whale trades, funding rates, squeeze alerts, and AI analysis.',
    images: ['/icons/icon-512.png'],
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
  /* data-design is a static attribute on <html> (#1111). It used to be resolved from ?design= and localStorage by an
     inline script and by DesignModeProvider; with the current-design markup deleted from every page, the only thing
     that switch could still do was strip the terminal tokens off terminal markup. So it is gone, `?design=` no longer
     does anything, and a stale `lhq-design-mode` value in someone's storage is simply never read. */
  return (
    <html lang="en" data-theme="dark" data-design="terminal" className={`${figtree.variable} ${plexSans.variable} ${plexMono.variable}`} suppressHydrationWarning>
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
        {/* #1740 item 4: the publisher, on every page, so a crawler can tie the whole site to one
            entity. Page-specific graphs (FAQPage, Product, BreadcrumbList) are added by the layout
            of the page they describe, not here. */}
        <StructuredData graph={organizationGraph()} />
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
        {/* A SIGNED-IN VISITOR LEAVES THE LANDING PAGE BEFORE HYDRATION, NOT ~13s AFTER IT (#1309 item 12 follow-up).
            Measured on production d01f366: `responseEnd` 677ms, `domContentLoaded` 733ms, `loadEventEnd` 746ms -
            and the signed-in visitor was STILL READING MARKETING COPY at 13,350ms. A second sample: 6,933ms. Both
            ended on /arena, so the redirect works; it is just late by more than an order of magnitude.

            THE DOCUMENT IS FINISHED IN THREE QUARTERS OF A SECOND. Everything after that is ours. The redirect
            lives in a useEffect in components/LandingContent.tsx and cannot run until React hydrates, and the
            `user` it waits on cannot resolve until AuthProvider's getSession settles after that.

            This is the SAME FIX AND THE SAME REASONING as the consent-pending script directly below, which exists
            because the Ask AI FAB waited ~2s on hydration for a class that a returning visitor's localStorage
            could have decided immediately. A useEffect cannot run before hydration; this can.

            WHY IT IS SAFE TO DECIDE HERE, rather than a heuristic that races the real auth:

              * The 90-SECOND MARGIN IS SUPABASE'S OWN. auth-js 2.106.2 treats a session as expired when
                `expires_at * 1000 - Date.now() < EXPIRY_MARGIN_MS`, and that constant is
                AUTO_REFRESH_TICK_THRESHOLD (3) x AUTO_REFRESH_TICK_DURATION_MS (30s) = 90,000. Using the same
                test means this never redirects on a token the SDK would itself refuse and refresh - the
                disagreement case is the only one that could send someone to /arena wrongly.
              * THE STORED VALUE IS PLAIN JSON. `setItemAsync` is `storage.setItem(key, JSON.stringify(data))` -
                no base64 wrapper on localStorage - so `expires_at` (unix SECONDS) is readable without the SDK.
                Checked in node_modules rather than assumed; if it were encoded this script would parse nothing,
                catch, and silently do nothing, which is indistinguishable from working.
              * NO REDIRECT LOOP IS POSSIBLE. /arena does not bounce signed-out visitors back - it renders with
                features locked and only sends to /login on an explicit action (app/arena/page.tsx:1750). So the
                worst case of a false positive is a visitor landing on /arena signed-out, not a cycle.
              * CRAWLERS ARE UNAFFECTED, which protects #1740. No localStorage token means no redirect, so the
                marketing copy is still what a crawler is served - the whole point of #1740, and the thing this
                script could most easily have broken without any timing measurement noticing.

                NO WORD COUNT HERE ON PURPOSE, and the reason is not that the page is hard to measure.

                This line quoted "1,013 words" with no method attached. Three sessions measured the same
                production page on 2026-10-27 and the results group cleanly ONCE THE METHOD IS NAMED:

                   A  alpha words only, script+style bodies stripped    835 / 855
                   B  all whitespace tokens, same stripping           1,060 / 1,059 / 1,059
                   C  script bodies counted                           1,614 / 1,613 / 1,613

                B agrees to within ONE TOKEN across three independent instruments, so the page is not
                ambiguous - only the reporting was. The withdrawn 1,013 sits in the B family on an earlier
                build; 1,013 -> 1,059 is an ordinary copy change, not a contradiction.

                The number is still gone, because a bare figure in a comment is unverifiable WHATEVER it is
                and whether or not it reconciles: nothing here can fail when it drifts. So this asserts the
                PROPERTY - a crawler is served the copy - and the figure belongs in a check that states its
                own method and can go red.

                STILL UNMEASURED, and it is a real axis rather than a caveat: all three methods above are
                regex over raw HTML. A browser's innerText excludes hidden and offscreen text that a regex
                counts, so it would differ - and it would differ MOST on /calc and /hours, which carry
                sr-only headings. Nobody should compare a browser-measured page against these numbers.

            ONLY THE THREE LANDING ROUTES. /about, /faq and the rest have no such redirect and must not gain one. */}
        <Script id="landing-signed-in-redirect" strategy="beforeInteractive">
          {`(function(){try{var p=location.pathname.replace(/\\/+$/,'')||'/';if(p!=='/'&&p!=='/ko'&&p!=='/zh')return;var ls=window.localStorage;for(var i=0;i<ls.length;i++){var k=ls.key(i);if(!k||k.slice(0,3)!=='sb-'||k.indexOf('-auth-token')<0)continue;var s=JSON.parse(ls.getItem(k)||'null');var e=s&&s.expires_at;if(typeof e==='number'&&e*1000-Date.now()>90000){location.replace('/arena');return;}}}catch(e){}})();`}
        </Script>
        <Script id="consent-pending-failsafe" strategy="beforeInteractive">
          {`(function(){var b=document.body;function go(){try{var v=localStorage.getItem('lhq_analytics_consent_v1');if(v==='granted'||v==='denied'){b.classList.remove('consent-pending');}}catch(e){}try{setTimeout(function(){try{b.classList.remove('consent-pending');}catch(e){}},3000);}catch(e){}}try{go();}catch(e){}})();`}
        </Script>
        <Script id="theme-init" strategy="beforeInteractive">
          {`(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`}
        </Script>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
