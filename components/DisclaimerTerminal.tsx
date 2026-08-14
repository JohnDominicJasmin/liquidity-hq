'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMarket } from '@/lib/marketStore';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';

/* /disclaimer in the Monochrome Terminal design (#413).
 *
 * THE COPY IS UNCHANGED. Same ten sections, same label keys, same words - this
 * is a visual rebuild, not a rewrite of a legal page. Any wording change is a
 * separate decision with the owner.
 *
 * The design opens with four red risk figures ($412M across five venues, the
 * largest single position, a cascade duration). Three of them describe data
 * this app does not have: the store carries a rolling 15-minute Binance
 * forceOrder aggregate for seven majors - no 24h window, no five venues, no
 * per-position rows, no cascade duration. The owner chose to show what is real
 * and label it honestly rather than print figures we cannot stand behind on the
 * page whose whole purpose is telling users the truth about risk.
 */

interface Section { titleKey: LabelKey; bodyKey: LabelKey }

const SECTIONS: Section[] = [
  { titleKey: 'DISCLAIMER_SECTION_EDUCATIONAL_TITLE',          bodyKey: 'DISCLAIMER_SECTION_EDUCATIONAL_BODY' },
  { titleKey: 'DISCLAIMER_SECTION_TRADING_RISKS_TITLE',        bodyKey: 'DISCLAIMER_SECTION_TRADING_RISKS_BODY' },
  { titleKey: 'DISCLAIMER_SECTION_NO_GUARANTEES_TITLE',        bodyKey: 'DISCLAIMER_SECTION_NO_GUARANTEES_BODY' },
  { titleKey: 'DISCLAIMER_SECTION_NOT_FINANCIAL_ADVICE_TITLE', bodyKey: 'DISCLAIMER_SECTION_NOT_FINANCIAL_ADVICE_BODY' },
  { titleKey: 'DISCLAIMER_SECTION_NO_TRADE_EXECUTION_TITLE',   bodyKey: 'DISCLAIMER_SECTION_NO_TRADE_EXECUTION_BODY' },
  { titleKey: 'DISCLAIMER_SECTION_AI_ANALYSIS_TITLE',          bodyKey: 'DISCLAIMER_SECTION_AI_ANALYSIS_BODY' },
  { titleKey: 'DISCLAIMER_SECTION_DATA_PROVIDERS_TITLE',       bodyKey: 'DISCLAIMER_SECTION_DATA_PROVIDERS_BODY' },
  { titleKey: 'DISCLAIMER_SECTION_BACKTESTS_TITLE',            bodyKey: 'DISCLAIMER_SECTION_BACKTESTS_BODY' },
  { titleKey: 'DISCLAIMER_SECTION_NO_LIABILITY_TITLE',         bodyKey: 'DISCLAIMER_SECTION_NO_LIABILITY_BODY' },
  { titleKey: 'DISCLAIMER_SECTION_PLATFORM_IDENTITY_TITLE',    bodyKey: 'DISCLAIMER_SECTION_PLATFORM_IDENTITY_BODY' },
];

const num = (i: number) => String(i + 1).padStart(2, '0');
const slug = (i: number) => `s${num(i)}`;

function fmtUsd(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${Math.round(v)}`;
}

/** The two cells we can actually stand behind.
 *
 *  Summed across whichever majors currently carry a reading, because the store
 *  holds this per coin and the honest headline is the market-wide figure - not
 *  BTC's alone dressed up as the market's. */
function useRiskFacts() {
  const { store } = useMarket();
  let longUsd = 0, shortUsd = 0, coins = 0;
  for (const c of Object.values(store.coins)) {
    if (c?.liqLongUsd == null || c?.liqShortUsd == null) continue;
    longUsd += c.liqLongUsd;
    shortUsd += c.liqShortUsd;
    coins++;
  }
  const total = longUsd + shortUsd;
  return {
    coins,
    total,
    /* Guarded: with no liquidations in the window this is 0/0. A NaN rendered
       as "NaN% longs" on a legal page is worse than showing nothing. */
    longPct: total > 0 ? Math.round((longUsd / total) * 100) : null,
  };
}

export default function DisclaimerTerminal() {
  const { t } = useLabels();
  const { total, longPct, coins } = useRiskFacts();
  const [active, setActive] = useState(0);

  /* Contents rail highlight. IntersectionObserver rather than a scroll handler:
     it fires only when a section crosses the band and costs nothing while the
     page is still, which matters on a page people scroll slowly and read. */
  useEffect(() => {
    const els = SECTIONS.map((_, i) => document.getElementById(slug(i))).filter(Boolean) as HTMLElement[];
    if (!els.length) return;
    const io = new IntersectionObserver(
      entries => {
        const top = entries.filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(els.indexOf(top.target as HTMLElement));
      },
      { rootMargin: '-72px 0px -65% 0px' },
    );
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="dterm">
      <header className="dterm-head">
        <div className="dterm-eyebrow">{t('DISCLAIMER_EYEBROW')}</div>
        <h1 className="dterm-title">{t('DISCLAIMER_PAGE_TITLE')}</h1>

        {/* The risk row. Rendered only when the stream has given us something -
            a "$0" opener on a risk-warning page reads as broken rather than as
            calm, and the 15-minute window is genuinely empty sometimes. */}
        {total > 0 && (
          <div className="dterm-risk" data-testid="disclaimer-risk">
            <div className="dterm-risk-cell">
              <div className="dterm-risk-label">Liquidations · last 15m</div>
              <div className="dterm-risk-value">{fmtUsd(total)}</div>
              <div className="dterm-risk-note">Binance perps · {coins} majors</div>
            </div>
            {longPct !== null && (
              <div className="dterm-risk-cell">
                <div className="dterm-risk-label">Longs liquidated</div>
                <div className="dterm-risk-value">{longPct}%</div>
                <div className="dterm-risk-note">of that total</div>
              </div>
            )}
          </div>
        )}
      </header>

      <div className="dterm-body">
        <nav className="dterm-toc" aria-label="Contents">
          {SECTIONS.map((s, i) => (
            <a
              key={s.titleKey}
              href={`#${slug(i)}`}
              className={`dterm-toc-item${active === i ? ' on' : ''}`}
            >
              <span className="dterm-toc-num">{num(i)}</span>
              {t(s.titleKey)}
            </a>
          ))}
        </nav>

        <div className="dterm-sections">
          {SECTIONS.map((s, i) => (
            <section key={s.titleKey} id={slug(i)} className="dterm-section">
              <div className="dterm-section-num">{num(i)}</div>
              <h2 className="dterm-section-title">{t(s.titleKey)}</h2>
              <p className="dterm-section-body">{t(s.bodyKey)}</p>
            </section>
          ))}

          <footer className="dterm-foot">
            <p>{t('DISCLAIMER_FOOTER_ACKNOWLEDGEMENT')}</p>
            <p className="dterm-foot-meta">
              <span>{t('DISCLAIMER_FOOTER_COPYRIGHT', { year: new Date().getFullYear() })}</span>
              <Link href="/about">{t('DISCLAIMER_FOOTER_ABOUT_LINK')}</Link>
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}
