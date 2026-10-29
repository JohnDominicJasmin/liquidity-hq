import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import LabelsProvider from '@/components/LabelsProvider';
import NotFoundContent from '@/components/NotFoundContent';

/* THE 404 FOR URLS THAT MATCH NO ROUTE AT ALL (#1740 item 2).
 *
 * WHY THIS FILE AND NOT app/not-found.tsx. This app has TWO root layouts -
 * app/(main)/layout.tsx and app/(intl)/[locale]/layout.tsx - because <html lang> has to differ
 * between them. The Next docs name that exact situation as one of the two cases global-not-found
 * exists for: "multiple root layouts ... so there's no single layout to compose a global 404 from".
 * A top-level app/not-found.tsx has no root layout left to render inside, and a boundary inside
 * [locale] can never fire either, because an unmatched URL is rejected at ROUTING - Next skips
 * rendering entirely. Measured before this file existed: /nope and /ja returned Next's built-in
 * next-error-h1 page, with no data-theme, no app shell and no <html lang> at all.
 *
 * IT BYPASSES BOTH LAYOUTS, so it brings its own document. Per the docs it must return a full HTML
 * document, and it has to import its own global styles, font and theme - "because
 * global-not-found.js bypasses your layout, the OS color scheme is the only signal the default UI
 * sees, so apply your theme (class or attribute) inside this file."
 *
 * THE SHELL MIRRORS components/RootDocument.tsx rather than inventing one: same lang="en", same
 * data-theme="dark", same data-design="terminal". Those three are what the rest of the app serves,
 * and a 404 that renders in a different theme is a worse bug than the one this fixes.
 *
 * DELIBERATELY LEANER THAN RootDocument, which the docs also ask for ("a smaller version of your
 * global styles, and a simpler font family could improve performance of this page"):
 *   - ONE font, not three. globals.css line 6429 points --font-sans at --font-sans-terminal under
 *     data-design="terminal", so plexSans is the only family the body copy actually resolves to.
 *     Figtree and the mono faces would be two more woff2 preloads nothing on this page reads.
 *   - NO AppShell. It carries MarketProvider, NewsProvider, AuthProvider, PostHog, onboarding and
 *     the chat widget - a 404 must not open market websockets.
 *   - NO beforeInteractive scripts. The theme is static here, there is no consent FAB to hold back,
 *     and the signed-in landing redirect is scoped to /, /ko and /zh.
 *
 * LabelsProvider IS needed, and it is the one provider here. NotFoundContent reads its copy through
 * useLabels(), and outside a provider LabelsContext falls back to `t: (key) => key` - the page would
 * render the literal strings NOT_FOUND_TITLE and NOT_FOUND_BODY. LabelsProvider seeds its map from
 * the static lib/labelDefaults.en.json on its first render, so the real English copy is in the
 * server HTML without waiting for /api/labels. */

const plexSans = localFont({
  src: [{ path: './fonts/plex-sans-latin-var.woff2', weight: '400 700', style: 'normal' }],
  variable: '--font-sans-terminal',
  display: 'swap',
});

export const metadata: Metadata = {
  title: '404 - Page not found - LiquidityHQ',
  description: 'The page you are looking for does not exist.',
};

export default function GlobalNotFound() {
  return (
    <html lang="en" data-theme="dark" data-design="terminal" className={plexSans.variable}>
      <body>
        <LabelsProvider>
          <NotFoundContent />
        </LabelsProvider>
      </body>
    </html>
  );
}
