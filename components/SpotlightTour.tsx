'use client';
import { useState, useEffect, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { useOnboarding } from './OnboardingProvider';
import { withAlpha } from '@/lib/color';
import { useLabels } from '@/lib/labels';
import { useTheme } from '@/lib/theme';
import type { LabelKey } from '@/lib/labelKeys';

const MONO = "var(--font-mono, 'IBM Plex Mono', monospace)";
const SANS = "var(--font-sans, 'Figtree', system-ui, sans-serif)";

// Every color here used to be a flat module-level dark-only constant - this
// whole component is inline-style (no CSS classes), so it never picked up
// [data-theme="light"] at all. Values below match the app's real light-theme
// tokens (app/globals.css's [data-theme="light"] block), not guesses.
const DARK = {
  ACCENT: 'var(--accent)', GREEN: 'var(--green)', RED: 'var(--red)', ORANGE: '#f97316',
  BG0: '#07090f', BG1: '#0c0f1c', BG2: '#101324',
  TXT1: '#eef0fa', TXT2: '#9296b5', TXT3: '#4e5374',
  BDR: 'rgba(26,122,255,0.1)', TRACK_BG: 'rgba(26,122,255,0.06)', GRID: 'rgba(26,122,255,0.05)',
  TG_BG: 'rgba(34,158,217,0.06)', TG_BDR: 'rgba(34,158,217,0.28)', TG_TXT: '#4db8e8',
  MODAL_SHADOW: '0 32px 80px rgba(0,0,0,0.7)',
};
const LIGHT = {
  ACCENT: '#0052CC', GREEN: '#047857', RED: '#B91C1C', ORANGE: '#C2410C',
  BG0: '#F2F3F5', BG1: '#FFFFFF', BG2: '#F2F3F5',
  TXT1: '#111318', TXT2: '#44475A', TXT3: '#63656F',
  BDR: 'rgba(0,82,204,0.14)', TRACK_BG: 'rgba(0,82,204,0.08)', GRID: 'rgba(0,82,204,0.08)',
  TG_BG: 'rgba(34,158,217,0.08)', TG_BDR: 'rgba(34,158,217,0.35)', TG_TXT: '#0e7fae',
  MODAL_SHADOW: '0 20px 48px rgba(20,25,40,0.18)',
};
type Palette = typeof DARK;
function usePalette(): Palette {
  const { theme } = useTheme();
  return theme === 'light' ? LIGHT : DARK;
}

/* ── Step 1 visual: three metric cards ── */
function Step1Visual() {
  const { t } = useLabels();
  const { ACCENT, RED, BG2, TXT3, BDR } = usePalette();
  const cards = [
    { id: 'card1', labelKey: 'SPOTLIGHT_TOUR_CARD1_LABEL', value: '-0.07%', subKey: 'SPOTLIGHT_TOUR_CARD1_SUB', color: RED },
    { id: 'card2', labelKey: 'SPOTLIGHT_TOUR_CARD2_LABEL', value: '+$38M',  subKey: 'SPOTLIGHT_TOUR_CARD2_SUB', color: RED },
    { id: 'card3', labelKey: 'SPOTLIGHT_TOUR_CARD3_LABEL', value: '82/100', subKey: 'SPOTLIGHT_TOUR_CARD3_SUB', color: ACCENT },
  ] as const;
  return (
    <div style={{ display: 'flex', gap: 8, width: '100%' }}>
      {cards.map(c => (
        <div key={c.id} style={{
          flex: 1, background: BG2, border: `1px solid ${BDR}`,
          borderRadius: 10, padding: '14px 10px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 'var(--fs-micro)', color: TXT3, fontFamily: MONO, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 6 }}>
            {t(c.labelKey)}
          </div>
          <div style={{ fontSize: 'var(--fs-data)', fontWeight: 800, color: c.color, fontFamily: MONO, letterSpacing: '-.02em' }}>
            {c.value}
          </div>
          <div style={{ fontSize: 'var(--fs-caption)', color: TXT3, marginTop: 4, lineHeight: 1.4 }}>
            {t(c.subKey)}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Step 2 visual: funding rate bar ── */
function Step2Visual() {
  const { t } = useLabels();
  const { ACCENT, RED, BG2, TXT2, TXT3, BDR, TRACK_BG } = usePalette();
  const [width, setWidth] = useState(0);
  useEffect(() => { const tid = setTimeout(() => setWidth(78), 120); return () => clearTimeout(tid); }, []);
  const ticks = ['+0.10%', '+0.05%', '0%', '-0.05%', '-0.10%'];
  return (
    <div style={{ width: '100%', background: BG2, border: `1px solid ${BDR}`, borderRadius: 12, padding: '20px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 'var(--fs-micro)', color: TXT2, fontFamily: MONO, letterSpacing: '.08em', textTransform: 'uppercase' }}>{t('SPOTLIGHT_TOUR_FUNDING_HEADER')}</span>
        <span style={{ fontSize: 'var(--fs-data)', fontWeight: 800, color: RED, fontFamily: MONO }}>-0.07%</span>
      </div>
      {/* Scale */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        {ticks.map(tick => (
          <span key={tick} style={{ fontSize: 'var(--fs-caption)', color: TXT3, fontFamily: MONO }}>{tick}</span>
        ))}
      </div>
      {/* Track */}
      <div style={{ position: 'relative', height: 10, background: TRACK_BG, borderRadius: 100, overflow: 'hidden' }}>
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
        {([
          { id: 'shortsPaying', labelKey: 'SPOTLIGHT_TOUR_CHIP_SHORTS_PAYING', col: RED },
          { id: 'overcrowded', labelKey: 'SPOTLIGHT_TOUR_CHIP_OVERCROWDED', col: RED },
          { id: 'squeezeFuel', labelKey: 'SPOTLIGHT_TOUR_CHIP_SQUEEZE_FUEL', col: ACCENT },
        ] as const).map(chip => (
          <span key={chip.id} style={{
            fontSize: 'var(--fs-caption)', fontWeight: 600, padding: '3px 10px',
            borderRadius: 100, border: `1px solid ${withAlpha(chip.col, '30')}`,
            background: withAlpha(chip.col, '10'), color: chip.col, fontFamily: MONO,
          }}>
            {t(chip.labelKey)}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Step 3 visual: OI change bars ── */
function Step3Visual() {
  const { t } = useLabels();
  const { RED, BG2, TXT2, TXT3, BDR } = usePalette();
  const bars = [
    { label: '20h', val: 18, color: TXT3 },
    { label: '16h', val: 24, color: TXT3 },
    { label: '12h', val: 22, color: TXT3 },
    { label: '8h',  val: 31, color: RED  },
    { label: '4h',  val: 55, color: RED  },
    { label: 'Now', val: 72, color: RED  },
  ];
  const [animated, setAnimated] = useState(false);
  useEffect(() => { const tid = setTimeout(() => setAnimated(true), 100); return () => clearTimeout(tid); }, []);
  return (
    <div style={{ width: '100%', background: BG2, border: `1px solid ${BDR}`, borderRadius: 12, padding: '20px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 'var(--fs-micro)', color: TXT2, fontFamily: MONO, letterSpacing: '.08em', textTransform: 'uppercase' }}>{t('SPOTLIGHT_TOUR_OI_HEADER')}</span>
        <span style={{ fontSize: 'var(--fs-data)', fontWeight: 800, color: RED, fontFamily: MONO }}>+$38.4M</span>
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
            <span style={{ fontSize: 'var(--fs-caption)', color: TXT3, fontFamily: MONO }}>{b.label}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, fontSize: 'var(--fs-caption)', color: TXT3, lineHeight: 1.5 }}>
        {t('SPOTLIGHT_TOUR_OI_CAPTION')}
      </div>
    </div>
  );
}

/* ── Step 4 visual: fake signal card ── */
function Step4Visual() {
  const { t } = useLabels();
  const { ACCENT, GREEN, RED, BG2, TXT1, TXT2, TXT3, BDR } = usePalette();
  const [alertShown, setAlertShown] = useState(false);
  useEffect(() => { const tid = setTimeout(() => setAlertShown(true), 600); return () => clearTimeout(tid); }, []);
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Signal card */}
      <div style={{
        background: BG2, border: `1px solid ${BDR}`,
        borderRadius: 10, padding: '14px 16px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 'var(--fs-data)', fontWeight: 800, color: TXT1, fontFamily: MONO }}>BTC</span>
            <span style={{
              fontSize: 'var(--fs-caption)', fontWeight: 700, padding: '2px 8px',
              borderRadius: 100, background: withAlpha(RED, '18'), color: RED, fontFamily: MONO,
              letterSpacing: '.06em',
            }}>SHORT_SQ</span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '1.25rem', fontWeight: 900, color: RED, fontFamily: MONO, lineHeight: 1 }}>82</div>
            <div style={{ fontSize: 'var(--fs-caption)', color: TXT3, fontFamily: MONO }}>/ 100</div>
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
              fontSize: 'var(--fs-caption)', padding: '3px 8px', borderRadius: 6,
              background: withAlpha(chip.col, '12'), color: chip.col,
              border: `1px solid ${withAlpha(chip.col, '25')}`, fontFamily: MONO, fontWeight: 600,
            }}>
              {chip.label}
            </span>
          ))}
        </div>
      </div>
      {/* Telegram alert toast */}
      <div style={{
        background: withAlpha(GREEN, '08'), border: `1px solid ${withAlpha(GREEN, '30')}`,
        borderRadius: 10, padding: '10px 14px',
        display: 'flex', alignItems: 'center', gap: 10,
        opacity: alertShown ? 1 : 0,
        transform: alertShown ? 'translateY(0)' : 'translateY(6px)',
        transition: 'opacity 0.4s, transform 0.4s',
      }}>
        <span style={{ fontSize: '1.125rem', flexShrink: 0 }}>✈</span>
        <div>
          <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: GREEN, fontFamily: MONO }}>{t('SPOTLIGHT_TOUR_TELEGRAM_SENT')}</div>
          <div style={{ fontSize: 'var(--fs-caption)', color: TXT3, marginTop: 1 }}>{t('SPOTLIGHT_TOUR_TELEGRAM_BODY')}</div>
        </div>
      </div>
    </div>
  );
}

/* ── Step 5 visual: animated arena chart mockup ── */
function Step5Visual() {
  const { t } = useLabels();
  const { ACCENT, GREEN, RED, ORANGE, BG0, BG2, TXT1, TXT3, BDR, GRID, TG_BG, TG_BDR, TG_TXT } = usePalette();
  const [phase,       setPhase]       = useState(0);
  const [markerScale, setMarkerScale] = useState(0);
  const [pulse,       setPulse]       = useState(false);

  // Staggered reveal sequence
  useEffect(() => {
    const ts = [
      setTimeout(() => setPhase(1),  100),  // candles
      setTimeout(() => setPhase(2),  420),  // EMA lines
      setTimeout(() => setPhase(3),  740),  // signal marker
      setTimeout(() => setPhase(4),  980),  // signal card
      setTimeout(() => setPhase(5), 1240),  // telegram toast
    ];
    return () => ts.forEach(clearTimeout);
  }, []);

  // Bounce-in when marker appears
  useEffect(() => {
    if (phase < 3) return;
    setMarkerScale(0);
    const ts = [
      setTimeout(() => setMarkerScale(1.45), 10),
      setTimeout(() => setMarkerScale(0.82), 190),
      setTimeout(() => setMarkerScale(1.14), 300),
      setTimeout(() => setMarkerScale(1.0),  390),
    ];
    return () => ts.forEach(clearTimeout);
  }, [phase]);

  // Pulse glow ring via setInterval (works without rAF)
  useEffect(() => {
    if (phase < 3) return;
    const id = setInterval(() => setPulse(p => !p), 850);
    return () => clearInterval(id);
  }, [phase]);

  // Chart geometry - viewBox 0 0 264 84
  const MIN_P = 38, MAX_P = 70, CH = 80;
  const yp = (p: number) => 4 + (1 - (p - MIN_P) / (MAX_P - MIN_P)) * CH;

  // [cx, open, close, high, low]
  const CANDLES: [number, number, number, number, number][] = [
    [14,  48, 44, 50, 43],
    [40,  44, 47, 48, 43],
    [66,  47, 45, 48, 44],
    [92,  45, 49, 51, 44],
    [118, 49, 47, 50, 46],
    [144, 47, 53, 55, 46],
    [170, 53, 51, 54, 49],
    [196, 51, 56, 58, 50],
    [222, 56, 60, 62, 55],
    [248, 60, 66, 68, 59],  // signal candle
  ];
  const CW = 18;

  // Pre-computed EMA values (EMA9 crosses above EMA20 at candle ~5)
  const ema9  = [47.0, 46.6, 46.3, 46.8, 47.0, 48.8, 49.4, 50.9, 52.6, 55.0];
  const ema20 = [47.0, 46.6, 46.4, 46.7, 47.0, 47.9, 48.3, 49.1, 50.0, 51.2];
  const ema50 = [47.0, 46.8, 46.7, 46.8, 46.9, 47.2, 47.4, 47.8, 48.3, 49.0];
  const pts   = (vals: number[]) => CANDLES.map(([cx], i) => `${cx},${yp(vals[i]).toFixed(1)}`).join(' ');

  const [sigCX, , , , sigLow] = CANDLES[CANDLES.length - 1];
  const sigY = yp(sigLow) + 11;

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 7 }}>
      {/* Chart */}
      <div style={{ background: BG0, border: `1px solid ${BDR}`, borderRadius: 10, padding: '8px 8px 4px' }}>
        {/* Chart header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
          <span style={{ fontSize: 'var(--fs-caption)', color: TXT3, fontFamily: MONO, letterSpacing: '.08em' }}>BTCUSDT · 4H</span>
          <div style={{ display: 'flex', gap: 10 }}>
            {([['EMA9', ACCENT], ['EMA20', ORANGE], ['EMA50', TXT3]] as const).map(([l, c]) => (
              <span key={l} style={{ fontSize: 'var(--fs-caption)', color: c, fontFamily: MONO }}>─ {l}</span>
            ))}
          </div>
        </div>

        <svg width="100%" viewBox="0 0 264 96" style={{ display: 'block', overflow: 'visible' }}>
          {/* Subtle grid */}
          {[22, 44, 66].map(y => (
            <line key={y} x1="0" y1={y} x2="264" y2={y} stroke={GRID} strokeWidth="0.5" />
          ))}

          {/* EMA lines - phase 2 */}
          {phase >= 2 && <>
            <polyline points={pts(ema50)} fill="none" stroke={TXT3}     strokeWidth="1"   strokeOpacity="0.35" />
            <polyline points={pts(ema20)} fill="none" stroke={ORANGE}  strokeWidth="1.2" strokeOpacity="0.55" />
            <polyline points={pts(ema9)}  fill="none" stroke={ACCENT}   strokeWidth="1.5" strokeOpacity="0.9" />
          </>}

          {/* Candles - phase 1, staggered */}
          {phase >= 1 && CANDLES.map(([cx, o, c, h, l], i) => {
            const bull  = c >= o;
            const col   = bull ? GREEN : RED;
            const bTop  = yp(Math.max(o, c));
            const bH    = Math.max(Math.abs(yp(o) - yp(c)), 1.5);
            const isLast = i === CANDLES.length - 1;
            return (
              <g key={i} style={{ opacity: 1, transition: `opacity 0.22s ${i * 32}ms` }}>
                <line x1={cx} y1={yp(h)} x2={cx} y2={yp(l)}
                  stroke={col} strokeWidth="1.2" strokeOpacity={isLast ? 0.9 : 0.6} />
                <rect x={cx - CW / 2} y={bTop} width={CW} height={bH} rx="1.5"
                  fill={col} fillOpacity={isLast ? 0.92 : 0.65} />
              </g>
            );
          })}

          {/* Score badge above signal candle */}
          {phase >= 3 && (
            <g transform={`translate(${sigCX - 13}, 0)`}>
              <rect width="26" height="13" rx="3" fill={ACCENT} />
              <text x="13" y="9.5" fontSize="7.5" fill="white" fontWeight="800"
                textAnchor="middle" fontFamily="var(--font-mono,'IBM Plex Mono',monospace)">87</text>
            </g>
          )}

          {/* BUY signal marker - phase 3, bounce + pulse */}
          {phase >= 3 && (
            <g transform={`translate(${sigCX},${sigY}) scale(${markerScale})`}>
              {/* Expanding glow ring */}
              <circle r="13" fill="none" stroke={GREEN} strokeWidth="1"
                style={{ opacity: pulse ? 0.55 : 0.08, transition: 'opacity 0.85s ease' }} />
              {/* Inner glow disc */}
              <circle r="7" fill={withAlpha(GREEN, '1a')} />
              {/* Upward triangle */}
              <polygon points="0,-6.5 -5.5,3.5 5.5,3.5" fill={GREEN} />
              {/* BUY label */}
              <text x="9" y="2.5" fontSize="7" fill={GREEN} fontWeight="700"
                fontFamily="var(--font-mono,'IBM Plex Mono',monospace)">BUY</text>
            </g>
          )}
        </svg>
      </div>

      {/* Signal card */}
      <div style={{
        background: BG2, border: `1px solid ${BDR}`,
        borderRadius: 8, padding: '8px 11px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
        opacity: phase >= 4 ? 1 : 0,
        transform: phase >= 4 ? 'translateY(0)' : 'translateY(5px)',
        transition: 'opacity 0.3s, transform 0.3s',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 800, color: TXT1, fontFamily: MONO }}>BTC</span>
          <span style={{
            fontSize: 'var(--fs-caption)', padding: '2px 7px', borderRadius: 100,
            background: withAlpha(GREEN, '18'), color: GREEN, fontFamily: MONO, fontWeight: 700, letterSpacing: '.05em',
          }}>LONG_SQ</span>
          {(['EMA ×', 'VOL 2.1×', 'FR+'] as const).map(chip => (
            <span key={chip} style={{
              fontSize: 'var(--fs-caption)', padding: '2px 6px', borderRadius: 4, fontFamily: MONO, fontWeight: 600,
              background: withAlpha(ACCENT, '12'), color: ACCENT, border: `1px solid ${withAlpha(ACCENT, '22')}`,
            }}>{chip}</span>
          ))}
        </div>
        <span style={{ fontSize: '1.125rem', fontWeight: 900, color: GREEN, fontFamily: MONO, flexShrink: 0 }}>87</span>
      </div>

      {/* Telegram toast */}
      <div style={{
        background: TG_BG, border: `1px solid ${TG_BDR}`,
        borderRadius: 8, padding: '7px 12px',
        display: 'flex', alignItems: 'center', gap: 9,
        opacity: phase >= 5 ? 1 : 0,
        transform: phase >= 5 ? 'translateY(0)' : 'translateY(4px)',
        transition: 'opacity 0.3s, transform 0.3s',
      }}>
        <span style={{ fontSize: '0.875rem', flexShrink: 0 }}>✈</span>
        <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: TG_TXT, fontFamily: MONO }}>
          {t('SPOTLIGHT_TOUR_ALERT_FIRED')}
        </span>
      </div>
    </div>
  );
}

const STEPS: {
  tagKey:   LabelKey;
  titleKey: LabelKey;
  bodyKey:  LabelKey;
  Visual:   () => ReactElement;
}[] = [
  {
    tagKey:   'SPOTLIGHT_TOUR_STEP1_TAG',
    titleKey: 'SPOTLIGHT_TOUR_STEP1_TITLE',
    bodyKey:  'SPOTLIGHT_TOUR_STEP1_BODY',
    Visual:   Step1Visual,
  },
  {
    tagKey:   'SPOTLIGHT_TOUR_STEP2_TAG',
    titleKey: 'SPOTLIGHT_TOUR_STEP2_TITLE',
    bodyKey:  'SPOTLIGHT_TOUR_STEP2_BODY',
    Visual:   Step2Visual,
  },
  {
    tagKey:   'SPOTLIGHT_TOUR_STEP3_TAG',
    titleKey: 'SPOTLIGHT_TOUR_STEP3_TITLE',
    bodyKey:  'SPOTLIGHT_TOUR_STEP3_BODY',
    Visual:   Step3Visual,
  },
  {
    tagKey:   'SPOTLIGHT_TOUR_STEP4_TAG',
    titleKey: 'SPOTLIGHT_TOUR_STEP4_TITLE',
    bodyKey:  'SPOTLIGHT_TOUR_STEP4_BODY',
    Visual:   Step4Visual,
  },
  {
    tagKey:   'SPOTLIGHT_TOUR_STEP5_TAG',
    titleKey: 'SPOTLIGHT_TOUR_STEP5_TITLE',
    bodyKey:  'SPOTLIGHT_TOUR_STEP5_BODY',
    Visual:   Step5Visual,
  },
];

export default function SpotlightTour({ onDone }: { onDone: () => void }) {
  const { t } = useLabels();
  const { ACCENT, BG1, TXT1, TXT2, TXT3, BDR, TRACK_BG, MODAL_SHADOW } = usePalette();
  const { markDone } = useOnboarding();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [animKey, setAnimKey] = useState(0);
  /* The rest of this component's motion lives in CSS classes that the global
     prefers-reduced-motion block already covers; the dots are inline-styled, so
     they have to read the preference themselves. Evaluated in an effect rather
     than at render so the server and first client render agree. */
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduceMotion(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

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
        // Was 0.92 - much heavier than this app's own backdrop convention
        // elsewhere (.smod-backdrop uses 0.55) - read as "too dark" against it.
        background: 'rgba(4,5,10,0.55)',
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
          boxShadow: `${MODAL_SHADOW}, 0 0 0 1px ${withAlpha(ACCENT, '0f')}`,
        }}
      >
        {/* Progress bar */}
        <div style={{ height: 3, background: TRACK_BG }}>
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
              fontSize: 'var(--fs-caption)', fontWeight: 700, fontFamily: MONO,
              letterSpacing: '.14em', color: ACCENT,
            }}>
              {t(current.tagKey)}
            </span>
            <button
              onClick={close}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: TXT3, fontSize: '1rem', padding: '2px 4px', lineHeight: 1,
              }}
              aria-label={t('SPOTLIGHT_TOUR_SKIP_ARIA')}
            >
              ✕
            </button>
          </div>

          {/* Visual panel. Fixed height, not just min-height matching its
              tallest content: Step1Visual's 3-card row measures ~95px tall,
              Step5Visual's full chart mockup ~282px - a bare-content div let
              the whole modal card jump from 337px to 525px on a single Next
              click, since nothing below (text, nav, progress bar) varies
              nearly as much. 290px covers the tallest step measured in
              English plus headroom for locales whose chip/toast text runs
              longer and wraps a line. Centered so shorter visuals (Step1)
              sit in the middle of the frame instead of stranded at its top. */}
          <div key={`v-${animKey}`} style={{
            marginBottom: 20,
            minHeight: 290,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            // Was 'ob-fade-up' - not a real keyframe name (globals.css defines
            // the camelCase obFadeUp, used elsewhere via the .ob-fade-up
            // CLASS; this inline animation shorthand needs the @keyframes
            // identifier itself, not the class that wraps it). getAnimations()
            // confirmed zero animations were ever running here - both this
            // panel and the text block below appeared instantly, with no fade.
            animation: 'obFadeUp 0.35s cubic-bezier(0.16,1,0.3,1) both',
          }}>
            <Visual />
          </div>

          {/* Text */}
          <div key={`t-${animKey}`} style={{ animation: 'obFadeUp 0.35s 0.05s cubic-bezier(0.16,1,0.3,1) both' }}>
            <h2 style={{
              fontSize: 'var(--fs-section)', fontWeight: 800, color: TXT1,
              margin: '0 0 8px', lineHeight: 1.2, letterSpacing: '-.02em',
            }}>
              {t(current.titleKey)}
            </h2>
            <p style={{
              fontSize: 'var(--fs-label)', color: TXT2, lineHeight: 1.65,
              margin: 0,
            }}>
              {t(current.bodyKey)}
            </p>
          </div>

          {/* Navigation */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 22 }}>
            {/* Dots. Timing is deliberate: these used to run 0.3s on
                cubic-bezier(0.16,1,0.3,1) - an expo-style curve that covers most
                of its distance in the first quarter of the duration. At 14px of
                travel that reads as an instant jump, and it finished before the
                0.38s content fade and the 0.4s progress bar, so the one element
                the eye tracks during a step change was the one that snapped.
                Now 0.42s on easeOutCubic, landing with the rest of the step. */}
            <div style={{ display: 'flex', gap: 5, flex: 1 }}>
              {STEPS.map((_, i) => (
                <div key={i} style={{
                  height: 4,
                  width: i === step ? 20 : 6,
                  borderRadius: 100,
                  background: i === step ? ACCENT : i < step ? withAlpha(ACCENT, '50') : TRACK_BG,
                  // Named properties, not `all` - `all` also transitions
                  // border-radius and would fight the pill shape mid-animation.
                  transition: reduceMotion
                    ? 'none'
                    : 'width 0.42s cubic-bezier(0.33,1,0.68,1), background-color 0.3s ease',
                }} />
              ))}
            </div>

            {step > 0 && (
              <button
                onClick={back}
                style={{
                  padding: '10px 16px', borderRadius: 8, cursor: 'pointer',
                  background: 'transparent', border: `1px solid ${BDR}`,
                  color: TXT3, fontSize: 'var(--fs-caption)', fontWeight: 700, fontFamily: MONO,
                  letterSpacing: '.04em',
                }}
              >
                {t('SPOTLIGHT_TOUR_BACK_BTN')}
              </button>
            )}
            <button
              onClick={next}
              style={{
                padding: '10px 22px', borderRadius: 8, cursor: 'pointer',
                background: ACCENT, border: 'none',
                color: '#fff', fontSize: 'var(--fs-caption)', fontWeight: 700, fontFamily: MONO,
                letterSpacing: '.05em',
                boxShadow: `0 4px 20px ${withAlpha(ACCENT, '40')}`,
              }}
            >
              {isLast ? t('SPOTLIGHT_TOUR_OPEN_ARENA_BTN') : t('SPOTLIGHT_TOUR_NEXT_BTN')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
