'use client';
import { useCallback, useEffect, useState } from 'react';
import { useLabels } from '@/lib/labels';
import EmailLinked from '@/components/EmailLinked';
import type { LabelKey } from '@/lib/labelKeys';

/* #1810 item 2. Everything on this page comes from one read of /api/health,
   which is public and takes no credentials, so it works signed out.
 *
 * NO UPTIME FIGURE, DELIBERATELY. Nothing in this project has ever measured
 * uptime, so a percentage here would be invented - and inventing one is the
 * clearest possible breach of the rule that copy says only what the product
 * does today. What this page can honestly show is what the endpoint reports at
 * the moment you open it, which is what it shows.
 *
 * UNKNOWN IS ITS OWN STATE AND IS NEVER DRAWN AS HEALTHY. A failed fetch, a
 * body in a shape we do not recognise, or a build whose /api/health predates
 * the `exchanges` block all land on Unknown with a neutral colour - never on
 * Operational. A status page whose failure mode is "green" is worse than no
 * status page, because it is believed.
 *
 * Colour never carries the meaning on its own: every row prints its state as
 * text beside the dot, for colour-blind readers and for a screen reader. */

type State = 'operational' | 'degraded' | 'slow' | 'down' | 'unknown' | 'checking';

const STATE_LABEL: Record<State, LabelKey> = {
  operational: 'STATUS_STATE_OPERATIONAL',
  degraded: 'STATUS_STATE_DEGRADED',
  slow: 'STATUS_STATE_SLOW',
  down: 'STATUS_STATE_DOWN',
  unknown: 'STATUS_STATE_UNKNOWN',
  checking: 'STATUS_STATE_CHECKING',
};

const STATE_COLOR: Record<State, string> = {
  operational: 'var(--green)',
  degraded: 'var(--amber)',
  slow: 'var(--amber)',
  down: 'var(--red)',
  unknown: 'var(--txt3)',
  checking: 'var(--txt3)',
};

interface Health {
  ok?: unknown;
  reason?: unknown;
  checked_at?: unknown;
  exchanges?: unknown;
}

interface Reading {
  site: State;
  database: State;
  bybit: State;
  binance: State;
  checkedAt: string | null;
  reachable: boolean;
}

const UNREACHABLE: Reading = {
  site: 'unknown', database: 'unknown', bybit: 'unknown', binance: 'unknown',
  checkedAt: null, reachable: false,
};

/** `{ degraded: true }` -> degraded, `{ degraded: false }` -> operational, anything else -> unknown. */
function exchangeState(raw: unknown): State {
  if (!raw || typeof raw !== 'object') return 'unknown';
  const degraded = (raw as { degraded?: unknown }).degraded;
  if (degraded === true) return 'degraded';
  if (degraded === false) return 'operational';
  return 'unknown';
}

function read(body: Health): Reading {
  const exchanges = (body.exchanges && typeof body.exchanges === 'object')
    ? body.exchanges as Record<string, unknown>
    : {};

  /* The database row is the only one the endpoint answers directly. `ok: true`
     means one real read came back inside the budget; the two failure reasons
     are distinguished because "slow" and "not answering at all" are different
     things to a reader deciding whether to wait. An unrecognised reason is
     Unknown rather than Down - we do not know what it means. */
  let database: State = 'unknown';
  if (body.ok === true) database = 'operational';
  else if (body.reason === 'db_slow') database = 'slow';
  else if (body.reason === 'db_error') database = 'down';

  return {
    /* The website answered this request, whatever it said about its database -
       that IS the website being up, and it is why this is not inferred from
       the fact that you are reading the page (a service worker can serve that
       from cache while the platform is down). */
    site: 'operational',
    database,
    bybit: exchangeState(exchanges.bybit),
    binance: exchangeState(exchanges.binance),
    checkedAt: typeof body.checked_at === 'string' ? body.checked_at : null,
    reachable: true,
  };
}

