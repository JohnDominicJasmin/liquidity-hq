'use client';
import { useLabels } from '@/lib/labels';
import { useSettings } from '@/lib/settings';
import { playPing, unlockAudio } from '@/lib/arenaSound';

/* THE FIRST-VISIT QUESTION (owner, 2026-11-14): "Play a sound on new signals and big moves?" Allow / Not now.
 * Shown on /arena until the visitor has answered once (`settings.arena_sound` is null only before the first answer); the answer is saved with the other
 * account settings, so it follows the account across devices. Allow turns the sounds ON and unlocks audio inside the click (browsers refuse audio before a
 * gesture). Not now, or the close button, turns them OFF. NOTHING PLAYS BEFORE AN ANSWER. The Settings toggle changes the answer at any time. */
export default function ArenaSoundPrompt() {
  const { t } = useLabels();
  const { settings, settingsLoadStatus, update } = useSettings();
  if (settingsLoadStatus !== 'ready' || settings.arena_sound !== null) return null;

  const allow = () => {
    unlockAudio();                                  // inside the click: the one moment the browser lets audio start
    update({ arena_sound: true });
    window.setTimeout(() => { playPing('move'); }, 60);   // a soft confirmation, after the answer, once the context is running
  };
  const notNow = () => { update({ arena_sound: false }); };

  return (
    <div
      role="region"
      aria-label={t('ARENA_SOUND_PROMPT_TEXT')}
      data-testid="arena-sound-prompt"
      style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 10px', padding: '8px 12px', border: '0.5px solid var(--bdr)', borderRadius: 8, background: 'var(--bg1)' }}
    >
      <span style={{ flex: '1 1 220px', fontSize: 'var(--fs-caption)', color: 'var(--txt2)' }}>{t('ARENA_SOUND_PROMPT_TEXT')}</span>
      <button
        type="button"
        data-testid="arena-sound-allow"
        onClick={allow}
        style={{ minHeight: 28, padding: '0 14px', borderRadius: 6, border: '0.5px solid var(--accent-bdr)', background: 'var(--accent-bg)', color: 'var(--accent)', fontSize: 'var(--fs-caption)', fontWeight: 700, cursor: 'pointer' }}
      >{t('ARENA_SOUND_PROMPT_ALLOW')}</button>
      <button
        type="button"
        data-testid="arena-sound-notnow"
        onClick={notNow}
        style={{ minHeight: 28, padding: '0 14px', borderRadius: 6, border: '0.5px solid var(--bdr)', background: 'none', color: 'var(--txt2)', fontSize: 'var(--fs-caption)', cursor: 'pointer' }}
      >{t('ARENA_SOUND_PROMPT_NOT_NOW')}</button>
      <button
        type="button"
        data-testid="arena-sound-dismiss"
        onClick={notNow}
        aria-label={t('ARENA_SOUND_PROMPT_DISMISS_LABEL')}
        title={t('ARENA_SOUND_PROMPT_DISMISS_LABEL')}
        style={{ minWidth: 28, minHeight: 28, border: 'none', background: 'none', color: 'var(--txt3)', fontSize: 'var(--fs-body)', cursor: 'pointer' }}
      ><span aria-hidden="true">{'✕'}</span></button>
    </div>
  );
}
