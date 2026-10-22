'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { GLOSSARY } from '@/lib/glossary';
import { useLabels } from '@/lib/labels';

// Public glossary page (Tier 2 #14). Deliberately does NOT redirect signed-in
// users away like the marketing homepage (components/LandingContent.tsx) -
// this page needs to be reachable by cold organic-search traffic (the whole
// point is SEO) AND by existing logged-in users referencing a term while
// using the app, e.g. via the footer or nav drawer.
//
// "MATCH THE APP" (owner, 2026-10-22, #1673 item 5: the old page was "too vibe coded"; also closes R6). It used to hide the app shell with
// body.landing and draw the landing page's always-dark nav, a gold Georgia-italic accent word, gold letter-spaced category eyebrows and a
// centred hero CTA, so the theme switch did nothing here. Now it is an ordinary app page, like /faq and /about: the app's own top bar,
// footer and theme, a plain title, the search pinned under the top bar with jump links to the five categories, and the terms as a
// definition list. The glossary text, the term order, every term's id (so /learn#funding-rate still lands) and the copy keys are unchanged.
const CSS = `
.gl-wrap { max-width: 980px; margin: 0 auto; padding: 32px 24px 64px; }
.gl-sub { font-size: var(--fs-body); color: var(--txt3); line-height: 1.55; margin: 4px 0 0; max-width: 680px; }
.gl-sticky {
  position: sticky; top: calc(var(--appbar-h) + var(--strip-h) + var(--banner-h)); z-index: 5;
  background: var(--bg); padding: 14px 0 10px; margin-top: 18px; border-bottom: 0.5px solid var(--bdr);
}
.gl-search {
  width: 100%; height: 42px; padding: 0 12px; border-radius: 8px; border: 0.5px solid var(--bdr2);
  background: var(--bg2); color: var(--txt); font-size: var(--fs-body); outline: none;
}
.gl-search:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-bdr); }
.gl-search::placeholder { color: var(--txt3); }
.gl-jump { display: flex; gap: 6px; margin-top: 10px; overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.gl-jump::-webkit-scrollbar { display: none; }
.gl-jump a {
  flex: none; white-space: nowrap; display: inline-flex; align-items: center; min-height: 32px; padding: 0 12px;
  border-radius: 999px; border: 0.5px solid var(--bdr2); color: var(--txt2); font-size: var(--fs-caption); font-weight: 600;
  text-decoration: none;
}
.gl-jump a:hover, .gl-jump a:focus-visible { border-color: var(--accent); color: var(--txt); }
.gl-count { font-size: var(--fs-caption); color: var(--txt3); margin-top: 8px; }
.gl-cat { margin-top: 28px; scroll-margin-top: calc(var(--appbar-h) + var(--strip-h) + var(--banner-h) + 120px); }
.gl-cat-title { font-size: var(--fs-label); font-weight: 700; color: var(--txt); margin: 0 0 4px; }
.gl-dl { display: grid; grid-template-columns: 1fr; column-gap: 28px; margin: 0; }
.gl-dl dt {
  font-size: var(--fs-body); font-weight: 700; color: var(--txt); padding-top: 14px; border-top: 0.5px solid var(--bdr);
  scroll-margin-top: calc(var(--appbar-h) + var(--strip-h) + var(--banner-h) + 120px);
}
.gl-dl dd { margin: 4px 0 0; padding-bottom: 14px; font-size: var(--fs-body); color: var(--txt2); line-height: 1.6; }
.gl-empty { color: var(--txt3); font-size: var(--fs-body); padding: 24px 0; }
.gl-cta {
  display: flex; align-items: center; justify-content: space-between; gap: 12px 16px; flex-wrap: wrap;
  margin-top: 36px; padding: 14px 16px; border-radius: 10px; border: 0.5px solid var(--bdr); background: var(--bg2);
}
.gl-cta span { font-size: var(--fs-body); color: var(--txt); font-weight: 600; }
.gl-cta a {
  display: inline-flex; align-items: center; min-height: 44px; padding: 0 16px; border-radius: 8px; flex: none;
  background: var(--accent-solid); color: var(--on-accent); font-size: var(--fs-label); font-weight: 700; text-decoration: none;
}
@media (min-width: 900px) {
  .gl-jump { flex-wrap: wrap; overflow: visible; }
  .gl-dl { grid-template-columns: 240px 1fr; }
  .gl-dl dd { margin: 0; padding-top: 14px; border-top: 0.5px solid var(--bdr); }
}
`;

const catId = (key: string) => `cat-${key}`;

export default function LearnContent() {
  const { t } = useLabels();
  const { user } = useAuth();
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const filtered = q
    ? GLOSSARY.map(cat => ({ ...cat, entries: cat.entries.filter(e => e.term.toLowerCase().includes(q) || e.definition.toLowerCase().includes(q)) }))
        .filter(cat => cat.entries.length > 0)
    : GLOSSARY;
  const total = GLOSSARY.reduce((n, cat) => n + cat.entries.length, 0);
  const shown = filtered.reduce((n, cat) => n + cat.entries.length, 0);

  return (
    <div className="gl-wrap">
      <style>{CSS}</style>

      {/* The app's page-heading style (as on Trade Journal), one plain string: no accent word. */}
      <h1 style={{ fontSize: 'var(--fs-section)', fontWeight: 700, color: 'var(--txt)', margin: 0 }}>
        {t('LEARN_CONTENT_HEADING_MAIN')} {t('LEARN_CONTENT_HEADING_ACCENT')}
      </h1>
      <p className="gl-sub">{t('LEARN_CONTENT_HERO_SUB')}</p>

      <div className="gl-sticky">
        <input
          className="gl-search"
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('LEARN_CONTENT_SEARCH_PLACEHOLDER')}
          aria-label={t('LEARN_CONTENT_SEARCH_ARIA_LABEL')}
          autoComplete="off"
        />
        {filtered.length > 0 && (
          <nav className="gl-jump" aria-label={t('LEARN_CONTENT_HEADING_ACCENT')}>
            {filtered.map(cat => <a key={cat.key} href={`#${catId(cat.key)}`}>{cat.label}</a>)}
          </nav>
        )}
        {q && filtered.length > 0 && (
          <div className="gl-count" role="status">{t('LEARN_CONTENT_RESULTS_COUNT', { count: shown, total })}</div>
        )}
      </div>

      {filtered.length === 0 && (
        <p className="gl-empty" role="status">{t('LEARN_CONTENT_EMPTY_STATE', { query })}</p>
      )}
      {filtered.map(cat => (
        <section key={cat.key} id={catId(cat.key)} className="gl-cat">
          <h2 className="gl-cat-title">{cat.label}</h2>
          <dl className="gl-dl">
            {cat.entries.map(entry => (
              <div key={entry.slug} style={{ display: 'contents' }}>
                <dt id={entry.slug}>{entry.term}</dt>
                <dd>{entry.definition}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      {/* Signed-out visitors (search traffic): one plain line and a button, in the app's style - not a centred hero. */}
      {!user && (
        <div className="gl-cta">
          <span>{t('LEARN_CONTENT_CTA_HEADING')}</span>
          <Link href="/login?signup=1">{t('LEARN_CONTENT_CTA_BUTTON')}</Link>
        </div>
      )}

      {/* PlatformFooter already renders globally via AppShell for every route
          except '/' and '/login' - /learn isn't excluded, so it's already
          rendered as a sibling right after this component. */}
    </div>
  );
}
