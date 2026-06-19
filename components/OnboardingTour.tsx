'use client';
import { useState, useEffect } from 'react';
import { useOnboarding } from './OnboardingProvider';
import { useAuth } from './AuthProvider';

const STEPS = [
  {
    title: 'Welcome to LiquidityHQ',
    body: 'Your personal crypto trading intelligence hub. Live signals, AI analysis, and real-time alerts — all in one place. Let us show you around in 30 seconds.',
  },
  {
    title: 'AI Arena — Your Trading Room',
    body: '35 live signals, a professional chart, and one-click AI analysis. Select a coin, pick your timeframe, and let LiquidityAI score the setup.',
  },
  {
    title: 'Morning Briefing',
    body: 'Start every trading day here. Funding rates, fear & greed, top movers, and an AI market outlook — everything you need before you open a position.',
  },
  {
    title: 'News — Sorted by Impact',
    body: 'Breaking macro, crypto, and geopolitical events filtered by market impact. Tap "Ask LiquidityAI" on any story to get instant trade implications.',
  },
  {
    title: 'Alerts Come to You',
    body: "Connect Telegram once and alerts fire automatically — squeeze setups, whale trades, RSI extremes, and more. No need to watch the screen.",
  },
  {
    title: "You're Ready to Trade",
    body: 'Complete the 4-step setup checklist and the tool starts working for you around the clock. Takes about 2 minutes.',
  },
];

export default function OnboardingTour() {
  const { user } = useAuth();
  const { state, loaded, markDone } = useOnboarding();
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dismissed = typeof window !== 'undefined' && localStorage.getItem('lhq_tour_seen') === '1';
    if (loaded && user && !state.tourSeen && !dismissed) setVisible(true);
  }, [loaded, user, state.tourSeen]);

  if (!visible) return null;

  function close() {
    setVisible(false);
    try { localStorage.setItem('lhq_tour_seen', '1'); } catch { /* storage blocked */ }
    markDone('tourSeen');
  }

  const isLast = step === STEPS.length - 1;

  return (
    <div className="ob-overlay" onClick={close}>
      <div className="ob-modal" onClick={e => e.stopPropagation()}>
        <button className="ob-skip" onClick={close}>Skip ✕</button>

        <h2 className="ob-step-title">{STEPS[step].title}</h2>
        <p className="ob-step-body">{STEPS[step].body}</p>

        <div className="ob-dots">
          {STEPS.map((_, i) => (
            <button
              key={i}
              className={`ob-dot${i === step ? ' ob-dot-active' : ''}`}
              onClick={() => setStep(i)}
              aria-label={`Step ${i + 1}`}
            />
          ))}
        </div>

        <div className="ob-actions">
          {step > 0 && (
            <button className="ob-btn ob-btn-ghost" onClick={() => setStep(s => s - 1)}>← Back</button>
          )}
          <button
            className="ob-btn ob-btn-primary"
            onClick={() => isLast ? close() : setStep(s => s + 1)}
          >
            {isLast ? "Let's go! 🚀" : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  );
}
