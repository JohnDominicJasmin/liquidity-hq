'use client';
import { useOnboarding } from './OnboardingProvider';
import { useAuth } from './AuthProvider';
import { useSettings } from '@/lib/settings';

interface Props {
  onStartTour: () => void;
}

export default function WelcomeModal({ onStartTour }: Props) {
  const { user } = useAuth();
  const { state, loaded, markDone } = useOnboarding();
  const { update } = useSettings();

  if (!user || !loaded || state.tourSeen) return null;

  function choose(mode: 'learning' | 'experienced') {
    if (mode === 'learning') {
      update({ beginner_mode: true });
      onStartTour();
    } else {
      update({ beginner_mode: false });
      markDone('tourSeen');
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose your experience"
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.88)',
        zIndex: 10000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div style={{
        background: 'var(--bg1)',
        border: '0.5px solid var(--bdr)',
        borderRadius: 18,
        padding: '36px 28px',
        maxWidth: 420,
        width: '100%',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 36, marginBottom: 14 }}>👋</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt1)', marginBottom: 8 }}>
          Welcome to LiquidityHQ
        </div>
        <div style={{ fontSize: 13, color: 'var(--txt2)', marginBottom: 28, lineHeight: 1.6 }}>
          Before we start, how do you want to use the dashboard?
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button
            onClick={() => choose('learning')}
            aria-label="I am just getting started - enable beginner mode and take a quick tour"
            style={{
              background: 'rgba(52,211,153,0.08)',
              border: '1px solid rgba(52,211,153,0.3)',
              borderRadius: 12,
              padding: '16px 20px',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'border-color 0.15s',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: '#34d399', marginBottom: 4 }}>
              🌱 I am just getting started
            </div>
            <div style={{ fontSize: 11, color: 'var(--txt3)', lineHeight: 1.5 }}>
              Show me a quick tour. Keep the dashboard simple with plain English labels.
            </div>
          </button>

          <button
            onClick={() => choose('experienced')}
            aria-label="I know crypto trading - skip tour and show full dashboard"
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid var(--bdr)',
              borderRadius: 12,
              padding: '16px 20px',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--txt1)', marginBottom: 4 }}>
              ⚡ I know crypto trading
            </div>
            <div style={{ fontSize: 11, color: 'var(--txt3)', lineHeight: 1.5 }}>
              Skip the tour. Show me everything including advanced indicators.
            </div>
          </button>
        </div>

        <button
          onClick={() => markDone('tourSeen')}
          style={{
            background: 'none', border: 'none',
            fontSize: 12, color: 'var(--txt3)',
            cursor: 'pointer', marginTop: 16,
            padding: '6px 0', width: '100%',
            textDecoration: 'underline', textUnderlineOffset: 3,
          }}
        >
          I will explore on my own
        </button>
      </div>
    </div>
  );
}
