'use client';
import { useState, useEffect, useCallback } from 'react';
import { useOnboarding } from './OnboardingProvider';

const STEPS = [
  {
    id: 'tour-raidmeter',
    emoji: '🎯',
    title: 'Is now a good time to trade?',
    body: 'The Raid Probability Meter scores current market conditions out of 100. Start here every session before opening any trade.',
  },
  {
    id: 'tour-best-setup',
    emoji: '🏆',
    title: "See what is setting up",
    body: "The Setup of the Day shows the single best trade opportunity right now. One clear answer - not 12 things to figure out.",
  },
  {
    id: 'tour-coin-signals',
    emoji: '✅',
    title: 'Confirm with coin signals',
    body: 'These cards confirm the setup. Check funding, open interest, and the average daily price before entering a trade.',
  },
];

interface Rect { x: number; y: number; width: number; height: number }

export default function SpotlightTour({ onDone }: { onDone: () => void }) {
  const { markDone } = useOnboarding();
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const current = STEPS[step];
  const PAD = 14;

  const updateRect = useCallback(() => {
    const el = document.getElementById(current.id);
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ x: r.left, y: r.top, width: r.width, height: r.height });
  }, [current.id]);

  useEffect(() => {
    const el = document.getElementById(current.id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(updateRect, 350);
    }
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [step, current.id, updateRect]);

  function advance() {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1);
    } else {
      markDone('tourSeen');
      onDone();
    }
  }

  function skip() {
    markDone('tourSeen');
    onDone();
  }

  // Tooltip placement: prefer below, fall back to above
  const tooltipH = 185;
  const tooltipW = 300;
  const tooltipAbove = rect
    ? rect.y + rect.height + PAD + 16 + tooltipH > window.innerHeight
    : false;
  const tooltipTop = rect
    ? tooltipAbove
      ? rect.y - PAD - tooltipH - 16
      : rect.y + rect.height + PAD + 16
    : 0;
  const tooltipLeft = rect
    ? Math.max(12, Math.min(rect.x, window.innerWidth - tooltipW - 12))
    : 0;

  return (
    <>
      {/* Dark overlay with spotlight hole */}
      <svg
        style={{
          position: 'fixed', top: 0, left: 0,
          width: '100%', height: '100%',
          zIndex: 9000, pointerEvents: 'none',
        }}
        xmlns="http://www.w3.org/2000/svg"
      >
        {rect && (
          <defs>
            <mask id="tour-spotlight-mask">
              <rect width="100%" height="100%" fill="white" />
              <rect
                x={rect.x - PAD}
                y={rect.y - PAD}
                width={rect.width + PAD * 2}
                height={rect.height + PAD * 2}
                rx="14"
                fill="black"
              />
            </mask>
          </defs>
        )}
        <rect
          width="100%" height="100%"
          fill="rgba(0,0,0,0.78)"
          mask={rect ? 'url(#tour-spotlight-mask)' : undefined}
        />
      </svg>

      {/* Glowing spotlight border */}
      {rect && (
        <div style={{
          position: 'fixed',
          left: rect.x - PAD,
          top: rect.y - PAD,
          width: rect.width + PAD * 2,
          height: rect.height + PAD * 2,
          borderRadius: 14,
          border: '2px solid rgba(52,211,153,0.7)',
          boxShadow: '0 0 24px rgba(52,211,153,0.25)',
          zIndex: 9001,
          pointerEvents: 'none',
        }} />
      )}

      {/* Step tooltip */}
      {rect && (
        <div style={{
          position: 'fixed',
          top: tooltipTop,
          left: tooltipLeft,
          width: tooltipW,
          background: 'var(--bg1)',
          border: '0.5px solid rgba(52,211,153,0.35)',
          borderRadius: 14,
          padding: '16px 18px',
          zIndex: 9002,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          <div style={{ fontSize: 22, marginBottom: 8 }}>{current.emoji}</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--txt1)', marginBottom: 6 }}>
            {current.title}
          </div>
          <div style={{ fontSize: 12, color: 'var(--txt2)', lineHeight: 1.55, marginBottom: 16 }}>
            {current.body}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button
              onClick={skip}
              style={{
                background: 'none', border: 'none',
                fontSize: 11, color: 'var(--txt3)',
                cursor: 'pointer', padding: 0,
              }}
            >
              Skip tour
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 10, color: 'var(--txt3)' }}>
                {step + 1} / {STEPS.length}
              </span>
              <button
                onClick={advance}
                style={{
                  background: '#34d399',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 18px',
                  fontSize: 13,
                  fontWeight: 700,
                  color: '#000',
                  cursor: 'pointer',
                }}
              >
                {step < STEPS.length - 1 ? 'Next →' : 'Got it ✓'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
