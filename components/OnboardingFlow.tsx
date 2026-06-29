'use client';
import { useState } from 'react';
import { useOnboarding } from './OnboardingProvider';
import { useAuth } from './AuthProvider';
import { useSettings } from '@/lib/settings';
import { getSupabase } from '@/lib/supabase';
import { T } from '@/lib/tables';

interface Props { onStartTour: () => void; }

type Exp       = 'lt6m' | '6to12m' | '1to3y' | '3plus';
type Style     = 'scalp' | 'swing' | 'both' | 'learning';
type Acct      = '1k5k' | '5k25k' | '25k100k' | '100kplus';
type Challenge = 'read_signals' | 'entry_exit' | 'risk_management' | 'discipline';
type Heard     = 'social' | 'youtube' | 'tiktok' | 'search' | 'word' | 'other';

const STEPS = ['Profile', 'Experience', 'Style', 'Goals', 'Source'] as const;

const COUNTRIES = [
  'Argentina', 'Australia', 'Bangladesh', 'Brazil', 'Canada', 'China',
  'Ethiopia', 'France', 'Germany', 'Ghana', 'India', 'Indonesia', 'Japan',
  'Kenya', 'Malaysia', 'Mexico', 'Nigeria', 'Pakistan', 'Philippines',
  'Russia', 'Singapore', 'South Africa', 'South Korea', 'Thailand', 'Turkey',
  'UAE', 'Ukraine', 'United Kingdom', 'United States', 'Vietnam', 'Other',
];

/* ── Single-select option card ── */
function Option<T extends string>({
  value, selected, label, sub, onClick,
}: {
  value: T; selected: T | null; label: string; sub?: string; onClick: (v: T) => void;
}) {
  const active = selected === value;
  return (
    <button
      onClick={() => onClick(value)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 18px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
        background: active ? 'rgba(167,139,250,0.1)' : 'rgba(255,255,255,0.03)',
        border: active ? '1px solid rgba(167,139,250,0.5)' : '0.5px solid rgba(255,255,255,0.08)',
        transition: 'all 0.15s',
      }}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: active ? '#c4b5fd' : 'var(--txt)', lineHeight: 1.3 }}>
          {label}
        </div>
        {sub && <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{
        width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginLeft: 12,
        background: active ? '#a78bfa' : 'transparent',
        border: active ? '2px solid #a78bfa' : '1.5px solid rgba(255,255,255,0.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {active && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </div>
    </button>
  );
}

