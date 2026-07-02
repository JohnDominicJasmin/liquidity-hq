'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';

export default function LandingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  /* Redirect signed-in users straight to the app */
  useEffect(() => {
    if (!loading && user) router.replace('/dashboard');
  }, [user, loading, router]);

  /* Hide the app shell nav + ticker on this page */
  useEffect(() => {
    document.body.classList.add('landing');
    return () => document.body.classList.remove('landing');
  }, []);

  // Show landing page immediately — don't blank-screen while auth resolves.
  // Once loaded and user is known, useEffect redirects to /dashboard.
  if (!loading && user) return null;

  return (
    <div className="lp-root">

      {/* ── NAV ── */}
      <nav className="lp-nav">
        <div className="lp-nav-inner">
          <span className="lp-logo">LiquidityHQ<span>.ai</span></span>
          <div className="lp-nav-actions">
            <Link href="/login" className="lp-btn-ghost">Sign In</Link>
            <Link href="/login?signup=1" className="lp-btn-primary">Get Started Free</Link>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="lp-hero">
        <div className="lp-hero-glow" />
        <div className="lp-hero-inner">
          <div className="lp-hero-badge">
            <span className="lp-live-dot" />
            Live · 17 coins · Real-time signals
          </div>
          <h1 className="lp-h1">
            Read the map.<br />
            <span className="lp-h1-accent">Hunt the stops.</span>
          </h1>
          <p className="lp-hero-sub">
            Professional-grade crypto intelligence for retail traders.
            Squeeze scores, whale alerts, AI analysis, and macro events —
            all in one dashboard.
          </p>
          <div className="lp-hero-ctas">
            <Link href="/login?signup=1" className="lp-cta-primary">Start for free →</Link>
            <Link href="/briefing" className="lp-cta-ghost">See live briefing</Link>
          </div>
          <div className="lp-hero-stats">
            <div className="lp-stat"><span>17</span>Coins tracked</div>
            <div className="lp-stat-sep" />
            <div className="lp-stat"><span>35</span>Signal types</div>
            <div className="lp-stat-sep" />
            <div className="lp-stat"><span>Grok</span>AI analysis</div>
            <div className="lp-stat-sep" />
            <div className="lp-stat"><span>Live</span>Telegram alerts</div>
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section className="lp-section">
        <div className="lp-section-inner">
          <div className="lp-section-label">What you get</div>
          <h2 className="lp-h2">Everything a serious trader needs</h2>
          <div className="lp-features">

            <div className="lp-feature-card lp-feat-purple">
              
              <h3>AI Arena</h3>
              <p>35-signal confluence engine with live chart and Grok AI analysis. Funding rate, CVD, open interest trend, squeeze score, whale flow, GEX — all in one view.</p>
              <div className="lp-feat-pills">
                <span>Grok 4.3</span><span>35 signals</span><span>17 coins</span>
              </div>
            </div>

            <div className="lp-feature-card lp-feat-green">
              
              <h3>Telegram Alerts</h3>
              <p>Auto-fire alerts for squeeze setups, whale trades, RSI extremes, EMA crosses, rapid price moves, open interest spikes, and breaking news — before the crowd.</p>
              <div className="lp-feat-pills">
                <span>Squeeze alerts</span><span>Whale trades</span><span>Breaking news</span>
              </div>
            </div>

            <div className="lp-feature-card lp-feat-amber">
              
              <h3>Morning Briefing</h3>
              <p>Daily macro snapshot: BTC dominance, DXY, S&P correlation, ETF flows, economic calendar, and hot setups. Know the backdrop before the session opens.</p>
              <div className="lp-feat-pills">
                <span>Macro events</span><span>ETF flows</span><span>Hot setups</span>
              </div>
            </div>

            <div className="lp-feature-card lp-feat-blue">
              
              <h3>News Feed</h3>
              <p>Reuters, AP, Al Jazeera, Fox News, Politico, TruthSocial, CoinDesk and more — all classified and scored. Breaking geo-political news that moves crypto.</p>
              <div className="lp-feat-pills">
                <span>12+ sources</span><span>Auto-classify</span><span>~1 min lag</span>
              </div>
            </div>

            <div className="lp-feature-card lp-feat-red">
              
              <h3>Whale Tracker</h3>
              <p>Real-time large trade detection across Binance and Bybit. Know when institutions move size. Configurable thresholds with per-coin sensitivity.</p>
              <div className="lp-feat-pills">
                <span>Real-time</span><span>Binance + Bybit</span><span>All 17 coins</span>
              </div>
            </div>

            <div className="lp-feature-card lp-feat-purple">
              
              <h3>Squeeze Scanner</h3>
              <p>3-signal squeeze score across all 17 coins simultaneously. Funding rate + L/S ratio + taker pressure — when all three align, the flush is coming.</p>
              <div className="lp-feat-pills">
                <span>Score 0–100</span><span>All coins</span><span>4h cooldown</span>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-section-inner">
          <div className="lp-section-label">How it works</div>
          <h2 className="lp-h2">From signal to trade in seconds</h2>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num">1</div>
              <h3>Connect Telegram</h3>
              <p>Link your Telegram in Settings. Alerts fire automatically — squeeze setups, whale trades, FR extremes, breaking news.</p>
            </div>
            <div className="lp-step-arrow">→</div>
            <div className="lp-step">
              <div className="lp-step-num">2</div>
              <h3>Pick your coins</h3>
              <p>Choose from 17 coins across majors, alts, and meme. The Squeeze Scanner watches all of them live, 24/7.</p>
            </div>
            <div className="lp-step-arrow">→</div>
            <div className="lp-step">
              <div className="lp-step-num">3</div>
              <h3>Run AI analysis</h3>
              <p>Open AI Arena, select a coin, hit Analyze. Grok reads 35 live signals and gives you a direct, actionable trade bias.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section className="lp-section" id="pricing">
        <div className="lp-section-inner">
          <div className="lp-section-label">Pricing</div>
          <h2 className="lp-h2">Start free. Upgrade when ready.</h2>
          <div className="lp-pricing">

            <div className="lp-plan lp-plan-free">
              <div className="lp-plan-header">
                <div className="lp-plan-name">Free</div>
                <div className="lp-plan-price">$0<span>/mo</span></div>
                <div className="lp-plan-sub">Always free, no card needed</div>
              </div>
              <ul className="lp-plan-features">
                <li><span className="lp-check">✓</span> Dashboard + market overview</li>
                <li><span className="lp-check">✓</span> Morning briefing</li>
                <li><span className="lp-check">✓</span> News feed</li>
                <li><span className="lp-check">✓</span> All 17 coins — squeeze scanner</li>
                <li><span className="lp-check">✓</span> 7 Quick + 5 Deep AI analyses / day</li>
                <li><span className="lp-check">✓</span> 15 AI chat messages / day</li>
                <li><span className="lp-x">✕</span> Telegram alerts</li>
                <li><span className="lp-x">✕</span> Price alerts</li>
              </ul>
              <Link href="/login?signup=1" className="lp-plan-cta lp-plan-cta-free">
                Get started free
              </Link>
            </div>

            <div className="lp-plan lp-plan-pro">
              <div className="lp-plan-badge">Most popular</div>
              <div className="lp-plan-header">
                <div className="lp-plan-name">Pro</div>
                <div className="lp-plan-price">$15<span>/mo</span></div>
                <div className="lp-plan-sub">Everything, unlimited</div>
              </div>
              <ul className="lp-plan-features">
                <li><span className="lp-check lp-check-pro">✓</span> Everything in Free</li>
                <li><span className="lp-check lp-check-pro">✓</span> Telegram alerts — all signal types</li>
                <li><span className="lp-check lp-check-pro">✓</span> Unlimited price alerts</li>
                <li><span className="lp-check lp-check-pro">✓</span> 50 Quick + 25 Deep analyses / day</li>
                <li><span className="lp-check lp-check-pro">✓</span> 100 AI chat messages / day</li>
                <li><span className="lp-check lp-check-pro">✓</span> 25 live searches / day</li>
                <li><span className="lp-check lp-check-pro">✓</span> Priority support</li>
              </ul>
              <Link href="/upgrade" className="lp-plan-cta lp-plan-cta-pro">
                Get Pro — $15/mo
              </Link>
            </div>

          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="lp-final-cta">
        <div className="lp-final-inner">
          <h2>Ready to read the map?</h2>
          <p>Join traders who see the liquidity before it moves.</p>
          <Link href="/login?signup=1" className="lp-cta-primary">
            Create free account →
          </Link>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="lp-footer">
        <div className="lp-footer-grid">
          <div className="lp-footer-brand">
            <span className="lp-logo">LiquidityHQ<span>.ai</span></span>
            <p>Live crypto intelligence for retail traders — squeeze scores, whale alerts, AI analysis, and macro events in one dashboard.</p>
          </div>

          <div className="lp-footer-col">
            <div className="lp-footer-col-title">Product</div>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/arena">AI Arena</Link>
            <Link href="/briefing">Briefing</Link>
            <Link href="/news">News</Link>
          </div>

          <div className="lp-footer-col">
            <div className="lp-footer-col-title">Analysis</div>
            <Link href="/scanner">Setup Scanner</Link>
            <Link href="/liq">Liquidation Map</Link>
            <Link href="/funding">FR History</Link>
            <Link href="/correlation">Correlation</Link>
          </div>

          <div className="lp-footer-col">
            <div className="lp-footer-col-title">Tools</div>
            <Link href="/journal">Journal</Link>
            <Link href="/calc">Position Sizer</Link>
            <Link href="/alerts">Alerts</Link>
            <Link href="/hours">Best Hours</Link>
          </div>

          <div className="lp-footer-col">
            <div className="lp-footer-col-title">Account</div>
            <Link href="/login">Sign In</Link>
            <Link href="/login?signup=1">Create Account</Link>
            <Link href="/upgrade">Pricing</Link>
            <Link href="/about">About</Link>
          </div>
        </div>
        <div className="lp-footer-bottom">
          <span className="lp-footer-copy">© 2026 LiquidityHQ.ai · For educational purposes only · Not financial advice</span>
        </div>
      </footer>

    </div>
  );
}
