'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useOnboarding } from './OnboardingProvider';

const ACCENT  = '#1a7aff';
const GREEN   = '#4ade80';
const RED     = '#f87171';
const BG0     = '#07090f';
const BG1     = '#0c0f1c';
const BG2     = '#101324';
const TXT1    = '#eef0fa';
const TXT2    = '#9296b5';
const TXT3    = '#4e5374';
const BDR     = 'rgba(140,150,255,0.1)';
const MONO    = "var(--font-mono, 'IBM Plex Mono', monospace)";
const SANS    = "var(--font-sans, 'Figtree', system-ui, sans-serif)";

/* ── Step 1 visual: three metric cards ── */
function Step1Visual() {
  const cards = [
    { label: 'Funding Rate', value: '-0.07%', sub: '3× more shorts', color: RED },
    { label: 'OI Change 4h',  value: '+$38M',  sub: 'New shorts piling in', color: RED },
    { label: 'Squeeze Score', value: '82/100', sub: 'SHORT_SQ forming', color: ACCENT },
  ];
  return (
    <div style={{ display: 'flex', gap: 8, width: '100%' }}>
      {cards.map(c => (
        <div key={c.label} style={{
          flex: 1, background: BG2, border: `1px solid ${BDR}`,
          borderRadius: 10, padding: '14px 10px', textAlign: 'center',
          borderTop: `2px solid ${c.color}`,
        }}>
          <div style={{ fontSize: 9, color: TXT3, fontFamily: MONO, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 6 }}>
            {c.label}
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: c.color, fontFamily: MONO, letterSpacing: '-.02em' }}>
            {c.value}
          </div>
          <div style={{ fontSize: 9, color: TXT3, marginTop: 4, lineHeight: 1.4 }}>
            {c.sub}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Step 2 visual: funding rate bar ── */
function Step2Visual() {
  const [width, setWidth] = useState(0);
  useEffect(() => { const t = setTimeout(() => setWidth(78), 120); return () => clearTimeout(t); }, []);
  const ticks = ['+0.10%', '+0.05%', '0%', '-0.05%', '-0.10%'];
  return (
    <div style={{ width: '100%', background: BG2, border: `1px solid ${BDR}`, borderRadius: 12, padding: '20px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 10, color: TXT2, fontFamily: MONO, letterSpacing: '.08em', textTransform: 'uppercase' }}>Funding Rate — BTC</span>
        <span style={{ fontSize: 16, fontWeight: 800, color: RED, fontFamily: MONO }}>-0.07%</span>
      </div>
      {/* Scale */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        {ticks.map(t => (
          <span key={t} style={{ fontSize: 8, color: TXT3, fontFamily: MONO }}>{t}</span>
        ))}
      </div>
      {/* Track */}
      <div style={{ position: 'relative', height: 10, background: 'rgba(140,150,255,0.06)', borderRadius: 100, overflow: 'hidden' }}>
        {/* neutral center line */}
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: BDR }} />
        {/* fill from center leftward (negative) */}
        <div style={{
          position: 'absolute', right: '50%', top: 0, bottom: 0,
          width: `${width * 0.7}%`, background: RED,
          borderRadius: '100px 0 0 100px',
          transition: 'width 0.9s cubic-bezier(0.16,1,0.3,1)',
          opacity: 0.85,
        }} />
      </div>
      <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[
          { label: 'Shorts paying longs', col: RED },
          { label: 'Overcrowded short side', col: RED },
          { label: 'Squeeze fuel building', col: ACCENT },
        ].map(chip => (
          <span key={chip.label} style={{
            fontSize: 10, fontWeight: 600, padding: '3px 10px',
            borderRadius: 100, border: `1px solid ${chip.col}30`,
            background: `${chip.col}10`, color: chip.col, fontFamily: MONO,
          }}>
            {chip.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Step 3 visual: OI change bars ── */
function Step3Visual() {
  const bars = [
    { label: '20h', val: 18, color: TXT3 },
    { label: '16h', val: 24, color: TXT3 },
    { label: '12h', val: 22, color: TXT3 },
    { label: '8h',  val: 31, color: RED  },
    { label: '4h',  val: 55, color: RED  },
    { label: 'Now', val: 72, color: RED  },
  ];
  const [animated, setAnimated] = useState(false);
  useEffect(() => { const t = setTimeout(() => setAnimated(true), 100); return () => clearTimeout(t); }, []);
  return (
    <div style={{ width: '100%', background: BG2, border: `1px solid ${BDR}`, borderRadius: 12, padding: '20px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 10, color: TXT2, fontFamily: MONO, letterSpacing: '.08em', textTransform: 'uppercase' }}>Open Interest Change — BTC</span>
        <span style={{ fontSize: 16, fontWeight: 800, color: RED, fontFamily: MONO }}>+$38.4M</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 64 }}>
        {bars.map(b => (
          <div key={b.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{
              width: '100%', borderRadius: '4px 4px 0 0',
              background: b.color,
              height: animated ? `${(b.val / 72) * 52}px` : '0px',
              opacity: animated ? (b.color === TXT3 ? 0.3 : 0.75) : 0,
              transition: 'height 0.7s cubic-bezier(0.16,1,0.3,1), opacity 0.4s',
              transitionDelay: `${bars.indexOf(b) * 60}ms`,
            }} />
            <span style={{ fontSize: 8, color: TXT3, fontFamily: MONO }}>{b.label}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, fontSize: 11, color: TXT3, lineHeight: 1.5 }}>
        Each red bar = more shorts entering. The last 3 bars (red) accelerated — a squeeze is loading.
      </div>
    </div>
  );
}

/* ── Step 4 visual: fake signal card ── */
function Step4Visual() {
  const [alertShown, setAlertShown] = useState(false);
  useEffect(() => { const t = setTimeout(() => setAlertShown(true), 600); return () => clearTimeout(t); }, []);
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Signal card */}
      <div style={{
        background: BG2, border: `1px solid ${RED}30`,
        borderLeft: `3px solid ${RED}`,
        borderRadius: 10, padding: '14px 16px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: TXT1, fontFamily: MONO }}>BTC</span>
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 8px',
              borderRadius: 100, background: `${RED}18`, color: RED, fontFamily: MONO,
              letterSpacing: '.06em',
            }}>SHORT_SQ</span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 20, fontWeight: 900, color: RED, fontFamily: MONO, lineHeight: 1 }}>82</div>
            <div style={{ fontSize: 8, color: TXT3, fontFamily: MONO }}>/ 100</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {[
            { label: 'FR -0.07%', col: RED },
            { label: 'OI +$38M', col: RED },
            { label: 'Vol 1.8×', col: ACCENT },
            { label: 'RSI 28', col: ACCENT },
            { label: 'VWAP below', col: TXT2 },
          ].map(chip => (
            <span key={chip.label} style={{
              fontSize: 10, padding: '3px 8px', borderRadius: 6,
              background: `${chip.col}12`, color: chip.col,
              border: `1px solid ${chip.col}25`, fontFamily: MONO, fontWeight: 600,
            }}>
              {chip.label}
            </span>
          ))}
        </div>
      </div>
      {/* Telegram alert toast */}
      <div style={{
        background: `${GREEN}08`, border: `1px solid ${GREEN}30`,
        borderRadius: 10, padding: '10px 14px',
        display: 'flex', alignItems: 'center', gap: 10,
        opacity: alertShown ? 1 : 0,
        transform: alertShown ? 'translateY(0)' : 'translateY(6px)',
        transition: 'opacity 0.4s, transform 0.4s',
      }}>
        <span style={{ fontSize: 18, flexShrink: 0 }}>✈</span>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: GREEN, fontFamily: MONO }}>Telegram alert sent</div>
          <div style={{ fontSize: 10, color: TXT3, marginTop: 1 }}>BTC SHORT_SQ 82/100 — squeeze forming</div>
        </div>
      </div>
    </div>
  );
}

/* ── Step 5 visual: live coin scores ── */
function Step5Visual() {
  const coins = [
    { coin: 'BTC', score: 82, type: 'SHORT_SQ', col: RED },
    { coin: 'SOL', score: 71, type: 'SHORT_SQ', col: RED },
    { coin: 'ETH', score: 58, type: 'LONG_LIQ', col: '#f97316' },
  ];
  return (
    <div style={{ width: '100%', background: BG2, border: `1px solid ${BDR}`, borderRadius: 12, padding: '16px' }}>
      <div style={{ fontSize: 9, color: TXT3, fontFamily: MONO, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 12 }}>
        Live scanner right now
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {coins.map((c, i) => (
          <div key={c.coin} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 12px', borderRadius: 8,
            background: `${c.col}08`, border: `1px solid ${c.col}20`,
            opacity: 0, animation: `ob-fade-up 0.3s ${i * 100 + 100}ms both`,
          }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: TXT1, fontFamily: MONO, width: 36 }}>{c.coin}</span>
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 7px',
              borderRadius: 100, background: `${c.col}18`, color: c.col, fontFamily: MONO,
            }}>{c.type}</span>
            <div style={{ flex: 1, height: 4, background: 'rgba(140,150,255,0.06)', borderRadius: 100, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${c.score}%`, background: c.col, borderRadius: 100, opacity: 0.7 }} />
            </div>
            <span style={{ fontSize: 14, fontWeight: 900, color: c.col, fontFamily: MONO, width: 32, textAlign: 'right' }}>{c.score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const STEPS = [
  {
    tag:     'THE SETUP',
    title:   'This is a squeeze setup.',
    body:    'When shorts overcrowd a market and price reverses, they all close at once — that spike is the squeeze. LiquidityHQ detects it before it fires.',
    Visual:  Step1Visual,
  },
  {
    tag:     'SIGNAL 1 OF 3',
    title:   'Funding rate goes negative.',
    body:    "When funding is negative, shorts pay longs to hold their position. It means the market is overcrowded on the short side — and that's exactly the fuel a squeeze needs.",
    Visual:  Step2Visual,
  },
  {
    tag:     'SIGNAL 2 OF 3',
    title:   'Open interest climbs.',
    body:    'More shorts are opening. Every new short is potential energy. When price reverses even slightly, margin calls cascade — that acceleration is the squeeze.',
    Visual:  Step3Visual,
  },
  {
    tag:     'SIGNAL 3 OF 3',
    title:   'LiquidityHQ scores it and alerts you.',
    body:    'Funding rate, OI change, volume, and RSI are combined into a single score. When it hits 70+, a Telegram alert fires before the crowd sees the move.',
    Visual:  Step4Visual,
  },
  {
    tag:     "YOU'RE READY",
    title:   'Your scanner is live right now.',
    body:    'LiquidityHQ is scanning every major coin in real time. Open Arena to see live scores, pick a coin, and let LiquidityAI analyze the setup for you.',
    Visual:  Step5Visual,
  },
];

export default function SpotlightTour({ onDone }: { onDone: () => void }) {
  const { markDone } = useOnboarding();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [animKey, setAnimKey] = useState(0);

  const current = STEPS[step];
  const isLast  = step === STEPS.length - 1;

  function close() {
    markDone('tourSeen');
    onDone();
  }

  function next() {
    if (isLast) {
      close();
      router.push('/arena');
      return;
    }
    setAnimKey(k => k + 1);
    setStep(s => s + 1);
  }

  function back() {
    setAnimKey(k => k + 1);
    setStep(s => s - 1);
  }

  const Visual = current.Visual;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 10001,
        background: 'rgba(4,5,10,0.92)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
        backdropFilter: 'blur(4px)',
        fontFamily: SANS,
      }}
      onClick={close}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480,
          background: BG1, border: `1px solid ${BDR}`,
          borderRadius: 16,
          overflow: 'hidden',
          boxShadow: '0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(140,150,255,0.06)',
        }}
      >
        {/* Progress bar */}
        <div style={{ height: 3, background: 'rgba(140,150,255,0.06)' }}>
          <div style={{
            height: '100%',
            width: `${((step + 1) / STEPS.length) * 100}%`,
            background: ACCENT,
            transition: 'width 0.4s cubic-bezier(0.16,1,0.3,1)',
          }} />
        </div>

        <div style={{ padding: '24px 24px 20px' }}>
          {/* Tag + close */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <span style={{
              fontSize: 9, fontWeight: 700, fontFamily: MONO,
              letterSpacing: '.14em', color: ACCENT,
            }}>
              {current.tag}
            </span>
            <button
              onClick={close}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: TXT3, fontSize: 16, padding: '2px 4px', lineHeight: 1,
              }}
              aria-label="Skip tour"
            >
              ✕
            </button>
          </div>

          {/* Visual panel */}
          <div key={`v-${animKey}`} style={{
            marginBottom: 20,
            animation: 'ob-fade-up 0.35s cubic-bezier(0.16,1,0.3,1) both',
          }}>
            <Visual />
          </div>

          {/* Text */}
          <div key={`t-${animKey}`} style={{ animation: 'ob-fade-up 0.35s 0.05s cubic-bezier(0.16,1,0.3,1) both' }}>
            <h2 style={{
              fontSize: 20, fontWeight: 800, color: TXT1,
              margin: '0 0 8px', lineHeight: 1.2, letterSpacing: '-.02em',
            }}>
              {current.title}
            </h2>
            <p style={{
              fontSize: 13, color: TXT2, lineHeight: 1.65,
              margin: 0,
            }}>
              {current.body}
            </p>
          </div>

          {/* Navigation */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 22 }}>
            {/* Dots */}
            <div style={{ display: 'flex', gap: 5, flex: 1 }}>
              {STEPS.map((_, i) => (
                <div key={i} style={{
                  height: 4,
                  width: i === step ? 20 : 6,
                  borderRadius: 100,
                  background: i === step ? ACCENT : i < step ? `${ACCENT}50` : 'rgba(140,150,255,0.12)',
                  transition: 'all 0.3s cubic-bezier(0.16,1,0.3,1)',
                }} />
              ))}
            </div>

            {step > 0 && (
              <button
                onClick={back}
                style={{
                  padding: '10px 16px', borderRadius: 8, cursor: 'pointer',
                  background: 'transparent', border: `1px solid ${BDR}`,
                  color: TXT3, fontSize: 12, fontWeight: 700, fontFamily: MONO,
                  letterSpacing: '.04em',
                }}
              >
                ← Back
              </button>
            )}
            <button
              onClick={next}
              style={{
                padding: '10px 22px', borderRadius: 8, cursor: 'pointer',
                background: ACCENT, border: 'none',
                color: '#fff', fontSize: 12, fontWeight: 700, fontFamily: MONO,
                letterSpacing: '.05em',
                boxShadow: `0 4px 20px ${ACCENT}40`,
              }}
            >
              {isLast ? 'Open Arena →' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
