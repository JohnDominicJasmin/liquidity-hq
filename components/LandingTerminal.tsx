'use client';
/* Terminal-mode landing page (#413 canvas mirror, design-handoff-dir/specs/landing.md).
 * Build target: `Landing 7a.dc.html`. Dark-only per the spec's own "Out of
 * scope: Light theme" - not a decision made here, a decision already made
 * in the spec.
 *
 * TWO ITEMS THE SPEC AUTHOR FLAGGED AS NEEDING THE OWNER'S EXPLICIT YES,
 * NOT BUILT HERE PENDING THAT ANSWER (see #588):
 *   - BeamsBackground / .lp-hero-glow are NOT removed - both still render,
 *     unchanged from current design. C10 (no [class*="beams"]/[class*=
 *     "hero-glow"]) will fail; that is the correct state until the owner
 *     rules, not a bug.
 *   - The light/dark theme toggle is untouched. This route has never had
 *     one, so it does not apply here regardless of how that question
 *     resolves elsewhere.
 *
 * Live-read panel data: BTC at the default read, reusing the same
 * deterministic signal computations dashboard's terminal mode already
 * shows (computeSqueezeScore for verdict+confidence, classifyFunding for
 * the funding row, computePerpSpot is NOT used - unrelated metric). Entry/
 * Stop/Target render as em dashes - spec's own explicit fallback state,
 * not a gap: no local computation produces them (same finding as
 * dashboard's Best Setup Today, #587) and the spec designs for their
 * absence rather than assuming they exist. */
