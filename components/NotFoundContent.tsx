'use client';
import Link from 'next/link';
import { useLabels } from '@/lib/labels';

export default function NotFoundContent() {
  const { t } = useLabels();

  return (
    <div style={{
      minHeight: '60vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 14, padding: '2rem',
      textAlign: 'center',
    }}>

      {/* AN EMPTY CHART. The owner asked for one on this page - "add a chart like for Display",
          then "like empty chart graphic design" - and the emptiness is the joke: "page not found"
          and "chart with no data" are the same idea.

          NOTHING IS DRAWN IN IT. No candles, no line, no sweep, no axis numbers, no symbol, no
          timestamp. A reader must not be able to mistake it for an instrument, which is the same
          reason the #1818 blind charts stripped their labels - the moment a decorative chart shows
          a real price it is making a claim, and nobody will have thought about its age or source.

          NO FETCH, NO API CALL, NO CANVAS, and each of those is a separate reason:
            - a 404 is the page that must not fail, so it must not depend on anything that can be
              slow, stale or down;
            - 404s are mostly crawlers, so a live chart would mean an upstream call per bot hit on a
              route with no entitlement check and no rate limit in front of it - a bill with no user
              attached;
            - BeamsBackground's Math.random() geometry is why a pixel comparison of landing needed a
              noise floor of 904,516 px, and this page gets screenshotted for sign-off.

          NO ANIMATION. An empty chart that animates is a chart pretending something is coming.

          COLOUR COMES FROM `currentColor`, NOT A TOKEN, so the same markup is correct on both 404s.
          app/global-not-found.tsx hardcodes data-theme="dark" and carries no theme script (#1740),
          while app/(main)/not-found.tsx inherits the viewer's theme through RootDocument - so a
          token colour would be right on one page and wrong on the other. Inheriting the muted text
          colour of whichever page renders it sidesteps that instead of waiting for #1740.

          NO NEW CSS. app/globals.css is a landing-gated file (CONTRIBUTING 3c), and a grid of
          hairlines is not worth spending a rendered landing check on. Inline, like the rest of
          this component.

          aria-hidden BECAUSE IT IS DECORATIVE. It carries no information the copy below does not,
          so announcing "chart" to a screen reader would add noise, not meaning. */}
      <svg
        viewBox="0 0 240 110"
        role="presentation"
        aria-hidden="true"
        focusable="false"
        style={{
          width: '100%', maxWidth: 240, height: 'auto', marginBottom: 6,
          color: 'var(--txt3, #808080)', overflow: 'visible',
        }}
      >
        {/* The frame. Dashed, echoing the .empty-state-dashed convention the calculators use for
            "nothing here", without needing its class. */}
        <rect
          x="0.5" y="0.5" width="239" height="109" rx="8"
          fill="none" stroke="currentColor" strokeWidth="1"
          strokeDasharray="4 4" opacity="0.35"
        />
        {/* Gridlines only - four across, five down. Hairline and faint, so the frame reads as a
            chart surface rather than as a table. */}
        <g stroke="currentColor" strokeWidth="0.5" opacity="0.18">
          <line x1="0" y1="22" x2="240" y2="22" />
          <line x1="0" y1="44" x2="240" y2="44" />
          <line x1="0" y1="66" x2="240" y2="66" />
          <line x1="0" y1="88" x2="240" y2="88" />
          <line x1="48"  y1="0" x2="48"  y2="110" />
          <line x1="96"  y1="0" x2="96"  y2="110" />
          <line x1="144" y1="0" x2="144" y2="110" />
          <line x1="192" y1="0" x2="192" y2="110" />
        </g>
      </svg>

      <div style={{
        fontSize: 'var(--fs-page)', fontWeight: 800, color: 'var(--txt1, #e8e8e8)',
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        {t('NOT_FOUND_TITLE')}
      </div>
      <div style={{ fontSize: 'var(--fs-label)', color: 'var(--txt3, #808080)', maxWidth: 420, lineHeight: 1.6 }}>
        {t('NOT_FOUND_BODY')}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link href="/" style={{
          padding: '9px 18px', borderRadius: 10, fontSize: 'var(--fs-label)', fontWeight: 700,
          color: 'var(--accent)', background: 'var(--accent-bg)',
          border: '0.5px solid var(--accent-bdr)', textDecoration: 'none',
        }}>
          {t('NOT_FOUND_HOME_LINK')}
        </Link>
        <Link href="/liq" style={{
          padding: '9px 18px', borderRadius: 10, fontSize: 'var(--fs-label)', fontWeight: 700,
          color: 'var(--green-2)', background: 'rgba(52,211,153,0.08)',
          border: '0.5px solid rgba(52,211,153,0.3)', textDecoration: 'none',
        }}>
          {t('NOT_FOUND_LIQUIDATION_MAP_LINK')}
        </Link>
      </div>
    </div>
  );
}
