'use client';
import type { GrokUsageInfo } from '@/lib/grok';
import { nextResetLocalTime } from '@/lib/resetTime';
import { useLabels } from '@/lib/labels';

const R = 21; // ring radius
const C = 2 * Math.PI * R; // arc circumference

const RINGS = [
  { id: 'quick',    labelKey: 'USAGE_RINGS_QUICK',    color: '#34d399', used: 'quick_used',     limit: 'quick_limit'     },
  { id: 'deep',     labelKey: 'USAGE_RINGS_DEEP',     color: '#5aa3ff', used: 'deep_used',      limit: 'deep_limit'      },
  { id: 'chat',     labelKey: 'USAGE_RINGS_CHAT',     color: '#60a5fa', used: 'chat_used',      limit: 'chat_limit'      },
  { id: 'search',   labelKey: 'USAGE_RINGS_SEARCH',   color: '#1a7aff', used: 'search_used',    limit: 'search_limit'    },
  { id: 'briefing', labelKey: 'USAGE_RINGS_BRIEFING', color: '#f59e0b', used: 'briefing_used',  limit: 'briefing_limit'  },
  // Shared budget across all 11 one-shot tools. Pro-only, so this ring is
  // filtered out below when the limit is 0 - free is capped per tool and has
  // no single number to show.
  { id: 'tools',    labelKey: 'USAGE_RINGS_TOOLS',    color: '#a78bfa', used: 'tool_pool_used', limit: 'tool_pool_limit' },
] as const;

export default function UsageRings({ usage }: { usage: GrokUsageInfo }) {
  const { t } = useLabels();
  const rings = RINGS.filter(r => (usage[r.limit] ?? 0) > 0);
  return (
    <div>
      <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--txt3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12, fontWeight: 500 }}>
        {t('USAGE_RINGS_HEADER')}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {rings.map(({ id, labelKey, color, used: usedKey, limit: limitKey }) => {
          const used      = usage[usedKey] ?? 0;
          const limit     = usage[limitKey] ?? 0;
          const remaining = limit - used;
          const pct       = limit > 0 ? used / limit : 0;
          const col       = pct >= 0.9 ? '#f87171' : pct >= 0.7 ? '#fbbf24' : color;
          const offset    = C * (1 - pct);
          return (
            <div key={id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{ position: 'relative', width: 56, height: 56 }}>
                <svg width="56" height="56" viewBox="0 0 56 56" style={{ display: 'block' }}>
                  <circle cx="28" cy="28" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
                  <circle
                    cx="28" cy="28" r={R} fill="none"
                    stroke={col} strokeWidth="4"
                    strokeDasharray={C} strokeDashoffset={offset}
                    strokeLinecap="round"
                    transform="rotate(-90 28 28)"
                    style={{ transition: 'stroke-dashoffset 0.5s ease, stroke 0.3s' }}
                  />
                </svg>
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: remaining >= 10 ? '0.8125rem' : '0.9375rem',
                  fontWeight: 700, color: col,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {remaining}
                </div>
              </div>
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', textAlign: 'center' }}>
                <div style={{ letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 600 }}>{t(labelKey)}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 10 }}>{t('USAGE_RINGS_RESETS_AT', { time: nextResetLocalTime() })}</div>
    </div>
  );
}
