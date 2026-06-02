'use client';
import { useEffect, useState } from 'react';
import { useMarket } from '@/lib/marketStore';

// ─── Labels & notes ────────────────────────────────────────────────────────
function getLabel(score: number) {
  if (score >= 75) return 'Alt Season 🚀';
  if (score >= 50) return 'Leaning Alts';
  if (score >= 25) return 'Leaning BTC';
  return 'Bitcoin Season ₿';
}

function getScoreCls(score: number) {
  if (score >= 75) return 'alt-score-altseason';
  if (score >= 50) return 'alt-score-leaning-alt';
  if (score >= 25) return 'alt-score-leaning-btc';
  return 'alt-score-btcseason';
}

const NOTES: Record<string, string> = {
  'Alt Season 🚀':
    'Over 75% of top 50 altcoins outperformed BTC over 90 days. Broad alt rally is active. Risk-on rotation in full swing.',
  'Leaning Alts':
    'Majority of alts beating BTC. Early-to-mid alt rotation. Monitor for continuation — but diversification is working.',
  'Leaning BTC':
    'Most alts underperforming BTC. Dominance is rising. Consider reducing alt exposure and riding BTC strength.',
  'Bitcoin Season ₿':
    'Less than 25% of top 50 alts beating BTC. Heavy Bitcoin season. Alts are bleeding in BTC terms — stay selective.',
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
        <div className="ind-value" style={{ color: '#606060' }}>--</div>
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
            <div className="fng-zones">
              <span>BTC ₿</span><span>Neutral</span><span>Alts 🚀</span>
            </div>
            <div className="fng-note">{NOTES[label]}</div>
          </div>
        </div>

        {delta != null && (
          <div className="fng-delta-row">
            <div className={`fng-delta-pill ${delta > 3 ? 'fng-delta-up' : delta < -3 ? 'fng-delta-down' : 'fng-delta-flat'}`}>
              {delta > 3 ? '▲' : delta < -3 ? '▼' : '◆'} {delta > 0 ? '+' : ''}{delta} pts vs yesterday
            </div>
            <div style={{ fontSize: 10, color: '#606060' }}>
              Yesterday: <span style={{ fontWeight: 600, color: '#a0a0a0' }}>{prevScore}</span>
            </div>
          </div>
        )}

        <div className="alt-sub-note">
          {altSeasonScore >= 75 ? `${altSeasonScore}` : altSeasonScore}% of top 50 alts outperformed BTC (90d) · resets daily
        </div>
      </div>
    </div>
  );
}
