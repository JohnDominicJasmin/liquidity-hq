'use client';
import { useState, useEffect, useLayoutEffect, useRef } from 'react';
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

const ACCENT   = '#1a7aff';
const DONE_CLR = '#4ade80';

const STEP_META = [
  { key: 'Profile',    label: 'Profile',    accent: ACCENT },
  { key: 'Experience', label: 'Experience', accent: ACCENT },
  { key: 'Style',      label: 'Style',      accent: ACCENT },
  { key: 'Goals',      label: 'Goals',      accent: ACCENT },
  { key: 'Source',     label: 'Source',     accent: ACCENT },
  { key: 'Alerts',     label: 'Alerts',     accent: ACCENT },
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
  { headline: ['Get alerts on', 'Telegram.'],             desc: 'Connect once and get live price alerts, funding extremes, and your morning briefing directly in Telegram.' },
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
          background: value ? `${accent}0c` : 'rgba(140,150,255,0.04)',
          border: `1px solid ${value ? accent + '40' : 'rgba(140,150,255,0.12)'}`,
          color: value ? '#eef0fa' : '#4e5374', fontSize: 14,
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
            background: '#0c0f1c', border: '1px solid rgba(140,150,255,0.12)', borderRadius: 12,
            boxShadow: '0 24px 72px rgba(0,0,0,0.85), 0 4px 16px rgba(0,0,0,0.5)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(140,150,255,0.08)' }}>
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search country…"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'rgba(140,150,255,0.06)', border: '1px solid rgba(140,150,255,0.12)',
                borderRadius: 7, padding: '8px 12px', fontSize: 13, color: '#eef0fa', outline: 'none',
              }}
            />
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: '#4e5374' }}>No match</div>
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
                    color: isActive ? accent : '#9296b5',
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
          ? `linear-gradient(135deg, ${accent}12 0%, ${accent}06 100%)`
          : 'rgba(140,150,255,0.03)',
        border: `1px solid ${active ? accent + '45' : 'rgba(140,150,255,0.1)'}`,
        borderLeft: `3px solid ${active ? accent : 'transparent'}`,
        boxShadow: active ? `0 0 28px ${accent}1a, inset 0 1px 0 ${accent}10` : 'none',
        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        animationDelay: `${delay}ms`,
      }}
    >
      <div style={{
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
        border: `2px solid ${active ? accent : 'rgba(140,150,255,0.2)'}`,
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
          color: active ? accent : '#eef0fa',
          transition: 'color 0.2s',
        }}>
          {label}
        </div>
        {sub && (
          <div style={{
            fontSize: 11, marginTop: 3, lineHeight: 1.4,
            color: active ? `${accent}90` : '#4e5374',
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
                : 'rgba(140,150,255,0.03)',
              border: `1px solid ${active ? accent + '45' : 'rgba(140,150,255,0.1)'}`,
              borderTop: `2px solid ${active ? accent : 'transparent'}`,
              color: active ? accent : '#9296b5',
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
        background: active ? `${accent}18` : 'rgba(140,150,255,0.05)',
        border: `1px solid ${active ? accent + '55' : 'rgba(140,150,255,0.12)'}`,
        color: active ? accent : '#9296b5',
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
                background: active ? ACCENT : done ? 'rgba(74,222,128,0.08)' : 'rgba(140,150,255,0.04)',
                border: `1.5px solid ${active ? ACCENT : done ? DONE_CLR + '40' : 'rgba(140,150,255,0.1)'}`,
                boxShadow: active ? `0 0 20px ${ACCENT}55` : 'none',
                transition: 'all 0.3s',
                fontSize: 10, fontWeight: 700,
                fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
                color: active ? '#fff' : done ? DONE_CLR : '#4e5374',
              }}>
                {done ? (
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4L3.5 6.5L9 1" stroke={DONE_CLR} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : String(i + 1).padStart(2, '0')}
              </div>
              {i < STEP_META.length - 1 && (
                <div style={{
                  width: 1.5, height: 32, marginTop: 4,
                  background: done
                    ? `linear-gradient(180deg, ${DONE_CLR}30, rgba(140,150,255,0.03))`
                    : 'rgba(140,150,255,0.08)',
                  transition: 'background 0.4s',
                }} />
              )}
            </div>
            <div style={{ paddingTop: 6, paddingBottom: i < STEP_META.length - 1 ? 32 : 0 }}>
              <div style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
                fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
                color: active ? ACCENT : done ? DONE_CLR : '#4e5374',
                transition: 'color 0.3s',
              }}>
                {s.label}
              </div>
              {active && (
                <div style={{
                  fontSize: 9, color: '#555', marginTop: 2,
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

  const stepRef = useRef<HTMLDivElement>(null);

  // Before paint: set initial hidden state so first frame starts invisible
  useLayoutEffect(() => {
    const el = stepRef.current;
    if (!el) return;
    el.style.transition = 'none';
    el.style.opacity = '0';
    el.style.transform = 'translateY(14px)';
  }, [animKey]);

  // After paint: trigger the reveal transition (setTimeout fires even when rAF doesn't)
  useEffect(() => {
    const el = stepRef.current;
    if (!el) return;
    const id = setTimeout(() => {
      el.style.transition = 'opacity 0.38s cubic-bezier(0.16,1,0.3,1), transform 0.38s cubic-bezier(0.16,1,0.3,1)';
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    }, 16);
    return () => clearTimeout(id);
  }, [animKey]);

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
    return true; // step 4 (source) and step 5 (alerts) are always optional
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
        { user_id: user.id, profile_complete: true, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
    }
    markDone('profileComplete');
    onStartTour();
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

  const monoFont  = "var(--font-mono, 'IBM Plex Mono', monospace)";
  const serifFont = "var(--font-sans, 'Figtree', system-ui, sans-serif)";

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        display: 'flex', background: '#07090f',
        fontFamily: serifFont,
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
          background: `radial-gradient(circle, ${accent}22 0%, transparent 65%)`,
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
          borderRight: '1px solid rgba(140,150,255,0.1)',
          position: 'relative', overflow: 'hidden',
          backgroundImage: 'radial-gradient(rgba(90,106,255,0.09) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
        }}>
          {/* Fade grid out at top and bottom */}
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'linear-gradient(180deg, #07090f 0%, transparent 14%, transparent 82%, #07090f 100%)',
          }} />
          <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Logo */}
            <div style={{ marginBottom: 52 }}>
              <img
                src="/icons/icon-192.png"
                alt="LiquidityHQ"
                style={{ width: 80, height: 80, borderRadius: 18, display: 'block' }}
              />
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
                  fontSize: 11.5, lineHeight: 1.75, color: '#4e5374',
                  fontFamily: serifFont,
                }}>
                  &ldquo;The edge goes to those who read the market, not the crowd.&rdquo;
                </div>
                <div style={{
                  fontSize: 9, color: '#2e3150', marginTop: 8,
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
            <div style={{ marginBottom: 20 }}>
              <img
                src="/icons/icon-192.png"
                alt="LiquidityHQ"
                style={{ width: 52, height: 52, borderRadius: 12, display: 'block' }}
              />
            </div>
            {/* Pill dots */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              {STEP_META.map((s, i) => (
                <div key={s.key} style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{
                    height: 6, width: i === step ? 20 : 6, borderRadius: 100,
                    background: i < step ? DONE_CLR : i === step ? ACCENT : 'rgba(140,150,255,0.1)',
                    transition: 'all 0.35s cubic-bezier(0.16,1,0.3,1)',
                  }} />
                  {i < STEP_META.length - 1 && (
                    <div style={{
                      width: 12, height: 1.5,
                      background: i < step ? DONE_CLR + '30' : 'rgba(140,150,255,0.06)',
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
          <span style={{ color: '#4e5374' }}>/</span>
          <span style={{ color: '#4e5374' }}>{String(STEP_META.length).padStart(2, '0')}</span>
          <span style={{ color: '#4e5374' }}>&nbsp;&mdash;&nbsp;{meta.label.toUpperCase()}</span>
        </div>

        {/* Animated step content */}
        <div key={animKey} ref={stepRef}>
          {/* Headline */}
          <div style={{ marginBottom: 10 }}>
            {copy.headline.map((line, i) => (
              <div
                key={i}
                style={{
                  fontFamily: serifFont,
                  fontSize: isMobile ? 28 : 38,
                  lineHeight: 1.1, fontWeight: 800,
                  color: i === copy.headline.length - 1 ? ACCENT : '#eef0fa',
                  transition: 'color 0.45s',
                }}
              >
                {line}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: '#9296b5', marginBottom: 28, lineHeight: 1.65 }}>
            {copy.desc}
          </div>

          {/* ── Step 0: Profile ── */}
          {step === 0 && (
            <>
              <div style={{ marginBottom: 16 }}>
                <label style={{
                  display: 'block', fontSize: 9, fontWeight: 700, letterSpacing: '.12em',
                  textTransform: 'uppercase', color: '#9296b5', marginBottom: 8, fontFamily: monoFont,
                }}>
                  Display name <span style={{ color: '#4e5374', fontWeight: 400 }}>(optional)</span>
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
                    background: 'rgba(140,150,255,0.04)',
                    border: '1px solid rgba(140,150,255,0.12)',
                    color: '#eef0fa', fontSize: 14,
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
                  textTransform: 'uppercase', color: '#9296b5', marginBottom: 8, fontFamily: monoFont,
                }}>
                  Country
                </label>
                <CountrySelect value={country} onChange={setCountry} accent={accent} />
              </div>

              <div>
                <label style={{
                  display: 'block', fontSize: 9, fontWeight: 700, letterSpacing: '.12em',
                  textTransform: 'uppercase', color: '#6b7280', marginBottom: 10, fontFamily: monoFont,
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

          {/* ── Step 5: Telegram alerts ── */}
          {step === 5 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{
                background: 'rgba(251,191,36,0.06)',
                border: '1px solid rgba(251,191,36,0.18)',
                borderRadius: 12, padding: '16px 18px',
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24', marginBottom: 12, letterSpacing: '.03em' }}>
                  What you get with Telegram alerts
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    'Live price alerts when your targets or stops are hit',
                    'Funding rate extremes that signal squeeze setups',
                    'Morning briefing delivered to Telegram every day',
                    'Works while the app is closed or your screen is off',
                  ].map(item => (
                    <div key={item} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <span style={{ color: '#fbbf24', fontSize: 11, marginTop: 1, flexShrink: 0 }}>▸</span>
                      <span style={{ fontSize: 13, color: '#9296b5', lineHeight: 1.45 }}>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
              <a
                href="/alerts"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'block', textAlign: 'center',
                  padding: '14px', borderRadius: 10,
                  background: 'rgba(251,191,36,0.1)',
                  border: '1px solid rgba(251,191,36,0.32)',
                  color: '#fbbf24', fontSize: 13, fontWeight: 700,
                  textDecoration: 'none', letterSpacing: '.02em',
                  transition: 'filter 0.15s',
                }}
              >
                Open Alerts Setup →
              </a>
              <div style={{ fontSize: 11, color: '#4e5374', textAlign: 'center', lineHeight: 1.6 }}>
                Opens in a new tab. Takes about 60 seconds to connect.<br />
                You can also do this later from Alerts in the navigation.
              </div>
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
                border: '1px solid rgba(140,150,255,0.1)',
                background: 'transparent', color: '#4e5374',
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
              background: canNext() && !saving ? accent : 'rgba(140,150,255,0.06)',
              color: canNext() && !saving ? '#fff' : '#4e5374',
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
              fontSize: 10, color: '#4e5374', cursor: 'pointer', padding: '4px 0',
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
