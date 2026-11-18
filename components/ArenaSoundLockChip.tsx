'use client';
import { useEffect, useState } from 'react';
import { audioReady, unlockAudio } from '@/lib/arenaSound';
import { useLabels } from '@/lib/labels';

/* SOUND IS ON BUT THE BROWSER HAS NOT LET IT PLAY YET (QA audit, owner spec 2026-11-18). After a reload a visitor who allowed sound heard silence
 * until their first click, and nothing said so. While sound is enabled and audio is still locked, this chip says so; tapping it (a gesture) unlocks
 * audio and the chip goes away. Any other click or key press unlocks it too (useArenaSounds), and the chip follows. */
export default function ArenaSoundLockChip({ enabled }: { enabled: boolean }) {
  const { t } = useLabels();
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    if (!enabled) { setLocked(false); return; }
    const check = () => setLocked(!audioReady());
    check();
    /* The unlock happens inside a gesture somewhere on the page; read the state just after it. */
    const later = () => window.setTimeout(check, 120);
    window.addEventListener('pointerdown', later, { passive: true });
    window.addEventListener('keydown', later);
    return () => { window.removeEventListener('pointerdown', later); window.removeEventListener('keydown', later); };
  }, [enabled]);
  if (!enabled || !locked) return null;
  return (
    <button
      type="button"
      style={{ minHeight: 28, padding: '0 12px', margin: '0 0 10px', borderRadius: 6, border: '0.5px solid var(--bdr)', background: 'var(--bg1)', color: 'var(--txt2)', fontSize: 'var(--fs-caption)', cursor: 'pointer' }}
      data-testid="arena-sound-lock-chip"
      onClick={() => { unlockAudio(); window.setTimeout(() => setLocked(!audioReady()), 120); }}
    >
      {t('ARENA_SOUND_TAP_TO_ENABLE')}
    </button>
  );
}
