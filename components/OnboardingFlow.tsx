'use client';
import { useState, useEffect, useRef } from 'react';
import { useOnboarding } from './OnboardingProvider';
import { useAuth } from './AuthProvider';
import { useSettings } from '@/lib/settings';
import { getSupabase } from '@/lib/supabase';
import { T } from '@/lib/tables';

interface Props { onStartTour: () => void; }

type Exp        = 'lt6m' | '6to12m' | '1to3y' | '3plus';
type TradeStyle = 'scalp' | 'swing' | 'both' | 'learning';
type Acct       = '1k5k' | '5k25k' | '25k100k' | '100kplus';
type Challenge  = 'read_signals' | 'entry_exit' | 'risk_management' | 'discipline';
type Heard      = 'social' | 'youtube' | 'tiktok' | 'search' | 'word' | 'other';

const STEP_META = [
  { key: 'Profile',    label: 'Profile',    accent: '#a78bfa' },
  { key: 'Experience', label: 'Experience', accent: '#34d399' },
  { key: 'Style',      label: 'Style',      accent: '#60a5fa' },
  { key: 'Goals',      label: 'Goals',      accent: '#f87171' },
  { key: 'Source',     label: 'Source',     accent: '#e879f9' },
] as const;

const COUNTRIES = [
  { flag: '🇦🇷', name: 'Argentina' },
  { flag: '🇦🇺', name: 'Australia' },
  { flag: '🇧🇩', name: 'Bangladesh' },
  { flag: '🇧🇷', name: 'Brazil' },
  { flag: '🇨🇦', name: 'Canada' },
  { flag: '🇨🇳', name: 'China' },
  { flag: '🇪🇹', name: 'Ethiopia' },
  { flag: '🇫🇷', name: 'France' },
  { flag: '🇩🇪', name: 'Germany' },
  { flag: '🇬🇭', name: 'Ghana' },
  { flag: '🇮🇳', name: 'India' },
  { flag: '🇮🇩', name: 'Indonesia' },
  { flag: '🇯🇵', name: 'Japan' },
  { flag: '🇰🇪', name: 'Kenya' },
  { flag: '🇲🇾', name: 'Malaysia' },
  { flag: '🇲🇽', name: 'Mexico' },
  { flag: '🇳🇬', name: 'Nigeria' },
  { flag: '🇵🇰', name: 'Pakistan' },
  { flag: '🇵🇭', name: 'Philippines' },
  { flag: '🇷🇺', name: 'Russia' },
  { flag: '🇸🇬', name: 'Singapore' },
  { flag: '🇿🇦', name: 'South Africa' },
  { flag: '🇰🇷', name: 'South Korea' },
  { flag: '🇹🇭', name: 'Thailand' },
  { flag: '🇹🇷', name: 'Turkey' },
  { flag: '🇦🇪', name: 'UAE' },
  { flag: '🇺🇦', name: 'Ukraine' },
  { flag: '🇬🇧', name: 'United Kingdom' },
  { flag: '🇺🇸', name: 'United States' },
  { flag: '🇻🇳', name: 'Vietnam' },
  { flag: '🌐', name: 'Other' },
];

const STEP_COPY = [
  { headline: ['Set up your', 'profile.'],               desc: 'Personalizes your signals, alerts, and position sizing.' },
  { headline: ['How long have you been', 'trading crypto?'], desc: 'Sets Beginner Mode on or off for your dashboard.' },
  { headline: ['How do you', 'mainly trade?'],            desc: 'Pre-selects your default chart timeframe in Arena.' },
  { headline: ['What is your biggest', 'challenge?'],     desc: 'Surfaces the most relevant signals and education for you.' },
  { headline: ['Where did you find', 'LiquidityHQ?'],    desc: 'Optional - helps us know where to invest our energy.' },
];

