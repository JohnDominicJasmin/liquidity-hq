'use client';
import { useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import BrandMark from '@/components/BrandMark';
import type { LandingDict, Locale } from '@/lib/i18n/dictionaries';
import { useMarket, COINS } from '@/lib/marketStore';
import { useMobileLayout, LANDING_MOBILE_QUERY } from '@/lib/useViewport';
import { buildEvidence, type EvidenceRow } from '@/lib/arenaEvidence';

/* Landing in the Monochrome Terminal direction.
 *
 * SPEC: design-handoff-dir/design-handoff-landing-7a/specs/landing.md
 * FRAME: Landing 7a.dc.html · 7a  (desktop 1440, mobile 390)
 *
 * Numbers below come from the frame. QA measured it independently before this
 * was written and every size corroborated - 54/46/36/34 desktop, 32/26/24
 * mobile, ticker 34/30, CTAs 50/48/46. Where the spec's prose and the frame
 * could disagree, the frame wins; here they do not.
 *
 * Do NOT build frame 6a. It predates the designer reading LandingContent.tsx,
 * invents 8 feature cards where we have 6, and omits five sections that exist
 * in production - building it would delete 24 links from the route.
 *
 * TWO TREES, ONE RENDERED. Not one tree with display:none. A hidden subtree
 * still mounts, which on this route would open a second ticker subscription
 * against wss://stream.binance.com. Acceptance criterion 30 checks the
 * inactive tree is ABSENT by node count; criterion 31 counts WebSocket
 * constructions. See lib/useViewport.ts.
 *
 * COLOUR. The only place a sign maps to colour on this route is the ticker's
 * change value - a price change genuinely is directional. Everywhere else,
 * including every evidence row, colour comes from the `fire` field. The frame
 * shows a green verdict because its fixture is bullish, NOT because the
 * verdict is a green element; hardcoding green passes every check we own and
 * lies on every bearish read.
 */

interface Props {
  dict:   LandingDict;
  locale: Locale;
  dir:    'ltr' | 'rtl';
}

const DASH = '—';

const fmtPrice = (n: number | null | undefined) =>
  n == null ? DASH : n.toLocaleString('en-US', {
    minimumFractionDigits: n < 1 ? 4 : 2, maximumFractionDigits: n < 1 ? 4 : 2,
  });

const fmtChange = (n: number | null | undefined) =>
  n == null ? DASH : `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`;

/* One icon + href per features.cards[i]. Structural, not translated - the same
   arrangement LandingContent.tsx uses, kept identical so the two designs
   cannot drift on which card points where. Acceptance criterion 3 asserts this
   exact order. */
const FEATURE_META: Array<{ href: string; icon: ReactNode }> = [
  { href: '/arena',     icon: <path d="M3 12h3l2-7 4 14 2-7h7" /> },
  { href: '/settings',  icon: <path d="M12 4a5 5 0 0 0-5 5v3.2c0 .5-.2 1-.5 1.4L5 16h14l-1.5-2.4c-.3-.4-.5-.9-.5-1.4V9a5 5 0 0 0-5-5Zm-2.5 14a2.5 2.5 0 0 0 5 0" /> },
  { href: '/briefing',  icon: <><path d="M12 3v4M4.9 8.9l1.4 1.4M19.1 8.9l-1.4 1.4M3 15h18" /><path d="M6 15a6 6 0 0 1 12 0" /></> },
  { href: '/news',      icon: <><path d="M5 4h11a2 2 0 0 1 2 2v13a1 1 0 0 1-1.7.7L15 18H6a2 2 0 0 1-2-2V4Z" /><path d="M8 8h6M8 11.5h6M8 15h3" /></> },
  { href: '/dashboard', icon: <path d="M3 13c3-4 6-5 9-5s6 3 9 5c-3 4-6 5-9 5s-6-1-9-5Zm5 0h.01M15 9c1 1.5 1 3 0 4" /> },
  { href: '/scanner',   icon: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21" /></> },
];

/* Footer columns, unchanged from LandingContent.tsx. The route's link census
   is 28 and criterion 2 fails below that, so this list is load-bearing rather
   than cosmetic - dropping one link is a §4 regression. */
const FOOTER_COLS = (d: LandingDict) => [
  { title: d.footer.columns.product,  links: [
    ['/dashboard', d.footer.links.dashboard], ['/arena', d.footer.links.arena],
    ['/briefing',  d.footer.links.briefing],  ['/news',  d.footer.links.news]] },
  { title: d.footer.columns.analysis, links: [
    ['/scanner', d.footer.links.scanner], ['/liq', d.footer.links.liq],
    ['/funding', d.footer.links.funding], ['/correlation', d.footer.links.correlation]] },
  { title: d.footer.columns.tools,    links: [
    ['/journal', d.footer.links.journal], ['/calc', d.footer.links.calc],
    ['/alerts',  d.footer.links.alerts],  ['/hours', d.footer.links.hours]] },
  { title: d.footer.columns.account,  links: [
    ['/login', d.footer.links.signIn], ['/login?signup=1', d.footer.links.createAccount],
    ['/upgrade', d.footer.links.pricing], ['/about', d.footer.links.about],
    ['/disclaimer', d.footer.links.disclaimer],
    /* THREE UNTRANSLATED LITERALS, CARRIED NOT INTRODUCED.
       LandingContent.tsx:284-286 hardcodes these in English, so every non-en
       locale already shows them untranslated. Acceptance criterion 35 requires
       every user-visible string to resolve through dict.*, and these do not.
       Reproducing the gap keeps the link census at 28; fixing it needs three
       new dict keys in every locale file, which is a separate change and is
       reported rather than folded in silently. */
    ['/terms', 'Terms of Use'], ['/privacy', 'Privacy Policy'], ['/refund', 'Refund Policy']] },
] as const;

/* Six risk-disclosure items. Same untranslated-literal situation as above -
   hardcoded English in LandingContent.tsx:297-302. Criterion 6 asserts six. */
const RISK_ITEMS: Array<[string, string]> = [
  ['Educational Use', 'All content - signals, scores, alerts, and AI commentary - is for informational purposes only. Nothing constitutes a recommendation to buy, sell, or hold any asset.'],
  ['Trading Risk', 'Crypto trading involves substantial risk. Prices are volatile, leverage magnifies losses, and most active traders lose money. Only trade with money you can afford to lose.'],
  ['No Investment Advice', 'We are not a registered investment advisor. You are solely responsible for your own trading decisions. Consult a licensed professional before making any investment decision.'],
  ['AI Analysis', 'LiquidityAI is powered by xAI Grok. AI output can be incomplete, outdated, or wrong - never use it as your sole basis for a trade. Always verify against the raw data shown.'],
  ['Data Sources', 'Price, funding, and OI data sourced from Binance, Bybit, Finnhub, and Alternative.me. We do not guarantee accuracy, completeness, or availability of third-party feeds.'],
  ['No Affiliation', 'LiquidityHQ is not affiliated with, endorsed by, or sponsored by any exchange or data provider referenced here. All trademarks belong to their respective owners.'],
];

/* ── the live read panel ─────────────────────────────────────────────────── */

function EvidenceRows({ rows }: { rows: EvidenceRow[] }) {
  return (
    <>
      {rows.map(r => {
        /* fire, never sign. A quiet row holding a positive number stays --txt. */
        const colour = r.fire === 'green' ? 'var(--green)'
                     : r.fire === 'red'   ? 'var(--red)'
                     : r.value === null   ? 'var(--txt2)' : 'var(--txt)';
        const marker = r.fire === 'green' ? 'var(--green)'
                     : r.fire === 'red'   ? 'var(--red)' : 'var(--mark-idle)';
        return (
          <div key={r.label} className="lt-ev">
            <span className="lt-ev-mark" style={{ background: marker }} />
            <span className="lt-ev-label">{r.label}</span>
            <span className="lt-ev-val" style={{ color: colour }}>{r.value ?? DASH}</span>
            <span className="lt-ev-note">{r.note ?? ''}</span>
          </div>
        );
      })}
    </>
  );
}

function LiveRead({ mobile }: { mobile: boolean }) {
  const { store } = useMarket();
  const coin = store.coins['btc'];

  const rows = useMemo(() => buildEvidence({
    coin,
    spotPrice: coin?.price ?? null,
    cbPremium: null,     // no source wired - renders an em dash, never a stand-in
  }), [coin]);

  /* NO VERDICT SOURCE ON A PUBLIC ROUTE.
     The spec sources the verdict from "the current read ... from the same store
     /arena reads". That read is generated per user and cached under
     `arena-results-v2` in their own localStorage - a signed-out visitor has
     none, and deriving a different verdict from the market data would be
     inventing one, which the owner's rule forbids.
     The spec handles this state explicitly: "no read available -> NO READ in
     --txt2, confidence row hidden". So that is what renders, and the evidence
     rows below it are real live data. Flagged to QA rather than papered over. */
  const verdict: { label: string; colour: string; conf: number | null } =
    { label: 'NO READ', colour: 'var(--txt2)', conf: null };

  const live = coin?.price != null;

  return (
    <section className="lt-read" aria-label="Live read">
      <header className="lt-read-head">
        <span className="lt-dot" style={{ background: live ? 'var(--green)' : 'var(--txt4)' }} />
        <span className="lt-read-label">BTC · PERP · 4H</span>
        <span className="lt-read-ts">{live ? 'LIVE' : 'STALE'}</span>
      </header>

      <div className="lt-read-body">
        <div className="lt-verdict" style={{ color: verdict.colour }}>{verdict.label}</div>

        {verdict.conf !== null && (
          <div className="lt-conf">
            <span className="lt-conf-track">
              <span className="lt-conf-fill" style={{ width: `${verdict.conf}%`, background: verdict.colour }} />
            </span>
            <span className="lt-conf-val">{verdict.conf}</span>
            <span className="lt-conf-lab">CONF</span>
          </div>
        )}

        {/* Entry / Stop / Target are PRICES, not signals - all --txt, they do
            not fire. Absent renders an em dash, never a placeholder price. */}
        <div className="lt-levels">
          {(['Entry', 'Stop', 'Target'] as const).map(l => (
            <div key={l} className="lt-level">
              <span className="lt-level-lab">{l}</span>
              <span className="lt-level-val">{DASH}</span>
            </div>
          ))}
        </div>

        <div className="lt-evidence">
          <EvidenceRows rows={mobile ? rows.slice(0, 6) : rows} />
        </div>
      </div>
    </section>
  );
}

/* ── shared section pieces ───────────────────────────────────────────────── */

function Nav({ dict, mobile, locale }: { dict: LandingDict; mobile: boolean; locale: Locale }) {
  return (
    <nav className="lt-nav" aria-label="Site">
      <Link href="/" className="lt-brand">
        <BrandMark size={mobile ? 22 : 26} tone="dark" />
        <span className="lt-wordmark">LIQUIDITYHQ</span>
      </Link>
      <div className="lt-spacer" />
      <LanguageSwitcher locale={locale} />
      <Link href="/login" className="lt-ghost">{dict.nav.signIn}</Link>
      <Link href="/login?signup=1" className="lt-cta-sm">
        {mobile ? 'START' : dict.nav.getStarted}
      </Link>
    </nav>
  );
}

function Ticker({ mobile }: { mobile: boolean }) {
  const { store } = useMarket();
  /* EXTEND, do not truncate. The frame draws 8 cells; we track 50. Same cell
     pattern, one row, horizontal overflow hidden - spec §Ticker. */
  return (
    <div className="lt-ticker" aria-label="Prices">
      {COINS.map(c => {
        const d = store.coins[c];
        const up = (d?.change ?? 0) >= 0;
        return (
          <div key={c} className="lt-tcell">
            <span className="lt-tsym">{c.toUpperCase()}</span>
            {!mobile && <span className="lt-tpx">{fmtPrice(d?.price)}</span>}
            <span className="lt-tchg" style={{ color: d?.change == null ? 'var(--txt2)' : up ? 'var(--green)' : 'var(--red)' }}>
              {fmtChange(d?.change)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Features({ dict }: { dict: LandingDict }) {
  return (
    <section className="lt-sec lt-features">
      <div className="lt-sec-label">{dict.features.label}</div>
      <h2 className="lt-h2">{dict.features.h2}</h2>
      <p className="lt-sec-sub">{dict.features.sub}</p>
      <div className="lt-fgrid">
        {dict.features.cards.map((card, i) => {
          const meta = FEATURE_META[i];
          if (!meta) return null;
          /* Card's OUTERMOST element is the <a> - criterion 4. A div wrapping
             a link makes the card look clickable and only the text is. */
          return (
            <Link key={meta.href} href={meta.href} className="lt-fcard">
              <svg viewBox="0 0 24 24" width={20} height={20} fill="none"
                   stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                {meta.icon}
              </svg>
              {/* h3, not span. The text rendered either way, but a screen
                  reader navigates this page by headings - as a span the six
                  card titles vanished from the outline and it stopped at the
                  section h2. Production uses h3 here (LandingContent.tsx:152)
                  and these sit under an h2, so h3 is the correct level and
                  nothing else in the outline moves. Caught by QA on #448:
                  "the text is present, the structure is not". */}
              <h3 className="lt-fcard-title">{card.title}</h3>
              <span className="lt-fcard-desc">{card.desc}</span>
              <span className="lt-fcard-open">{dict.features.openLabel}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function HowItWorks({ dict }: { dict: LandingDict }) {
  return (
    <section className="lt-sec lt-how">
      <div className="lt-sec-label">{dict.howItWorks.label}</div>
      <h2 className="lt-h2">{dict.howItWorks.h2}</h2>
      {/* Numbered boxes replace the arrow connectors. The arrow was the only
          RTL-aware element in this section, so this removes an RTL branch
          rather than breaking one - step count and copy unchanged. */}
      <div className="lt-steps">
        {dict.howItWorks.steps.map((s, i) => (
          <div key={s.title} className="lt-step">
            <span className="lt-step-n">{String(i + 1).padStart(2, '0')}</span>
            <h3 className="lt-step-title">{s.title}</h3>
            <span className="lt-step-desc">{s.desc}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Pricing({ dict }: { dict: LandingDict }) {
  return (
    <section className="lt-sec lt-pricing">
      <div className="lt-sec-label">{dict.pricing.label}</div>
      <h2 className="lt-h2">{dict.pricing.h2}</h2>
      <div className="lt-plans">
        <div className="lt-plan">
          <div className="lt-plan-name">{dict.pricing.free.name}</div>
          <div className="lt-price">$0</div>
          <div className="lt-plan-sub">{dict.pricing.free.sub}</div>
          <ul className="lt-plan-list">
            {dict.pricing.free.features.map((f, i) => (
              <li key={i}><span className="lt-tick">{f.included ? '✓' : '✕'}</span>{f.text}</li>
            ))}
          </ul>
          <Link href="/login?signup=1" className="lt-plan-cta">{dict.pricing.free.cta}</Link>
        </div>

        {/* 2px --accent top border marks Pro - criterion 15. */}
        <div className="lt-plan lt-plan-pro">
          <div className="lt-plan-name">
            {dict.pricing.pro.name}
            <span className="lt-badge">{dict.pricing.pro.badge}</span>
          </div>
          <div className="lt-price">$25</div>
          <div className="lt-plan-sub">{dict.pricing.pro.sub}</div>
          <ul className="lt-plan-list">
            {dict.pricing.pro.features.map((f, i) => (
              <li key={i}><span className="lt-tick">✓</span>{f}</li>
            ))}
          </ul>
          <Link href="/upgrade" className="lt-plan-cta lt-plan-cta-pro">{dict.pricing.pro.cta}</Link>
        </div>
      </div>
    </section>
  );
}

function Footer({ dict }: { dict: LandingDict }) {
  return (
    <footer className="lt-footer">
      <div className="lt-footer-top">
        <div className="lt-footer-brand">
          <Link href="/" className="lt-brand">
            <BrandMark size={22} tone="dark" />
            <span className="lt-wordmark">LIQUIDITYHQ</span>
          </Link>
          <p className="lt-footer-desc">{dict.footer.brandDesc}</p>
        </div>
        <div className="lt-footer-cols">
          {FOOTER_COLS(dict).map(col => (
            <div key={col.title} className="lt-footer-col">
              <div className="lt-footer-col-title">{col.title}</div>
              {col.links.map(([href, label]) => (
                <Link key={href} href={href}>{label}</Link>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="lt-risk-divider"><span>RISK DISCLOSURE</span></div>
      <div className="lt-risk">
        {RISK_ITEMS.map(([label, text]) => (
          <div key={label} className="lt-risk-item">
            <div className="lt-risk-label">{label}</div>
            <p className="lt-risk-text">{text}</p>
          </div>
        ))}
      </div>

      <div className="lt-legal">
        <span>{dict.footer.copyright}</span>
        <Link href="/disclaimer">{dict.footer.fullDisclaimer}</Link>
      </div>
    </footer>
  );
}

/* ── the two trees ───────────────────────────────────────────────────────── */

export default function LandingTerminal({ dict, locale, dir }: Props) {
  const mobile = useMobileLayout(LANDING_MOBILE_QUERY);

  const hero = (
    <section className="lt-hero">
      <div className="lt-hero-l">
        <span className="lt-badge-live"><span className="lt-dot" />{dict.hero.badge}</span>
        {/* Two lines, second in --accent. The dict already splits them, which
            is what the frame draws - not a wrap of one string. */}
        <h1 className="lt-h1">
          {dict.hero.h1Line1}<br />
          <span className="lt-h1-accent">{dict.hero.h1Line2}</span>
        </h1>
        <p className="lt-hero-sub">{dict.hero.sub}</p>
        <div className="lt-hero-ctas">
          <Link href="/login?signup=1" className="lt-cta">{dict.hero.ctaPrimary}</Link>
          <Link href="/briefing" className="lt-ghost-lg">{dict.hero.ctaGhost}</Link>
        </div>
        {/* FIXED at 4. Copy, not data - these do not extend. */}
        <div className="lt-stats">
          {([['50', dict.hero.stats.coins], ['35', dict.hero.stats.signals],
             ['Grok', dict.hero.stats.ai], ['Live', dict.hero.stats.telegram]] as const).map(([v, l]) => (
            <div key={v} className="lt-stat"><span className="lt-stat-v">{v}</span><span className="lt-stat-l">{l}</span></div>
          ))}
        </div>
      </div>
      <div className="lt-hero-r"><LiveRead mobile={mobile} /></div>
    </section>
  );

  const sections = (
    <>
      <Nav dict={dict} mobile={mobile} locale={locale} />
      <Ticker mobile={mobile} />
      {hero}
      <Features dict={dict} />
      <HowItWorks dict={dict} />
      <Pricing dict={dict} />
      <section className="lt-sec lt-final">
        <div>
          <h2 className="lt-final-h">{dict.finalCta.h2}</h2>
          <p className="lt-sec-sub">{dict.finalCta.sub}</p>
        </div>
        <Link href="/login?signup=1" className="lt-cta">{dict.finalCta.cta}</Link>
      </section>
      <Footer dict={dict} />
    </>
  );

  /* ONE TREE. data-layout is what criterion 30 counts - at 1440 there must be
     zero [data-layout="mobile"] nodes, and the check is by node count, not by
     computed display, precisely because display:none still mounts. */
  return (
    <div className="lt-root" data-layout={mobile ? 'mobile' : 'desktop'} dir={dir} lang={locale}>
      {sections}
    </div>
  );
}
