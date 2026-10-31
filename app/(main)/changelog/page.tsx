'use client';
import { useLabels } from '@/lib/labels';
import { CHANGELOG } from '@/lib/changelog';

/* #1810 item 1. The shape is /refund's - eyebrow, big h1, one-line note, then
   content - because that is what the other public, non-app pages look like and
   the owner asked for "aligned with the current design".
   `refund-term-wrap` is REUSED rather than copied under a new name: all that
   class does is strip border-radius under the terminal design, and adding a
   sixth selector would have pulled app/globals.css - a landing-gate file - into
   this change for two lines of CSS. */

function formatDate(iso: string): string {
  /* en-GB with an explicit UTC zone, not toLocaleDateString() on a bare Date:
     the entries are plain calendar dates, and parsing one as midnight UTC and
     then rendering it in the reader's zone moves it to the previous day for
     anyone west of Greenwich. */
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

export default function Changelog() {
  const { t } = useLabels();

  return (
    <div className="refund-term-wrap" style={{ maxWidth: 860, margin: '0 auto', padding: '48px 24px 80px' }}>

      <div style={{ marginBottom: 40 }}>
        <div style={{
          fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 14,
        }}>
          {t('CHANGELOG_EYEBROW')}
        </div>
        <h1 style={{ fontSize: '2.625rem', fontWeight: 800, color: 'var(--txt)', margin: 0, lineHeight: 1.1 }}>
          {t('CHANGELOG_PAGE_TITLE')}
        </h1>
        <p style={{ fontSize: 'var(--fs-label)', color: 'var(--txt3)', marginTop: 16, lineHeight: 1.7 }}>
          {t('CHANGELOG_SUBTITLE')}
        </p>
      </div>

      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 28 }}>
        {CHANGELOG.map(entry => (
          <li
            key={entry.tag}
            style={{
              border: '0.5px solid var(--bdr)', borderRadius: 12,
              background: 'var(--bg2)', padding: '20px 24px',
            }}
          >
            {/* <time>, so the date is machine-readable as well as legible. */}
            <h2 style={{ fontSize: 'var(--fs-card-title)', fontWeight: 700, color: 'var(--txt)', margin: '0 0 12px', lineHeight: 1.3 }}>
              <time dateTime={entry.date}>{formatDate(entry.date)}</time>
            </h2>
            <ul style={{ margin: 0, paddingLeft: '1.1em', display: 'flex', flexDirection: 'column', gap: 7 }}>
              {entry.items.map(item => (
                <li key={item} style={{ fontSize: 'var(--fs-label)', color: 'var(--txt2)', lineHeight: 1.7 }}>
                  {item}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      <p style={{
        borderTop: '1px solid var(--bdr)', marginTop: 40, paddingTop: 24,
        fontSize: 'var(--fs-caption)', color: 'var(--txt3)', lineHeight: 1.9,
      }}>
        {t('CHANGELOG_FIRST_ENTRY_NOTE')}
      </p>

    </div>
  );
}