/* ── Custom country dropdown with emoji flags ── */
function CountrySelect({ value, onChange, accent }: {
  value: string; onChange: (v: string) => void; accent: string;
}) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const containerRef      = useRef<HTMLDivElement>(null);
  const searchRef         = useRef<HTMLInputElement>(null);

  const selected = COUNTRIES.find(c => c.name === value);
  const filtered = query
    ? COUNTRIES.filter(c => c.name.toLowerCase().includes(query.toLowerCase()))
    : COUNTRIES;

  useEffect(() => {
    if (!open) { setQuery(''); return; }
    setTimeout(() => searchRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          padding: '13px 16px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
          background: value ? `${accent}0c` : 'rgba(255,255,255,0.03)',
          border: `1px solid ${value ? accent + '40' : 'rgba(255,255,255,0.08)'}`,
          color: value ? '#e5e7eb' : '#555', fontSize: 14,
          boxShadow: value ? `0 0 0 1px ${accent}18` : 'none',
          transition: 'all 0.2s',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {selected ? (
            <>
              <span style={{ fontSize: 20, flexShrink: 0, lineHeight: 1 }}>{selected.flag}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.name}</span>
            </>
          ) : (
            <span>Select your country…</span>
          )}
        </span>
        <svg
          width="12" height="12" viewBox="0 0 12 12" fill="none"
          style={{ flexShrink: 0, opacity: 0.4, transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none' }}
        >
          <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div
          className="ob-fade-down"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 200,
            background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
            boxShadow: '0 24px 72px rgba(0,0,0,0.95), 0 4px 16px rgba(0,0,0,0.6)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search country…"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 7, padding: '8px 12px', fontSize: 13, color: '#e5e7eb', outline: 'none',
              }}
            />
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: '#444' }}>No match</div>
            ) : filtered.map(c => {
              const isActive = value === c.name;
              return (
                <button
                  key={c.name}
                  type="button"
                  className="ob-opt"
                  onClick={() => { onChange(c.name); setOpen(false); }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px', border: 'none', cursor: 'pointer', textAlign: 'left',
                    background: isActive ? `${accent}15` : 'transparent',
                    color: isActive ? accent : '#ccc',
                    fontSize: 14, transition: 'background 0.1s',
                  }}
                >
                  <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{c.flag}</span>
                  <span style={{ flex: 1 }}>{c.name}</span>
                  {isActive && (
                    <svg width="12" height="10" viewBox="0 0 12 10" fill="none" style={{ flexShrink: 0 }}>
                      <path d="M1 5L4.5 8.5L11 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Option card with glow + animated check ── */
function OptionCard<T extends string>({
  value, selected, label, sub, accent, onClick, delay = 0,
}: {
  value: T; selected: T | null; label: string; sub?: string;
  accent: string; onClick: (v: T) => void; delay?: number;
}) {
  const active = selected === value;
  return (
    <button
      type="button"
      className="ob-opt"
      onClick={() => onClick(value)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 14,
        padding: '15px 18px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
        boxSizing: 'border-box', position: 'relative', overflow: 'hidden',
        background: active
          ? `linear-gradient(135deg, ${accent}10 0%, ${accent}06 100%)`
          : 'rgba(255,255,255,0.025)',
        border: `1px solid ${active ? accent + '45' : 'rgba(255,255,255,0.07)'}`,
        borderLeft: `3px solid ${active ? accent : 'transparent'}`,
        boxShadow: active ? `0 0 28px ${accent}1a, inset 0 1px 0 ${accent}10` : 'none',
        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        animationDelay: `${delay}ms`,
      }}
    >
      <div style={{
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
        border: `2px solid ${active ? accent : 'rgba(255,255,255,0.16)'}`,
        background: active ? accent : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.2s',
        boxShadow: active ? `0 0 14px ${accent}55` : 'none',
      }}>
        {active && (
          <svg className="ob-check-in" width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4L3.5 6.5L9 1" stroke="#000" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, lineHeight: 1.3,
          color: active ? accent : '#d1d5db',
          transition: 'color 0.2s',
        }}>
          {label}
        </div>
        {sub && (
          <div style={{
            fontSize: 11, marginTop: 3, lineHeight: 1.4,
            color: active ? `${accent}70` : '#3f3f3f',
            transition: 'color 0.2s',
          }}>
            {sub}
          </div>
        )}
      </div>
    </button>
  );
}

/* ── Account size 2x2 grid ── */
function AcctGrid({ acct, setAcct, accent }: { acct: Acct | null; setAcct: (v: Acct) => void; accent: string }) {
  const opts: { value: Acct; label: string }[] = [
    { value: '1k5k',     label: '$1k - $5k'    },
    { value: '5k25k',    label: '$5k - $25k'   },
    { value: '25k100k',  label: '$25k - $100k'  },
    { value: '100kplus', label: '$100k+'         },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {opts.map(o => {
        const active = acct === o.value;
        return (
          <button
            key={o.value}
            type="button"
            className="ob-opt"
            onClick={() => setAcct(o.value)}
            style={{
              padding: '15px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
              background: active
                ? `linear-gradient(160deg, ${accent}14 0%, ${accent}07 100%)`
                : 'rgba(255,255,255,0.025)',
              border: `1px solid ${active ? accent + '45' : 'rgba(255,255,255,0.07)'}`,
              borderTop: `2px solid ${active ? accent : 'transparent'}`,
              color: active ? accent : '#888',
              fontSize: 13, fontWeight: 700, letterSpacing: '-.01em',
              boxShadow: active ? `0 0 20px ${accent}18` : 'none',
              transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Source attribution chip ── */
function SourceChip({ value, selected, label, accent, onClick }: {
  value: Heard; selected: Heard | null; label: string; accent: string; onClick: (v: Heard) => void;
}) {
  const active = selected === value;
  return (
    <button
      type="button"
      className="ob-opt"
      onClick={() => onClick(value)}
      style={{
        padding: '9px 18px', borderRadius: 100, cursor: 'pointer',
        fontSize: 12, fontWeight: 700, letterSpacing: '.03em',
        background: active ? `${accent}18` : 'rgba(255,255,255,0.04)',
        border: `1px solid ${active ? accent + '55' : 'rgba(255,255,255,0.08)'}`,
        color: active ? accent : '#555',
        boxShadow: active ? `0 0 18px ${accent}25` : 'none',
        transition: 'all 0.18s',
      }}
    >
      {label}
    </button>
  );
}

/* ── Left panel step list ── */
function StepList({ step: currentStep }: { step: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {STEP_META.map((s, i) => {
        const done   = i < currentStep;
        const active = i === currentStep;
        return (
          <div key={s.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 28 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: active ? s.accent : done ? 'rgba(52,211,153,0.1)' : 'rgba(255,255,255,0.04)',
                border: `1.5px solid ${active ? s.accent : done ? '#34d39945' : 'rgba(255,255,255,0.07)'}`,
                boxShadow: active ? `0 0 20px ${s.accent}55` : 'none',
                transition: 'all 0.3s',
                fontSize: 10, fontWeight: 700,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                color: active ? '#000' : done ? '#34d399' : '#2a2a2a',
              }}>
                {done ? (
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4L3.5 6.5L9 1" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : String(i + 1).padStart(2, '0')}
              </div>
              {i < STEP_META.length - 1 && (
                <div style={{
                  width: 1.5, height: 32, marginTop: 4,
                  background: done
                    ? 'linear-gradient(180deg, #34d39940, rgba(255,255,255,0.03))'
                    : 'rgba(255,255,255,0.04)',
                  transition: 'background 0.4s',
                }} />
              )}
            </div>
            <div style={{ paddingTop: 6, paddingBottom: i < STEP_META.length - 1 ? 32 : 0 }}>
              <div style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                color: active ? s.accent : done ? '#34d399' : '#242424',
                transition: 'color 0.3s',
              }}>
                {s.label}
              </div>
              {active && (
                <div style={{
                  fontSize: 9, color: '#2c2c2c', marginTop: 2,
                  fontFamily: "'JetBrains Mono', monospace", letterSpacing: '.06em',
                }}>
                  YOU ARE HERE
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Main onboarding component ── */
export default function OnboardingFlow({ onStartTour }: Props) {
  const { user }                    = useAuth();
  const { state, loaded, markDone } = useOnboarding();
  const { update }                  = useSettings();

  const [step,        setStep]       = useState(0);
  const [animKey,     setAnimKey]    = useState(0);
  const [saving,      setSaving]     = useState(false);
  const [isMobile,    setIsMobile]   = useState(false);
  const [displayName, setDisplayName]= useState('');
  const [country,     setCountry]    = useState('');
  const [acct,        setAcct]       = useState<Acct | null>(null);
  const [exp,         setExp]        = useState<Exp | null>(null);
  const [tradeStyle,  setTradeStyle] = useState<TradeStyle | null>(null);
  const [challenge,   setChallenge]  = useState<Challenge | null>(null);
  const [heard,       setHeard]      = useState<Heard | null>(null);

  // Inject fonts + CSS animations (class-based since inline can't do keyframes/hover)
  useEffect(() => {
    if (document.getElementById('ob-styles')) return;
    const el = document.createElement('style');
    el.id = 'ob-styles';
    el.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap');
      @keyframes obFadeUp   { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
      @keyframes obCheckIn  { from { transform:scale(0) rotate(-45deg); opacity:0; } to { transform:scale(1) rotate(0); opacity:1; } }
      @keyframes obGlow     { 0%,100% { opacity:.3; } 50% { opacity:.6; } }
      @keyframes obFadeDown { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }
      .ob-fade-up  { animation: obFadeUp 0.38s cubic-bezier(0.16,1,0.3,1) both; }
      .ob-check-in { animation: obCheckIn 0.28s cubic-bezier(0.175,0.885,0.32,1.275) both; }
      .ob-glow     { animation: obGlow 3.5s ease-in-out infinite; }
      .ob-fade-down{ animation: obFadeDown 0.18s ease both; }
      .ob-opt:hover       { filter: brightness(1.07); }
      .ob-next:not(:disabled):hover { filter:brightness(1.1); transform:translateY(-1px); box-shadow-transition:box-shadow 0.2s; }
      .ob-next            { transition: all 0.2s !important; }
      .ob-back:hover      { color: rgba(255,255,255,0.42) !important; }
      .ob-skip:hover      { color: rgba(255,255,255,0.38) !important; }
    `;
    document.head.appendChild(el);
    return () => { document.getElementById('ob-styles')?.remove(); };
  }, []);

  // Responsive: detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  if (!user || !loaded || state.profileComplete) return null;

  const meta   = STEP_META[step];
  const accent = meta.accent;
  const isLast = step === STEP_META.length - 1;
  const copy   = STEP_COPY[step];

  function canNext() {
    if (step === 0) return country !== '' && acct !== null;
    if (step === 1) return exp !== null;
    if (step === 2) return tradeStyle !== null;
    if (step === 3) return challenge !== null;
    return true;
  }

  async function finish() {
    if (saving) return;
    setSaving(true);
    const beginner = exp === 'lt6m' || exp === '6to12m' || tradeStyle === 'learning';
    const tfMap: Record<TradeStyle, '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d'> = {
      scalp: '5m', swing: '4h', both: '15m', learning: '15m',
    };
    const acctMap: Record<Acct, number> = {
      '1k5k': 2500, '5k25k': 10000, '25k100k': 50000, '100kplus': 150000,
    };
    update({
      beginner_mode:      beginner,
      display_name:       displayName || null,
      country:            country     || null,
      trading_experience: exp         ?? null,
      trading_style:      tradeStyle  ?? null,
      trading_challenge:  challenge   ?? null,
      how_heard:          heard       ?? null,
      ...(acct       ? { account_size: acctMap[acct]      } : {}),
      ...(tradeStyle ? { default_tf:   tfMap[tradeStyle]  } : {}),
    });
    const sb = getSupabase();
    if (sb && user) {
      await sb.from(T.user_onboarding).upsert(
        { user_id: user.id, profile_complete: true, tour_seen: true, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
    }
    markDone('profileComplete');
    markDone('tourSeen');
    if (beginner) onStartTour();
  }

  function goNext() {
    setAnimKey(k => k + 1);
    if (step < STEP_META.length - 1) setStep(s => s + 1);
    else finish();
  }

  function goBack() {
    setAnimKey(k => k + 1);
    setStep(s => s - 1);
  }

  const monoFont = "'JetBrains Mono', 'Fira Code', monospace";
  const serifFont = "'Outfit', system-ui, sans-serif";

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        display: 'flex', background: '#080808',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        overflowY: 'auto',
      }}
    >
      {/* Ambient glow — color tracks the active step */}
      <div
        className="ob-glow"
        style={{
          position: 'fixed',
          top: '10%', left: isMobile ? '0%' : '35%',
          width: 800, height: 800,
          background: `radial-gradient(circle, ${accent}12 0%, transparent 65%)`,
          pointerEvents: 'none', borderRadius: '50%',
          transition: 'background 0.55s ease',
        }}
      />

      {/* ── LEFT BRAND PANEL ── */}
      {!isMobile && (
        <div style={{
          width: 288, flexShrink: 0,
          display: 'flex', flexDirection: 'column',
          padding: '52px 36px',
          borderRight: '1px solid rgba(255,255,255,0.04)',
          position: 'relative', overflow: 'hidden',
          backgroundImage: `radial-gradient(${accent}16 1px, transparent 1px)`,
          backgroundSize: '22px 22px',
          transition: 'background-image 0.5s',
        }}>
          {/* Fade grid out at top and bottom */}
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'linear-gradient(180deg, #080808 0%, transparent 14%, transparent 82%, #080808 100%)',
          }} />
          <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Logo */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 64,
              fontSize: 11, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase',
              fontFamily: monoFont, color: '#fff',
            }}>
              <span style={{ color: accent, fontSize: 14, transition: 'color 0.45s' }}>⚡</span>
              LIQUIDITYHQ
            </div>

            <StepList step={step} />

            {/* Quote */}
            <div style={{ marginTop: 'auto' }}>
              <div style={{
                borderLeft: `2px solid ${accent}35`,
                paddingLeft: 14,
                transition: 'border-color 0.45s',
              }}>
                <div style={{
                  fontSize: 11.5, lineHeight: 1.75, color: '#2b2b2b',
                  fontFamily: serifFont,
                }}>
                  &ldquo;The edge goes to those who read the market, not the crowd.&rdquo;
                </div>
                <div style={{
                  fontSize: 9, color: '#1c1c1c', marginTop: 8,
                  fontFamily: monoFont, letterSpacing: '.09em', textTransform: 'uppercase',
                }}>
                  — LIQUIDITYHQ
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── RIGHT FORM PANEL ── */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        padding: isMobile ? '40px 24px 48px' : '52px 64px',
        position: 'relative', minHeight: '100vh',
        justifyContent: 'center',
        maxWidth: isMobile ? '100%' : 640,
      }}>
        {/* Mobile top bar: logo + step dots */}
        {isMobile && (
          <div style={{ marginBottom: 36 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7, marginBottom: 24,
              fontSize: 11, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase',
              fontFamily: monoFont, color: '#fff',
            }}>
              <span style={{ color: accent, transition: 'color 0.45s' }}>⚡</span>
              LIQUIDITYHQ
            </div>
            {/* Pill dots */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              {STEP_META.map((s, i) => (
                <div key={s.key} style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{
                    height: 6, width: i === step ? 20 : 6, borderRadius: 100,
                    background: i < step ? '#34d399' : i === step ? accent : 'rgba(255,255,255,0.07)',
                    transition: 'all 0.35s cubic-bezier(0.16,1,0.3,1)',
                  }} />
                  {i < STEP_META.length - 1 && (
                    <div style={{
                      width: 12, height: 1.5,
                      background: i < step ? '#34d39938' : 'rgba(255,255,255,0.04)',
                      transition: 'background 0.35s',
                    }} />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step label */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14,
          fontSize: 10, fontWeight: 700, letterSpacing: '.14em', fontFamily: monoFont,
        }}>
          <span style={{ color: accent, transition: 'color 0.45s' }}>
            {`STEP ${String(step + 1).padStart(2, '0')}`}
          </span>
          <span style={{ color: '#222' }}>/</span>
          <span style={{ color: '#222' }}>{String(STEP_META.length).padStart(2, '0')}</span>
          <span style={{ color: '#1e1e1e' }}>&nbsp;&mdash;&nbsp;{meta.label.toUpperCase()}</span>
        </div>

        {/* Animated step content */}
        <div key={animKey} className="ob-fade-up">
          {/* Headline */}
          <div style={{ marginBottom: 10 }}>
            {copy.headline.map((line, i) => (
              <div
                key={i}
                style={{
                  fontFamily: serifFont,
                  fontSize: isMobile ? 28 : 38,
                  lineHeight: 1.1, fontWeight: 800,
                  color: i === copy.headline.length - 1 ? accent : '#fff',
                  transition: 'color 0.45s',
                }}
              >
                {line}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: '#343434', marginBottom: 28, lineHeight: 1.65 }}>
            {copy.desc}
          </div>

          {/* ── Step 0: Profile ── */}
          {step === 0 && (
            <>
              <div style={{ marginBottom: 16 }}>
                <label style={{
                  display: 'block', fontSize: 9, fontWeight: 700, letterSpacing: '.12em',
                  textTransform: 'uppercase', color: '#2e2e2e', marginBottom: 8, fontFamily: monoFont,
                }}>
                  Display name <span style={{ color: '#222', fontWeight: 400 }}>(optional)</span>
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="e.g. trader_dom"
                  maxLength={32}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '13px 16px', borderRadius: 10, outline: 'none',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: '#e5e7eb', fontSize: 14,
                    fontFamily: monoFont,
                    transition: 'border-color 0.2s, box-shadow 0.2s',
                  }}
                  onFocus={e => { e.target.style.borderColor = `${accent}60`; e.target.style.boxShadow = `0 0 0 2px ${accent}14`; }}
                  onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.08)'; e.target.style.boxShadow = 'none'; }}
                />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{
                  display: 'block', fontSize: 9, fontWeight: 700, letterSpacing: '.12em',
                  textTransform: 'uppercase', color: '#2e2e2e', marginBottom: 8, fontFamily: monoFont,
                }}>
                  Country
                </label>
                <CountrySelect value={country} onChange={setCountry} accent={accent} />
              </div>

              <div>
                <label style={{
                  display: 'block', fontSize: 9, fontWeight: 700, letterSpacing: '.12em',
                  textTransform: 'uppercase', color: '#2e2e2e', marginBottom: 10, fontFamily: monoFont,
                }}>
                  Trading account range
                </label>
                <AcctGrid acct={acct} setAcct={setAcct} accent={accent} />
              </div>
            </>
          )}

          {/* ── Step 1: Experience ── */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <OptionCard<Exp> value="lt6m"   selected={exp} accent={accent} label="Less than 6 months" sub="Just getting started — Beginner Mode enabled" onClick={setExp} delay={0} />
              <OptionCard<Exp> value="6to12m" selected={exp} accent={accent} label="6-12 months"        sub="Finding my footing — Beginner Mode enabled"  onClick={setExp} delay={55} />
              <OptionCard<Exp> value="1to3y"  selected={exp} accent={accent} label="1-3 years"          sub="Getting comfortable — full tools unlocked"    onClick={setExp} delay={110} />
              <OptionCard<Exp> value="3plus"  selected={exp} accent={accent} label="3+ years"           sub="I know what I am doing — full access"        onClick={setExp} delay={165} />
            </div>
          )}

          {/* ── Step 2: Style ── */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <OptionCard<TradeStyle> value="scalp"    selected={tradeStyle} accent={accent} label="Scalp"          sub="Minutes to hours — defaults to 5m chart"      onClick={setTradeStyle} delay={0} />
              <OptionCard<TradeStyle> value="swing"    selected={tradeStyle} accent={accent} label="Swing trade"    sub="Days to weeks — defaults to 4h chart"         onClick={setTradeStyle} delay={55} />
              <OptionCard<TradeStyle> value="both"     selected={tradeStyle} accent={accent} label="Both"           sub="Depends on the setup — defaults to 15m chart"  onClick={setTradeStyle} delay={110} />
              <OptionCard<TradeStyle> value="learning" selected={tradeStyle} accent={accent} label="Still learning" sub="Not sure yet — Beginner Mode on"              onClick={setTradeStyle} delay={165} />
            </div>
          )}

          {/* ── Step 3: Goals ── */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <OptionCard<Challenge> value="read_signals"    selected={challenge} accent={accent} label="Reading the signals correctly"     sub="Not sure what the data is telling me"       onClick={setChallenge} delay={0} />
              <OptionCard<Challenge> value="entry_exit"      selected={challenge} accent={accent} label="Knowing when to enter and exit"    sub="Always too early, too late, or too scared"  onClick={setChallenge} delay={55} />
              <OptionCard<Challenge> value="risk_management" selected={challenge} accent={accent} label="Managing risk and not overtrading" sub="Position sizing, stop losses, overexposure" onClick={setChallenge} delay={110} />
              <OptionCard<Challenge> value="discipline"      selected={challenge} accent={accent} label="Staying disciplined and patient"   sub="Chasing trades, revenge trading, FOMO"      onClick={setChallenge} delay={165} />
            </div>
          )}

          {/* ── Step 4: Source ── */}
          {step === 4 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <SourceChip value="social"  selected={heard} accent={accent} label="Facebook / Instagram" onClick={setHeard} />
              <SourceChip value="youtube" selected={heard} accent={accent} label="YouTube"             onClick={setHeard} />
              <SourceChip value="tiktok"  selected={heard} accent={accent} label="TikTok"             onClick={setHeard} />
              <SourceChip value="search"  selected={heard} accent={accent} label="Search"             onClick={setHeard} />
              <SourceChip value="word"    selected={heard} accent={accent} label="Word of mouth"      onClick={setHeard} />
              <SourceChip value="other"   selected={heard} accent={accent} label="Other"              onClick={setHeard} />
            </div>
          )}
        </div>

        {/* ── Navigation ── */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 38 }}>
          {step > 0 && !saving && (
            <button
              type="button"
              className="ob-back"
              onClick={goBack}
              style={{
                padding: '14px 18px', borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.07)',
                background: 'transparent', color: '#303030',
                fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
                fontFamily: monoFont, letterSpacing: '.06em',
                transition: 'color 0.2s',
              }}
            >
              ← BACK
            </button>
          )}
          <button
            type="button"
            className="ob-next"
            onClick={goNext}
            disabled={!canNext() || saving}
            style={{
              flex: 1, padding: '15px 0', borderRadius: 10, border: 'none',
              background: canNext() && !saving ? accent : 'rgba(255,255,255,0.05)',
              color: canNext() && !saving ? '#000' : '#282828',
              fontSize: 11, fontWeight: 800, letterSpacing: '.09em', textTransform: 'uppercase',
              fontFamily: monoFont,
              cursor: canNext() && !saving ? 'pointer' : 'not-allowed',
              boxShadow: canNext() && !saving ? `0 8px 32px ${accent}45` : 'none',
              transition: 'all 0.2s',
            }}
          >
            {saving ? 'Setting up…' : isLast ? 'Launch Dashboard →' : 'Continue →'}
          </button>
        </div>

        {isLast && !saving && (
          <button
            type="button"
            className="ob-skip"
            onClick={finish}
            style={{
              background: 'none', border: 'none', width: '100%', marginTop: 12,
              fontSize: 10, color: '#1e1e1e', cursor: 'pointer', padding: '4px 0',
              fontFamily: monoFont, letterSpacing: '.07em', transition: 'color 0.2s',
            }}
          >
            SKIP THIS QUESTION →
          </button>
        )}
      </div>
    </div>
  );
}
