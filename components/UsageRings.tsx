'use client';
import type { GrokUsageInfo } from '@/lib/grok';

const C = 2 * Math.PI * 18; // arc circumference for r=18

const RINGS = [
  { label: 'Quick',    icon: '⚡', color: '#34d399', used: 'quick_used',    limit: 'quick_limit'    },
  { label: 'Deep',     icon: '🔬', color: '#b8aeff', used: 'deep_used',     limit: 'deep_limit'     },
  { label: 'Chat',     icon: '💬', color: '#60a5fa', used: 'chat_used',     limit: 'chat_limit'     },
  { label: 'Search',   icon: '🌐', color: '#a78bfa', used: 'search_used',   limit: 'search_limit'   },
  { label: 'Briefing', icon: '📋', color: '#f59e0b', used: 'briefing_used', limit: 'briefing_limit' },
] as const;

export default function UsageRings({ usage }: { usage: GrokUsageInfo }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--txt3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12, fontWeight: 500 }}>
        AI calls remaining today
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {RINGS.map(({ label, icon, color, used: usedKey, limit: limitKey }) => {
          const used      = usage[usedKey];
          const limit     = usage[limitKey];
          const remaining = limit - used;
          const pct       = limit > 0 ? used / limit : 0;
          const col       = pct >= 0.9 ? '#f87171' : pct >= 0.7 ? '#fbbf24' : color;
          const offset    = C * (1 - pct);
          return (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{ position: 'relative', width: 48, height: 48 }}>
                <svg width="48" height="48" viewBox="0 0 48 48" style={{ display: 'block' }}>
                  <circle cx="24" cy="24" r="18" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
                  <circle
                    cx="24" cy="24" r="18" fill="none"
                    stroke={col} strokeWidth="4"
                    strokeDasharray={C} strokeDashoffset={offset}
                    strokeLinecap="round"
                    transform="rotate(-90 24 24)"
                    style={{ transition: 'stroke-dashoffset 0.5s ease, stroke 0.3s' }}
                  />
                </svg>
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: remaining >= 10 ? 11 : 13,
                  fontWeight: 700, color: col,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {remaining}
                </div>
              </div>
              <div style={{ fontSize: 8, color: 'var(--txt3)', textAlign: 'center', lineHeight: 1.4 }}>
                <div>{icon}</div>
                <div style={{ letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 10 }}>Resets midnight UTC</div>
    </div>
  );
}