export default function StatusPage() {
  const { t } = useLabels();
  const [reading, setReading] = useState<Reading | null>(null);
  const [checking, setChecking] = useState(true);

  /* `run` only STARTS the fetch - every setState it causes happens in a
     callback, never synchronously in the effect body. That is why `checking`
     starts true rather than being set to true here: calling setChecking(true)
     inside the mount effect is the react-hooks/set-state-in-effect warning the
     rest of this repo is already carrying 200 of, and there is no reason to
     add the 201st for a value that is correct at its initial state. */
  const run = useCallback(() => {
    /* no-store: a cached answer on a status page is the one thing it must not
       serve. The route sends no-store too; this is the browser half. */
    fetch('/api/health', { cache: 'no-store' })
      /* .json() on a 503 is fine - the route returns a JSON body with the
         failure reason at that status, and that body is the whole point. */
      .then(r => r.json())
      .then((body: Health) => setReading(read(body)))
      .catch(() => setReading(UNREACHABLE))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => { run(); }, [run]);

  /** The Check again button. A click is not an effect, so setting state here is fine. */
  const check = useCallback(() => { setChecking(true); run(); }, [run]);

  const rows: { key: LabelKey; state: State }[] = [
    { key: 'STATUS_COMPONENT_SITE', state: checking ? 'checking' : reading?.site ?? 'unknown' },
    { key: 'STATUS_COMPONENT_DATABASE', state: checking ? 'checking' : reading?.database ?? 'unknown' },
    { key: 'STATUS_COMPONENT_BYBIT', state: checking ? 'checking' : reading?.bybit ?? 'unknown' },
    { key: 'STATUS_COMPONENT_BINANCE', state: checking ? 'checking' : reading?.binance ?? 'unknown' },
  ];

  return (
    <div className="refund-term-wrap" style={{ maxWidth: 860, margin: '0 auto', padding: '48px 24px 80px' }}>

      <div style={{ marginBottom: 40 }}>
        <div style={{
          fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 14,
        }}>
          {t('STATUS_EYEBROW')}
        </div>
        <h1 style={{ fontSize: '2.625rem', fontWeight: 800, color: 'var(--txt)', margin: 0, lineHeight: 1.1 }}>
          {t('STATUS_PAGE_TITLE')}
        </h1>
        <p style={{ fontSize: 'var(--fs-label)', color: 'var(--txt3)', marginTop: 16, lineHeight: 1.7 }}>
          {t('STATUS_SUBTITLE')}
        </p>
      </div>

      {/* aria-live: pressing Check again replaces these values in place, which a
          screen reader would otherwise never hear. polite, not assertive - it
          is a status readout, not an interruption. */}
      <div
        aria-live="polite"
        style={{
          border: '0.5px solid var(--bdr)', borderRadius: 12,
          background: 'var(--bg2)', padding: '20px 24px', marginBottom: 20,
        }}
      >
        <div className="lbl">{t('STATUS_COMPONENTS_LABEL')}</div>
        {rows.map(row => (
          <div
            key={row.key}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
              padding: '9px 0', borderBottom: '0.5px solid var(--bdr)', fontSize: 'var(--fs-caption)',
            }}
          >
            <span style={{ color: 'var(--txt2)' }}>{t(row.key)}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--txt2)' }}>
              {/* aria-hidden: the dot repeats the word next to it, so announcing
                  it would read every row twice. */}
              <span
                aria-hidden="true"
                style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: STATE_COLOR[row.state],
                }}
              />
              {t(STATE_LABEL[row.state])}
            </span>
          </div>
        ))}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>
            {reading?.checkedAt
              ? t('STATUS_LAST_CHECKED', { time: new Date(reading.checkedAt).toLocaleTimeString() })
              : ' '}
          </span>
          {/* minHeight 24 + inline-flex, not padding: a standalone control, so
              WCAG 2.2 SC 2.5.8's inline exception does not cover it. */}
          <button
            type="button"
            onClick={check}
            disabled={checking}
            style={{
              fontSize: 'var(--fs-caption)', color: 'var(--txt2)', background: 'transparent',
              border: '0.5px solid var(--bdr)', borderRadius: 8, padding: '0 14px',
              display: 'inline-flex', alignItems: 'center', minHeight: 32,
              cursor: checking ? 'default' : 'pointer', opacity: checking ? 0.6 : 1,
            }}
          >
            {t('STATUS_REFRESH')}
          </button>
        </div>
      </div>

      {reading && !reading.reachable && (
        <p style={{
          fontSize: 'var(--fs-label)', color: 'var(--txt2)', lineHeight: 1.75,
          border: '0.5px solid var(--bdr)', borderRadius: 12, background: 'var(--bg2)',
          padding: '16px 24px', marginTop: 0, marginBottom: 20,
        }}>
          {t('STATUS_UNREACHABLE')}
        </p>
      )}

      <div style={{
        border: '0.5px solid var(--bdr)', borderRadius: 12,
        background: 'var(--bg2)', padding: '20px 24px',
      }}>
        <div className="lbl">{t('STATUS_REPORT_LABEL')}</div>
        <div style={{ fontSize: 'var(--fs-label)', color: 'var(--txt2)', lineHeight: 1.7 }}>
          <EmailLinked text={t('STATUS_REPORT_BODY')} />
        </div>
      </div>

    </div>
  );
}
