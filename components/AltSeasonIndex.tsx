'use client';
import { useEffect, useState } from 'react';
import { useMarket } from '@/lib/marketStore';

// ─── Labels & notes ────────────────────────────────────────────────────────
function getLabel(score: number) {
  if (score >= 75) return 'Alt Season';
  if (score >= 50) return 'Leaning Alts';
  if (score >= 25) return 'Leaning BTC';
  return 'Bitcoin Season';
}

function getScoreCls(score: number) {
  if (score >= 75) return 'alt-score-altseason';
  if (score >= 50) return 'alt-score-leaning-alt';
  if (score >= 25) return 'alt-score-leaning-btc';
  return 'alt-score-btcseason';
}

const NOTES: Record<string, string> = {
  'Alt Season':     'Broad alt rally active - ride alts',
  'Leaning Alts':   'Alts beating BTC - early rotation',
  'Leaning BTC':    'Alts lagging - ride BTC strength',
  'Bitcoin Season': 'BTC dominance rising - stay selective',
};

// ─── Storage keys for yesterday comparison ─────────────────────────────────
function todayKey()     { return 'altSeason_' + new Date().toISOString().slice(0, 10); }
function yesterdayKey() {
  const d = new Date(Date.now() - 86_400_000);
  return 'altSeason_' + d.toISOString().slice(0, 10);
}

// ─── Component ─────────────────────────────────────────────────────────────
export default function AltSeasonIndex() {
  const { store }      = useMarket();
  const { altSeasonScore } = store;
  const [prevScore, setPrevScore] = useState<number | null>(null);

  // Persist today's score; load yesterday's for delta
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem(yesterdayKey());
    if (stored) setPrevScore(parseInt(stored, 10));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || altSeasonScore == null) return;
    localStorage.setItem(todayKey(), String(altSeasonScore));
  }, [altSeasonScore]);

  if (altSeasonScore == null) {
    return (
      <div className="ind-card">
        <div className="ind-label">Alt Season Index</div>
        <div className="ind-value" style={{ color: 'var(--txt3)' }}>--</div>
        <div className="ind-note">Loading…</div>
      </div>
    );
  }

  const label = getLabel(altSeasonScore);
  const cls   = getScoreCls(altSeasonScore);
  const delta = prevScore != null ? altSeasonScore - prevScore : null;

  return (
    <div className="ind-card" style={{ gridColumn: 'span 2' }}>
      <div className="ind-label">Alt Season Index</div>
      <div className="fng-wrap">
        <div className="fng-row">
          <div>
            <div className={`fng-score ${cls}`}>{altSeasonScore}</div>
            <div className={`fng-label ${cls}`}>{label}</div>
          </div>
          <div className="fng-right">
            <div className="alt-bar-bg">
              <div className="fng-marker" style={{ left: altSeasonScore + '%' }} />
            </div>
            <div className="fng-note">{NOTES[label]}</div>
          </div>
        </div>

        {delta != null && (
          <div className="fng-delta-row">
            <div className={`fng-delta-pill ${delta > 3 ? 'fng-delta-up' : delta < -3 ? 'fng-delta-down' : 'fng-delta-flat'}`}>
              {delta > 3 ? '▲' : delta < -3 ? '▼' : '◆'} {delta > 0 ? '+' : ''}{delta} pts vs yesterday
            </div>
            <div style={{ fontSize: '0.625rem', color: 'var(--txt3)' }}>
              Yesterday: <span style={{ fontWeight: 600, color: 'var(--txt2)' }}>{prevScore}</span>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
