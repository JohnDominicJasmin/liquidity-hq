'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { track } from '@/lib/analytics';
import TerminalNav from './TerminalNav';
import {
  NavDashboard, NavBriefing, NavArena, NavMarkets, NavScanner,
  NavLiqMap, NavFunding, NavCorrelation, NavResearch,
  NavNews, NavCalendar, NavJournal, NavCalc, NavAlerts, NavHours, NavPlaybook,
  NavSettings, NavAbout,
} from './icons';
import { useLabels } from '@/lib/labels';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { rendersOwnNav } from '@/lib/navRoutes';
import { useDialogFocusTrap } from '@/lib/useDialogFocusTrap';
import type { LabelKey } from '@/lib/labelKeys';
import type { ComponentType } from 'react';

/* ── Nav data ──────────────────────────────────────────────────────────────── */

type NavIcon = ComponentType<{ size?: number }>;
type NavDest = { path: string; labelKey: LabelKey; Icon: NavIcon };
type NavSection = { headerKey: LabelKey; items: NavDest[] };

const NAV_SECTIONS: NavSection[] = [
  { headerKey: 'NAV_SECTION_MAIN', items: [
    { path: '/dashboard', labelKey: 'NAV_DASHBOARD', Icon: NavDashboard },
    { path: '/briefing',  labelKey: 'NAV_BRIEFING',  Icon: NavBriefing },
  ] },
  { headerKey: 'NAV_SECTION_ANALYSIS', items: [
    { path: '/arena',         labelKey: 'NAV_ARENA',           Icon: NavArena },
    { path: '/markets',       labelKey: 'NAV_MARKETS',         Icon: NavMarkets },
    { path: '/scanner',       labelKey: 'NAV_SETUP_SCANNER',   Icon: NavScanner },
    { path: '/liq',           labelKey: 'NAV_LIQUIDATION_MAP', Icon: NavLiqMap },
    { path: '/funding',       labelKey: 'NAV_FR_HISTORY',      Icon: NavFunding },
    { path: '/correlation',   labelKey: 'NAV_CORRELATION',     Icon: NavCorrelation },
  ] },
  { headerKey: 'NAV_SECTION_RESEARCH', items: [
    { path: '/research',      labelKey: 'NAV_RESEARCH',      Icon: NavResearch },
    { path: '/news',          labelKey: 'NAV_NEWS',          Icon: NavNews },
    { path: '/econ-calendar', labelKey: 'NAV_ECON_CALENDAR', Icon: NavCalendar },
    { path: '/learn',         labelKey: 'NAV_GLOSSARY',      Icon: NavPlaybook },
  ] },
  { headerKey: 'NAV_SECTION_MY_TOOLS', items: [
    { path: '/journal',  labelKey: 'NAV_JOURNAL',        Icon: NavJournal },
    /* NAV_CALCULATORS, not NAV_POSITION_SIZER (#846).
     *
     * Two bugs in one label. The route is a six-tool hub - sizer, liquidation,
     * PnL, R:R, funding, DCA - and "Position Sizer" names one of the six, which
     * is also the name of the FIRST TAB on the page it opens. On mobile that put
     * two controls reading "Position Sizer" on the same screen: this one
     * navigates, the tab does not. Same name, different action, no way to tell
     * them apart by ear.
     *
     * It was also drift. `lib/navRoutes.ts` - the module #714 created precisely
     * so the two navs could not disagree - already called this route
     * NAV_CALCULATORS. This tile is the copy that was left behind, from when
     * /calc really was only a position sizer.
     *
     * Renaming the TAB instead would be wrong: that tab genuinely is the
     * position sizer, and the hub is genuinely the calculators. */
    { path: '/calc',     labelKey: 'NAV_CALCULATORS', Icon: NavCalc },
    { path: '/alerts',   labelKey: 'NAV_ALERTS',         Icon: NavAlerts },
    { path: '/hours',    labelKey: 'NAV_BEST_HOURS',     Icon: NavHours },
    { path: '/playbook', labelKey: 'NAV_PLAYBOOK',       Icon: NavPlaybook },
  ] },
  { headerKey: 'NAV_SECTION_ACCOUNT', items: [
    /* Was `modal: true`, which intercepted this entry and opened SettingsModal
       instead of navigating - so the tile named /settings and went somewhere
       else. That component is deleted; see the note on renderTile below. */
    { path: '/settings', labelKey: 'NAV_SETTINGS_LABEL', Icon: NavSettings },
    { path: '/about',    labelKey: 'NAV_ABOUT',          Icon: NavAbout },
  ] },
];

const ALL_DESTS: NavDest[] = NAV_SECTIONS.flatMap(s => s.items);

