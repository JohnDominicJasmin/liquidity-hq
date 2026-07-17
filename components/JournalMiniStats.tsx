'use client';
import { useState, useEffect } from 'react';
import { useAuth } from './AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { T } from '@/lib/tables';
import Link from 'next/link';

type TradeResult = 'OPEN' | 'WIN' | 'LOSS' | 'BE';
interface MinTrade {
  result: TradeResult;
  created_at?: string | null;
}

export default function JournalMiniStats() {
  const { user } = useAuth();
  const [trades, setTrades] = useState<MinTrade[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    const db = getSupabase();
    if (!db) return;
    db.from(T.trades)
      .select('result, created_at')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (data) setTrades(data as MinTrade[]);
        setLoaded(true);
      });
  }, [user]);

  if (!user || !loaded) return null;

  const closed = trades.filter(t => t.result !== 'OPEN');
  if (closed.length === 0) return null;

  const wins = closed.filter(t => t.result === 'WIN').length;
  const winRate = (wins / closed.length) * 100;
  const winRateCol = winRate >= 50 ? '#34d399' : '#f87171';

  const chron = [...closed].sort((a, b) =>
    (a.created_at ?? '') < (b.created_at ?? '') ? -1 : 1
  );
  let curStreak = 0, curDir: 'W' | 'L' | null = null;
  for (const t of chron) {
    if (t.result === 'BE') continue;
    const d: 'W' | 'L' = t.result === 'WIN' ? 'W' : 'L';
    if (d === curDir) { curStreak++; } else { curDir = d; curStreak = 1; }
  }
  const streakCol = curDir === 'W' ? '#34d399' : curDir === 'L' ? '#f87171' : 'var(--txt3)';

  const stats = [
    { label: 'Trades logged', value: String(closed.length), col: 'var(--txt)' },
    { label: 'Win rate',      value: winRate.toFixed(0) + '%', col: winRateCol },
    { label: 'Streak',        value: curDir ? `${curStreak} ${curDir === 'W' ? (curStreak === 1 ? 'win' : 'wins') : (curStreak === 1 ? 'loss' : 'losses')}` : '-', col: streakCol },
  ];

  return (
    <Link href="/journal" style={{ textDecoration: 'none', display: 'block', marginBottom: 10 }}>
      <div style={{
        display: 'flex',
        background: 'var(--bg2)',
        border: '0.5px solid var(--bdr)',
        borderRadius: 10,
        overflow: 'hidden',
        transition: 'border-color 0.15s',
      }}>
        {stats.map((s, i) => (
          <div key={i} style={{
            flex: 1,
            padding: '9px 10px',
            textAlign: 'center',
            borderRight: i < stats.length - 1 ? '0.5px solid var(--bdr)' : undefined,
          }}>
            <div style={{
              fontSize: '0.9375rem', fontWeight: 800, color: s.col,
              fontFamily: 'var(--font-mono), monospace', lineHeight: 1.2,
            }}>
              {s.value}
            </div>
            <div style={{ fontSize: '0.625rem', color: 'var(--txt3)', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>
    </Link>
  );
}
