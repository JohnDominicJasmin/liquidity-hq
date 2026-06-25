'use client';
import { useState } from 'react';
import { useOnboarding } from './OnboardingProvider';
import { useAuth } from './AuthProvider';
import { useSettings } from '@/lib/settings';
import { getSupabase } from '@/lib/supabase';
import { T } from '@/lib/tables';

interface Props {
  onStartTour: () => void;
}

type Exp   = 'lt6m' | '6to12m' | '1to3y' | '3plus';
type Style = 'scalp' | 'swing' | 'both' | 'learning';
type Acct  = '1k5k' | '5k25k' | '25k100k' | '100kplus';
type Heard = 'social' | 'youtube' | 'tiktok' | 'search' | 'word' | 'other';

const STEPS = ['Experience', 'Style', 'Account', 'Source'] as const;

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
        {sub && (
          <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>{sub}</div>
        )}
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

/* ── Source chips (multi-look but single-select) ── */
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
  const { user } = useAuth();
  const { state, loaded, markDone } = useOnboarding();
  const { update } = useSettings();

  const [step, setStep]       = useState(0);
  const [saving, setSaving]   = useState(false);
  const [exp,   setExp]       = useState<Exp | null>(null);
  const [style, setStyle]     = useState<Style | null>(null);
  const [acct,  setAcct]      = useState<Acct | null>(null);
  const [heard, setHeard]     = useState<Heard | null>(null);

  // Don't show if: not logged in, not loaded, or already completed profile
  if (!user || !loaded || state.profileComplete) return null;

  const isBeginnerExp = exp === 'lt6m' || exp === '6to12m';
  const isBeginnerStyle = style === 'learning';

  function canNext() {
    if (step === 0) return exp !== null;
    if (step === 1) return style !== null;
    if (step === 2) return acct !== null;
    return true; // step 3 (source) is optional
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

    // Save to settings (local + DB via useSettings)
    update({
      beginner_mode:      beginner,
      trading_experience: exp ?? undefined,
      trading_style:      style ?? undefined,
      how_heard:          heard ?? undefined,
      ...(acct ? { account_size: acctMap[acct] } : {}),
      ...(style ? { default_tf: tfMap[style] } : {}),
    });

    // Mark profile_complete + tourSeen in user_onboarding
    const sb = getSupabase();
    if (sb) {
      await sb.from(T.user_onboarding).upsert(
        { user_id: user.id, profile_complete: true, tour_seen: true, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
    }
    markDone('profileComplete');
    markDone('tourSeen');

    // Launch tour for beginners
    if (beginner) onStartTour();
  }

  function next() {
    if (step < 3) { setStep(s => s + 1); return; }
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
      }}
    >
      <div style={{
        background: 'var(--bg1)',
        border: '0.5px solid var(--bdr)',
        borderRadius: 16,
        padding: '32px 28px',
        maxWidth: 460,
        width: '100%',
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

        {/* Step 0 — Experience */}
        {step === 0 && (
          <>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt)', marginBottom: 6 }}>
              How long have you been trading crypto?
            </div>
            <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 20 }}>
              No judgment — this helps us set up the right view for you.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Option<Exp> value="lt6m"   selected={exp} label="Less than 6 months" sub="Just getting started"       onClick={setExp} />
              <Option<Exp> value="6to12m" selected={exp} label="6-12 months"         sub="Finding my footing"         onClick={setExp} />
              <Option<Exp> value="1to3y"  selected={exp} label="1-3 years"           sub="Getting comfortable"        onClick={setExp} />
              <Option<Exp> value="3plus"  selected={exp} label="3+ years"            sub="I know what I am doing"     onClick={setExp} />
            </div>
          </>
        )}

        {/* Step 1 — Trading style */}
        {step === 1 && (
          <>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt)', marginBottom: 6 }}>
              How do you mainly trade?
            </div>
            <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 20 }}>
              We will set your default chart timeframe to match.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Option<Style> value="scalp"    selected={style} label="Scalp"         sub="Minutes to hours — 5m chart" onClick={setStyle} />
              <Option<Style> value="swing"    selected={style} label="Swing trade"   sub="Days to weeks — 4h chart"    onClick={setStyle} />
              <Option<Style> value="both"     selected={style} label="Both"          sub="Depends on the setup"        onClick={setStyle} />
              <Option<Style> value="learning" selected={style} label="Still learning" sub="Not sure yet"               onClick={setStyle} />
            </div>
          </>
        )}

        {/* Step 2 — Account size */}
        {step === 2 && (
          <>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt)', marginBottom: 6 }}>
              What range fits your account?
            </div>
            <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 20 }}>
              Used to pre-fill the position sizer. You can change this anytime.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Option<Acct> value="1k5k"     selected={acct} label="$1k - $5k"     onClick={setAcct} />
              <Option<Acct> value="5k25k"    selected={acct} label="$5k - $25k"    onClick={setAcct} />
              <Option<Acct> value="25k100k"  selected={acct} label="$25k - $100k"  onClick={setAcct} />
              <Option<Acct> value="100kplus" selected={acct} label="$100k+"         onClick={setAcct} />
            </div>
          </>
        )}

        {/* Step 3 — Attribution */}
        {step === 3 && (
          <>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt)', marginBottom: 6 }}>
              Where did you hear about LiquidityHQ?
            </div>
            <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 20 }}>
              Optional - helps us know where to focus.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <SourceChip value="social"  selected={heard} label="Facebook / Instagram" onClick={setHeard} />
              <SourceChip value="youtube" selected={heard} label="YouTube"              onClick={setHeard} />
              <SourceChip value="tiktok"  selected={heard} label="TikTok"              onClick={setHeard} />
              <SourceChip value="search"  selected={heard} label="Search"              onClick={setHeard} />
              <SourceChip value="word"    selected={heard} label="Word of mouth"       onClick={setHeard} />
              <SourceChip value="other"   selected={heard} label="Other"               onClick={setHeard} />
            </div>
          </>
        )}

        {/* Next / Finish button */}
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
            fontSize: 14, fontWeight: 700, cursor: canNext() && !saving ? 'pointer' : 'not-allowed',
            transition: 'all 0.15s',
          }}
        >
          {saving ? 'Setting up...' : step === 3 ? 'Go to Dashboard' : 'Next'}
        </button>

        {/* Skip */}
        {step === 3 && (
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
      </div>
    </div>
  );
}