/* ── NavDrawer ─────────────────────────────────────────────────────────────── */
export default function NavDrawer() {
  const { t } = useLabels();
  const [drawerOpen, setDrawerOpen]     = useState(false);
  const [navQuery, setNavQuery]         = useState('');
  // #1149: signOut()'s network call can be slow (not just fail). Without this
  // the drawer closed the instant Sign Out was tapped, so a slow-but-working
  // network looked identical to a broken button - nothing on screen for
  // however long the request took. Kept visible with a spinner instead.
  const [signingOut, setSigningOut]     = useState(false);
  /* 768px, the same breakpoint .hamburger and .tnav-mmore already use (#731). */
  const isDesktop = useIsDesktop();
  const pathname = usePathname();
  const { user, loading: authLoading, signOut } = useAuth();
  /* #1309 item 3 (R-32): the drawer had no Escape, no dialog role and did not move focus. The shared hook
     (#1243) gives it the three behaviours a modal panel owes: focus moves in on open, Tab stays inside,
     Escape closes and focus returns to whatever opened it. */
  const drawerRef = useDialogFocusTrap<HTMLDivElement>(drawerOpen, () => setDrawerOpen(false));

  // Hide the floating Ask AI button while the mobile nav drawer is open -
  // it otherwise sits on top of the bottom nav links and eats their taps.
  useEffect(() => {
    document.body.classList.toggle('nav-drawer-open', drawerOpen);
    if (!drawerOpen) setNavQuery(''); // reopen clean
    return () => { document.body.classList.remove('nav-drawer-open'); };
  }, [drawerOpen]);

  /* TerminalNav lives HERE rather than in AppShell because the drawer's
     open state is local to this component; rendering it here means the
     opener is a prop instead of a window event threaded through the shell.
     Terminal is the only design now (#1111, Pattern A) - this used to also
     render a current-design `.app-bar` and `.mobile-tab-bar` here, gated on
     `mode !== 'terminal'`, which is why the comment above used to warn about
     the two tab bars stacking. Both current-design blocks are gone; only
     the shared off-canvas drawer below is still conditional (on `isDesktop`,
     unrelated to design mode). */

  /* NOT ON THE LANDING PAGE (#714).
   *
   * LandingTerminal renders its own nav - `Sign In` and `Get Started Free` -
   * and this one was rendering underneath it, so `/` served two stacked navs.
   * The app nav is the wrong one to show there: its five items (Overview,
   * Arena, Scan, Flow, Book) are all GATED routes, so a logged-out visitor
   * clicking any of them lands somewhere they cannot use, on the page whose
   * only job is to convert them.
   *
   * Latent until #719. `.tnav` renders only in terminal mode, and before
   * terminal became the default on `/`, anyone seeing it had typed
   * ?design=terminal and was already a signed-in operator reading an app nav
   * as normal. Making it the default turned a duplicate nobody met into the
   * first thing every visitor sees.
   *
   * A RENDER GATE, NOT `body.landing { display: none }`. That block hides the
   * rest of the app chrome and I tried it first - but `body.landing` is added
   * by an effect in LandingContent, so the CSS cannot apply until after
   * hydration and the nav FLASHES on every landing visit. Measured: the
   * regression test failed on exactly that, asserting immediately after
   * navigation. #719 established that a flash on the acquisition surface is
   * the thing to avoid, so the nav must never be in the tree here rather than
   * be painted and then hidden.
   *
   * Route-based rather than a `body.landing` read because the pathname is
   * known synchronously on the first render, server and client. Same shape as
   * AppShell's own isChromeless()/isAuthRoute() gates.
   *
   * WAS `pathname === '/'` UNTIL #845. That covered the route in front of me
   * and not the family, so `/learn` - the same `.lp-nav` + `.lp-logo` shell -
   * kept the app nav and had its logo and both hero buttons painted over the
   * moment #748 made terminal the default. The membership test moved to
   * `rendersOwnNav` in lib/navRoutes.ts, next to the route groups it belongs
   * with; add routes there rather than reintroducing a comparison here. */
  const onLanding = rendersOwnNav(pathname);

  return (
    <>
      {!onLanding && <TerminalNav onOpenDrawer={() => setDrawerOpen(true)} />}

      {/* MOBILE AND TABLET ONLY (#731). Owner: "the side menu on the right
          side, it should be only available on mobile view or tablet."

          `.nav-menu` is 360px wide and slid off-canvas by a transform that
          left 8px of its near-black ground inside the right edge on desktop -
          a visible strip on every route, in BOTH designs, scaling with the
          window (14px at 2818px). `pointer-events: none` is why it intercepted
          nothing and every click test passed, and why platform-audit reported
          `overflow 0`: 8px of a fixed element INSIDE the viewport is neither an
          overflow nor a page wider than the screen. Nothing in the suite asked
          whether an off-canvas panel is actually off canvas.

          A RENDER GATE, NOT `display: none`, per #728 - a CSS hide applied
          after hydration paints first.

          768px because that is the breakpoint the drawer's own openers already
          use: `.hamburger` is hidden at `min-width: 768px` (globals.css:1022)
          and `.tnav-mmore` lives in `@media (max-width: 767px)`. So on desktop
          the drawer already had no opener in either design - it was unreachable
          chrome bleeding 8px. No new number invented.

          SAFE ONLY BECAUSE #732 LANDED FIRST. Until then `.tnav-avatar` was
          terminal's DESKTOP drawer opener and the sole path to ~15 routes;
          gating here would have stranded them. The bar now reaches those routes
          directly, which is what makes this a removal rather than a
          regression. */}
      {!isDesktop && (
      <div
        id="nav-drawer"
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        tabIndex={-1}
        className={`nav-drawer${drawerOpen ? ' open' : ''}`}
        /* inert while closed - the same fix as GrokChat. The drawer is hidden
           with a transform and pointer-events:none, so its 23 focusable
           controls otherwise stayed in the tab order behind an invisible panel.
           STILL LOAD-BEARING, on mobile. The render gate above removes those
           controls from the document entirely on desktop, which solves it there
           outright - but below 768 the drawer exists and spends most of its
           life closed, so this is what keeps it out of the tab order. Restored
           after QA noticed I had dropped the explanation with the comment block
           the #731 note replaced; a future reader seeing a bare `inert` and the
           new gate could reasonably conclude the gate had made it redundant. */
        inert={!drawerOpen}
        aria-hidden={!drawerOpen}
      >
        <div className="nav-overlay" onClick={() => setDrawerOpen(false)} />
        <div className="nav-menu">
          <div className="nav-search-bar">
            <div className="nav-search-wrap">
              <svg className="nav-search-icon" width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
                <line x1="13.5" y1="13.5" x2="17.5" y2="17.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <input
                className="nav-search"
                type="text"
                value={navQuery}
                onChange={e => setNavQuery(e.target.value)}
                placeholder={t('NAV_SEARCH_PLACEHOLDER')}
                aria-label={t('NAV_SEARCH_PLACEHOLDER')}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              {navQuery && (
                <button className="nav-search-clear" onClick={() => setNavQuery('')} aria-label="Clear search" type="button">
                  <svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <line x1="5" y1="5" x2="15" y2="15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    <line x1="15" y1="5" x2="5" y2="15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {(() => {
            const renderTile = (d: NavDest) => {
              const on = pathname === d.path;
              const inner = (
                <>
                  <span className="nav-tile-icon"><d.Icon size={20} /></span>
                  <span className="nav-tile-label">{t(d.labelKey)}</span>
                </>
              );
              /* Every destination is a real link now. The one exception was
                 Settings, which rendered a <button> that opened a modal while
                 naming /settings as its path - so it had no href, could not be
                 opened in a new tab, middle-clicked or bookmarked, and gave a
                 screen reader "button" where every sibling said "link". */
              return (
                <Link
                  key={d.path}
                  href={d.path}
                  className={`nav-tile${on ? ' on' : ''}`}
                  aria-current={on ? 'page' : undefined}
                  onClick={() => setDrawerOpen(false)}
                >
                  {inner}
                </Link>
              );
            };

            const q = navQuery.trim().toLowerCase();
            if (q) {
              const matches = ALL_DESTS.filter(d => t(d.labelKey).toLowerCase().includes(q));
              return matches.length ? (
                <div className="nav-grid">{matches.map(renderTile)}</div>
              ) : (
                <div className="nav-empty">{t('NAV_NO_MATCHES', { query: navQuery.trim() })}</div>
              );
            }
            return NAV_SECTIONS.map(sec => (
              <div key={sec.headerKey} className="nav-section">
                <div className="nav-section-label">{t(sec.headerKey)}</div>
                <div className="nav-grid">{sec.items.map(renderTile)}</div>
              </div>
            ));
          })()}

          <div className="nav-divider" />
          {!authLoading && (
            user ? (
              <button
                className="nav-item nav-signout"
                disabled={signingOut}
                onClick={async () => {
                  if (signingOut) return;
                  setSigningOut(true);
                  track.signOut();
                  await signOut();
                  // Hard navigation - see the note on the Settings control
                  // (#304). Not closing the drawer first (#1149) - the
                  // navigation discards it along with everything else, and
                  // closing it here would hide the spinner above for
                  // whatever this await actually took.
                  window.location.assign('/login');
                }}
              >
                {signingOut ? <span className="login-spinner" /> : t('NAV_SIGN_OUT_DRAWER')}
              </button>
            ) : (
              <Link
                href="/login"
                className={`nav-item${pathname === '/login' ? ' on' : ''}`}
                onClick={() => setDrawerOpen(false)}
              >
                {t('NAV_SIGN_IN')}
              </Link>
            )
          )}
        </div>
      </div>
      )}
    </>
  );
}
