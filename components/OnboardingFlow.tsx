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
  { key: 'Profile',    label: 'Profile'    },
  { key: 'Experience', label: 'Experience' },
  { key: 'Style',      label: 'Style'      },
  { key: 'Goals',      label: 'Goals'      },
  { key: 'Source',     label: 'Source'     },
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
  { headline: ['Set up your', 'profile.'],                    desc: 'Personalizes your signals, alerts, and position sizing.' },
  { headline: ['How long have you been', 'trading crypto?'],  desc: 'Sets Beginner Mode on or off for your dashboard.' },
  { headline: ['How do you', 'mainly trade?'],                desc: 'Pre-selects your default chart timeframe in Arena.' },
  { headline: ['What is your biggest', 'challenge?'],         desc: 'Surfaces the most relevant signals and education for you.' },
  { headline: ['Where did you find', 'LiquidityHQ?'],         desc: 'Optional - helps us know where to invest our energy.' },
];

/* ── Reusable check glyph for selection indicators ── */
function CheckGlyph() {
  return (
    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
      <path d="M1 4L3.5 6.5L9 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Custom country dropdown with emoji flags ── */
function CountrySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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
        className={`obw-select ${value ? 'is-selected' : 'is-empty'}`}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {selected ? (
            <>
              <span style={{ fontSize: '1.25rem', flexShrink: 0, lineHeight: 1 }}>{selected.flag}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.name}</span>
            </>
          ) : (
            <span>Select your country…</span>
          )}
        </span>
        <svg
          width="12" height="12" viewBox="0 0 12 12" fill="none"
          style={{ flexShrink: 0, opacity: 0.5, transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none' }}
        >
          <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="obw-menu">
          <div className="obw-menu-search">
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search country…"
              className="obw-input"
              style={{ padding: '8px 12px', fontSize: 'var(--fs-label)' }}
            />
          </div>
          <div className="obw-menu-list">
            {filtered.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center', fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>No match</div>
            ) : filtered.map(c => {
              const isActive = value === c.name;
              return (
                <button
                  key={c.name}
                  type="button"
                  className={`obw-menu-opt ${isActive ? 'is-selected' : ''}`}
                  onClick={() => { onChange(c.name); setOpen(false); }}
                >
                  <span style={{ fontSize: '1.125rem', lineHeight: 1, flexShrink: 0 }}>{c.flag}</span>
                  <span style={{ flex: 1 }}>{c.name}</span>
                  {isActive && (
                    <svg width="12" height="10" viewBox="0 0 12 10" fill="none" style={{ flexShrink: 0 }}>
                      <path d="M1 5L4.5 8.5L11 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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

/* ── Selection row (radio-style) ── */
function OptionRow<T extends string>({ value, selected, label, sub, onClick }: {
  value: T; selected: T | null; label: string; sub?: string; onClick: (v: T) => void;
}) {
  const active = selected === value;
  return (
    <button type="button" className={`obw-row ${active ? 'is-selected' : ''}`} onClick={() => onClick(value)}>
      <div className="obw-row-main">
        <div className="obw-row-label">{label}</div>
        {sub && <div className="obw-row-sub">{sub}</div>}
      </div>
      <span className="obw-ind">{active && <CheckGlyph />}</span>
    </button>
  );
}

/* ── Account size 2x2 grid ── */
function AcctGrid({ acct, setAcct }: { acct: Acct | null; setAcct: (v: Acct) => void }) {
  const opts: { value: Acct; label: string }[] = [
    { value: '1k5k',     label: '$1k - $5k'    },
    { value: '5k25k',    label: '$5k - $25k'   },
    { value: '25k100k',  label: '$25k - $100k' },
    { value: '100kplus', label: '$100k+'       },
  ];
  return (
    <div className="obw-grid">
      {opts.map(o => (
        <button
          key={o.value}
          type="button"
          className={`obw-tile ${acct === o.value ? 'is-selected' : ''}`}
          onClick={() => setAcct(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── Main onboarding component ── */
export default function OnboardingFlow({ onStartTour }: Props) {
  const { user }                    = useAuth();
  const { state, loaded, markDone } = useOnboarding();
  const { update }                  = useSettings();

  const [step,        setStep]       = useState(0);
  const [saving,      setSaving]     = useState(false);
  const [displayName, setDisplayName]= useState('');
  const [country,     setCountry]    = useState('');
  const [acct,        setAcct]       = useState<Acct | null>(null);
  const [exp,         setExp]        = useState<Exp | null>(null);
  const [tradeStyle,  setTradeStyle] = useState<TradeStyle | null>(null);
  const [challenge,   setChallenge]  = useState<Challenge | null>(null);
  const [heard,       setHeard]      = useState<Heard | null>(null);

  if (!user || state.profileComplete) return null;

  // `loaded` is a separate, async-resolved state (Supabase fetch to
  // user_onboarding) from `user` itself - while it's still resolving we don't
  // yet know whether to show the wizard. Returning null here let the
  // dashboard render fully underneath for that window, then this overlay
  // would snap in once the fetch finished, producing a visible flash for
  // brand-new signups. Block with the same full-screen backdrop instead so
  // nothing shows through.
  if (!loaded) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg)',
      }}>
        <div className="login-spinner-lg" />
      </div>
    );
  }

  const meta   = STEP_META[step];
  const isLast = step === STEP_META.length - 1;
  const copy   = STEP_COPY[step];

  function canNext() {
    if (step === 0) return country !== '' && acct !== null;
    if (step === 1) return exp !== null;
    if (step === 2) return tradeStyle !== null;
    if (step === 3) return challenge !== null;
    return true; // step 4 (source) is always optional
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
    if (step < STEP_META.length - 1) setStep(s => s + 1);
    else finish();
  }

  function goBack() {
    setStep(s => s - 1);
  }

  return (
    <div role="dialog" aria-modal="true" className="obw-root">

      {/* ── Segmented progress bar ── */}
      <div className="obw-progress">
        {STEP_META.map((s, i) => (
          <div key={s.key} className={`obw-seg ${i < step ? 'is-done' : ''} ${i === step ? 'is-active' : ''}`}>
            <div className="obw-seg-track"><span className="obw-seg-fill" /></div>
            <div className="obw-seg-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Centered content ── */}
      <div className="obw-main">
        <div className="obw-panel">
          <div key={step} className="obw-step">
            {/* Step meta */}
            <div className="obw-eyebrow">
              <span className="k">{`STEP ${String(step + 1).padStart(2, '0')}`}</span>
              <span className="d">/ {String(STEP_META.length).padStart(2, '0')}</span>
              <span className="d">&mdash; {meta.label.toUpperCase()}</span>
            </div>

            {/* Headline */}
            <h1 className="obw-headline">
              {copy.headline.map((line, i) => (
                <span key={i} style={{ display: 'block' }} className={i === copy.headline.length - 1 ? 'accent' : undefined}>
                  {line}
                </span>
              ))}
            </h1>
            <div className="obw-desc">{copy.desc}</div>

            {/* ── Step 0: Profile ── */}
            {step === 0 && (
              <>
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <label className="obw-label">
                    Display name <span className="opt">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    placeholder="e.g. trader_dom"
                    maxLength={32}
                    className="obw-input"
                  />
                  <div style={{
                    marginTop: 6, textAlign: 'right', fontFamily: 'var(--font-mono), monospace',
                    fontSize: 'var(--fs-caption)', letterSpacing: '0.06em', color: 'var(--txt3)',
                  }}>
                    {displayName.length}/32
                  </div>
                </div>

                <div style={{ marginBottom: 'var(--space-5)' }}>
                  <label className="obw-label">Country</label>
                  <CountrySelect value={country} onChange={setCountry} />
                </div>

                <div>
                  <label className="obw-label">Trading account range</label>
                  <AcctGrid acct={acct} setAcct={setAcct} />
                </div>
              </>
            )}

            {/* ── Step 1: Experience ── */}
            {step === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <OptionRow<Exp> value="lt6m"   selected={exp} label="Less than 6 months" sub="Just getting started - Beginner Mode enabled" onClick={setExp} />
                <OptionRow<Exp> value="6to12m" selected={exp} label="6-12 months"        sub="Finding my footing - Beginner Mode enabled"  onClick={setExp} />
                <OptionRow<Exp> value="1to3y"  selected={exp} label="1-3 years"          sub="Getting comfortable - full tools unlocked"   onClick={setExp} />
                <OptionRow<Exp> value="3plus"  selected={exp} label="3+ years"           sub="I know what I am doing - full access"        onClick={setExp} />
              </div>
            )}

            {/* ── Step 2: Style ── */}
            {step === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <OptionRow<TradeStyle> value="scalp"    selected={tradeStyle} label="Scalp"          sub="Minutes to hours - defaults to 5m chart"      onClick={setTradeStyle} />
                <OptionRow<TradeStyle> value="swing"    selected={tradeStyle} label="Swing trade"    sub="Days to weeks - defaults to 4h chart"         onClick={setTradeStyle} />
                <OptionRow<TradeStyle> value="both"     selected={tradeStyle} label="Both"           sub="Depends on the setup - defaults to 15m chart" onClick={setTradeStyle} />
                <OptionRow<TradeStyle> value="learning" selected={tradeStyle} label="Still learning" sub="Not sure yet - Beginner Mode on"              onClick={setTradeStyle} />
              </div>
            )}

            {/* ── Step 3: Goals ── */}
            {step === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <OptionRow<Challenge> value="read_signals"    selected={challenge} label="Reading the signals correctly"     sub="Not sure what the data is telling me"       onClick={setChallenge} />
                <OptionRow<Challenge> value="entry_exit"      selected={challenge} label="Knowing when to enter and exit"    sub="Always too early, too late, or too scared"  onClick={setChallenge} />
                <OptionRow<Challenge> value="risk_management" selected={challenge} label="Managing risk and not overtrading" sub="Position sizing, stop losses, overexposure" onClick={setChallenge} />
                <OptionRow<Challenge> value="discipline"      selected={challenge} label="Staying disciplined and patient"   sub="Chasing trades, revenge trading, FOMO"      onClick={setChallenge} />
              </div>
            )}

            {/* ── Step 4: Source ── */}
            {step === 4 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                {([
                  ['social',  'Facebook / Instagram'],
                  ['youtube', 'YouTube'],
                  ['tiktok',  'TikTok'],
                  ['search',  'Search'],
                  ['word',    'Word of mouth'],
                  ['other',   'Other'],
                ] as [Heard, string][]).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    className={`obw-chip ${heard === val ? 'is-selected' : ''}`}
                    onClick={() => setHeard(val)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Navigation ── */}
          <div className="obw-nav">
            {step > 0 && !saving && (
              <button type="button" className="obw-btn obw-btn-back" onClick={goBack}>
                ← Back
              </button>
            )}
            <button
              type="button"
              className="obw-btn obw-btn-next"
              onClick={goNext}
              disabled={!canNext() || saving}
            >
              {saving ? 'Setting up…' : isLast ? 'Launch Dashboard →' : 'Continue →'}
            </button>
          </div>

          {isLast && !saving && (
            <button type="button" className="obw-skip" onClick={finish}>
              Skip this question →
            </button>
          )}
        </div>
      </div>

      {/* ── Footer: disclaimer + legal links ── */}
      <footer className="obw-footer">
        <p className="obw-footer-disc">
          LiquidityHQ provides data analytics and software tools for informational purposes only.
          This is not financial, investment, or trading advice. Trade at your own risk.
        </p>
        <div className="obw-footer-links">
          <a href="/terms" target="_blank" rel="noopener noreferrer" className="obw-footer-link">Terms of Use</a>
          <a href="/privacy" target="_blank" rel="noopener noreferrer" className="obw-footer-link">Privacy Policy</a>
          <a href="/disclaimer" target="_blank" rel="noopener noreferrer" className="obw-footer-link">Full Disclaimer</a>
        </div>
        <div className="obw-footer-copy">© {new Date().getFullYear()} LIQUIDITYHQ</div>
      </footer>
    </div>
  );
}
