'use client';
/* Quiet hours and snooze for Telegram alerts (owner sweep 2026-11-18), shown under the connected Telegram card on /alerts.
 * Saved with the account's other settings (alert_quiet_start / alert_quiet_end / alert_snooze_until / alert_paused); the alert cron reads them
 * through lib/alertQuiet.ts. Quiet hours run in the timezone the server has for this account (user_settings.timezone, UTC when unknown),
 * which is the zone named on screen, so what the person reads is what the cron applies. */
import { useEffect, useState } from 'react';
import { useSettings } from '@/lib/settings';
import { useLabels } from '@/lib/labels';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** 08:00 tomorrow on this browser's clock. */
function tomorrowMorning(now: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d.toISOString();
}

export default function TelegramQuietControls() {
  const { t } = useLabels();
  const { settings, update } = useSettings();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const zone = settings.timezone || 'UTC';
  const until = settings.alert_snooze_until ? Date.parse(settings.alert_snooze_until) : NaN;
  const snoozed = Number.isFinite(until) && until > now;
  const paused = settings.alert_paused === true;

  /* QUIET HOURS ARE A PAIR: the settings API refuses one bound alone. The choice is held here until both are set (or both Off), then saved
     together; while only one is chosen the field error says so and nothing is sent. A saved pair from another device replaces the draft. */
  type Field = 'alert_quiet_start' | 'alert_quiet_end';
  const [draft, setDraft] = useState<{ start: number | null; end: number | null; baseStart: number | null; baseEnd: number | null } | null>(null);
  const savedStart = settings.alert_quiet_start, savedEnd = settings.alert_quiet_end;
  const live = draft && draft.baseStart === savedStart && draft.baseEnd === savedEnd ? draft : null; // a draft made against an older saved pair is dropped
  const shown = live ?? { start: savedStart, end: savedEnd };
  const halfSet = (shown.start == null) !== (shown.end == null);
  const pick = (field: Field, value: number | null) => {
    const next = { start: shown.start, end: shown.end, [field === 'alert_quiet_start' ? 'start' : 'end']: value };
    if ((next.start == null) === (next.end == null)) { setDraft(null); update({ alert_quiet_start: next.start, alert_quiet_end: next.end }); }
    else setDraft({ ...next, baseStart: savedStart, baseEnd: savedEnd });
  };

  const hourSelect = (field: Field, label: string) => (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-caption)', color: 'var(--txt2)' }}>
      {label}
      <select
        className="pa-select"
        aria-label={`${t('ALERTS_QUIET_TITLE')}: ${label}`}
        value={(field === 'alert_quiet_start' ? shown.start : shown.end) == null ? '' : String(field === 'alert_quiet_start' ? shown.start : shown.end)}
        aria-invalid={halfSet && (field === 'alert_quiet_start' ? shown.start : shown.end) == null}
        aria-describedby={halfSet ? 'tg-quiet-pair-error' : undefined}
        onChange={e => pick(field, e.target.value === '' ? null : Number(e.target.value))}
      >
        <option value="">{t('ALERTS_QUIET_OFF')}</option>
        {HOURS.map(h => <option key={h} value={h}>{hh(h)}</option>)}
      </select>
    </label>
  );

  const snooze = (ms: number | 'tomorrow') => {
    setNow(Date.now());
    update({ alert_snooze_until: ms === 'tomorrow' ? tomorrowMorning(Date.now()) : new Date(Date.now() + ms).toISOString() });
  };
  const resume = () => update({ alert_paused: false, alert_snooze_until: null });

  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: '0.5px solid var(--bdr)', display: 'grid', gap: 14 }}>
      <div>
        <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--txt)', marginBottom: 4 }}>{t('ALERTS_QUIET_TITLE')}</div>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginBottom: 8, lineHeight: 1.6 }}>{t('ALERTS_QUIET_DESC', { tz: zone })}</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {hourSelect('alert_quiet_start', t('ALERTS_QUIET_FROM'))}
          {hourSelect('alert_quiet_end', t('ALERTS_QUIET_TO'))}
        </div>
        {halfSet && <div id="tg-quiet-pair-error" role="alert" style={{ fontSize: 'var(--fs-caption)', color: 'var(--red)', marginTop: 6 }}>{t('ALERTS_QUIET_BOTH')}</div>}
      </div>

      <div>
        <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--txt)', marginBottom: 4 }}>{t('ALERTS_SNOOZE_TITLE')}</div>
        {paused || snoozed ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span role="status" style={{ fontSize: 'var(--fs-caption)', color: 'var(--amber)' }}>
              {paused
                ? t('ALERTS_PAUSED_STATUS')
                : t('ALERTS_SNOOZED_UNTIL', { time: new Date(until).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) })}
            </span>
            <button className="tg-action-btn tg-btn-secondary" onClick={resume}>{t('ALERTS_RESUME_BUTTON')}</button>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginBottom: 8, lineHeight: 1.6 }}>{t('ALERTS_SNOOZE_DESC')}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="tg-action-btn tg-btn-secondary" onClick={() => snooze(60 * 60_000)}>{t('ALERTS_SNOOZE_1H')}</button>
              <button className="tg-action-btn tg-btn-secondary" onClick={() => snooze(4 * 60 * 60_000)}>{t('ALERTS_SNOOZE_4H')}</button>
              <button className="tg-action-btn tg-btn-secondary" onClick={() => snooze('tomorrow')}>{t('ALERTS_SNOOZE_TOMORROW')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