import { useState, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { useMarket, COIN_DEC, fmtPrice, classifyFunding, computeSqueezeScore } from '@/lib/marketStore';
import { useOI1h, oi1hSignal } from '@/lib/useOI1h';
import { BeamsBackground } from '@/components/BeamsBackground';
import BrandMark from '@/components/BrandMark';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import LandingTicker from '@/components/LandingTicker';
import type { LandingDict, Locale } from '@/lib/i18n/dictionaries';

interface Props {
  dict: LandingDict;
  locale: Locale;
  dir: 'ltr' | 'rtl';
}

/* Required by landing.md's own Layout section: "Select with
 * useSyncExternalStore over matchMedia... and render one tree." A plain
 * useState+useEffect resize hook (components/MagicBento.tsx's useMobile)
 * defaults to desktop on first render even on a mobile device, so the
 * wrong tree mounts briefly - useSyncExternalStore reads the real value
 * synchronously on the client instead of after a post-mount effect. */
function subscribeViewport(cb: () => void) {
  const mql = window.matchMedia('(min-width: 768px)');
  mql.addEventListener('change', cb);
  return () => mql.removeEventListener('change', cb);
}
function getViewportSnapshot() { return window.matchMedia('(min-width: 768px)').matches; }
function getServerViewportSnapshot() { return true; }
function useIsDesktop() {
  return useSyncExternalStore(subscribeViewport, getViewportSnapshot, getServerViewportSnapshot);
}

const LIVE_READ_COIN = 'btc' as const;

function EmDash() { return <span style={{ color: 'var(--txt2)' }}>—</span>; }

/* ── Same FEATURE_META as current design's LandingContent.tsx - structural
   icon+route data, not translated copy, so it is shared rather than
   duplicated per-design. Kept local rather than importing from
   LandingContent.tsx (a component should not import another component's
   internals); if a third design needs it, that is when it moves to lib/. */
const FEATURE_ROUTES = ['/arena', '/settings', '/briefing', '/news', '/dashboard', '/scanner'];
const FEATURE_ICONS: ReactNode[] = [
  <path key="a" d="M3 12h3l2-7 4 14 2-7h7" />,
  <path key="b" d="M12 4a5 5 0 0 0-5 5v3.2c0 .5-.2 1-.5 1.4L5 16h14l-1.5-2.4c-.3-.4-.5-.9-.5-1.4V9a5 5 0 0 0-5-5Zm-2.5 14a2.5 2.5 0 0 0 5 0" />,
  <g key="c"><path d="M12 3v4M4.9 8.9l1.4 1.4M19.1 8.9l-1.4 1.4M3 15h18" /><path d="M6 15a6 6 0 0 1 12 0" /></g>,
  <g key="d"><path d="M5 4h11a2 2 0 0 1 2 2v13a1 1 0 0 1-1.7.7L15 18H6a2 2 0 0 1-2-2V4Z" /><path d="M8 8h6M8 11.5h6M8 15h3" /></g>,
  <path key="e" d="M3 13c3-4 6-5 9-5s6 3 9 5c-3 4-6 5-9 5s-6-1-9-5Zm5 0h.01M15 9c1 1.5 1 3 0 4" />,
  <g key="f"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21" /></g>,
];

function LiveReadPanel({ mobile, dict }: { mobile: boolean; dict: LandingDict }) {
  const { store } = useMarket();
  const d = store.coins[LIVE_READ_COIN];
  const oi1h = useOI1h(LIVE_READ_COIN);
  const sq = computeSqueezeScore(d);

  const verdictCol = sq.dir === 'SHORT_SQ' ? 'var(--green)' : sq.dir === 'LONG_LIQ' ? 'var(--red)' : 'var(--txt2)';
  const verdictText = sq.dir === 'SHORT_SQ' ? 'BULLISH' : sq.dir === 'LONG_LIQ' ? 'BEARISH' : 'NO READ';
  const hasConfidence = sq.dir !== 'NEUTRAL';

  const price = d?.price ?? null;
  const vwap  = d?.vwap ?? null;
  const vwapAbove = vwap != null && price != null ? price > vwap : null;
  const vwapCol = vwapAbove === null ? 'var(--txt)' : vwapAbove ? 'var(--green)' : 'var(--red)';

  const oiTrendTxt: Record<string, { txt: string; col: string }> = {
    strong_up:   { txt: 'Strong up',   col: 'var(--green)' },
    strong_down: { txt: 'Strong down', col: 'var(--red)' },
    weak_up:     { txt: 'Weak up',     col: 'var(--txt)' },
    weak_down:   { txt: 'Weak down',   col: 'var(--txt)' },
  };
  const oiRow = d?.oiTrend ? oiTrendTxt[d.oiTrend] : null;

  const fr = d?.fundingRate;
  const frInfo = fr != null ? classifyFunding(fr) : null;
  const frCol = frInfo && (frInfo.band === 'heavyPos' || frInfo.band === 'mildPos') ? 'var(--red)' : 'var(--txt)';

  const cbPct = store.cbPremiumPct;
  const cbCol = cbPct == null ? 'var(--txt)' : cbPct >= 0.05 ? 'var(--green)' : cbPct <= -0.05 ? 'var(--red)' : 'var(--txt)';

  const { txt: oi1hTxt, col: oi1hColRaw } = oi1hSignal(oi1h.pct, d?.oiTrend);
  const oi1hCol = oi1h.pct == null ? 'var(--txt2)' : oi1hColRaw;

  const evidence: { label: string; value: string | null; note: string; col: string }[] = [
    { label: 'VWAP',    value: price != null ? '$' + fmtPrice(price, COIN_DEC[LIVE_READ_COIN]) : null, note: vwapAbove == null ? '' : vwapAbove ? 'Above' : 'Below', col: vwapCol },
    { label: 'OI trend', value: oiRow ? oiRow.txt : null, note: '', col: oiRow ? oiRow.col : 'var(--txt2)' },
    { label: 'Funding', value: fr != null ? (fr * 100 >= 0 ? '+' : '') + (fr * 100).toFixed(4) + '%' : null, note: frInfo ? frInfo.label : '', col: frCol },
    { label: 'CB prem', value: null, note: '', col: 'var(--txt2)' /* no source wired - see LABELS in spec, always em dash */ },
    { label: 'OI 1h',   value: oi1h.loading ? null : (oi1h.pct != null ? (oi1h.pct >= 0 ? '+' : '') + oi1h.pct.toFixed(2) + '%' : null), note: oi1h.loading ? '' : oi1hTxt, col: oi1hCol },
    { label: 'Setup',   value: String(sq.score), note: sq.label, col: sq.dir === 'SHORT_SQ' ? 'var(--green)' : sq.dir === 'LONG_LIQ' ? 'var(--red)' : 'var(--txt)' },
  ];

  return (
    <div style={{
      width: mobile ? '100%' : 472, flexShrink: 0, background: 'var(--bg1)', border: '1px solid var(--bdr)',
    }}>
      <div style={{ height: 34, display: 'flex', alignItems: 'center', padding: '0 14px', gap: 9, borderBottom: '1px solid var(--bdr)' }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono), monospace', letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--txt2)' }}>
          Live read · {LIVE_READ_COIN.toUpperCase()}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: 'var(--font-mono), monospace', color: 'var(--txt3)' }} suppressHydrationWarning>
          {new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}
        </span>
      </div>

      <div style={{ padding: mobile ? 18 : 20 }}>
        <div style={{ fontSize: mobile ? 26 : 32, fontFamily: 'var(--font-mono), monospace', fontWeight: 700, lineHeight: 1, color: verdictCol }} suppressHydrationWarning>
          {verdictText}
        </div>

        {hasConfidence && (
          <div style={{ marginTop: 14 }}>
            <div style={{ height: 3, background: 'var(--bdr)' }}>
              <div style={{ width: `${sq.score}%`, height: 3, background: verdictCol }} />
            </div>
            <div style={{ marginTop: 6, display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 13, fontFamily: 'var(--font-mono), monospace', fontWeight: 700, color: 'var(--txt)' }}>{sq.score}</span>
              <span style={{ fontSize: 9.5, fontFamily: 'var(--font-mono), monospace', letterSpacing: '.12em', color: 'var(--txt3)' }}>CONF</span>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, background: 'var(--bdr)', marginTop: 16 }}>
          {(['Entry', 'Stop', 'Target'] as const).map(label => (
            <div key={label} style={{ background: 'var(--bg1)', padding: mobile ? '9px 10px' : '11px 12px' }}>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono), monospace', letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--txt3)' }}>{label}</div>
              <div style={{ fontSize: mobile ? 12.5 : 13.5, fontFamily: 'var(--font-mono), monospace', fontWeight: 600, color: 'var(--txt)', fontVariantNumeric: 'tabular-nums', marginTop: 5 }}>
                <EmDash />
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 4 }}>
          {evidence.map(row => (
            <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 14px', borderBottom: '1px solid var(--bdr2)' }}>
              <span style={{ width: 2, height: 18, flexShrink: 0, background: row.value == null ? 'var(--mark-idle)' : row.col }} />
              <span style={{ width: 76, flexShrink: 0, fontSize: 9.5, fontFamily: 'var(--font-mono), monospace', letterSpacing: '.1em', color: 'var(--txt3)' }}>{row.label}</span>
              <span style={{ fontSize: 12.5, fontFamily: 'var(--font-mono), monospace', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: row.value == null ? 'var(--txt2)' : row.col }}>
                {row.value == null ? <EmDash /> : row.value}
              </span>
              {row.note && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--txt3)' }}>{row.note}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function LandingTerminal({ dict, locale, dir }: Props) {
  const isDesktop = useIsDesktop();
  const stepArrow = dir === 'rtl' ? '←' : '→';

  useEffect(() => {
    document.body.classList.add('landing');
    const prevLang = document.documentElement.lang;
    const prevDir  = document.documentElement.dir;
    document.documentElement.lang = locale;
    document.documentElement.dir  = dir;
    return () => {
      document.body.classList.remove('landing');
      document.documentElement.lang = prevLang;
      document.documentElement.dir  = prevDir;
    };
  }, [locale, dir]);

  return (
    <div className="lpt-root" data-layout={isDesktop ? 'desktop' : 'mobile'} dir={dir} style={{
      background: 'var(--bg0)', color: 'var(--txt)', minHeight: '100vh',
    }}>

      {/* ── NAV ── */}
      <nav style={{
        height: isDesktop ? 56 : 52, display: 'flex', alignItems: 'center',
        padding: isDesktop ? '0 40px' : '0 16px', gap: isDesktop ? 12 : 9,
        borderBottom: '1px solid var(--bdr)',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BrandMark size={isDesktop ? 26 : 22} tone="dark" radiusPct={0} />
          <span style={{ fontFamily: 'var(--font-mono), monospace', fontWeight: 700, letterSpacing: '.16em', fontSize: isDesktop ? 14 : 11.5, color: 'var(--txt)' }}>
            LIQUIDITYHQ
          </span>
        </span>
        <span style={{ flex: 1 }} />
        <LanguageSwitcher locale={locale} />
        <Link href="/login" style={{
          fontFamily: 'var(--font-mono), monospace', fontSize: 11.5, letterSpacing: '.12em',
          color: 'var(--txt2)', border: '1px solid var(--border-input)', padding: '9px 16px',
          textDecoration: 'none', textTransform: 'uppercase',
        }}>
          {isDesktop ? dict.nav.signIn : dict.nav.signIn}
        </Link>
        <Link href="/login?signup=1" style={{
          fontFamily: 'var(--font-mono), monospace', fontSize: 11.5, fontWeight: 700, letterSpacing: '.12em',
          color: 'var(--bg0)', background: 'var(--accent)', padding: '10px 18px',
          textDecoration: 'none', textTransform: 'uppercase',
        }}>
          {isDesktop ? dict.nav.getStarted : 'START'}
        </Link>
      </nav>

      {/* ── TICKER ── */}
      <LandingTicker mobile={!isDesktop} />

      {/* ── HERO — glow/beams intentionally kept, see file header ── */}
      <section style={{ position: 'relative', padding: isDesktop ? '76px 40px 64px' : '34px 18px 30px' }}>
        <BeamsBackground intensity="medium" />
        <div className="lp-hero-glow" />
        <div style={{
          position: 'relative', zIndex: 2, display: 'flex',
          flexDirection: isDesktop ? 'row' : 'column', gap: isDesktop ? 56 : 30,
        }}>
          <div style={{ flex: isDesktop ? 1 : undefined }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid var(--bdr)',
              background: 'var(--bg1)', padding: '7px 13px',
            }}>
              <span style={{ width: isDesktop ? 6 : 5, height: isDesktop ? 6 : 5, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />
              <span style={{ fontSize: isDesktop ? 10.5 : 9.5, fontFamily: 'var(--font-mono), monospace', letterSpacing: isDesktop ? '.16em' : '.14em', textTransform: 'uppercase', color: 'var(--txt2)' }}>
                {dict.hero.badge}
              </span>
            </div>
            <h1 style={{
              fontFamily: 'var(--font-mono), monospace', fontWeight: 700, color: 'var(--txt)',
              fontSize: isDesktop ? 54 : 32, lineHeight: isDesktop ? 1.06 : 1.1,
              letterSpacing: '-.015em', marginTop: isDesktop ? 26 : 18, margin: 0, marginBlockStart: isDesktop ? 26 : 18,
            }}>
              {dict.hero.h1Line1}<br />
              <span style={{ color: 'var(--accent)' }}>{dict.hero.h1Line2}</span>
            </h1>
            <p style={{
              fontSize: isDesktop ? 17 : 14.5, lineHeight: 1.6, color: 'var(--txt2)',
              marginTop: isDesktop ? 22 : 14, maxWidth: isDesktop ? 600 : undefined,
            }}>
              {dict.hero.sub}
            </p>
            <div style={{ display: 'flex', flexDirection: isDesktop ? 'row' : 'column', gap: isDesktop ? 12 : 9, marginTop: isDesktop ? 30 : 22 }}>
              <Link href="/login?signup=1" style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                height: isDesktop ? 50 : 48, padding: isDesktop ? '0 30px' : undefined,
                background: 'var(--accent)', color: 'var(--bg0)', fontFamily: 'var(--font-mono), monospace',
                fontSize: 13, fontWeight: 700, letterSpacing: '.12em', textDecoration: 'none',
                textTransform: 'uppercase',
              }}>
                {dict.hero.ctaPrimary}
              </Link>
              <Link href="/briefing" style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                height: isDesktop ? 50 : 46, padding: isDesktop ? '0 26px' : undefined,
                border: '1px solid var(--border-input)', color: 'var(--txt2)', fontFamily: 'var(--font-mono), monospace',
                fontSize: 13, letterSpacing: '.12em', textDecoration: 'none', textTransform: 'uppercase',
              }}>
                {dict.hero.ctaGhost}
              </Link>
            </div>

            {isDesktop ? (
              <div style={{ display: 'flex', marginTop: 40, borderTop: '1px solid var(--bdr)', paddingTop: 24 }}>
                {[dict.hero.stats.coins, dict.hero.stats.signals, dict.hero.stats.ai, dict.hero.stats.telegram].map((label, i) => (
                  <div key={label} style={{ paddingRight: 38, marginRight: 38, borderRight: i < 3 ? '1px solid var(--bdr)' : undefined }}>
                    <div style={{ fontSize: 26, fontFamily: 'var(--font-mono), monospace', fontWeight: 700, color: 'var(--txt)', lineHeight: 1 }}>
                      {['50', '35', 'Grok', 'Live'][i]}
                    </div>
                    <div style={{ fontSize: 9.5, fontFamily: 'var(--font-mono), monospace', letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--txt3)', marginTop: 8 }}>{label}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--bdr)', marginTop: 40 }}>
                {[dict.hero.stats.coins, dict.hero.stats.signals, dict.hero.stats.ai, dict.hero.stats.telegram].map((label, i) => (
                  <div key={label} style={{ background: 'var(--bg0)', padding: '13px 14px' }}>
                    <div style={{ fontSize: 20, fontFamily: 'var(--font-mono), monospace', fontWeight: 700, color: 'var(--txt)', lineHeight: 1 }}>
                      {['50', '35', 'Grok', 'Live'][i]}
                    </div>
                    <div style={{ fontSize: 8.5, fontFamily: 'var(--font-mono), monospace', letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--txt3)', marginTop: 8 }}>{label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <LiveReadPanel mobile={!isDesktop} dict={dict} />
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section style={{ padding: isDesktop ? '64px 40px' : '30px 18px' }}>
        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono), monospace', letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--accent)' }}>
          {dict.features.label}
        </div>
        <h2 style={{ fontSize: isDesktop ? 34 : 24, fontFamily: 'var(--font-mono), monospace', fontWeight: 700, color: 'var(--txt)', marginTop: 14, lineHeight: isDesktop ? undefined : 1.15 }}>
          {dict.features.h2}
        </h2>
        <p style={{ fontSize: 15.5, lineHeight: 1.6, color: 'var(--txt2)', marginTop: 12, maxWidth: 660 }}>{dict.features.sub}</p>

        <div style={{
          display: 'grid', gridTemplateColumns: isDesktop ? 'repeat(3, 1fr)' : '1fr',
          gap: 1, background: 'var(--bdr)', border: '1px solid var(--bdr)', marginTop: 34,
        }}>
          {dict.features.cards.map((card, i) => (
            <Link key={i} href={FEATURE_ROUTES[i]} className="lpt-feature-card" style={{
              background: 'var(--bg0)', padding: isDesktop ? '24px 22px' : 16,
              display: 'flex', flexDirection: 'column', textDecoration: 'none', color: 'inherit',
            }}>
              <svg width={isDesktop ? 24 : 19} height={isDesktop ? 24 : 19} viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                {FEATURE_ICONS[i]}
              </svg>
              <h3 style={{
                fontSize: isDesktop ? 15 : 13.5, fontFamily: 'var(--font-mono), monospace', fontWeight: 700,
                letterSpacing: '.06em', color: 'var(--txt)', marginTop: isDesktop ? 16 : 0, marginBottom: 0,
                display: isDesktop ? 'block' : 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              }}>
                {card.title}
                {!isDesktop && <span style={{ color: 'var(--accent)', fontSize: 10 }}>{stepArrow}</span>}
              </h3>
              <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--txt2)', marginTop: 10, minHeight: 66 }}>{card.desc}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
                {card.pills.map((p, j) => (
                  <span key={j} style={{
                    fontSize: isDesktop ? 9.5 : 9, fontFamily: 'var(--font-mono), monospace', letterSpacing: '.1em',
                    textTransform: 'uppercase', color: 'var(--txt2)', border: '1px solid var(--bdr)',
                    padding: isDesktop ? '4px 8px' : '3px 7px',
                  }}>
                    {p}
                  </span>
                ))}
              </div>
              {isDesktop && (
                <div style={{
                  marginTop: 'auto', paddingTop: 14, borderTop: '1px solid var(--bdr2)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span style={{ fontSize: 10.5, fontFamily: 'var(--font-mono), monospace', letterSpacing: '.12em', color: 'var(--accent)', textTransform: 'uppercase' }}>
                    {dict.features.openLabel} {stepArrow}
                  </span>
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono), monospace', color: 'var(--txt4)' }}>{FEATURE_ROUTES[i]}</span>
                </div>
              )}
            </Link>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section style={{ background: 'var(--bg1)', padding: isDesktop ? '60px 40px' : '30px 18px' }}>
        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono), monospace', letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--accent)' }}>
          {dict.howItWorks.label}
        </div>
        <h2 style={{ fontSize: isDesktop ? 34 : 24, fontFamily: 'var(--font-mono), monospace', fontWeight: 700, color: 'var(--txt)', marginTop: 14 }}>
          {dict.howItWorks.h2}
        </h2>
        <div style={{ display: 'flex', flexDirection: isDesktop ? 'row' : 'column', gap: isDesktop ? 14 : 16, marginTop: 34 }}>
          {dict.howItWorks.steps.map((step, i) => (
            <div key={i} style={{ flex: isDesktop ? 1 : undefined, paddingRight: isDesktop ? 22 : undefined }}>
              <div style={{
                width: isDesktop ? 34 : 30, height: isDesktop ? 34 : 30, border: '1px solid var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-mono), monospace', fontSize: isDesktop ? 14 : 13, fontWeight: 700, color: 'var(--accent)',
              }}>
                {i + 1}
              </div>
              <h3 style={{ fontSize: isDesktop ? 14 : 13, fontFamily: 'var(--font-mono), monospace', fontWeight: 700, letterSpacing: '.04em', color: 'var(--txt)', marginTop: 14 }}>{step.title}</h3>
              <p style={{ fontSize: isDesktop ? 13.5 : 13, lineHeight: 1.6, color: 'var(--txt2)', marginTop: isDesktop ? 9 : 6 }}>{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── PRICING ── */}
      <section id="pricing" style={{ padding: isDesktop ? '64px 40px' : '30px 18px' }}>
        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono), monospace', letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--accent)' }}>
          {dict.pricing.label}
        </div>
        <h2 style={{ fontSize: isDesktop ? 34 : 24, fontFamily: 'var(--font-mono), monospace', fontWeight: 700, color: 'var(--txt)', marginTop: 14 }}>
          {dict.pricing.h2}
        </h2>

        <div style={{
          display: 'flex', flexDirection: isDesktop ? 'row' : 'column', gap: 1, background: 'var(--bdr)',
          border: '1px solid var(--bdr)', marginTop: 32,
        }}>
          <div style={{ flex: isDesktop ? 1 : undefined, background: 'var(--bg0)', padding: isDesktop ? '30px 28px' : '20px 18px' }}>
            <div style={{ fontSize: 12, fontFamily: 'var(--font-mono), monospace', fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--txt2)' }}>{dict.pricing.free.name}</div>
            <div style={{ fontSize: isDesktop ? 46 : 36, fontFamily: 'var(--font-mono), monospace', fontWeight: 700, color: 'var(--txt)', lineHeight: 1, marginTop: 4 }}>
              $0<span style={{ fontSize: 14, fontFamily: 'var(--font-mono), monospace', color: 'var(--txt3)' }}>/mo</span>
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--txt2)', marginTop: 12 }}>{dict.pricing.free.sub}</div>
            <ul style={{ listStyle: 'none', margin: '22px 0 0', padding: 0 }}>
              {dict.pricing.free.features.map((f, i) => (
                <li key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--bdr2)' }}>
                  <span style={{ width: 12, fontSize: 12, fontFamily: 'var(--font-mono), monospace', color: f.included ? 'var(--green)' : 'var(--txt4)' }}>{f.included ? '✓' : '✕'}</span>
                  <span style={{ fontSize: 13.5, color: f.included ? 'var(--txt)' : 'var(--txt3)' }}>{f.text}</span>
                </li>
              ))}
            </ul>
            <Link href="/login?signup=1" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 22,
              height: isDesktop ? 46 : 44, border: '1px solid var(--border-input)', color: 'var(--txt2)',
              fontFamily: 'var(--font-mono), monospace', fontSize: 12, letterSpacing: '.12em', textDecoration: 'none', textTransform: 'uppercase',
            }}>
              {dict.pricing.free.cta}
            </Link>
          </div>

          <div style={{
            flex: isDesktop ? 1 : undefined, background: 'var(--bg1)', borderTop: '2px solid var(--accent)',
            padding: isDesktop ? '30px 28px' : '20px 18px', marginTop: isDesktop ? 0 : 14,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 12, fontFamily: 'var(--font-mono), monospace', fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--txt)' }}>{dict.pricing.pro.name}</div>
              <span style={{ fontSize: 9.5, fontFamily: 'var(--font-mono), monospace', fontWeight: 700, letterSpacing: '.14em', color: 'var(--bg0)', background: 'var(--accent)', padding: '3px 8px' }}>
                {dict.pricing.pro.badge}
              </span>
            </div>
            <div style={{ fontSize: isDesktop ? 46 : 36, fontFamily: 'var(--font-mono), monospace', fontWeight: 700, color: 'var(--txt)', lineHeight: 1, marginTop: 4 }}>
              $25<span style={{ fontSize: 14, fontFamily: 'var(--font-mono), monospace', color: 'var(--txt3)' }}>/mo</span>
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--txt2)', marginTop: 12 }}>{dict.pricing.pro.sub}</div>
            <ul style={{ listStyle: 'none', margin: '22px 0 0', padding: 0 }}>
              {dict.pricing.pro.features.map((f, i) => (
                <li key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--bdr2)' }}>
                  <span style={{ width: 12, fontSize: 12, fontFamily: 'var(--font-mono), monospace', color: 'var(--green)' }}>✓</span>
                  <span style={{ fontSize: 13.5, color: 'var(--txt)' }}>{f}</span>
                </li>
              ))}
            </ul>
            <Link href="/upgrade" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 22,
              height: 46, background: 'var(--accent)', color: 'var(--bg0)',
              fontFamily: 'var(--font-mono), monospace', fontSize: 12, fontWeight: 700, letterSpacing: '.12em', textDecoration: 'none', textTransform: 'uppercase',
            }}>
              {dict.pricing.pro.cta}
            </Link>
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section style={{
        background: 'var(--bg1)', padding: isDesktop ? '64px 40px' : '30px 18px',
        display: 'flex', flexDirection: isDesktop ? 'row' : 'column', gap: isDesktop ? 40 : undefined, alignItems: isDesktop ? 'center' : undefined,
      }}>
        <div>
          <h2 style={{ fontSize: isDesktop ? 36 : 22, fontFamily: 'var(--font-mono), monospace', fontWeight: 700, lineHeight: isDesktop ? 1.15 : 1.2, color: 'var(--txt)', margin: 0 }}>
            {dict.finalCta.h2}
          </h2>
          <p style={{ fontSize: isDesktop ? 15.5 : 13.5, lineHeight: 1.6, color: 'var(--txt2)', marginTop: 14, maxWidth: isDesktop ? 620 : undefined }}>
            {dict.finalCta.sub}
          </p>
        </div>
        <Link href="/login?signup=1" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          height: isDesktop ? 54 : 48, padding: isDesktop ? '0 34px' : undefined, width: isDesktop ? undefined : '100%',
          marginTop: isDesktop ? 0 : 16, background: 'var(--accent)', color: 'var(--bg0)',
          fontFamily: 'var(--font-mono), monospace', fontSize: 13.5, fontWeight: 700, letterSpacing: '.12em',
          textDecoration: 'none', textTransform: 'uppercase',
        }}>
          {dict.finalCta.cta}
        </Link>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ padding: isDesktop ? '52px 40px 0' : '28px 18px 0' }}>
        <div style={{ display: 'flex', flexDirection: isDesktop ? 'row' : 'column', gap: isDesktop ? 0 : 24 }}>
          <div style={{ width: isDesktop ? 290 : undefined, flexShrink: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <BrandMark size={30} tone="dark" radiusPct={0} />
              <span style={{ fontFamily: 'var(--font-mono), monospace', fontWeight: 700, letterSpacing: '.16em', fontSize: 13, color: 'var(--txt)' }}>LIQUIDITYHQ</span>
            </span>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--txt3)', marginTop: 14 }}>{dict.footer.brandDesc}</p>
          </div>

          <div style={{
            display: 'grid', gridTemplateColumns: isDesktop ? 'repeat(4, 1fr)' : 'repeat(2, 1fr)',
            gap: isDesktop ? 0 : 22, flex: 1,
          }}>
            {[
              { title: dict.footer.columns.product, links: [
                ['/dashboard', dict.footer.links.dashboard], ['/arena', dict.footer.links.arena],
                ['/briefing', dict.footer.links.briefing], ['/news', dict.footer.links.news],
              ] },
              { title: dict.footer.columns.analysis, links: [
                ['/scanner', dict.footer.links.scanner], ['/liq', dict.footer.links.liq],
                ['/funding', dict.footer.links.funding], ['/correlation', dict.footer.links.correlation],
              ] },
              { title: dict.footer.columns.tools, links: [
                ['/journal', dict.footer.links.journal], ['/calc', dict.footer.links.calc],
                ['/alerts', dict.footer.links.alerts], ['/hours', dict.footer.links.hours],
              ] },
              { title: dict.footer.columns.account, links: [
                ['/login', dict.footer.links.signIn], ['/login?signup=1', dict.footer.links.createAccount],
                ['/upgrade', dict.footer.links.pricing], ['/about', dict.footer.links.about],
                ['/disclaimer', dict.footer.links.disclaimer], ['/terms', 'Terms of Use'],
                ['/privacy', 'Privacy Policy'], ['/refund', 'Refund Policy'],
              ] },
            ].map(col => (
              <div key={col.title}>
                <div style={{ fontSize: isDesktop ? 9.5 : 9, fontFamily: 'var(--font-mono), monospace', fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--txt2)' }}>
                  {col.title}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: isDesktop ? 9 : 7, marginTop: 14 }}>
                  {col.links.map(([href, label]) => (
                    <Link key={href} href={href} style={{ fontSize: isDesktop ? 13 : 12.5, color: 'var(--txt3)', textDecoration: 'none' }}>{label}</Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: isDesktop ? 40 : 28 }}>
          <span style={{ fontSize: 9.5, fontFamily: 'var(--font-mono), monospace', fontWeight: 700, letterSpacing: '.2em', color: 'var(--txt3)', flexShrink: 0, textTransform: 'uppercase' }}>
            Risk disclosure
          </span>
          <div style={{ flex: 1, height: 1, background: 'var(--bdr)' }} />
        </div>
        <div style={{
          display: isDesktop ? 'grid' : 'flex', gridTemplateColumns: isDesktop ? 'repeat(3, 1fr)' : undefined,
          flexDirection: isDesktop ? undefined : 'column', gap: isDesktop ? '24px 40px' : 16, marginTop: 22,
        }}>
          {[
            { label: 'Educational Use', text: 'All content - signals, scores, alerts, and AI commentary - is for informational purposes only. Nothing constitutes a recommendation to buy, sell, or hold any asset.' },
            { label: 'Trading Risk', text: 'Crypto trading involves substantial risk. Prices are volatile, leverage magnifies losses, and most active traders lose money. Only trade with money you can afford to lose.' },
            { label: 'No Investment Advice', text: 'We are not a registered investment advisor. You are solely responsible for your own trading decisions. Consult a licensed professional before making any investment decision.' },
            { label: 'AI Analysis', text: 'LiquidityAI is powered by xAI Grok. AI output can be incomplete, outdated, or wrong - never use it as your sole basis for a trade. Always verify against the raw data shown.' },
            { label: 'Data Sources', text: 'Price, funding, and OI data sourced from Binance, Bybit, Finnhub, and Alternative.me. We do not guarantee accuracy, completeness, or availability of third-party feeds.' },
            { label: 'No Affiliation', text: 'LiquidityHQ is not affiliated with, endorsed by, or sponsored by any exchange or data provider referenced here. All trademarks belong to their respective owners.' },
          ].map(item => (
            <div key={item.label}>
              <div style={{ fontSize: isDesktop ? 10 : 9.5, fontFamily: 'var(--font-mono), monospace', fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--txt2)' }}>{item.label}</div>
              <p style={{ fontSize: isDesktop ? 12.5 : 12, lineHeight: 1.6, color: 'var(--txt3)', marginTop: 7 }}>{item.text}</p>
            </div>
          ))}
        </div>

        <div style={{ borderTop: '1px solid var(--bdr)', padding: '20px 0 24px', marginTop: 30 }}>
          <p style={{ fontSize: isDesktop ? 12.5 : 12, lineHeight: 1.6, color: 'var(--txt3)', margin: 0 }}>
            {dict.footer.copyright}{' '}
            <Link href="/disclaimer" style={{ color: 'var(--txt3)', textDecoration: 'underline', textUnderlineOffset: 2 }}>{dict.footer.fullDisclaimer}</Link>
          </p>
          <p style={{ fontSize: isDesktop ? 12.5 : 12, lineHeight: 1.6, color: 'var(--txt3)', margin: '8px 0 0' }}>
            By using LiquidityHQ, you acknowledge that you understand and agree to our{' '}
            <Link href="/disclaimer" style={{ color: 'var(--txt3)', textDecoration: 'underline', textUnderlineOffset: 2 }}>Disclaimer</Link>,{' '}
            <Link href="/terms" style={{ color: 'var(--txt3)', textDecoration: 'underline', textUnderlineOffset: 2 }}>Terms of Use</Link>,{' '}
            <Link href="/privacy" style={{ color: 'var(--txt3)', textDecoration: 'underline', textUnderlineOffset: 2 }}>Privacy Policy</Link>, and{' '}
            <Link href="/refund" style={{ color: 'var(--txt3)', textDecoration: 'underline', textUnderlineOffset: 2 }}>Refund Policy</Link>.
          </p>
        </div>
      </footer>
    </div>
  );
}
