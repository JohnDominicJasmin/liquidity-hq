'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { GLOSSARY } from '@/lib/glossary';

// Public glossary page (Tier 2 #14). Deliberately does NOT redirect signed-in
// users away like the marketing homepage (components/LandingContent.tsx) -
// this page needs to be reachable by cold organic-search traffic (the whole
// point is SEO) AND by existing logged-in users referencing a term while
// using the app, e.g. via the footer or nav drawer.
export default function LearnContent() {
  const { user } = useAuth();
  const [query, setQuery] = useState('');

  // Same mechanism LandingContent uses to hide the authenticated app shell
  // (nav drawer, ticker, mobile tab bar) - see body.landing in globals.css.
  // Restored on unmount so the rest of the app is unaffected.
  useEffect(() => {
    document.body.classList.add('landing');
    return () => { document.body.classList.remove('landing'); };
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? GLOSSARY.map(cat => ({ ...cat, entries: cat.entries.filter(e => e.term.toLowerCase().includes(q) || e.definition.toLowerCase().includes(q)) }))
        .filter(cat => cat.entries.length > 0)
    : GLOSSARY;

  return (
    <div className="lp-root">

      {/* ── NAV ── */}
      <nav className="lp-nav">
        <div className="lp-nav-inner">
          <Link href="/" className="lp-logo" style={{ textDecoration: 'none' }}>LiquidityHQ</Link>
          <div className="lp-nav-actions">
            {user ? (
              <Link href="/dashboard" className="lp-btn-primary">Open Dashboard</Link>
            ) : (
              <>
                <Link href="/login" className="lp-btn-ghost">Sign In</Link>
                <Link href="/login?signup=1" className="lp-btn-primary">Get Started</Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ── HEADER ── */}
      <section className="learn-header">
        <h1 className="lp-h1" style={{ fontSize: 'clamp(2rem, 5vw, 2.75rem)' }}>
          Crypto Trading <span className="lp-h1-accent">Glossary</span>
        </h1>
        <p className="lp-hero-sub" style={{ maxWidth: 640 }}>
          Plain-English definitions for the momentum, order-flow, sentiment, and risk
          terms used throughout LiquidityHQ - and across crypto trading generally.
        </p>
        <div className="learn-search-wrap">
          <input
            className="learn-search"
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search terms…"
            aria-label="Search glossary terms"
            autoComplete="off"
          />
        </div>
      </section>

      {/* ── GLOSSARY ── */}
      <section className="learn-body">
        {filtered.length === 0 && (
          <p className="learn-empty">No terms match "{query}".</p>
        )}
        {filtered.map(cat => (
          <div key={cat.key} className="learn-category">
            <h2 className="learn-category-title">{cat.label}</h2>
            <div className="learn-entries">
              {cat.entries.map(entry => (
                <div key={entry.slug} id={entry.slug} className="learn-entry">
                  <h3 className="learn-entry-term">{entry.term}</h3>
                  <p className="learn-entry-def">{entry.definition}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* ── CTA ── */}
      {!user && (
        <section className="learn-cta">
          <h2 className="lp-h1" style={{ fontSize: 'clamp(1.5rem, 3vw, 2rem)' }}>
            See these signals live, not just defined.
          </h2>
          <Link href="/login?signup=1" className="lp-btn-primary" style={{ marginTop: 16 }}>Get Started Free</Link>
        </section>
      )}

      {/* PlatformFooter already renders globally via AppShell for every route
          except '/' and '/login' - /learn isn't excluded, so it's already
          rendered as a sibling right after this component. */}
    </div>
  );
}
