'use client';
import { useSettings } from '@/lib/settings';
import { useLabels } from '@/lib/labels';
import { formatSummaryHour, summaryHour } from '@/lib/dailySummaryPrefs';

/* The hour picker under the Daily summary switch on /alerts. Saves user_settings.daily_summary_hour; the cron sends at that hour in the
   user's own timezone (the one TimezoneSync saved from this browser, UTC when none is saved yet). */
const HOURS = Array.from({ length: 24 }, (_, h) => h);

export default function DailySummaryHourPicker() {
  const { t } = useLabels();
  const { settings, update } = useSettings();
  const hour = summaryHour(settings.daily_summary_hour);
  const zone = settings.timezone || 'UTC';
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-caption)', color: 'var(--txt2)' }}>
        {t('ALERTS_DAILY_SUMMARY_HOUR_LABEL')}
        <select
          className="pa-select"
          value={hour}
          onChange={e => update({ daily_summary_hour: Number(e.target.value) })}
        >
          {HOURS.map(h => <option key={h} value={h}>{formatSummaryHour(h)}</option>)}
        </select>
      </label>
      <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('ALERTS_DAILY_SUMMARY_TZ_NOTE', { zone })}</span>
    </div>
  );
}