/* ── Account size in 2×2 grid ── */
function AcctGrid({ acct, setAcct }: { acct: Acct | null; setAcct: (v: Acct) => void }) {
  const opts: { value: Acct; label: string }[] = [
    { value: '1k5k',    label: '$1k - $5k'    },
    { value: '5k25k',   label: '$5k - $25k'   },
    { value: '25k100k', label: '$25k - $100k'  },
    { value: '100kplus', label: '$100k+'        },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {opts.map(o => {
        const active = acct === o.value;
        return (
          <button
            key={o.value}
            onClick={() => setAcct(o.value)}
            style={{
              padding: '12px 10px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
              background: active ? 'rgba(167,139,250,0.1)' : 'rgba(255,255,255,0.03)',
              border: active ? '1px solid rgba(167,139,250,0.5)' : '0.5px solid rgba(255,255,255,0.08)',
              color: active ? '#c4b5fd' : 'var(--txt)',
              fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Source chips ── */
function SourceChip({ value, selected, label, onClick }: {
  value: Heard; selected: Heard | null; label: string; onClick: (v: Heard) => void;
}) {
  const active = selected === value;
  return (
    <button
      onClick={() => onClick(value)}
      style={{
        padding: '10px 16px', borderRadius: 20, cursor: 'pointer', fontSize: 12, fontWeight: 600,
        background: active ? 'rgba(167,139,250,0.15)' : 'rgba(255,255,255,0.04)',
        border: active ? '1px solid rgba(167,139,250,0.5)' : '0.5px solid rgba(255,255,255,0.1)',
        color: active ? '#c4b5fd' : 'var(--txt2)',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  );
}

export default function OnboardingFlow({ onStartTour }: Props) {
  const { user }              = useAuth();
  const { state, loaded, markDone } = useOnboarding();
  const { update }            = useSettings();

  const [step,        setStep]        = useState(0);
  const [saving,      setSaving]      = useState(false);
  // Profile
  const [displayName, setDisplayName] = useState('');
  const [country,     setCountry]     = useState('');
  const [acct,        setAcct]        = useState<Acct | null>(null);
  // Experience
  const [exp,         setExp]         = useState<Exp | null>(null);
  // Style
  const [style,       setStyle]       = useState<Style | null>(null);
  // Goals
  const [challenge,   setChallenge]   = useState<Challenge | null>(null);
  // Source
  const [heard,       setHeard]       = useState<Heard | null>(null);

  if (!user || !loaded || state.profileComplete) return null;

  const isBeginnerExp   = exp === 'lt6m' || exp === '6to12m';
  const isBeginnerStyle = style === 'learning';

  function canNext() {
    if (step === 0) return country !== '' && acct !== null;
    if (step === 1) return exp !== null;
    if (step === 2) return style !== null;
    if (step === 3) return challenge !== null;
    return true; // Source is optional
  }

  async function finish() {
    if (saving) return;
    setSaving(true);

    const beginner = isBeginnerExp || isBeginnerStyle;
    const tfMap: Record<Style, '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d'> = {
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
      trading_style:      style       ?? null,
      trading_challenge:  challenge   ?? null,
      how_heard:          heard       ?? null,
      ...(acct  ? { account_size: acctMap[acct]   } : {}),
      ...(style ? { default_tf:   tfMap[style]    } : {}),
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

  function next() {
    if (step < STEPS.length - 1) { setStep(s => s + 1); return; }
    finish();
  }

  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.92)',
        zIndex: 10000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
        overflowY: 'auto',
      }}
    >
      <div style={{
        background: 'var(--bg1)',
        border: '0.5px solid var(--bdr)',
        borderRadius: 16,
        padding: '32px 28px',
        maxWidth: 480,
        width: '100%',
        margin: 'auto',
      }}>

        {/* Progress bar */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            {STEPS.map((label, i) => (
              <span key={label} style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
                color: i <= step ? '#a78bfa' : 'var(--txt3)',
              }}>
                {label}
              </span>
            ))}
          </div>
          <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
            <div style={{
              height: '100%', borderRadius: 2,
              width: `${progress}%`,
              background: 'linear-gradient(90deg, #7c3aed, #a78bfa)',
              transition: 'width 0.3s ease',
            }} />
          </div>
        </div>

        {/* ── Step 0: Profile ── */}
        {step === 0 && (
          <>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt)', marginBottom: 4 }}>
              Set up your profile
            </div>
            <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 20 }}>
              Helps us personalize your experience. Takes 30 seconds.
            </div>

            {/* Display name */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--txt3)', marginBottom: 6, letterSpacing: '.04em', textTransform: 'uppercase' }}>
                Display name <span style={{ color: 'var(--txt3)', fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="e.g. trader_dom"
                maxLength={32}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '12px 14px', borderRadius: 10,
                  background: 'rgba(255,255,255,0.04)',
                  border: '0.5px solid rgba(255,255,255,0.12)',
                  color: 'var(--txt)', fontSize: 13, outline: 'none',
                }}
              />
            </div>

            {/* Country */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--txt3)', marginBottom: 6, letterSpacing: '.04em', textTransform: 'uppercase' }}>
                Country
              </label>
              <select
                value={country}
                onChange={e => setCountry(e.target.value)}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '12px 14px', borderRadius: 10,
                  background: 'rgba(255,255,255,0.04)',
                  border: country ? '0.5px solid rgba(167,139,250,0.5)' : '0.5px solid rgba(255,255,255,0.12)',
                  color: country ? 'var(--txt)' : 'var(--txt3)',
                  fontSize: 13, outline: 'none', cursor: 'pointer',
                }}
              >
                <option value="" disabled>Select your country…</option>
                {COUNTRIES.map(c => (
                  <option key={c} value={c} style={{ background: '#1a1a1a', color: '#fff' }}>{c}</option>
                ))}
              </select>
            </div>

            {/* Account size */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--txt3)', marginBottom: 8, letterSpacing: '.04em', textTransform: 'uppercase' }}>
                What range fits your trading account?
              </label>
              <AcctGrid acct={acct} setAcct={setAcct} />
            </div>
          </>
        )}

        {/* ── Step 1: Experience ── */}
        {step === 1 && (
          <>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt)', marginBottom: 4 }}>
              How long have you been trading crypto?
            </div>
            <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 20 }}>
              No judgment - this sets Beginner Mode on or off for you.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Option<Exp> value="lt6m"   selected={exp} label="Less than 6 months" sub="Just getting started"   onClick={setExp} />
              <Option<Exp> value="6to12m" selected={exp} label="6-12 months"        sub="Finding my footing"     onClick={setExp} />
              <Option<Exp> value="1to3y"  selected={exp} label="1-3 years"          sub="Getting comfortable"    onClick={setExp} />
              <Option<Exp> value="3plus"  selected={exp} label="3+ years"           sub="I know what I am doing" onClick={setExp} />
            </div>
          </>
        )}

        {/* ── Step 2: Style ── */}
        {step === 2 && (
          <>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt)', marginBottom: 4 }}>
              How do you mainly trade?
            </div>
            <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 20 }}>
              Sets your default chart timeframe in Arena.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Option<Style> value="scalp"    selected={style} label="Scalp"          sub="Minutes to hours - 5m chart" onClick={setStyle} />
              <Option<Style> value="swing"    selected={style} label="Swing trade"    sub="Days to weeks - 4h chart"    onClick={setStyle} />
              <Option<Style> value="both"     selected={style} label="Both"           sub="Depends on the setup"        onClick={setStyle} />
              <Option<Style> value="learning" selected={style} label="Still learning" sub="Not sure yet"                onClick={setStyle} />
            </div>
          </>
        )}

        {/* ── Step 3: Goals ── */}
        {step === 3 && (
          <>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt)', marginBottom: 4 }}>
              What is your biggest trading challenge?
            </div>
            <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 20 }}>
              Helps us surface the most relevant signals and tips for you.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Option<Challenge> value="read_signals"    selected={challenge} label="Reading the signals correctly"       sub="Not sure what the data means"        onClick={setChallenge} />
              <Option<Challenge> value="entry_exit"      selected={challenge} label="Knowing when to enter and exit"      sub="Always entering too early or too late" onClick={setChallenge} />
              <Option<Challenge> value="risk_management" selected={challenge} label="Managing risk and not overtrading"   sub="Position sizing, stop losses"         onClick={setChallenge} />
              <Option<Challenge> value="discipline"      selected={challenge} label="Staying disciplined and patient"     sub="Chasing trades, revenge trading"       onClick={setChallenge} />
            </div>
          </>
        )}

        {/* ── Step 4: Source ── */}
        {step === 4 && (
          <>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt)', marginBottom: 4 }}>
              Where did you hear about LiquidityHQ?
            </div>
            <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 20 }}>
              Optional - helps us know where to focus.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <SourceChip value="social"  selected={heard} label="Facebook / Instagram" onClick={setHeard} />
              <SourceChip value="youtube" selected={heard} label="YouTube"             onClick={setHeard} />
              <SourceChip value="tiktok"  selected={heard} label="TikTok"             onClick={setHeard} />
              <SourceChip value="search"  selected={heard} label="Search"             onClick={setHeard} />
              <SourceChip value="word"    selected={heard} label="Word of mouth"      onClick={setHeard} />
              <SourceChip value="other"   selected={heard} label="Other"              onClick={setHeard} />
            </div>
          </>
        )}

        {/* Next / Finish */}
        <button
          onClick={next}
          disabled={!canNext() || saving}
          style={{
            width: '100%', marginTop: 24,
            padding: '14px 0', borderRadius: 10, border: 'none',
            background: canNext() && !saving
              ? 'linear-gradient(135deg, #7c3aed, #a78bfa)'
              : 'rgba(255,255,255,0.06)',
            color: canNext() && !saving ? '#fff' : 'var(--txt3)',
            fontSize: 14, fontWeight: 700,
            cursor: canNext() && !saving ? 'pointer' : 'not-allowed',
            transition: 'all 0.15s',
          }}
        >
          {saving ? 'Setting up...' : step === STEPS.length - 1 ? 'Go to Dashboard' : 'Next'}
        </button>

        {/* Skip on last step only */}
        {step === STEPS.length - 1 && (
          <button
            onClick={finish}
            disabled={saving}
            style={{
              background: 'none', border: 'none', width: '100%', marginTop: 10,
              fontSize: 11, color: 'var(--txt3)', cursor: 'pointer', padding: '4px 0',
              textDecoration: 'underline', textUnderlineOffset: 3,
            }}
          >
            Skip this question
          </button>
        )}

        {/* Back button (except first step) */}
        {step > 0 && !saving && (
          <button
            onClick={() => setStep(s => s - 1)}
            style={{
              background: 'none', border: 'none', width: '100%', marginTop: 8,
              fontSize: 11, color: 'var(--txt3)', cursor: 'pointer', padding: '4px 0',
            }}
          >
            ← Back
          </button>
        )}

      </div>
    </div>
  );
}
